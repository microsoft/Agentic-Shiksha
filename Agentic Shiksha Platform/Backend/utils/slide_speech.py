import logging
import math
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from xml.etree import ElementTree

import httpx
from pydantic import ValidationError
from deployment_settings import SpeechSettings as SlideSpeechSettings

from backend.schemas.slides import SlideSpeechRequest, SlideSpeechVoice, SlideSpeechVoicesResponse
from common_azure_auth import get_token_with_retry


logger = logging.getLogger(__name__)
AUDIO_MEDIA_TYPE = "audio/mpeg"
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MAX_STREAM_SECONDS = 30
SPEECH_SCOPE = "https://cognitiveservices.azure.com/.default"
NOT_CONFIGURED = "Indian-voice speech is not configured on this server."
UPSTREAM_FAILURE = "Speech could not be generated. Please try again later."
VOICES = (
    SlideSpeechVoice(id="en-IN-NeerjaNeural", name="Neerja / Indian English", language="en-IN"),
    SlideSpeechVoice(id="en-IN-PrabhatNeural", name="Prabhat / Indian English", language="en-IN"),
    SlideSpeechVoice(id="hi-IN-SwaraNeural", name="Swara / Hindi", language="hi-IN"),
    SlideSpeechVoice(id="hi-IN-MadhurNeural", name="Madhur / Hindi", language="hi-IN"),
)


@lru_cache(maxsize=1)
def get_speech_settings() -> SlideSpeechSettings | None:
    try:
        settings = SlideSpeechSettings()
    except ValidationError:
        logger.warning("Presentation speech configuration is invalid")
        return None
    return settings if settings.configured else None


def voice_catalog() -> SlideSpeechVoicesResponse:
    available = get_speech_settings() is not None
    return SlideSpeechVoicesResponse(
        available=available, voices=list(VOICES), detail=None if available else NOT_CONFIGURED,
    )


class SlideSpeechError(Exception):
    def __init__(self, status_code: int, detail: str, retry_after: str | None = None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.retry_after = retry_after


def build_ssml(body: SlideSpeechRequest) -> bytes:
    language = next(voice.language for voice in VOICES if voice.id == body.voice)
    speak = ElementTree.Element("speak", {
        "version": "1.0",
        "xmlns": "http://www.w3.org/2001/10/synthesis",
        "{http://www.w3.org/XML/1998/namespace}lang": language,
    })
    ElementTree.SubElement(speak, "voice", {"name": body.voice}).text = body.text
    # XML parsers normalize literal CR/CRLF; a character reference preserves the saved script.
    return ElementTree.tostring(speak, encoding="utf-8", xml_declaration=True).replace(b"\r", b"&#13;")


def bounded_retry_after(value: str | None) -> str:
    try:
        raw = (value or "").strip()
        if re.fullmatch(r"[0-9]{1,10}", raw):
            seconds = int(raw)
        else:
            date = parsedate_to_datetime(raw)
            if date.tzinfo is None:
                return "5"
            seconds = math.ceil((date - datetime.now(timezone.utc)).total_seconds())
        return str(max(1, min(seconds, 60)))
    except (ValueError, TypeError, OverflowError):
        return "5"


def synthesize_speech(body: SlideSpeechRequest) -> bytes:
    settings = get_speech_settings()
    if settings is None:
        raise SlideSpeechError(503, NOT_CONFIGURED)
    ssml = build_ssml(body)
    try:
        token = get_token_with_retry(SPEECH_SCOPE)
        if not token or any(char in token for char in "\r\n"):
            raise ValueError("Invalid speech credential")
    except Exception:
        logger.warning("Presentation speech authentication failed")
        raise SlideSpeechError(503, UPSTREAM_FAILURE) from None

    headers = {
        "Authorization": f"Bearer aad#{settings.resource_id}#{token}",
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "Accept": AUDIO_MEDIA_TYPE,
        "Accept-Encoding": "identity",
    }
    deadline = time.monotonic() + MAX_STREAM_SECONDS
    try:
        with httpx.Client(
            timeout=httpx.Timeout(20, connect=5, write=5, pool=5),
            follow_redirects=False, trust_env=False,
        ) as client:
            with client.stream("POST", settings.endpoint, headers=headers, content=ssml) as response:
                if response.status_code == 429:
                    logger.warning("Presentation speech was rate limited")
                    raise SlideSpeechError(
                        429, "Speech is busy. Please wait before trying again.",
                        bounded_retry_after(response.headers.get("Retry-After")),
                    )
                if response.status_code != 200:
                    raise SlideSpeechError(502, UPSTREAM_FAILURE)
                content_type = response.headers.get("Content-Type", "").partition(";")[0].strip().lower()
                encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
                if content_type != AUDIO_MEDIA_TYPE or encoding not in {"", "identity"}:
                    raise SlideSpeechError(502, UPSTREAM_FAILURE)
                length = response.headers.get("Content-Length")
                if length is not None and (
                    not re.fullmatch(r"[0-9]{1,10}", length) or int(length) > MAX_AUDIO_BYTES
                ):
                    raise SlideSpeechError(502, UPSTREAM_FAILURE)
                audio = bytearray()
                for chunk in response.iter_raw():
                    if time.monotonic() > deadline:
                        raise SlideSpeechError(504, "Speech timed out. Please try again later.")
                    if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
                        raise SlideSpeechError(502, UPSTREAM_FAILURE)
                    audio.extend(chunk)
                if not audio:
                    raise SlideSpeechError(502, UPSTREAM_FAILURE)
                return bytes(audio)
    except SlideSpeechError:
        logger.warning("Presentation speech response could not be accepted")
        raise
    except httpx.TimeoutException:
        logger.warning("Presentation speech request timed out")
        raise SlideSpeechError(504, "Speech timed out. Please try again later.") from None
    except Exception:
        logger.warning("Presentation speech request failed")
        raise SlideSpeechError(502, UPSTREAM_FAILURE) from None
