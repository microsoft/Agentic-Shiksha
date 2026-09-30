"""Process-owned research workers and cancellation shared by API lifespans."""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache


logger = logging.getLogger(__name__)


class ResearchShutdown(BaseException):
    """Cancellation that pipeline Exception retry handlers must not swallow."""


class ResearchWorkers:
    def __init__(self, max_parallel: int):
        self.max_parallel = max_parallel
        self.shutdown_event = threading.Event()
        self._lock = threading.Lock()
        self._executor: ThreadPoolExecutor | None = None

    def executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._executor is None:
                self._executor = ThreadPoolExecutor(
                    max_workers=self.max_parallel, thread_name_prefix="research"
                )
                logger.info("Research executor created (max_workers=%s)", self.max_parallel)
            return self._executor

    def raise_if_cancelled(self) -> None:
        if self.shutdown_event.is_set():
            raise ResearchShutdown("server shutting down")

    def shutdown(self) -> None:
        self.shutdown_event.set()
        if self._executor is not None:
            try:
                self._executor.shutdown(wait=False, cancel_futures=True)
                logger.info("Research executor shut down (queued batches cancelled)")
            except Exception:
                logger.warning("Research executor shutdown failed", exc_info=True)


@lru_cache(maxsize=1)
def get_research_workers() -> ResearchWorkers:
    from deployment_settings import RuntimeSettings, get_settings

    return ResearchWorkers(get_settings(RuntimeSettings).EKALAIVA_RESEARCH_MAX_PARALLEL)
