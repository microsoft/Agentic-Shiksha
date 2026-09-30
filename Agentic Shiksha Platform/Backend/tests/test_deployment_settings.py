import ast
from pathlib import Path

import pytest
from pydantic import AliasChoices, SecretStr

from deployment_settings import (
    ApplicationSettings, AzureSettings, DatabaseSettings,
    ModelSettings, RuntimeSettings, SessionSettings, SpeechSettings, ToolSettings,
    get_settings, load_environment, require_configured,
)


MODELS = (
    ApplicationSettings, AzureSettings, DatabaseSettings,
    ModelSettings, RuntimeSettings, SessionSettings, SpeechSettings, ToolSettings,
)
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for model in MODELS:
        for name, field in model.model_fields.items():
            aliases = field.validation_alias
            for key in aliases.choices if isinstance(aliases, AliasChoices) else [aliases or name]:
                monkeypatch.setenv(key, "")
                monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize("value", [None, "", " ", "\t\n"])
def test_database_requires_explicit_nonblank_name(monkeypatch, value):
    monkeypatch.setenv("COSMOS_ENDPOINT", "https://example.documents.azure.com")
    if value is not None:
        monkeypatch.setenv("COSMOS_DATABASE", value)
    with pytest.raises(RuntimeError, match="COSMOS_DATABASE"):
        get_settings(DatabaseSettings)


def test_database_uses_configured_name_and_never_substitutes_archived_database(monkeypatch):
    monkeypatch.setenv("COSMOS_ENDPOINT", "https://example.documents.azure.com")
    monkeypatch.setenv("COSMOS_DATABASE", "configured-database")
    settings = get_settings(DatabaseSettings)
    assert settings.COSMOS_DATABASE == "configured-database"
    assert settings.COSMOS_CONNECTION_POOL_SIZE == 64
    assert not settings.ALLOW_FROZEN_DATABASE


@pytest.mark.parametrize("name", [
    "AZURE_AI_MODEL_DEPLOYMENT_NAME", "AZURE_AI_AGENT_MODEL_DEPLOYMENT", "AZURE_ALLOWED_DEPLOYMENTS",
])
def test_model_deployments_have_no_invented_defaults(monkeypatch, name):
    values = {
        "AZURE_AI_MODEL_DEPLOYMENT_NAME": "configured-chat",
        "AZURE_AI_AGENT_MODEL_DEPLOYMENT": "configured-agent",
        "AZURE_ALLOWED_DEPLOYMENTS": "configured-chat,configured-agent",
    }
    for key, value in values.items():
        if key != name:
            monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=name):
        get_settings(ModelSettings)


def test_model_list_requires_the_selected_default(monkeypatch):
    monkeypatch.setenv("AZURE_AI_MODEL_DEPLOYMENT_NAME", "configured-chat")
    monkeypatch.setenv("AZURE_AI_AGENT_MODEL_DEPLOYMENT", "configured-agent")
    monkeypatch.setenv("AZURE_ALLOWED_DEPLOYMENTS", "another-model")
    with pytest.raises(RuntimeError):
        get_settings(ModelSettings)
    monkeypatch.setenv("AZURE_ALLOWED_DEPLOYMENTS", "configured-chat, configured-agent,configured-chat")
    assert get_settings(ModelSettings).allowed_models == {"configured-chat", "configured-agent"}


def test_secrets_are_required_and_redacted(monkeypatch):
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        get_settings(SessionSettings)
    sentinel = "synthetic-session-value-not-a-live-credential"
    monkeypatch.setenv("JWT_SECRET", sentinel)
    settings = get_settings(SessionSettings)
    assert isinstance(settings.JWT_SECRET, SecretStr)
    assert settings.JWT_SECRET.get_secret_value() == sentinel
    assert sentinel not in repr(settings)
    assert sentinel not in settings.model_dump_json()
    assert settings.JWT_EXPIRY_SECONDS == 604800


def test_invalid_setting_errors_do_not_expose_other_secret_values(monkeypatch):
    sentinel = "synthetic-session-value-not-a-live-credential"
    monkeypatch.setenv("JWT_SECRET", sentinel)
    monkeypatch.setenv("JWT_EXPIRY_SECONDS", "invalid-lifetime")
    with pytest.raises(RuntimeError) as error:
        get_settings(SessionSettings)
    assert "JWT_EXPIRY_SECONDS" in str(error.value)
    assert sentinel not in str(error.value)
    assert "invalid-lifetime" not in str(error.value)


