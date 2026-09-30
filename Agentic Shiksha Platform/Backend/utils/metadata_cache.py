from collections import OrderedDict
from concurrent.futures import Future
from copy import deepcopy
from threading import Lock
from time import monotonic
from typing import Any, Callable


class MetadataCache:
    def __init__(self, ttl: float = 30, limit: int = 64):
        self.ttl = ttl
        self.limit = limit
        self._values: OrderedDict[tuple, tuple[float, Any]] = OrderedDict()
        self._pending: dict[tuple, Future] = {}
        self._lock = Lock()

    def get(self, key: tuple, load: Callable[[], Any]) -> Any:
        with self._lock:
            cached = self._values.get(key)
            if cached and cached[0] > monotonic():
                self._values.move_to_end(key)
                return deepcopy(cached[1])
            self._values.pop(key, None)
            pending = self._pending.get(key)
            owner = pending is None
            if owner:
                pending = Future()
                self._pending[key] = pending
        if not owner:
            return deepcopy(pending.result(timeout=60))
        try:
            value = load()
            with self._lock:
                if self._pending.get(key) is pending:
                    self._pending.pop(key)
                    if value is not None:
                        self._values[key] = (monotonic() + self.ttl, deepcopy(value))
                        while len(self._values) > self.limit:
                            self._values.popitem(last=False)
            pending.set_result(value)
            return deepcopy(value)
        except BaseException as error:
            with self._lock:
                if self._pending.get(key) is pending:
                    self._pending.pop(key)
            pending.set_exception(error)
            raise

    def invalidate(self, agent_name: str | None = None) -> None:
        with self._lock:
            for mapping in (self._values, self._pending):
                for key in list(mapping):
                    if agent_name is None or key[-1] == agent_name:
                        mapping.pop(key, None)


setup_cache = MetadataCache()
definition_cache = MetadataCache()


def invalidate_agent_metadata(agent_name: str) -> None:
    setup_cache.invalidate(agent_name)
    definition_cache.invalidate(agent_name)