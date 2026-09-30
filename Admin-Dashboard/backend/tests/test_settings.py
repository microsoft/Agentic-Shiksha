import asyncio
import importlib
import os
import shutil
import sys
import traceback
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest

from admin_backend.core import settings


EVALUATION_ENV = {
    "AZURE_AI_SEARCH_ENDPOINT": "https://search.example.invalid",
    "COMMON_INDEX_NAME": "test-index",
    "AZURE_EVAL_MODEL": "test-evaluation-deployment",
}


@pytest.fixture(autouse=True)
def evaluation_environment(monkeypatch):
    for name, value in EVALUATION_ENV.items():
        monkeypatch.setenv(name, value)


@pytest.mark.parametrize("value", [None, "", " \t\n"])
@pytest.mark.parametrize(("name", "getter"), [
    ("COSMOS_ENDPOINT", settings.get_cosmos_settings),
    ("COSMOS_DATABASE", settings.get_cosmos_settings),
    ("STORAGE_ACCOUNT_NAME", settings.get_storage_settings),
    ("PROJECT_ENDPOINT", settings.get_research_settings),
    ("INSTITUTE_RESEARCH_AGENT_NAME", settings.get_research_settings),
    ("AZURE_AI_PROJECT_ENDPOINT", settings.get_foundry_settings),
    ("LOGGING_AGENT_NAME", settings.get_chat_settings),
    ("AZURE_AI_SEARCH_ENDPOINT", settings.get_evaluation_settings),
    ("COMMON_INDEX_NAME", settings.get_evaluation_settings),
    ("AZURE_EVAL_MODEL", settings.get_evaluation_settings),
    ("ALLOWED_ORIGINS", settings.get_cors_settings),
])
def test_deployment_settings_reject_missing_and_blank(monkeypatch, name, getter, value):
    if value is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(settings.ConfigurationError, match=name):
        getter()


def test_domain_getter_does_not_require_unrelated_resources(monkeypatch):
    for name in (
        "PROJECT_ENDPOINT", "AZURE_AI_PROJECT_ENDPOINT", "STORAGE_ACCOUNT_NAME",
        "INSTITUTE_RESEARCH_AGENT_NAME", "LOGGING_AGENT_NAME", "ALLOWED_ORIGINS",
        *EVALUATION_ENV,
    ):
        monkeypatch.delenv(name, raising=False)
    assert settings.get_cosmos_settings().cosmos_database == "test-database"


def test_project_endpoints_remain_distinct(monkeypatch):
    research = settings.get_research_settings()
    foundry = settings.get_foundry_settings()
    assert research.research_project_endpoint == "https://research.example.invalid/api/projects/test"
    assert foundry.foundry_project_endpoint == "https://chat.example.invalid/api/projects/test"
    settings.clear_settings_cache()
    monkeypatch.delenv("PROJECT_ENDPOINT")
    with pytest.raises(settings.ConfigurationError, match="PROJECT_ENDPOINT"):
        settings.get_research_settings()
    assert settings.get_foundry_settings().foundry_project_endpoint == foundry.foundry_project_endpoint


def test_typed_overrides_take_precedence_and_settings_are_cached(monkeypatch):
    configured = settings.get_evaluation_settings()
    overridden = settings.EvaluationSettings(model_deployment="override-deployment")
    assert overridden.model_deployment == "override-deployment"
    assert configured.model_deployment == "test-evaluation-deployment"
    monkeypatch.setenv("AZURE_EVAL_MODEL", "changed-deployment")
    assert settings.get_evaluation_settings() is configured
    settings.get_evaluation_settings.cache_clear()
    assert settings.get_evaluation_settings().model_deployment == "changed-deployment"


@pytest.mark.parametrize("value", [None, "", "invalid-optional-placeholder"])
def test_disabled_evaluation_does_not_validate_optional_resources(monkeypatch, value):
    for name in EVALUATION_ENV:
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)
    settings.validate_startup_settings()


def test_disabled_evaluation_starts_api_without_importing_evaluator(monkeypatch):
    from fastapi.testclient import TestClient

    for name in EVALUATION_ENV:
        monkeypatch.delenv(name)
    monkeypatch.setitem(sys.modules, "admin_backend.integrations.groundedness_evaluator", None)
    from admin_backend.app import create_app

    with TestClient(create_app()) as client:
        assert client.get("/api/dashboard/health").json()["status"] == "ok"
        response = client.options("/api/dashboard/health", headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": "GET",
        })
        assert response.headers["access-control-allow-origin"] == "http://localhost:5174"
        assert response.headers["access-control-allow-credentials"] == "true"


