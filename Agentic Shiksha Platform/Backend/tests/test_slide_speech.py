import json
import logging
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from types import SimpleNamespace
from unittest.mock import Mock
from xml.etree import ElementTree

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.dependencies import agent_access, auth
from backend.routers import slides
from backend.schemas.slides import SlideSpeechRequest
from utils import course_materials, slide_speech


BASE = "/api/agents/course-example/slides"
AUTH = {"Authorization": "Bearer test-token"}
BODY = {"text": "  A saved script.\r\nनमस्ते भारत!  ", "voice": "en-IN-NeerjaNeural"}
SETTINGS = {
    "AZURE_SPEECH_RESOURCE_NAME": "speech-example",
    "AZURE_SUBSCRIPTION_ID": "00000000-0000-0000-0000-000000000000",
    "AZURE_RESOURCE_GROUP": "example-group",
}
AUDIO = b"ID3example-mp3"


class AudioStream(httpx.SyncByteStream):
    def __init__(self, chunks, error=None):
        self.chunks = chunks
        self.error = error
        self.closed = False

    def __iter__(self):
        yield from self.chunks
        if self.error is not None:
            raise self.error

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def speech_backend(monkeypatch):
    for key, value in SETTINGS.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("AZURE_SPEECH_REGION", raising=False)
    slide_speech.get_speech_settings.cache_clear()
    backend = SimpleNamespace(
        status=200, headers={"Content-Type": "audio/mpeg"}, chunks=[AUDIO],
        error=None, stream_error=None, requests=[], streams=[],
        token=Mock(return_value="test-entra-token"),
    )
    original_client = httpx.Client

    def handle(request):
        backend.requests.append(request)
        if backend.error is not None:
            raise backend.error
        stream = AudioStream(backend.chunks, backend.stream_error)
        backend.streams.append(stream)
        return httpx.Response(backend.status, headers=backend.headers, stream=stream)

    backend.client = Mock(side_effect=lambda **kwargs: original_client(
        transport=httpx.MockTransport(handle), **kwargs,
    ))
    monkeypatch.setattr(slide_speech, "get_token_with_retry", backend.token)
    monkeypatch.setattr(slide_speech.httpx, "Client", backend.client)
    yield backend
    slide_speech.get_speech_settings.cache_clear()


@pytest.fixture
def api(monkeypatch):
    profile = {"id": "teacher-1", "role": "teacher", "status": "active"}
    course = {
        "id": "course-example", "_etag": "course-revision",
        "createdById": "teacher-1", "teacherIds": [], "studentIds": ["student-1"],
    }
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": profile["id"]} if token == "test-token" else None)
    monkeypatch.setattr(auth, "load_profile", lambda _user: profile)
    monkeypatch.setattr(agent_access, "student_assignment_ids", lambda _user: [])
    monkeypatch.setattr(course_materials, "load_course", lambda name: course if name == course["id"] else None)
    monkeypatch.setattr(course_materials, "load_setup", lambda _name: {
        "sessionUuid": "11111111-1111-4111-8111-111111111111",
    })
    app = FastAPI()
    app.include_router(slides.router)
    return SimpleNamespace(client=TestClient(app), profile=profile, app=app)


@pytest.mark.parametrize("method,path,kwargs", [
    ("get", "/voices", {}),
    ("post", "/speech", {"json": BODY}),
    ("post", "/speech", {"json": {"text": "", "voice": "not-allowed"}}),
    ("post", "/speech", {"content": b"{not-json"}),
])
def test_auth_and_course_access_run_before_validation_or_speech(api, speech_backend, method, path, kwargs):
    request = getattr(api.client, method)
    assert request(BASE + path, **kwargs).status_code == 401
    assert request(BASE + path, headers={"Authorization": "Bearer wrong-token"}, **kwargs).status_code == 401
    api.profile["status"] = "disabled"
    assert request(BASE + path, headers=AUTH, **kwargs).status_code == 403
    api.profile.update(status="active", id="unrelated-user")
    assert request(BASE + path, headers=AUTH, **kwargs).status_code == 403
    assert request(BASE.replace("course-example", "missing") + path, headers=AUTH, **kwargs).status_code == 404
    speech_backend.token.assert_not_called()
    speech_backend.client.assert_not_called()


