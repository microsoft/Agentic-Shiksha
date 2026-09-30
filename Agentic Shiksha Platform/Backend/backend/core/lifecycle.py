"""Explicit process lifecycle, with replaceable worker and credential providers."""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
import logging
import threading
from typing import Protocol

from fastapi import FastAPI

from backend.core.research import ResearchWorkers


logger = logging.getLogger(__name__)


class MemorySettings(Protocol):
    @property
    def enabled(self) -> bool: ...
    @property
    def worker_enabled(self) -> bool: ...


class MemoryService(Protocol):
    async def worker(self, stop: asyncio.Event) -> None: ...


def _memory_settings() -> MemorySettings:
    from learner_memory.settings import get_memory_settings

    return get_memory_settings()


def _memory_service() -> MemoryService:
    from learner_memory.service import get_service

    return get_service()


def _configure_thread_capacity(capacity: int) -> None:
    import anyio.to_thread

    limiter = anyio.to_thread.current_default_thread_limiter()
    previous = limiter.total_tokens
    limiter.total_tokens = capacity
    logger.info("Sync endpoint thread capacity: %s -> %s", previous, limiter.total_tokens)


def _start_usage_reconciliation() -> None:
    from teacher_dashboard.token_stats import sync_foundry_usage_to_cosmos

    threading.Thread(
        target=sync_foundry_usage_to_cosmos,
        name="token-usage-reconciliation",
        daemon=True,
    ).start()


async def _close_credentials() -> None:
    from common_azure_auth import close_async_credential

    await close_async_credential()


@dataclass(frozen=True)
class LifecycleDependencies:
    memory_settings: Callable[[], MemorySettings] = _memory_settings
    memory_service: Callable[[], MemoryService] = _memory_service
    configure_threads: Callable[[int], None] = _configure_thread_capacity
    start_usage_reconciliation: Callable[[], None] = _start_usage_reconciliation
    close_credentials: Callable[[], Awaitable[None]] = _close_credentials


def create_lifespan(
    max_sync_threads: int,
    research: ResearchWorkers,
    dependencies: LifecycleDependencies | None = None,
):
    dependencies = dependencies or LifecycleDependencies()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        memory_stop = asyncio.Event()
        memory_task = None
        settings = dependencies.memory_settings()
        if settings.enabled:
            service = dependencies.memory_service()
            if settings.worker_enabled:
                memory_task = asyncio.create_task(
                    service.worker(memory_stop), name="learner-memory-worker"
                )
        try:
            dependencies.configure_threads(max_sync_threads)
        except Exception:
            logger.warning("Could not raise sync thread capacity", exc_info=True)
        try:
            dependencies.start_usage_reconciliation()
        except Exception:
            logger.warning("Could not start token usage reconciliation", exc_info=True)
        try:
            yield
        finally:
            memory_stop.set()
            if memory_task is not None:
                try:
                    await asyncio.wait_for(memory_task, timeout=30)
                except asyncio.TimeoutError:
                    memory_task.cancel()
                    try:
                        await memory_task
                    except asyncio.CancelledError:
                        pass
        research.shutdown()
        try:
            await dependencies.close_credentials()
        except Exception:
            logger.warning("Could not close async credential", exc_info=True)

    return lifespan
