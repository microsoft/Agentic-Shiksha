"""
Centralized configuration for the azure_services package.

Single source of truth for endpoints, resource names, and model deployments.
Every value is read from a REQUIRED environment variable once, at import time.
If any variable is missing or empty, import fails immediately with a clear
error, so the app never starts with silent, wrong defaults. Import these names
from here instead of re-declaring ``os.getenv(...)`` constants in individual
modules.

This module must not import anything from the rest of the package (only the
standard library / dotenv) so it can be safely imported everywhere without cycles.
"""

import os
from pathlib import Path

# Load .env once, here, so this config always reflects the .env file regardless
# of which module imports it first. Anchored to the Backend package rather than
# the working directory, because a bare load_dotenv() searches upward from the
# cwd and silently finds nothing when the app is launched from elsewhere.
# Real environment variables still take precedence (load_dotenv does not
# override them), and calling it again elsewhere (e.g. main.py) is harmless.
_BACKEND_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    _app_env = (os.getenv("APP_ENV") or "development").strip().lower()
    load_dotenv(_BACKEND_DIR / f".env.{_app_env}")  # environment-specific overrides win
    load_dotenv(_BACKEND_DIR / ".env")              # shared base / fallback
except ImportError:
    # python-dotenv not installed — fall back to whatever is already in os.environ.
    pass


def env(name: str) -> str:
    """Return the value of a required environment variable.

    Raises ``RuntimeError`` immediately if it is missing or empty, so the
    application fails fast at startup instead of running with a wrong default.
    """
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


# --- Azure subscription / resource group ---
SUBSCRIPTION_ID = env("AZURE_SUBSCRIPTION_ID")
RESOURCE_GROUP = env("AZURE_RESOURCE_GROUP")

# --- Azure AI Search ---
SEARCH_SERVICE_NAME = env("AZURE_AI_SEARCH_SERVICE_NAME")
SEARCH_ENDPOINT = env("AZURE_AI_SEARCH_ENDPOINT")
API_VERSION = env("AZURE_AI_SEARCH_API_VERSION")

# --- Azure AI Foundry / project ---
PROJECT_ENDPOINT = env("AZURE_AI_PROJECT_ENDPOINT")
FOUNDRY_ENDPOINT = env("AZURE_FOUNDRY_ENDPOINT")

# --- Storage ---
STORAGE_ACCOUNT = env("STORAGE_ACCOUNT_NAME")
BLOB_CONTAINER = env("AZURE_AI_SEARCH_BLOB_CONTAINER")

# --- Models ---
CHAT_MODEL = env("AZURE_OPENAI_CHAT_MODEL")
EMBEDDING_MODEL = env("EMBEDDING_MODEL")
EMBEDDING_DIMENSIONS = int(env("EMBEDDING_DIMENSIONS"))
EVAL_MODEL = env("AZURE_EVAL_MODEL")

# --- Common index resources (shared across ALL sessions) ---
COMMON_INDEX_NAME = env("COMMON_INDEX_NAME")
COMMON_DATASOURCE_NAME = env("COMMON_DATASOURCE_NAME")
COMMON_SKILLSET_NAME = env("COMMON_SKILLSET_NAME")
COMMON_INDEXER_NAME = env("COMMON_INDEXER_NAME")
COMMON_IMAGE_CONTAINER = env("COMMON_IMAGE_CONTAINER")
