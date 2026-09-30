import base64
import binascii
import io
import json
import re
import subprocess
import tempfile
import warnings
import zipfile
from pathlib import Path, PurePath
from xml.etree import ElementTree

from PIL import Image, ImageOps, UnidentifiedImageError

from backend.schemas.course_form import CourseFormAttachment, CourseFormRequest


DOCUMENT_LIMIT = 1024 * 1024
IMAGE_LIMIT = 2 * 1024 * 1024
TEXT_LIMIT = 8000
PDF_PAGE_LIMIT = 5
IMAGE_PIXEL_LIMIT = 8_000_000
FORMATS = {
    ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
}


class AttachmentRejected(ValueError):
    pass


def decode_attachment(attachment: CourseFormAttachment) -> bytes:
    extension = PurePath(attachment.name).suffix.lower()
    if FORMATS.get(extension) != attachment.contentType:
        raise AttachmentRejected("The attachment type does not match its filename.")
    limit = IMAGE_LIMIT if attachment.contentType.startswith("image/") else DOCUMENT_LIMIT
    if len(attachment.data) > 4 * ((limit + 2) // 3):
        raise AttachmentRejected("The attachment is too large to read. Add documents to course materials instead.")
    try:
        data = base64.b64decode(attachment.data, validate=True)
    except (binascii.Error, ValueError):
        raise AttachmentRejected("The attachment could not be decoded.") from None
    if not data or len(data) > limit:
        raise AttachmentRejected("The attachment is empty or too large to read.")
    return data


def document_text(data: bytes, extension: str) -> tuple[str, bool]:
    if len(data) > DOCUMENT_LIMIT:
        raise AttachmentRejected("This document is too large to read in chat.")
    try:
        if extension in {".txt", ".md"}:
            text = data.decode("utf-8-sig")
            if "\x00" in text:
                raise AttachmentRejected("This file is not a supported text document.")
        elif extension == ".docx":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 200 or sum(entry.file_size for entry in entries) > 4 * DOCUMENT_LIMIT:
                    raise AttachmentRejected("This document is too large to expand. Add it to course materials instead.")
                document = archive.getinfo("word/document.xml")
                if document.file_size > DOCUMENT_LIMIT:
                    raise AttachmentRejected("This document has too much text to read in chat.")
                xml = archive.read(document).decode("utf-8-sig")
                if "\x00" in xml or "<!doctype" in xml.lower() or "<!entity" in xml.lower():
                    raise AttachmentRejected("This document contains unsupported XML declarations.")
                root = ElementTree.fromstring(xml)
                text = "\n".join("".join(paragraph.itertext()) for paragraph in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"))
        elif extension == ".pdf":
            if not data.startswith(b"%PDF-"):
                raise AttachmentRejected("The attachment is not a valid PDF.")
            with tempfile.TemporaryDirectory(prefix="form-assistant-") as folder:
                source = Path(folder) / "document.pdf"
                source.write_bytes(data)
                with tempfile.TemporaryFile() as info_output:
                    subprocess.run(["pdfinfo", str(source)], stdout=info_output, stderr=subprocess.DEVNULL, timeout=3, check=True)
                    info_output.seek(0)
                    info = info_output.read(16384).decode("utf-8", errors="replace")
                pages = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
                if not pages or int(pages[1]) > PDF_PAGE_LIMIT:
                    raise AttachmentRejected("Only PDFs up to 5 pages can be read here. Add this file to course materials instead.")
                with tempfile.TemporaryFile() as output:
                    subprocess.run(
                        ["pdftotext", "-f", "1", "-l", str(PDF_PAGE_LIMIT), "-enc", "UTF-8", str(source), "-"],
                        stdout=output, stderr=subprocess.DEVNULL, timeout=4, check=True,
                    )
                    output.seek(0)
                    text = output.read(4 * TEXT_LIMIT + 4).decode("utf-8", errors="replace")
        else:
            raise AttachmentRejected("This document format cannot be read in chat.")
    except AttachmentRejected:
        raise
    except (UnicodeError, zipfile.BadZipFile, KeyError, ElementTree.ParseError, OSError, RuntimeError, subprocess.SubprocessError):
        raise AttachmentRejected("This file could not be read safely. Add it to course materials instead.") from None
    text = text.strip()
    if not text:
        raise AttachmentRejected("No readable text was found. OCR is disabled; add the file to course materials instead.")
    return text[:TEXT_LIMIT], len(text) > TEXT_LIMIT


def image_data_url(data: bytes, content_type: str) -> str:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if Image.MIME.get(source.format) != content_type or source.width * source.height > IMAGE_PIXEL_LIMIT or getattr(source, "n_frames", 1) != 1:
                    raise AttachmentRejected("Use a static PNG, JPEG, or WebP image up to 8 megapixels.")
                image = ImageOps.exif_transpose(source)
                image.thumbnail((1024, 1024))
                image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=80)
    except AttachmentRejected:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError):
        raise AttachmentRejected("The image could not be read safely.") from None
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def form_agent_input(body: CourseFormRequest) -> str | list[dict]:
    payload = body.model_dump(exclude={"attachments"})
    if not body.attachments:
        return json.dumps(payload, ensure_ascii=False)
    payload["attachments"] = []
    images = []
    for attachment in body.attachments:
        data = decode_attachment(attachment)
        if attachment.contentType.startswith("image/"):
            images.append({"type": "input_image", "image_url": image_data_url(data, attachment.contentType), "detail": "low"})
            payload["attachments"].append({"name": attachment.name, "kind": "image"})
        else:
            text, truncated = document_text(data, PurePath(attachment.name).suffix.lower())
            payload["attachments"].append({"name": attachment.name, "kind": "document", "text": text, "truncated": truncated})
    return [{"role": "user", "content": [{"type": "input_text", "text": json.dumps(payload, ensure_ascii=False)}, *images]}]