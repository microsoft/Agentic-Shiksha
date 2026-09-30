from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.dependencies.auth import get_current_active_user
from backend.routers import speech


@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(speech.router)
    app.dependency_overrides[get_current_active_user] = lambda: SimpleNamespace(id="example-user", role="student")
    monkeypatch.setattr(speech, "get_speech_settings", lambda: None)
    return TestClient(app)


def test_voice_input_requires_authentication(monkeypatch):
    app = FastAPI()
    app.include_router(speech.router)
    monkeypatch.setattr(speech, "get_speech_settings", lambda: pytest.fail("Configuration must not be accessed anonymously"))
    assert TestClient(app).get("/api/speech/token").status_code == 401


def test_missing_speech_configuration_is_explicit_and_makes_no_azure_request(client, monkeypatch):
    monkeypatch.setattr(speech, "get_token_with_retry", lambda _scope: pytest.fail("Unconfigured speech must not acquire a token"))
    response = client.get("/api/speech/token")
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_narration_configuration_without_region_does_not_invent_voice_input_region(client, monkeypatch):
    monkeypatch.setattr(speech, "get_speech_settings", lambda: SimpleNamespace(resource_name="example-speech", region=""))
    monkeypatch.setattr(speech, "get_token_with_retry", lambda _scope: pytest.fail("No regional fallback is permitted"))
    assert client.get("/api/speech/token").status_code == 503


def test_configured_voice_input_preserves_response_contract_and_disables_caching(client, monkeypatch):
    requests = []
    monkeypatch.setattr(speech, "get_speech_settings", lambda: SimpleNamespace(resource_name="example-speech", region="eastus"))
    monkeypatch.setattr(speech, "get_token_with_retry", lambda _scope: "synthetic-entra-token")

    class HttpClient:
        def __init__(self, **kwargs):
            assert kwargs == {"timeout": 10, "follow_redirects": False}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, **kwargs):
            requests.append((url, kwargs))
            return SimpleNamespace(status_code=200, text="synthetic-speech-token", content=b"synthetic-speech-token")

    monkeypatch.setattr(speech.httpx, "Client", HttpClient)
    response = client.get("/api/speech/token")
    assert response.status_code == 200
    assert response.json() == {"token": "synthetic-speech-token", "region": "eastus"}
    assert response.headers["cache-control"] == "private, no-store"
    assert requests[0][0] == "https://example-speech.cognitiveservices.azure.com/sts/v1.0/issueToken"
    assert requests[0][1]["headers"]["Ocp-Apim-Subscription-Region"] == "eastus"


def test_voice_input_failure_does_not_echo_credential_details(client, monkeypatch, caplog):
    monkeypatch.setattr(speech, "get_speech_settings", lambda: SimpleNamespace(resource_name="example-speech", region="eastus"))

    def fail(_scope):
        raise ValueError("synthetic-sensitive-token")

    monkeypatch.setattr(speech, "get_token_with_retry", fail)
    response = client.get("/api/speech/token")
    assert response.status_code == 503
    assert "synthetic-sensitive-token" not in response.text
    assert "synthetic-sensitive-token" not in caplog.text