def test_optional_features_do_not_invent_model_or_resource_names():
    tools = get_settings(ToolSettings)
    for name in (
        "TIKZ_GENERATOR_MODEL", "TIKZ_DISCRIMINATOR_MODEL", "TIKZ_POLISHER_MODEL",
        "AZURE_IMAGE_MODEL", "GENERATED_IMAGES_CONTAINER", "MEMORY_CHAT_MODEL",
        "MEMORY_EMBEDDING_MODEL", "TEACHER_ANALYTICS_AGENT_NAME",
    ):
        assert getattr(tools, name) is None
        with pytest.raises(RuntimeError, match=name):
            require_configured(getattr(tools, name), name)
    speech = get_settings(SpeechSettings)
    assert not speech.configured
    assert speech.resource_name == speech.region == ""


def test_speech_uses_the_same_explicit_resource_for_both_features(monkeypatch):
    monkeypatch.setenv("AZURE_SPEECH_RESOURCE_NAME", "example-speech")
    monkeypatch.setenv("AZURE_SPEECH_REGION", "eastus")
    monkeypatch.setenv("AZURE_SUBSCRIPTION_ID", "00000000-0000-0000-0000-000000000000")
    monkeypatch.setenv("AZURE_RESOURCE_GROUP", "example-group")
    settings = get_settings(SpeechSettings)
    assert settings.configured
    assert settings.region == "eastus"
    assert settings.endpoint == "https://example-speech.cognitiveservices.azure.com/tts/cognitiveservices/v1"
    assert settings.resource_id.endswith("/resourceGroups/example-group/providers/Microsoft.CognitiveServices/accounts/example-speech")


def test_dotenv_precedence_is_process_then_base(tmp_path, monkeypatch):
    monkeypatch.delenv("PYTHON_DOTENV_DISABLED", raising=False)
    monkeypatch.setenv("COSMOS_DATABASE", "process-database")
    monkeypatch.setenv("JWT_SECRET", "process-test-secret")
    for name in ("AZURE_IMAGE_MODEL", "GENERATED_IMAGES_CONTAINER"):
        monkeypatch.delenv(name, raising=False)
    (tmp_path / ".env").write_text(
        "COSMOS_DATABASE=base-database\nAZURE_IMAGE_MODEL=base-image\nGENERATED_IMAGES_CONTAINER=base-images\n",
        encoding="utf-8",
    )
    load_environment(tmp_path)
    import os

    assert os.environ["COSMOS_DATABASE"] == "process-database"
    assert os.environ["AZURE_IMAGE_MODEL"] == "base-image"
    assert os.environ["GENERATED_IMAGES_CONTAINER"] == "base-images"
    assert get_settings(SessionSettings).JWT_SECRET.get_secret_value() == "process-test-secret"


def test_disabled_dotenv_does_not_read_private_files(tmp_path, monkeypatch):
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "1")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    (tmp_path / ".env").write_text("JWT_SECRET=must-not-be-read\n", encoding="utf-8")
    load_environment(tmp_path)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        get_settings(SessionSettings)


def test_session_lifetime_can_be_configured_without_changing_the_signing_algorithm(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "unit-test-session-signing-value")
    monkeypatch.setenv("JWT_EXPIRY_SECONDS", "3600")
    assert get_settings(SessionSettings).JWT_EXPIRY_SECONDS == 3600
    assert 'JWT_ALGORITHM = "HS256"' in (ROOT / "auth.py").read_text(encoding="utf-8")


def test_resource_and_model_fallbacks_do_not_reappear_in_runtime_modules():
    disallowed = {
        "COSMOS_DATABASE", "AZURE_SPEECH_RESOURCE_NAME", "AZURE_SPEECH_REGION",
        "AZURE_BING_CUSTOM_SEARCH_INSTANCE", "AZURE_AI_SEARCH_INDEX_NAME",
        "AZURE_AI_SEARCH_BLOB_CONTAINER", "AZURE_IMAGE_MODEL", "GENERATED_IMAGES_CONTAINER",
        "MEMORY_CHAT_MODEL", "MEMORY_EMBEDDING_MODEL", "TIKZ_GENERATOR_MODEL",
        "TIKZ_DISCRIMINATOR_MODEL", "TIKZ_POLISHER_MODEL", "AZURE_AI_AGENT_MODEL_DEPLOYMENT",
        "AZURE_AI_MODEL_DEPLOYMENT_NAME", "BLOB_CONTAINER_NAME", "AGENT_IMAGES_CONTAINER",
    }
    findings = []
    for directory in ("backend", "azure_services", "agent_tools", "teacher_dashboard", "harness"):
        for path in (ROOT / directory).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call) or len(node.args) < 2:
                    continue
                if not isinstance(node.func, ast.Attribute) or node.func.attr not in {"getenv", "get"}:
                    continue
                key, fallback = node.args[:2]
                if isinstance(key, ast.Constant) and key.value in disallowed and isinstance(fallback, ast.Constant) and fallback.value:
                    findings.append(f"{path.relative_to(ROOT)}:{node.lineno}:{key.value}")
    assert findings == []
