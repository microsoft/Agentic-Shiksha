from admin_backend.core.contracts import Attachment


def download_attachment(account_name: str, container_name: str, blob_name: str) -> Attachment:
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    account_url = f"https://{account_name}.blob.core.windows.net"
    with DefaultAzureCredential() as credential:
        with BlobServiceClient(account_url=account_url, credential=credential) as service:
            blob = service.get_blob_client(container=container_name, blob=blob_name)
            content = blob.download_blob().readall()
            content_type = blob.get_blob_properties().content_settings.content_type
            return Attachment(content, content_type or "application/octet-stream")
