"""Text-to-image generation via the Foundry ``images/generations`` endpoint.

Wraps the ``gpt-image-2-1`` deployment on the v1 OpenAI-compatible surface. The
model returns base64 PNG bytes directly (no URL), which are handed straight to
the client as a ``generated_image`` block.
"""

import base64
import datetime
import logging
import os
import time
import uuid
from typing import Any, Dict

import openai
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)

from common_azure_auth import get_sync_credential
from azure_services.persistence import image_quota
from utils.tool_definitions import load_tool_definition
from agent_tools.custom.base import CustomTool

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────
# Mirrors the sibling add_tikz_diagram tool: local os.getenv with a working
# default, rather than azure_services.config, whose env() aborts startup when a
# variable is missing. Image generation is optional, so it must not gate boot.

IMAGE_ENDPOINT = os.getenv("AZURE_IMAGE_ENDPOINT") or os.environ["AZURE_FOUNDRY_ENDPOINT"]
# The SDK appends /images/generations to base_url, but Azure serves the
# OpenAI-compatible API under /openai/v1 — without it every call 404s.
IMAGE_ENDPOINT = IMAGE_ENDPOINT.rstrip("/")
if not IMAGE_ENDPOINT.endswith("/openai/v1"):
    IMAGE_ENDPOINT = f"{IMAGE_ENDPOINT}/openai/v1"
IMAGE_MODEL = os.getenv("AZURE_IMAGE_MODEL", "gpt-image-2-1")
STORAGE_ACCOUNT = os.environ["STORAGE_ACCOUNT_NAME"]
IMAGE_CONTAINER = os.getenv("GENERATED_IMAGES_CONTAINER", "generated-images")

# Fixed: the model has no size parameter, so every image is landscape.
IMAGE_SIZE = "1536x1024"
VALID_QUALITIES = {"low", "medium"}
DEFAULT_QUALITY = "medium"
REQUEST_TIMEOUT_SECONDS = 180.0
# Ceiling for a user-delegation SAS; readers re-sign, so this is only a stopgap.
SAS_LIFETIME_DAYS = 7

GENERATE_IMAGE_TOOL_DEFINITION: Dict[str, Any] = load_tool_definition("generate_image")

_client = None
_token_provider = None
_blob_service = None


def _get_blob_service() -> BlobServiceClient:
    global _blob_service
    if _blob_service is None:
        _blob_service = BlobServiceClient(
            account_url=f"https://{STORAGE_ACCOUNT}.blob.core.windows.net",
            credential=get_sync_credential(),
        )
    return _blob_service


def _upload_image(image_b64: str) -> str:
    """Store the PNG in blob storage and return a readable URL, or "" if that fails.

    One render is ~3 MB of base64, past the 2 MB Cosmos item limit, so only this
    URL is persisted with the message. Upload failure is not fatal: the caller
    still gets the base64 and the image renders for the current session.

    The URL carries a SAS because the account forbids anonymous reads — an
    unsigned link renders as a broken image. Readers re-sign it on every fetch,
    so this token expiring does not matter.
    """
    try:
        service = _get_blob_service()
        container = service.get_container_client(IMAGE_CONTAINER)
        if not container.exists():
            container.create_container()
        blob_name = f"{uuid.uuid4().hex}.png"
        container.upload_blob(
            name=blob_name,
            data=base64.b64decode(image_b64),
            content_settings=ContentSettings(content_type="image/png"),
            overwrite=True,
        )
        url = f"https://{STORAGE_ACCOUNT}.blob.core.windows.net/{IMAGE_CONTAINER}/{blob_name}"
        try:
            start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=5)
            expiry = start + datetime.timedelta(days=SAS_LIFETIME_DAYS)
            sas = generate_blob_sas(
                account_name=STORAGE_ACCOUNT,
                container_name=IMAGE_CONTAINER,
                blob_name=blob_name,
                user_delegation_key=service.get_user_delegation_key(start, expiry),
                permission=BlobSasPermissions(read=True),
                expiry=expiry,
                start=start,
            )
            return f"{url}?{sas}"
        except Exception as sas_error:
            logger.error(f"[generate_image] SAS signing failed, link will not load: {sas_error}")
            return url
    except Exception as exc:
        logger.error(f"[generate_image] Blob upload failed, image will not persist: {exc}")
        return ""