@pytest.mark.parametrize("value", [None, "", " \t"])
def test_enabled_evaluation_fails_startup_before_scheduling(monkeypatch, value):
    from admin_backend.app import build_services, create_app

    monkeypatch.setenv("EVAL_ENABLED", "true")
    if value is None:
        monkeypatch.delenv("AZURE_EVAL_MODEL")
    else:
        monkeypatch.setenv("AZURE_EVAL_MODEL", value)
    services = build_services()
    app = create_app(services)
    worker = Mock(side_effect=AssertionError("Do not schedule invalid evaluation configuration"))
    monkeypatch.setattr(services.evaluation, "run_periodic", worker)

    async def start():
        async with app.router.lifespan_context(app):
            pytest.fail("Startup accepted an unconfigured model deployment")

    with pytest.raises(settings.ConfigurationError, match="AZURE_EVAL_MODEL"):
        asyncio.run(start())
    worker.assert_not_called()


def test_manual_evaluator_rejects_missing_model_even_when_loop_disabled(monkeypatch):
    monkeypatch.delenv("AZURE_EVAL_MODEL")
    monkeypatch.delitem(sys.modules, "admin_backend.integrations.groundedness_evaluator", raising=False)
    with pytest.raises(settings.ConfigurationError, match="AZURE_EVAL_MODEL"):
        importlib.import_module("admin_backend.integrations.groundedness_evaluator")


def test_resource_consumers_use_their_validated_domains(monkeypatch):
    modules = tuple(f"admin_backend.integrations.{name}" for name in (
        "cosmos_queries", "groundedness_evaluator", "logging_agent_chat", "research_storage", "token_stats",
    ))
    for name in modules:
        monkeypatch.delitem(sys.modules, name, raising=False)
    cosmos_queries, groundedness_evaluator, logging_agent_chat, research_storage, token_stats = (
        importlib.import_module(name) for name in modules
    )

    assert cosmos_queries.COSMOS_DATABASE == settings.get_cosmos_settings().cosmos_database
    assert research_storage._STORAGE_ACCOUNT_NAME == settings.get_storage_settings().storage_account_name
    assert logging_agent_chat.AGENT_NAME == settings.get_chat_settings().logging_agent_name
    assert logging_agent_chat.PROJECT_ENDPOINT == settings.get_foundry_settings().foundry_project_endpoint
    assert token_stats.PROJECT_ENDPOINT == settings.get_foundry_settings().foundry_project_endpoint
    assert groundedness_evaluator.EVAL_MODEL == settings.get_evaluation_settings().model_deployment
    assert groundedness_evaluator.COMMON_INDEX_NAME == settings.get_evaluation_settings().search_index_name


def test_example_has_no_deployment_values():
    from dotenv import dotenv_values

    example = dotenv_values(settings.BACKEND_ROOT / ".env.example", interpolate=False)
    for name in (
        "COSMOS_ENDPOINT", "COSMOS_DATABASE", "STORAGE_ACCOUNT_NAME", "PROJECT_ENDPOINT",
        "INSTITUTE_RESEARCH_AGENT_NAME", "AZURE_AI_PROJECT_ENDPOINT", "LOGGING_AGENT_NAME",
        "ALLOWED_ORIGINS", *EVALUATION_ENV,
    ):
        assert name in example
        assert example[name] == ""


