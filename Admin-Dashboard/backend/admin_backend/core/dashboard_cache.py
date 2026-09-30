from collections import OrderedDict
from concurrent.futures import Future
from copy import deepcopy
from functools import wraps
from threading import Lock
from time import monotonic


_values = OrderedDict()
_pending = {}
_lock = Lock()
_ttl_seconds = 30
_max_entries = 128


def invalidate_views() -> None:
    with _lock:
        _values.clear()
        _pending.clear()


def cached_view(function):
    @wraps(function)
    def read(*args, **kwargs):
        key = (function.__name__, args, tuple(sorted(kwargs.items())))
        with _lock:
            cached = _values.get(key)
            if cached and cached[0] > monotonic():
                _values.move_to_end(key)
                return deepcopy(cached[1])
            _values.pop(key, None)
            pending = _pending.get(key)
            owner = pending is None
            if owner:
                pending = Future()
                _pending[key] = pending
        if not owner:
            return deepcopy(pending.result(timeout=60))
        try:
            value = function(*args, **kwargs)
            with _lock:
                if _pending.get(key) is pending:
                    _pending.pop(key)
                    _values[key] = (monotonic() + _ttl_seconds, deepcopy(value))
                    while len(_values) > _max_entries:
                        _values.popitem(last=False)
            pending.set_result(value)
            return deepcopy(value)
        except BaseException as error:
            with _lock:
                if _pending.get(key) is pending:
                    _pending.pop(key)
            pending.set_exception(error)
            raise
    return read


def invalidates_views(function):
    @wraps(function)
    def write(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        finally:
            invalidate_views()
    return write