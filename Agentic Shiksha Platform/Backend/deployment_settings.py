"""Environment-backed deployment configuration, without embedded resource defaults."""

from functools import lru_cache
import os
from pathlib import Path
from typing import Annotated, Literal, TypeVar
from urllib.parse import urlsplit

from dotenv import load_dotenv
from pydantic import AliasChoices, Field, SecretStr, StringConstraints, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


RequiredValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class EnvironmentSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None, extra="ignore", env_ignore_empty=True, hide_input_in_errors=True,
        case_sensitive=True,
    )


def load_environment(base_dir: Path | None = None) -> None:
    if os.getenv("PYTHON_DOTENV_DISABLED", "").strip().lower() in {"1", "true", "yes", "on"}:
        return
    root = base_dir or Path(__file__).resolve().parent
    load_dotenv(root / ".env", override=False)


class AzureSettings(EnvironmentSettings):
    AZURE_SUBSCRIPTION_ID: RequiredValue
    AZURE_RESOURCE_GROUP: RequiredValue
    AZURE_AI_SEARCH_SERVICE_NAME: RequiredValue
    AZURE_AI_SEARCH_ENDPOINT: RequiredValue
    AZURE_AI_SEARCH_CONNECTION_ID: RequiredValue
    AZURE_AI_SEARCH_API_VERSION: RequiredValue
    AZURE_AI_PROJECT_ENDPOINT: RequiredValue
    AZURE_FOUNDRY_ENDPOINT: RequiredValue
    STORAGE_ACCOUNT_NAME: RequiredValue
    AZURE_AI_SEARCH_BLOB_CONTAINER: RequiredValue
    AZURE_OPENAI_CHAT_MODEL: RequiredValue
    EMBEDDING_MODEL: RequiredValue
    EMBEDDING_DIMENSIONS: int = Field(gt=0)
    AZURE_EVAL_MODEL: RequiredValue
    COMMON_INDEX_NAME: RequiredValue
    COMMON_DATASOURCE_NAME: RequiredValue
    COMMON_SKILLSET_NAME: RequiredValue
    COMMON_INDEXER_NAME: RequiredValue
    COMMON_IMAGE_CONTAINER: RequiredValue
    AZURE_BING_CONNECTION_ID: RequiredValue
    AZURE_BING_CUSTOM_SEARCH_CONNECTION_ID: RequiredValue
    AZURE_BING_CUSTOM_SEARCH_INSTANCE: RequiredValue | None = None
    AZURE_STORAGE_CONNECTION_STRING: SecretStr | None = None


class DatabaseSettings(EnvironmentSettings):
    COSMOS_ENDPOINT: RequiredValue
    COSMOS_DATABASE: RequiredValue
    COSMOS_CONNECTION_POOL_SIZE: int = Field(default=64, ge=10)
    ALLOW_FROZEN_DATABASE: bool = False
    CHAT_INITIAL_MESSAGE_LIMIT: int = Field(default=200, ge=1)
    COURSE_CURRICULUM_CACHE_MAX_ENTRIES: int = Field(default=64, ge=1)


