"""Validated configuration for the independently deployed admin API."""

from functools import lru_cache
import os
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import AfterValidator, Field, StringConstraints, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict, SettingsError

BACKEND_ROOT = Path(__file__).resolve().parents[2]
ResourceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _endpoint(value: str) -> str:
    try:
        parsed = urlsplit(value)
        valid = (
            parsed.scheme == "https"
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
        parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("must be an HTTPS endpoint without credentials, query or fragment")
    return value


Endpoint = Annotated[ResourceName, AfterValidator(_endpoint)]


class ConfigurationError(ValueError):
    """A configuration failure that identifies fields, never their values."""


class _SafeSettings(BaseSettings):
    model_config = SettingsConfigDict(
        extra="ignore",
        env_file=None,
        populate_by_name=True,
        loc_by_alias=False,
        hide_input_in_errors=True,
        str_strip_whitespace=True,
        frozen=True,
    )

    def __init__(self, **values: Any) -> None:
        try:
            super().__init__(**values)
        except ValidationError as exc:
            fields = type(self).model_fields
            names = set()
            for error in exc.errors(include_input=False, include_context=False, include_url=False):
                location = error["loc"]
                field = fields.get(str(location[0])) if location else None
                names.add(field.alias if field and field.alias else type(self).__name__)
            raise ConfigurationError(
                f"Invalid or missing settings: {', '.join(sorted(names))}"
            ) from None
        except SettingsError:
            raise ConfigurationError("Unable to read deployment settings") from None


@lru_cache(maxsize=1)
def bootstrap_environment() -> None:
    """Load this service's optional local dotenv file without replacing injected values."""
    if os.getenv("PYTHON_DOTENV_DISABLED", "").strip().lower() in {"1", "true", "yes", "on"}:
        return
    load_dotenv(BACKEND_ROOT / ".env", override=False)


class _DeploymentSettings(_SafeSettings):
    def __init__(self, **values: Any) -> None:
        bootstrap_environment()
        super().__init__(**values)


class RuntimeSettings(_DeploymentSettings):
    eval_enabled: bool = Field(default=False, alias="EVAL_ENABLED")
    eval_interval_seconds: int = Field(default=5, alias="EVAL_INTERVAL_SECONDS", gt=0)
    eval_lookback_hours: int = Field(default=24, alias="EVAL_LOOKBACK_HOURS", gt=0)
    eval_batch_limit: int = Field(default=50, alias="EVAL_BATCH_LIMIT", gt=0)
    azure_cli_timeout: int = Field(default=60, alias="AZURE_CLI_TIMEOUT", gt=0)
    dashboard_port: int = Field(default=8050, alias="DASHBOARD_PORT", ge=1, le=65535)


class CosmosSettings(_DeploymentSettings):
    cosmos_endpoint: Endpoint = Field(alias="COSMOS_ENDPOINT", repr=False)
    cosmos_database: ResourceName = Field(alias="COSMOS_DATABASE", repr=False)


class StorageSettings(_DeploymentSettings):
    storage_account_name: ResourceName = Field(alias="STORAGE_ACCOUNT_NAME", repr=False)


class ResearchSettings(_DeploymentSettings):
    research_project_endpoint: Endpoint = Field(alias="PROJECT_ENDPOINT", repr=False)
    research_agent_name: ResourceName = Field(alias="INSTITUTE_RESEARCH_AGENT_NAME", repr=False)


class FoundrySettings(_DeploymentSettings):
    foundry_project_endpoint: Endpoint = Field(alias="AZURE_AI_PROJECT_ENDPOINT", repr=False)


class ChatSettings(FoundrySettings):
    logging_agent_name: ResourceName = Field(alias="LOGGING_AGENT_NAME", repr=False)


class EvaluationSettings(FoundrySettings):
    search_endpoint: Endpoint = Field(alias="AZURE_AI_SEARCH_ENDPOINT", repr=False)
    search_index_name: ResourceName = Field(alias="COMMON_INDEX_NAME", repr=False)
    model_deployment: ResourceName = Field(alias="AZURE_EVAL_MODEL", repr=False)


class CorsSettings(_DeploymentSettings):
    allowed_origins: Annotated[list[str], NoDecode] = Field(alias="ALLOWED_ORIGINS", repr=False)

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _parse_origins(cls, value: Any) -> Any:
        return value.split(",") if isinstance(value, str) else value

    @field_validator("allowed_origins")
    @classmethod
    def _validate_origins(cls, values: list[str]) -> list[str]:
        if not values:
            raise ValueError("must contain at least one explicit origin")
        for value in values:
            try:
                parsed = urlsplit(value)
                valid = (
                    parsed.scheme in ("http", "https")
                    and parsed.hostname
                    and "*" not in value
                    and parsed.username is None
                    and parsed.password is None
                    and not parsed.path
                    and not parsed.query
                    and not parsed.fragment
                )
                parsed.port
            except ValueError:
                valid = False
            if not valid:
                raise ValueError("must contain explicit HTTP origins without credentials or paths")
        return values


@lru_cache(maxsize=1)
def get_runtime_settings() -> RuntimeSettings:
    return RuntimeSettings()


@lru_cache(maxsize=1)
def get_cosmos_settings() -> CosmosSettings:
    return CosmosSettings()


@lru_cache(maxsize=1)
def get_storage_settings() -> StorageSettings:
    return StorageSettings()


@lru_cache(maxsize=1)
def get_research_settings() -> ResearchSettings:
    return ResearchSettings()


@lru_cache(maxsize=1)
def get_foundry_settings() -> FoundrySettings:
    return FoundrySettings()


@lru_cache(maxsize=1)
def get_chat_settings() -> ChatSettings:
    return ChatSettings()


@lru_cache(maxsize=1)
def get_evaluation_settings() -> EvaluationSettings:
    return EvaluationSettings()


@lru_cache(maxsize=1)
def get_cors_settings() -> CorsSettings:
    return CorsSettings()


def validate_startup_settings() -> None:
    runtime = get_runtime_settings()
    get_cosmos_settings()
    get_storage_settings()
    get_research_settings()
    get_chat_settings()
    get_cors_settings()
    if runtime.eval_enabled:
        get_evaluation_settings()


def clear_settings_cache() -> None:
    """Reset cached configuration models for isolated tests."""
    for getter in (
        bootstrap_environment,
        get_runtime_settings,
        get_cosmos_settings,
        get_storage_settings,
        get_research_settings,
        get_foundry_settings,
        get_chat_settings,
        get_evaluation_settings,
        get_cors_settings,
    ):
        getter.cache_clear()