@pytest.mark.parametrize(("name", "getter", "value"), [
    ("DASHBOARD_PORT", settings.get_runtime_settings, "do-not-expose-secret"),
    ("AZURE_AI_PROJECT_ENDPOINT", settings.get_foundry_settings,
     "https://user:do-not-expose-secret@example.invalid/api/projects/test"),
    ("ALLOWED_ORIGINS", settings.get_cors_settings,
     "https://user:do-not-expose-secret@example.invalid"),
])
def test_validation_errors_expose_only_field_names(monkeypatch, name, getter, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(settings.ConfigurationError) as caught:
        getter()
    error = caught.value
    rendered = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    assert str(error) == f"Invalid or missing settings: {name}"
    assert "do-not-expose-secret" not in rendered + repr(error)
    assert "input_value" not in rendered


@pytest.mark.parametrize("value", ["*", "https://*.example.invalid", "https://example.invalid/path", "https://example.invalid,"])
def test_credentialed_cors_requires_explicit_origins(monkeypatch, value):
    monkeypatch.setenv("ALLOWED_ORIGINS", value)
    with pytest.raises(settings.ConfigurationError, match="ALLOWED_ORIGINS"):
        settings.get_cors_settings()


def test_configured_resource_identifiers_and_origins_are_trimmed(monkeypatch):
    monkeypatch.setenv("COSMOS_DATABASE", "  configured-database \t")
    monkeypatch.setenv("AZURE_EVAL_MODEL", " evaluation-deployment ")
    monkeypatch.setenv("ALLOWED_ORIGINS", " https://admin.example.invalid , http://localhost:5174 ")
    assert settings.get_cosmos_settings().cosmos_database == "configured-database"
    assert settings.get_evaluation_settings().model_deployment == "evaluation-deployment"
    assert settings.get_cors_settings().allowed_origins == [
        "https://admin.example.invalid", "http://localhost:5174",
    ]


def test_operational_defaults_do_not_select_resources(monkeypatch):
    for name in (
        "EVAL_ENABLED", "EVAL_INTERVAL_SECONDS", "EVAL_LOOKBACK_HOURS",
        "EVAL_BATCH_LIMIT", "AZURE_CLI_TIMEOUT", "DASHBOARD_PORT",
    ):
        monkeypatch.delenv(name)
    runtime = settings.get_runtime_settings()
    assert runtime.model_dump() == {
        "eval_enabled": False, "eval_interval_seconds": 5, "eval_lookback_hours": 24,
        "eval_batch_limit": 50, "azure_cli_timeout": 60, "dashboard_port": 8050,
    }


@pytest.fixture
def dotenv_root():
    root = Path(__file__).resolve().parent / f".settings-fixture-{uuid4().hex}"
    root.mkdir()
    try:
        yield root
    finally:
        shutil.rmtree(root)


def test_dotenv_bootstrap_is_anchored_to_backend(monkeypatch, dotenv_root):
    (dotenv_root / ".env").write_text(
        "COSMOS_ENDPOINT=https://base.example.invalid\n"
        "COSMOS_DATABASE=base-database\n"
        "STORAGE_ACCOUNT_NAME=basestorage\n"
        "ADMIN_TEST_CREDENTIAL=base-placeholder\n",
        encoding="utf-8",
    )
    elsewhere = dotenv_root / "other-working-directory"
    elsewhere.mkdir()
    (elsewhere / ".env").write_text("COSMOS_DATABASE=wrong-database\n", encoding="utf-8")
    monkeypatch.setattr(settings, "BACKEND_ROOT", dotenv_root)
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "0")
    monkeypatch.setenv("COSMOS_ENDPOINT", "https://process.example.invalid")
    for name in ("COSMOS_DATABASE", "STORAGE_ACCOUNT_NAME", "ADMIN_TEST_CREDENTIAL"):
        # Track previously absent keys too, so dotenv injection is undone.
        monkeypatch.setenv(name, "removed-before-bootstrap")
        monkeypatch.delenv(name, raising=False)

    with monkeypatch.context() as cwd:
        cwd.chdir(elsewhere)
        configured = settings.get_cosmos_settings()
        assert configured.cosmos_endpoint == "https://process.example.invalid"
        assert configured.cosmos_database == "base-database"
        assert settings.get_storage_settings().storage_account_name == "basestorage"
        assert os.environ["ADMIN_TEST_CREDENTIAL"] == "base-placeholder"


def test_base_dotenv_cannot_override_process(monkeypatch, dotenv_root):
    (dotenv_root / ".env").write_text("COSMOS_DATABASE=base-database\n", encoding="utf-8")
    monkeypatch.setattr(settings, "BACKEND_ROOT", dotenv_root)
    monkeypatch.setenv("PYTHON_DOTENV_DISABLED", "0")
    monkeypatch.setenv("COSMOS_DATABASE", "process-database")
    assert settings.get_cosmos_settings().cosmos_database == "process-database"
