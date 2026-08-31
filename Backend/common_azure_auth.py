# common_azure_auth.py
import os
import logging
import tempfile
import time
import threading
from typing import Any, Optional

# Suppress noisy azure.identity credential-probing warnings.
# These are just informational ("X credential unavailable") and clutter logs
# when running locally without every credential type configured.
logging.getLogger("azure.identity").setLevel(logging.ERROR)
logging.getLogger("azure.identity._credentials.chained").setLevel(logging.ERROR)

# Sync creds
from azure.identity import (
    DefaultAzureCredential as SyncDefaultCred,
    AzureCliCredential as SyncCliCred,
    ChainedTokenCredential as SyncChain,
)
# Async creds
from azure.identity.aio import (
    DefaultAzureCredential as AsyncDefaultCred,
    AzureCliCredential as AsyncCliCred,
    ChainedTokenCredential as AsyncChain,
)

# ---------------------------------------------------------------------
# Auth mode:
#   AZURE_AUTH_MODE = "auto"   -> Default (no-CLI) then CLI fallback  (recommended)
#                     "cli"    -> CLI only
#                     "default"-> DefaultAzureCredential only (no CLI)
# CLI timeout:
#   AZURE_CLI_TIMEOUT (seconds, default 60)
# ---------------------------------------------------------------------
_MODE = (os.getenv("AZURE_AUTH_MODE") or "auto").strip().lower()
_CLI_TIMEOUT = int(os.getenv("AZURE_CLI_TIMEOUT") or "60")

# Singleton only for SYNC creds (safe) – async creds are created per-use
_SYNC_CRED: Optional[SyncChain] = None

# Thread lock for credential operations to prevent Windows file locking issues
# MUST be RLock (reentrant) because get_token_with_retry() acquires this lock
# then calls _RetryCredential.get_token() which also acquires it — same thread.
_CRED_LOCK = threading.RLock()

# Token cache to reduce concurrent CLI calls
_TOKEN_CACHE: dict = {}
_TOKEN_CACHE_LOCK = threading.Lock()


def _fix_temp_dirs() -> None:
    """Force TEMP/TMP to a real directory before any Azure auth call."""
    tmp = tempfile.gettempdir()
    os.environ["TEMP"] = tmp
    os.environ["TMP"] = tmp


class _RetryCredential:
    """
    Wraps any Azure credential and adds retry logic around get_token() / get_token_info().

    This protects against Windows Azure CLI temp-file locking errors that happen
    when multiple threads (including the Cosmos DB SDK's internal health-check
    thread) try to fetch tokens concurrently.
    """

    def __init__(self, inner, max_retries: int = 3, base_delay: float = 1.0):
        self._inner = inner
        self._max_retries = max_retries
        self._base_delay = base_delay

    def _is_retryable(self, err: Exception) -> bool:
        msg = str(err).lower()
        return "cannot access the file" in msg or "being used by another process" in msg

    def get_token(self, *scopes, **kwargs):
        last_err = None
        for attempt in range(self._max_retries):
            try:
                with _CRED_LOCK:
                    return self._inner.get_token(*scopes, **kwargs)
            except Exception as e:
                last_err = e
                if self._is_retryable(e) and attempt < self._max_retries - 1:
                    time.sleep(self._base_delay * (attempt + 1))
                    continue
                raise
        raise last_err  # pragma: no cover

    def get_token_info(self, *scopes, **kwargs):
        last_err = None
        for attempt in range(self._max_retries):
            try:
                with _CRED_LOCK:
                    return self._inner.get_token_info(*scopes, **kwargs)
            except Exception as e:
                last_err = e
                if self._is_retryable(e) and attempt < self._max_retries - 1:
                    time.sleep(self._base_delay * (attempt + 1))
                    continue
                raise
        raise last_err  # pragma: no cover

    # Forward any other attribute access to the inner credential
    def __getattr__(self, name):
        return getattr(self._inner, name)