class SessionSettings(EnvironmentSettings):
    JWT_SECRET: SecretStr
    JWT_EXPIRY_SECONDS: int = Field(default=604800, ge=60, le=2592000)
    DASHBOARD_ALLOW_DEV_AUTH: bool = False

    @field_validator("JWT_SECRET")
    @classmethod
    def nonempty_secret(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("JWT_SECRET is required")
        return value


class ModelSettings(EnvironmentSettings):
    AZURE_AI_MODEL_DEPLOYMENT_NAME: RequiredValue
    AZURE_AI_AGENT_MODEL_DEPLOYMENT: RequiredValue
    AZURE_ALLOWED_DEPLOYMENTS: RequiredValue

    @model_validator(mode="after")
    def validate_model_list(self) -> "ModelSettings":
        if not self.allowed_models or self.AZURE_AI_MODEL_DEPLOYMENT_NAME not in self.allowed_models:
            raise ValueError("AZURE_ALLOWED_DEPLOYMENTS must include AZURE_AI_MODEL_DEPLOYMENT_NAME")
        return self

    @property
    def allowed_models(self) -> set[str]:
        return {name.strip() for name in self.AZURE_ALLOWED_DEPLOYMENTS.split(",") if name.strip()}


class ApplicationSettings(ModelSettings):
    PROJECT_RESOURCE_ID: RequiredValue
    FRONTEND_URL: RequiredValue
    BACKEND_URL: RequiredValue
    AZURE_AUTH_CLIENT_ID: RequiredValue = Field(validation_alias=AliasChoices("AZURE_AUTH_CLIENT_ID", "VITE_AZURE_CLIENT_ID"))
    AZURE_AUTH_TENANT_ID: RequiredValue = Field(validation_alias=AliasChoices("AZURE_AUTH_TENANT_ID", "VITE_AZURE_TENANT_ID"))
    AUTH_REDIRECT_URI: RequiredValue | None = None
    GOOGLE_CLIENT_ID: RequiredValue
    GOOGLE_CLIENT_SECRET: SecretStr
    GOOGLE_REDIRECT_URI: RequiredValue | None = None
    SUPER_ADMIN_EMAIL: RequiredValue
    CORS_ALLOWED_ORIGINS: str = ""
    AZURE_AGENTS_CONFIG_PATH: RequiredValue = "configs/azure_agents.json"
    DOCUMENT_INTELLIGENCE_ENDPOINT: RequiredValue
    AGENT_IMAGES_CONTAINER: RequiredValue
    BLOB_CONTAINER_NAME: RequiredValue
    BLOB_STORAGE_CONNECTION_STRING: SecretStr | None = None
    AZURE_AI_SEARCH_INDEX_NAME: RequiredValue | None = None
    DEEP_RESEARCH_PROJECT_ENDPOINT: RequiredValue
    DEEP_RESEARCH_AGENT_ID: RequiredValue
    DEEP_RESEARCH_BING_CONNECTION_ID: RequiredValue
    DEEP_RESEARCH_MODEL: RequiredValue | None = None
    DEEP_RESEARCH_BASE_MODEL: RequiredValue | None = None
    TEXTBOOK_RESEARCH_AGENT_NAME: RequiredValue | None = None
    THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME: RequiredValue | None = None

    @field_validator("GOOGLE_CLIENT_SECRET")
    @classmethod
    def nonempty_secret(cls, value: SecretStr) -> SecretStr:
        if not value.get_secret_value().strip():
            raise ValueError("GOOGLE_CLIENT_SECRET is required")
        return value

    @field_validator("FRONTEND_URL", "BACKEND_URL", "AUTH_REDIRECT_URI", "GOOGLE_REDIRECT_URI")
    @classmethod
    def application_url(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("An HTTP(S) application URL without credentials is required")
        return value

    @model_validator(mode="after")
    def validate_origins(self) -> "ApplicationSettings":
        for origin in self.cors_origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("CORS_ALLOWED_ORIGINS must contain explicit HTTP(S) origins")
            if parsed.path not in {"", "/"}:
                raise ValueError("CORS_ALLOWED_ORIGINS must not contain paths")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return list(dict.fromkeys(
            [self.FRONTEND_URL.rstrip("/")]
            + [origin.strip().rstrip("/") for origin in self.CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]
        ))


class SpeechSettings(EnvironmentSettings):
    resource_name: str = Field(default="", validation_alias="AZURE_SPEECH_RESOURCE_NAME")
    subscription_id: str = Field(default="", validation_alias="AZURE_SUBSCRIPTION_ID")
    resource_group: str = Field(default="", validation_alias="AZURE_RESOURCE_GROUP")
    region: str = Field(default="", validation_alias="AZURE_SPEECH_REGION")

    @field_validator("resource_name", "subscription_id", "resource_group", "region")
    @classmethod
    def validate_resource_part(cls, value: str, info) -> str:
        import re

        patterns = {
            "resource_name": r"[A-Za-z0-9][A-Za-z0-9-]{0,62}[A-Za-z0-9]",
            "subscription_id": r"[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}",
            "resource_group": r"[A-Za-z0-9_().-]{1,90}",
            "region": r"[a-z0-9]{1,32}",
        }
        if value and (not re.fullmatch(patterns[info.field_name], value)
                      or (info.field_name == "resource_group" and value.endswith("."))):
            raise ValueError("Invalid Azure Speech resource configuration")
        return value

    @property
    def configured(self) -> bool:
        return bool(self.resource_name and self.subscription_id and self.resource_group)

    @property
    def endpoint(self) -> str:
        return f"https://{self.resource_name}.cognitiveservices.azure.com/tts/cognitiveservices/v1"

    @property
    def resource_id(self) -> str:
        return (
            f"/subscriptions/{self.subscription_id}/resourceGroups/{self.resource_group}"
            f"/providers/Microsoft.CognitiveServices/accounts/{self.resource_name}"
        )


class ToolSettings(EnvironmentSettings):
    TIKZ_GENERATOR_MODEL: RequiredValue | None = None
    TIKZ_DISCRIMINATOR_MODEL: RequiredValue | None = None
    TIKZ_POLISHER_MODEL: RequiredValue | None = None
    AZURE_IMAGE_ENDPOINT: RequiredValue | None = None
    AZURE_IMAGE_MODEL: RequiredValue | None = None
    GENERATED_IMAGES_CONTAINER: RequiredValue | None = None
    MEMORY_CHAT_MODEL: RequiredValue | None = None
    MEMORY_EMBEDDING_MODEL: RequiredValue | None = None
    MEMORY_UPDATE_DELAY: int = Field(default=300, ge=0)
    TEACHER_ANALYTICS_AGENT_NAME: RequiredValue | None = None
    CONTENT_SAFETY_ENDPOINT: RequiredValue | None = None
    AI_SERVICES_ENDPOINT: RequiredValue | None = None
    CONTENT_GUARDRAIL_TIMEOUT: float = Field(default=10, gt=0)
    AI_DOCUMENT_INTELLIGENCE_ENDPOINT: RequiredValue | None = None
    AZURE_OPENAI_ENDPOINT: RequiredValue | None = None
    AZURE_OPENAI_DEPLOYMENT: RequiredValue | None = None
    MODEL_DEPLOYMENT_NAME: RequiredValue | None = None
    BING_CUSTOM_SEARCH_API_KEY: SecretStr | None = None
    BING_CUSTOM_SEARCH_CONFIG_ID: RequiredValue | None = None


class RuntimeSettings(EnvironmentSettings):
    AZURE_AUTH_MODE: Literal["auto", "cli", "default"] = "auto"
    AZURE_CLI_TIMEOUT: int = Field(default=60, gt=0)
    EKALAIVA_MAX_SYNC_THREADS: int = Field(default=160, ge=1)
    EKALAIVA_RESEARCH_MAX_PARALLEL: int = Field(default=4, ge=1)
    FOUNDRY_CONNECT_TIMEOUT_SECONDS: float = Field(default=15, gt=0)
    FOUNDRY_READ_TIMEOUT_SECONDS: float = Field(default=180, gt=0)


SettingsT = TypeVar("SettingsT", bound=EnvironmentSettings)


@lru_cache(maxsize=None)
def get_settings(model: type[SettingsT]) -> SettingsT:
    try:
        return model()
    except ValidationError as error:
        fields = sorted({".".join(str(part) for part in item["loc"]) or model.__name__
                         for item in error.errors(include_input=False)})
        raise RuntimeError("Missing or invalid deployment settings: " + ", ".join(fields)) from None


def require_configured(value: str | None, name: str) -> str:
    if not value or not value.strip():
        raise RuntimeError(f"{name} is required for this feature")
    return value