def _get_image_client():
    """Return the images client, refreshing its bearer token before each call.

    The OpenAI SDK takes a static api_key, but AAD tokens expire, so the value is
    re-read from the (internally cached) provider on every call.
    """
    global _client, _token_provider
    if _token_provider is None:
        from azure.identity import get_bearer_token_provider
        _token_provider = get_bearer_token_provider(
            get_sync_credential(),
            "https://cognitiveservices.azure.com/.default",
        )
    if _client is None:
        _client = openai.OpenAI(
            base_url=IMAGE_ENDPOINT,
            api_key=_token_provider(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    else:
        _client.api_key = _token_provider()
    return _client


def _error(title: str, message: str) -> Dict[str, Any]:
    return {
        "type": "generated_image",
        "title": title,
        "imageData": "",
        "imageUrl": "",
        "caption": message,
        "error": True,
    }


def _spend_quota(user_id: str, agent_id: str, quality: str) -> bool:
    """Claim one image from the weekly allowance; True when it was granted."""
    try:
        return image_quota.consume(user_id, agent_id, quality)
    except Exception as error:
        # A metering outage should not take image generation down with it.
        logger.error(f"[generate_image] Quota check failed, allowing call: {error}")
        return True


def _build_image_result(arguments: Dict[str, Any], user_id: str = "", agent_id: str = "") -> Dict[str, Any]:
    """Call the image model and return the ``generated_image`` payload."""
    prompt = (arguments.get("prompt") or "").strip()
    title = arguments.get("title") or "Generated image"
    caption = arguments.get("caption") or ""

    if not prompt:
        return _error(title, "No image prompt provided.")

    # Any size the model sends is ignored; the tool owns this choice.
    requested_quality = arguments.get("quality")
    quality = requested_quality if requested_quality in VALID_QUALITIES else DEFAULT_QUALITY
    quality_source = "model" if requested_quality in VALID_QUALITIES else f"default (got {requested_quality!r})"

    if not _spend_quota(user_id, agent_id, quality):
        status = image_quota.get_status(user_id, agent_id)
        left = ", ".join(
            f"{q}: {status['quotas'][q]['remaining']} left" for q in image_quota.QUALITIES
        )
        logger.info(f"[generate_image] Quota exhausted for {quality} ({left})")
        return _error(
            title,
            f"Weekly quota for {quality}-quality images is used up ({left}). "
            "Quotas reset on Monday.",
        )

    logger.info(
        f"[generate_image] model={IMAGE_MODEL}, size={IMAGE_SIZE}, "
        f"quality={quality} [{quality_source}], prompt_len={len(prompt)}"
    )

    t0 = time.time()
    try:
        response = _get_image_client().images.generate(
            model=IMAGE_MODEL,
            prompt=prompt,
            size=IMAGE_SIZE,
            quality=quality,
            n=1,
        )
    except Exception as exc:
        logger.error(f"[generate_image] Generation failed: {exc}", exc_info=True)
        return _error(title, f"Image generation failed: {exc}")

    data = getattr(response, "data", None) or []
    image_b64 = getattr(data[0], "b64_json", "") if data else ""
    if not image_b64:
        logger.error("[generate_image] Response contained no image data")
        return _error(title, "The image model returned no image.")

    usage = getattr(response, "usage", None)
    image_url = _upload_image(image_b64)
    logger.info(
        f"[generate_image] Complete in {time.time() - t0:.1f}s, "
        f"bytes_b64={len(image_b64)}, persisted={bool(image_url)}, "
        f"tokens={getattr(usage, 'total_tokens', '?')}"
    )

    return {
        "type": "generated_image",
        "title": title,
        "imageData": image_b64,
        "imageUrl": image_url,
        "caption": caption,
        "size": IMAGE_SIZE,
        "quality": quality,
    }


class GenerateImageTool(CustomTool):
    """Generate an illustrative image from a text prompt."""

    name = "generate_image"

    def execute(self, arguments: Dict[str, Any], **context: Any) -> Dict[str, Any]:
        return _build_image_result(
            arguments,
            user_id=str(context.get("user_id") or ""),
            agent_id=str(context.get("agent_name") or ""),
        )

    def output(self, result: Dict[str, Any], arguments: Dict[str, Any]) -> str:
        if result.get("error"):
            return (
                f"Image generation FAILED: {result.get('caption', 'unknown error')}. "
                "Describe the image verbally instead."
            )
        return (
            f"Image '{result.get('title', 'Generated image')}' was generated and "
            "displayed to the user. Continue with your explanation. "
            "Do NOT describe the image pixel by pixel."
        )