def test_teacher_and_enrolled_student_can_use_catalog_and_speech(api, speech_backend):
    for identity, role in [("teacher-1", "teacher"), ("student-1", "student")]:
        api.profile.update(id=identity, role=role)
        catalog = api.client.get(BASE + "/voices", headers=AUTH)
        assert catalog.status_code == 200
        assert catalog.json()["available"] is True
        assert "detail" not in catalog.json()
        response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
        assert response.status_code == 200
        assert response.content == AUDIO
        assert response.headers["content-type"] == "audio/mpeg"
        assert response.headers["cache-control"] == "private, no-store"
        assert response.headers["x-content-type-options"] == "nosniff"
    assert len(speech_backend.requests) == 2
    assert all(stream.closed for stream in speech_backend.streams)


def test_catalog_is_static_typed_and_performs_no_cloud_operation(api, speech_backend):
    response = api.client.get(BASE + "/voices", headers=AUTH)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json() == {
        "available": True,
        "voices": [
            {"id": "en-IN-NeerjaNeural", "name": "Neerja / Indian English", "language": "en-IN"},
            {"id": "en-IN-PrabhatNeural", "name": "Prabhat / Indian English", "language": "en-IN"},
            {"id": "hi-IN-SwaraNeural", "name": "Swara / Hindi", "language": "hi-IN"},
            {"id": "hi-IN-MadhurNeural", "name": "Madhur / Hindi", "language": "hi-IN"},
        ],
    }
    speech_backend.token.assert_not_called()
    speech_backend.client.assert_not_called()


@pytest.mark.parametrize("missing", [*SETTINGS, "all"])
def test_missing_configuration_disables_synthesis_without_auth_or_http(api, speech_backend, monkeypatch, missing):
    for key in SETTINGS if missing == "all" else [missing]:
        monkeypatch.delenv(key, raising=False)
    catalog = api.client.get(BASE + "/voices", headers=AUTH)
    assert catalog.status_code == 200
    assert catalog.json()["available"] is False
    assert catalog.json()["detail"] == slide_speech.NOT_CONFIGURED
    assert len(catalog.json()["voices"]) == 4
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 503
    assert response.json() == {"detail": slide_speech.NOT_CONFIGURED}
    speech_backend.token.assert_not_called()
    speech_backend.client.assert_not_called()


