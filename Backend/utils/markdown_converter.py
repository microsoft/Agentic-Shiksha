import os
import logging
import base64
import io
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pdf2image import convert_from_path
from PIL import Image
from litellm import completion
from common_azure_auth import get_sync_credential
from utils.prompt_unifier import load_prompt_file


# OPTIONAL: tqdm for progress bars
try:
    from tqdm.auto import tqdm
except ImportError:  # tqdm not installed; progress bar will be disabled
    tqdm = None

# Azure scope for Azure OpenAI (cognitive services)
AZURE_SCOPE = "https://cognitiveservices.azure.com/.default"

logger = logging.getLogger(__name__)


class PdfToMarkdownPreprocessor:
    """
    Preprocessing tool: PDF → page images → Azure OpenAI → Markdown.

    Usage example:

        pre = PdfToMarkdownPreprocessor(
            azure_endpoint="https://<resource>.openai.azure.com",
            azure_api_version="2024-10-01-preview",
            deployment_name="gpt-4.1",
            poppler_path=os.getenv("POPPLER_PATH"),  # None uses the system PATH
        )

        # 1) Just get markdown in a variable
        md_text = pre.extract_markdown("data/docs/paper.pdf")

        # 2) Get markdown AND write it to a file
        md_text = pre.extract_markdown(
            "data/docs/paper.pdf",
            write_to_file=True,
            output_path="data/markdown/paper.md",
        )

        # 3) Process a whole folder of PDFs
        success, errors = pre.extract_folder(
            "data/docs",
            pattern="*.pdf",
            write_to_files=True,
            output_dir="data/markdown",
        )
    """

    # System prompts (loaded from prompt_store)
    _SYSTEM_PROMPT = load_prompt_file("tools/markdown_transcriber_system.md")

    _BATCH_SYSTEM_PROMPT = load_prompt_file("tools/markdown_transcriber_batch.md")

    def __init__(
        self,
        *,
        azure_endpoint: str,
        azure_api_version: str,
        deployment_name: str,
        poppler_path: str,
        use_cli_credential: bool = True,
        batch_size: int = 5,
        dpi: int = 300,
        document_structure_hint: str = "",
    ):
        """
        Args:
            azure_endpoint: Azure OpenAI endpoint, e.g. "https://<resource>.openai.azure.com"
            azure_api_version: API version, e.g. "2024-10-01-preview"
            deployment_name: Azure OpenAI deployment name, e.g. "gpt-4o"
            poppler_path: Folder containing pdfinfo.exe / pdftoppm.exe
            use_cli_credential: True to use AzureCliCredential, False for DefaultAzureCredential
            batch_size: How many pages to use as rolling context
            dpi: DPI for PDF→image conversion
            document_structure_hint: Optional extra hint about the doc (e.g. "two-column paper")
        """
        self.azure_endpoint = azure_endpoint.rstrip("/")
        self.azure_api_version = azure_api_version
        self.deployment_name = deployment_name
        self.poppler_path = poppler_path
        self.batch_size = batch_size
        self.dpi = dpi
        self.document_structure_hint = document_structure_hint

        # Auth
        # Single place to get a configured credential (currently Azure CLI)
        self._credential = get_sync_credential()

        self._logger = logging.getLogger(self.__class__.__name__)

    # ---------- public API ----------

    def extract_markdown(
        self,
        pdf_path: str,
        *,
        write_to_file: bool = False,
        output_path: Optional[str] = None,
    ) -> str:
        """
        Convert a single PDF to markdown.

        Args:
            pdf_path: Path to input PDF.
            write_to_file: If True, also write the markdown to a .md file.
            output_path:
                - If provided and write_to_file=True, writes to this file.
                - If write_to_file=True and output_path is None, writes next to
                  the PDF with the same basename but .md extension.
                - Ignored if write_to_file=False.

        Returns:
            Markdown content as a string (always).
        """
        if not os.path.isfile(pdf_path):
            raise FileNotFoundError(f"PDF not found: {pdf_path}")

        self._logger.info(f"Converting PDF to images with DPI {self.dpi}: {pdf_path}")
        images = convert_from_path(
            pdf_path,
            dpi=self.dpi,
            poppler_path=self.poppler_path,
        )

        azure_ad_token = self._get_azure_ad_token()
        md_text = self._process_pages_in_batches(
            images,
            azure_ad_token=azure_ad_token,
        )

        if write_to_file:
            if output_path is None:
                base, _ = os.path.splitext(pdf_path)
                output_path = base + ".md"

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(md_text)

            self._logger.info(f"Wrote markdown to: {output_path}")

        return md_text

    def extract_to_file(self, pdf_path: str, output_path: str) -> str:
        """
        Convenience wrapper: always writes to file, returns markdown content.
        """
        return self.extract_markdown(
            pdf_path,
            write_to_file=True,
            output_path=output_path,
        )

    def extract_folder(
        self,
        folder_path: str,
        *,
        pattern: str = "*.pdf",
        write_to_files: bool = True,
        output_dir: Optional[str] = None,
    ) -> Tuple[Dict[str, Optional[str]], Dict[str, str]]:
        """
        Process all PDFs (or other matching files) in a folder.

        Args:
            folder_path: Directory containing PDF files.
            pattern: Glob pattern (default: "*.pdf").
            write_to_files:
                - If True, write a .md file per PDF.
                - If False, only return markdown in memory.
            output_dir:
                - If provided and write_to_files=True, all .md files go here
                  with the same basename as the PDF.
                - If None and write_to_files=True, each .md is written next
                  to its source PDF.
                - Ignored if write_to_files=False.

        Returns:
            (success, errors) where:
                success: {pdf_path -> md_output_path or None}
                errors:  {pdf_path -> error_message}
        """
        folder = Path(folder_path)
        if not folder.is_dir():
            raise NotADirectoryError(f"Not a directory: {folder_path}")

        pdf_paths = sorted(folder.glob(pattern))
        if not pdf_paths:
            raise RuntimeError(
                f"No files matching pattern '{pattern}' found in: {folder_path}"
            )

        self._logger.info(
            f"Found {len(pdf_paths)} files in {folder_path} (pattern: {pattern})"
        )

        success: Dict[str, Optional[str]] = {}
        errors: Dict[str, str] = {}

        if write_to_files and output_dir is not None:
            os.makedirs(output_dir, exist_ok=True)

        # Use tqdm if available, otherwise just a normal iterator
        iterator = pdf_paths
        if tqdm is not None:
            iterator = tqdm(pdf_paths, desc="Processing PDFs")

        for pdf_path in iterator:
            pdf_str = str(pdf_path)
            try:
                if write_to_files:
                    if output_dir is not None:
                        base = pdf_path.stem
                        md_path = os.path.join(output_dir, base + ".md")
                    else:
                        md_path = None  # will be determined by extract_markdown

                    self._logger.info(f"Processing file: {pdf_str}")
                    _md = self.extract_markdown(
                        pdf_str,
                        write_to_file=True,
                        output_path=md_path,
                    )

                    if md_path is None:
                        base, _ = os.path.splitext(pdf_str)
                        md_path = base + ".md"

                    success[pdf_str] = md_path
                else:
                    self._logger.info(f"Processing file (no write): {pdf_str}")
                    _md = self.extract_markdown(pdf_str, write_to_file=False)
                    success[pdf_str] = None

            except Exception as e:
                self._logger.error(f"Error processing {pdf_str}: {e}")
                errors[pdf_str] = str(e)

        return success, errors

    # ---------- internal helpers ----------

    def _get_azure_ad_token(self) -> str:
        token = self._credential.get_token(AZURE_SCOPE).token
        return token

    def _encode_image(self, image: Image.Image) -> str:
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return img_str

    def _process_page_with_llm(
        self,
        image: Image.Image,
        azure_ad_token: str,
        previous_pages_text: str = "",
        page_number: int = 1,
        total_pages: int = 1,
    ) -> str:
        encoded_image = self._encode_image(image)

        base_system_prompt = (
            self._SYSTEM_PROMPT if not previous_pages_text else self._BATCH_SYSTEM_PROMPT
        )

        system_prompt = base_system_prompt
        if self.document_structure_hint:
            system_prompt = (
                f"{base_system_prompt}\n\nAdditional document structure information:\n"
                f"{self.document_structure_hint}"
            )

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_prompt}
        ]

        user_content: List[Dict[str, Any]] = [
            {
                "type": "text",
                "text": (
                    f"Extract the text from this document page "
                    f"(page {page_number} of {total_pages}) and convert it to markdown."
                ),
            }
        ]

        if previous_pages_text:
            user_content.append(
                {
                    "type": "text",
                    "text": (
                        "Previous pages transcription for context:\n\n"
                        f"{previous_pages_text}\n\n"
                        "Now transcribe ONLY the current image:"
                    ),
                }
            )

        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{encoded_image}"},
            }
        )

        messages.append({"role": "user", "content": user_content})

        completion_args: Dict[str, Any] = {
            "model": f"azure/{self.deployment_name}",
            "api_base": self.azure_endpoint,
            "api_version": self.azure_api_version,
            "messages": messages,
            "max_completion_tokens": 4096,
            "azure_ad_token": azure_ad_token,
        }

        try:
            response = completion(**completion_args)
            extracted_text = response["choices"][0]["message"]["content"].strip()
            return extracted_text
        except Exception as e:
            self._logger.error(f"Error processing page {page_number}: {e}")
            return f"*Error processing page {page_number}: {str(e)}*"

    def _process_pages_in_batches(
        self,
        images: List[Image.Image],
        azure_ad_token: str,
    ) -> str:
        total_pages = len(images)
        full_markdown = ""
        accumulated_context = ""

        self._logger.info(
            f"Processing {total_pages} pages in batches of {self.batch_size}"
        )

        for i, image in enumerate(images):
            page_number = i + 1
            self._logger.info(f"Processing page {page_number}/{total_pages}")

            context_to_use = accumulated_context

            page_markdown = self._process_page_with_llm(
                image=image,
                azure_ad_token=azure_ad_token,
                previous_pages_text=context_to_use,
                page_number=page_number,
                total_pages=total_pages,
            )

            page_delimiter = f"---\n\n## Page {page_number}\n"

            if i > 0:
                full_markdown += f"\n\n{page_delimiter}\n"
            else:
                full_markdown += f"## Page {page_number}\n"

            full_markdown += page_markdown

            # Sliding window context over last `batch_size` pages
            if i >= self.batch_size:
                parts = full_markdown.split("\n\n---\n\n## Page ")
                if len(parts) > self.batch_size:
                    accumulated_context = (
                        "---\n\n## Page "
                        + "\n\n---\n\n## Page ".join(parts[-self.batch_size :])
                    )
                else:
                    accumulated_context = full_markdown
            else:
                accumulated_context = full_markdown

        return full_markdown


if __name__ == "__main__":
    # basic logging setup for running as a script
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    pre = PdfToMarkdownPreprocessor(
        azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        azure_api_version="2024-10-01-preview",
        deployment_name=os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-5.2-chat"),
        poppler_path=os.getenv("POPPLER_PATH"),
    )

    # Example: process a folder of PDFs. Override with PDF_INPUT_DIR / PDF_OUTPUT_DIR.
    input_dir = os.getenv("PDF_INPUT_DIR", os.path.join(os.getcwd(), "data", "docs"))
    output_dir = os.getenv("PDF_OUTPUT_DIR", os.path.join(os.getcwd(), "data", "markdown"))

    success, errors = pre.extract_folder(
        folder_path=input_dir,
        pattern="*.pdf",
        write_to_files=True,
        output_dir=output_dir,
    )

    print("✅ Success:")
    for pdf, md in success.items():
        print(f" - {pdf} -> {md}")

    if errors:
        print("\n⚠️ Errors:")
        for pdf, err in errors.items():
            print(f" - {pdf}: {err}")