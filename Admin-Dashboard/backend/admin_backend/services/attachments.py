from collections.abc import Callable
from urllib.parse import urlparse

from admin_backend.core.contracts import Attachment
from admin_backend.core.errors import InvalidOperation


class AttachmentService:
    def __init__(
        self,
        account_name: str,
        download: Callable[[str, str], Attachment],
    ) -> None:
        self.account_name = account_name
        self.download = download

    def resolve(self, url: str) -> tuple[str, str]:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname != f"{self.account_name}.blob.core.windows.net":
            raise InvalidOperation("Invalid blob storage URL")
        path_parts = parsed.path.lstrip("/").split("/", 1)
        if len(path_parts) < 2:
            raise InvalidOperation("Invalid blob path")
        container_name, blob_name = path_parts
        if not container_name.startswith("feedback-attachments") or ".." in blob_name.split("/"):
            raise InvalidOperation("Invalid blob path")
        return container_name, blob_name