@pytest.mark.parametrize("key,value", [
    ("AZURE_SPEECH_RESOURCE_NAME", "speech.example"),
    ("AZURE_SPEECH_RESOURCE_NAME", "speech@attacker.example"),
    ("AZURE_SPEECH_RESOURCE_NAME", "speech/path"),
    ("AZURE_SPEECH_RESOURCE_NAME", "speech\r\nx-header"),
    ("AZURE_SPEECH_RESOURCE_NAME", "-speech"),
    ("AZURE_SPEECH_RESOURCE_NAME", "x" * 65),
    ("AZURE_SUBSCRIPTION_ID", "not-a-guid"),
    ("AZURE_RESOURCE_GROUP", "../group/other"),
    ("AZURE_RESOURCE_GROUP", "group#token"),
    ("AZURE_RESOURCE_GROUP", "group."),
])
def test_invalid_settings_fail_closed_without_logging_values(api, speech_backend, monkeypatch, caplog, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(ValidationError):
        slide_speech.SlideSpeechSettings()
    assert api.client.get(BASE + "/voices", headers=AUTH).json()["available"] is False
    assert api.client.post(BASE + "/speech", headers=AUTH, json=BODY).status_code == 503
    assert value not in caplog.text
    speech_backend.token.assert_not_called()
    speech_backend.client.assert_not_called()


@pytest.mark.parametrize("body", [
    {}, {"text": "script"}, {"voice": "en-IN-NeerjaNeural"},
    {**BODY, "text": ""}, {**BODY, "text": " \t\r\n"},
    {**BODY, "text": "x" * 1201}, {**BODY, "text": "🚀" * 1201},
    {**BODY, "text": "\0"}, {**BODY, "text": "\v"}, {**BODY, "text": "\ufffe"},
    {**BODY, "text": "\uffff"}, {**BODY, "text": "\ud800"},
    {**BODY, "text": 123}, {**BODY, "text": None}, {**BODY, "text": ["script"]},
    {**BODY, "voice": "en-US-JennyNeural"}, {**BODY, "voice": ""},
    {**BODY, "voice": None}, {**BODY, "voice": " en-IN-NeerjaNeural"},
    {**BODY, "ssml": "<speak>injected</speak>"}, {**BODY, "owner_id": "other"},
])
def test_invalid_input_returns_422_without_echo_or_cloud_work(api, speech_backend, body):
    response = api.client.post(
        BASE + "/speech", headers={**AUTH, "Content-Type": "application/json"},
        content=json.dumps(body, ensure_ascii=True),
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid speech text or voice."}
    speech_backend.token.assert_not_called()
    speech_backend.client.assert_not_called()


@pytest.mark.parametrize("content", [b"", b"not-json", b"null", b"[]", b'{"text":'])
def test_malformed_payload_is_422_after_authentication(api, speech_backend, content):
    response = api.client.post(BASE + "/speech", headers=AUTH, content=content)
    assert response.status_code == 422
    speech_backend.token.assert_not_called()


@pytest.mark.parametrize("voice", [voice.id for voice in slide_speech.VOICES])
def test_exact_text_is_escaped_into_known_voice_ssml_and_passwordless_request(api, speech_backend, voice):
    text = ' \tनमस्ते & <voice name="other"><audio src="https://example.com"/></voice>\r\nΔV > 0\r🚀  '
    response = api.client.post(BASE + "/speech", headers=AUTH, json={"text": text, "voice": voice})
    assert response.status_code == 200
    speech_backend.token.assert_called_once_with(slide_speech.SPEECH_SCOPE)
    request, = speech_backend.requests
    assert request.method == "POST"
    assert str(request.url) == "https://speech-example.cognitiveservices.azure.com/tts/cognitiveservices/v1"
    resource_id = (
        "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/example-group"
        "/providers/Microsoft.CognitiveServices/accounts/speech-example"
    )
    assert request.headers["Authorization"] == f"Bearer aad#{resource_id}#test-entra-token"
    assert request.headers["Content-Type"] == "application/ssml+xml"
    assert request.headers["X-Microsoft-OutputFormat"] == "audio-24khz-48kbitrate-mono-mp3"
    assert request.headers["Accept-Encoding"] == "identity"
    assert "Ocp-Apim-Subscription-Key" not in request.headers
    root = ElementTree.fromstring(request.content)
    assert root.tag == "{http://www.w3.org/2001/10/synthesis}speak"
    assert root.attrib["{http://www.w3.org/XML/1998/namespace}lang"] == voice[:5]
    assert len(root) == 1 and len(root[0]) == 0
    assert root[0].attrib == {"name": voice}
    assert root[0].text == text
    settings = speech_backend.client.call_args.kwargs
    assert settings["follow_redirects"] is False
    assert settings["trust_env"] is False
    assert settings["timeout"].as_dict() == {"connect": 5, "read": 20, "write": 5, "pool": 5}


def test_1200_unicode_code_points_are_accepted_without_trimming(api, speech_backend):
    text = " \t" + "🚀" * 1196 + "\r "
    assert len(text) == 1200
    assert SlideSpeechRequest(text=text, voice=BODY["voice"]).text == text
    assert api.client.post(BASE + "/speech", headers=AUTH, json={**BODY, "text": text}).status_code == 200
    assert ElementTree.fromstring(speech_backend.requests[0].content)[0].text == text


@pytest.mark.parametrize("status", [301, 302, 307, 308, 400, 401, 403, 404, 500, 503])
def test_upstream_errors_and_redirects_are_generic_and_never_retried(api, speech_backend, caplog, status):
    speech_backend.status = status
    speech_backend.headers["Location"] = "https://attacker.example/private-token"
    speech_backend.chunks = [b"private upstream failure body"]
    with caplog.at_level(logging.WARNING):
        response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 502
    assert response.json() == {"detail": slide_speech.UPSTREAM_FAILURE}
    assert len(speech_backend.requests) == 1
    assert "private upstream" not in response.text + caplog.text
    assert "test-entra-token" not in response.text + caplog.text
    assert BODY["text"] not in caplog.text
    assert all(stream.closed for stream in speech_backend.streams)


@pytest.mark.parametrize("retry_after,expected", [
    (None, "5"), ("12", "12"), ("0", "1"), ("9999999999", "60"),
    ("garbage secret", "5"), ("-2", "5"), ("12\r\nInjected: secret", "5"),
])
def test_throttling_propagates_only_bounded_retry_after(api, speech_backend, retry_after, expected):
    speech_backend.status = 429
    if retry_after is not None:
        speech_backend.headers["Retry-After"] = retry_after
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == expected
    assert response.headers["Cache-Control"] == "private, no-store"
    assert len(speech_backend.requests) == 1


def test_http_date_retry_after_is_bounded():
    future = format_datetime(datetime.now(timezone.utc) + timedelta(hours=1), usegmt=True)
    past = format_datetime(datetime.now(timezone.utc) - timedelta(hours=1), usegmt=True)
    assert slide_speech.bounded_retry_after(future) == "60"
    assert slide_speech.bounded_retry_after(past) == "1"


@pytest.mark.parametrize("error,status", [
    (httpx.ConnectTimeout("private upstream secret"), 504),
    (httpx.ReadTimeout("private upstream secret"), 504),
    (httpx.ConnectError("private upstream secret"), 502),
    (RuntimeError("private upstream secret"), 502),
])
def test_network_failure_is_sanitized_without_retry(api, speech_backend, caplog, error, status):
    speech_backend.error = error
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == status
    assert "private upstream secret" not in response.text + caplog.text
    assert len(speech_backend.requests) == 1


def test_credential_failure_does_not_leak_or_start_http(api, speech_backend, caplog):
    speech_backend.token.side_effect = RuntimeError("private credential test-entra-token")
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 503
    assert "private credential" not in response.text + caplog.text
    assert "test-entra-token" not in response.text + caplog.text
    speech_backend.token.assert_called_once()
    speech_backend.client.assert_not_called()


@pytest.mark.parametrize("headers,chunks", [
    ({"Content-Type": "audio/mpeg"}, []),
    ({"Content-Type": "application/json"}, [b"private error"]),
    ({}, [AUDIO]),
    ({"Content-Type": "audio/mpeg", "Content-Encoding": "gzip"}, [AUDIO]),
    ({"Content-Type": "audio/mpeg", "Content-Length": str(slide_speech.MAX_AUDIO_BYTES + 1)}, [AUDIO]),
    ({"Content-Type": "audio/mpeg", "Content-Length": "invalid"}, [AUDIO]),
    ({"Content-Type": "audio/mpeg"}, [b"x" * slide_speech.MAX_AUDIO_BYTES, b"x"]),
])
def test_empty_invalid_or_oversized_audio_is_not_returned(api, speech_backend, headers, chunks):
    speech_backend.headers = headers
    speech_backend.chunks = chunks
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 502
    assert response.json() == {"detail": slide_speech.UPSTREAM_FAILURE}
    assert all(stream.closed for stream in speech_backend.streams)


def test_exact_audio_size_limit_is_accepted(api, speech_backend):
    speech_backend.chunks = [b"x" * slide_speech.MAX_AUDIO_BYTES]
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 200
    assert len(response.content) == slide_speech.MAX_AUDIO_BYTES


def test_mid_stream_failure_returns_no_partial_audio(api, speech_backend, caplog):
    speech_backend.stream_error = httpx.ReadTimeout("private read failure")
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 504
    assert "private read failure" not in response.text + caplog.text
    assert AUDIO not in response.content
    assert all(stream.closed for stream in speech_backend.streams)


def test_streaming_deadline_is_enforced(api, speech_backend, monkeypatch):
    monkeypatch.setattr(slide_speech, "MAX_STREAM_SECONDS", -1)
    response = api.client.post(BASE + "/speech", headers=AUTH, json=BODY)
    assert response.status_code == 504
    assert all(stream.closed for stream in speech_backend.streams)


def test_course_lookup_error_is_generic_without_speech(api, speech_backend, monkeypatch, caplog):
    monkeypatch.setattr(course_materials, "load_course", Mock(side_effect=RuntimeError("private course record")))
    for response in [
        api.client.get(BASE + "/voices", headers=AUTH),
        api.client.post(BASE + "/speech", headers=AUTH, json=BODY),
    ]:
        assert response.status_code == 503
        assert "private course record" not in response.text + caplog.text
    speech_backend.token.assert_not_called()


def test_openapi_describes_typed_request_catalog_and_binary_audio(api):
    paths = api.app.openapi()["paths"]
    speech = paths["/api/agents/{agent_name}/slides/speech"]["post"]
    schema = speech["requestBody"]["content"]["application/json"]["schema"]
    assert schema["required"] == ["text", "voice"]
    assert schema["additionalProperties"] is False
    assert schema["properties"]["text"]["maxLength"] == 1200
    assert len(schema["properties"]["voice"]["enum"]) == 4
    assert speech["responses"]["200"]["content"] == {
        "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
    }
    catalog = paths["/api/agents/{agent_name}/slides/voices"]["get"]
    assert catalog["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/SlideSpeechVoicesResponse",
    )
