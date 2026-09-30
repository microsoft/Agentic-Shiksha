import hashlib
import io
import re
import warnings
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree

import fitz
from PIL import Image, UnidentifiedImageError

from backend.schemas.course_materials import MaterialPreflight


MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_BATCH_BYTES = 250 * 1024 * 1024
MAX_FILES = 100
MAX_PDF_PAGES = 2000
INDEX_PART_BYTES = 16_000_000
INDEX_PART_PAGES = 50
EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
PART_PATTERN = re.compile(r"^(?P<stem>.+)--(?P<source>[a-f0-9]{32})--p(?P<first>\d{6})-(?P<last>\d{6})\.pdf$")
COPY_PATTERN = re.compile(r"^.+--(?P<source>[a-f0-9]{32})(?:--s\d{6})?\.[a-z]+$")


class MaterialRejected(ValueError):
    pass


@dataclass(frozen=True)
class PreparedPart:
    filename: str
    content: bytes
    page_start: int | None = None
    page_end: int | None = None


def safe_material_filename(name: str) -> str:
    base = PurePosixPath(name.replace("\\", "/")).name
    base = re.sub(r"[\x00-\x1f\x7f]", "", base)
    base = re.sub(r"[^A-Za-z0-9.\-_\s]", "_", base)
    base = re.sub(r"[\s_]+", "_", base).strip("._")
    path = PurePosixPath(base)
    if not base or path.suffix.lower() not in EXTENSIONS:
        raise MaterialRejected("Unsupported file type. Use PDF, DOCX, TXT, Markdown, PNG, JPEG, TIFF, or BMP.")
    return f"{(path.stem or 'file')[:80]}{path.suffix.lower()}"


def inspect_material(filename: str, content: bytes) -> MaterialPreflight:
    stored = safe_material_filename(filename)
    if not content or len(content) > MAX_FILE_BYTES:
        raise MaterialRejected("Files must be nonempty and no larger than 100 MiB.")
    extension = PurePosixPath(stored).suffix
    if extension != ".pdf" and len(content) > INDEX_PART_BYTES:
        raise MaterialRejected("Non-PDF files must be no larger than 16 MB for indexing. Convert or split this file first.")
    digest = hashlib.sha256(content).hexdigest()
    original = PurePosixPath(filename.replace("\\", "/")).name
    original = re.sub(r"[\x00-\x1f\x7f]", "", original)[:255]
    report = MaterialPreflight(
        filename=original, stored_filename=stored, sha256=digest,
        source_id=hashlib.sha256(f"{original}\0{digest}".encode()).hexdigest()[:32],
        size_bytes=len(content),
    )
    try:
        if extension == ".pdf":
            with fitz.open(stream=content, filetype="pdf") as document:
                if document.needs_pass:
                    raise MaterialRejected("Unlock this PDF before uploading it.")
                if document.is_repaired or not 1 <= len(document) <= MAX_PDF_PAGES:
                    raise MaterialRejected("Use a valid PDF with 1 to 2,000 pages.")
                report.pages = len(document)
                report.ocr_pages = sum(
                    len(page.get_text().strip()) < 32 and bool(page.get_images()) for page in document
                )
                report.needs_preparation = len(content) > INDEX_PART_BYTES or len(document) > INDEX_PART_PAGES
        elif extension == ".docx":
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 10000 or sum(entry.file_size for entry in entries) > MAX_FILE_BYTES:
                    raise MaterialRejected("This DOCX expands beyond the document processing limit.")
                if "word/document.xml" not in archive.namelist() or any(entry.flag_bits & 1 for entry in entries):
                    raise MaterialRejected("Use a valid, unencrypted DOCX document.")
        elif extension in {".txt", ".md"}:
            text = content.decode("utf-8-sig")
            if "\x00" in text or not text.strip():
                raise MaterialRejected("Use a nonempty UTF-8 text document.")
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as image:
                    allowed_formats = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".tif": "TIFF", ".tiff": "TIFF", ".bmp": "BMP"}
                    if image.format != allowed_formats[extension] or min(image.size) < 50 or max(image.size) > 10000:
                        raise MaterialRejected("Use a valid image with dimensions between 50 and 10,000 pixels.")
                    if getattr(image, "n_frames", 1) > MAX_PDF_PAGES:
                        raise MaterialRejected("TIFF documents must contain no more than 2,000 pages.")
                    image.verify()
    except MaterialRejected:
        raise
    except (RuntimeError, ValueError, UnicodeError, zipfile.BadZipFile, OSError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise MaterialRejected("This file could not be read. Repair or convert it before uploading.") from None
    return report


def prepared_parts(content: bytes, report: MaterialPreflight) -> Iterator[PreparedPart]:
    if hashlib.sha256(content).hexdigest() != report.sha256:
        raise MaterialRejected("The original file changed. Upload it again.")
    path = PurePosixPath(report.stored_filename)
    if path.suffix in {".txt", ".md"}:
        text = content.decode("utf-8-sig")
        for position, first in enumerate(range(0, len(text), 50000), 1):
            root = ElementTree.Element("html")
            head = ElementTree.SubElement(root, "head")
            ElementTree.SubElement(head, "meta", charset="utf-8")
            body = ElementTree.SubElement(root, "body")
            ElementTree.SubElement(body, "pre").text = text[first:first + 50000]
            yield PreparedPart(
                f"{path.stem}--{report.source_id}--s{position:06d}.html",
                ElementTree.tostring(root, encoding="utf-8", method="html"),
            )
        return
    if path.suffix != ".pdf":
        yield PreparedPart(f"{path.stem}--{report.source_id}{path.suffix}", content)
        return
    with fitz.open(stream=content, filetype="pdf") as document:
        def emit(first: int, last: int) -> Iterator[PreparedPart]:
            with fitz.open() as part:
                part.insert_pdf(document, from_page=first, to_page=last)
                data = part.tobytes(garbage=4, deflate=True, no_new_id=True)
            if len(data) > INDEX_PART_BYTES:
                if first == last:
                    raise MaterialRejected("A single PDF page exceeds 16 MB. Optimize that page and retry.")
                middle = (first + last) // 2
                yield from emit(first, middle)
                yield from emit(middle + 1, last)
                return
            yield PreparedPart(
                f"{path.stem}--{report.source_id}--p{first + 1:06d}-{last + 1:06d}.pdf",
                data, first + 1, last + 1,
            )

        for first in range(0, len(document), INDEX_PART_PAGES):
            yield from emit(first, min(first + INDEX_PART_PAGES, len(document)) - 1)