def _build_sync_credential() -> Any:
    if _MODE == "cli":
        return SyncCliCred(process_timeout=_CLI_TIMEOUT)

    if _MODE == "default":
        return SyncDefaultCred(
            exclude_cli_credential=True,
            exclude_interactive_browser_credential=False,
            exclude_visual_studio_code_credential=False,
            exclude_shared_token_cache_credential=False,
        )

    # AUTO: CLI first → Default fallback (no interactive browser to prevent blocking)
    return SyncChain(
        SyncCliCred(process_timeout=_CLI_TIMEOUT),
        SyncDefaultCred(
            exclude_cli_credential=True,
            exclude_interactive_browser_credential=True,  # Prevent blocking on browser auth
            exclude_visual_studio_code_credential=False,
            exclude_shared_token_cache_credential=False,
        ),
    )


def _build_async_credential() -> Any:
    if _MODE == "cli":
        return AsyncCliCred(process_timeout=_CLI_TIMEOUT)

    if _MODE == "default":
        return AsyncDefaultCred(
            exclude_cli_credential=True,
            exclude_interactive_browser_credential=False,
            exclude_visual_studio_code_credential=False,
            exclude_shared_token_cache_credential=False,
        )

    # AUTO: CLI first → Default fallback (no interactive browser to prevent blocking)
    return AsyncChain(
        AsyncCliCred(process_timeout=_CLI_TIMEOUT),
        AsyncDefaultCred(
            exclude_cli_credential=True,
            exclude_interactive_browser_credential=True,  # Prevent blocking on browser auth
            exclude_visual_studio_code_credential=False,
            exclude_shared_token_cache_credential=False,
        ),
    )


def get_sync_credential() -> Any:
    """Singleton sync credential for the whole app, wrapped with retry logic."""
    global _SYNC_CRED
    _fix_temp_dirs()
    with _CRED_LOCK:
        if _SYNC_CRED is None:
            _SYNC_CRED = _RetryCredential(_build_sync_credential())
    return _SYNC_CRED


def get_token_with_retry(scope: str, max_retries: int = 3, retry_delay: float = 0.5) -> str:
    """
    Get an access token with retry logic for Windows file locking issues.
    
    Azure CLI credential can fail on Windows when multiple concurrent requests
    try to access temp files. This wrapper retries with exponential backoff.
    
    Args:
        scope: The Azure scope (e.g., "https://search.azure.com/.default")
        max_retries: Maximum retry attempts
        retry_delay: Initial delay between retries (doubles each retry)
        
    Returns:
        Access token string
    """
    cred = get_sync_credential()
    last_error = None
    
    for attempt in range(max_retries):
        try:
            with _CRED_LOCK:
                # Check cache first
                cache_key = scope
                with _TOKEN_CACHE_LOCK:
                    cached = _TOKEN_CACHE.get(cache_key)
                    if cached:
                        token, expires_on = cached
                        # Check if token is still valid (with 5 min buffer)
                        if expires_on > time.time() + 300:
                            return token
                
                # Get new token
                token_info = cred.get_token(scope)
                
                # Cache the token
                with _TOKEN_CACHE_LOCK:
                    _TOKEN_CACHE[cache_key] = (token_info.token, token_info.expires_on)
                
                return token_info.token
                
        except Exception as e:
            last_error = e
            error_msg = str(e)
            # Check if it's a file locking error
            if "cannot access the file" in error_msg or "being used by another process" in error_msg:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (2 ** attempt))  # Exponential backoff
                    continue
            else:
                # Non-retryable error
                raise
    
    # All retries exhausted
    raise last_error


def get_async_credential() -> Any:
    """
    Return a *fresh* async credential each time.

    This avoids 'HTTP transport has already been closed' errors that happen
    when reusing an async credential after its underlying session is closed.
    """
    _fix_temp_dirs()
    return _build_async_credential()


async def close_async_credential() -> None:
    """
    No-op for now.

    We create a new async credential per use, so there is no shared global
    credential that needs to be closed on app shutdown.
    """
    return