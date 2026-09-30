"""SSE framing and transport keepalives shared by the two chat protocols."""

import json
import queue
import threading
from collections.abc import Iterable, Iterator
from typing import Any


SSE_KEEPALIVE_SECONDS = 15.0


def encode_sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event)}\n\n"


def with_sse_keepalive(
    frames: Iterable[str], interval: float = SSE_KEEPALIVE_SECONDS
) -> Iterator[str]:
    pending: queue.Queue[Any] = queue.Queue(maxsize=1)
    done = object()
    stop = threading.Event()
    failure: list[BaseException] = []

    def produce():
        try:
            for frame in frames:
                while not stop.is_set():
                    try:
                        pending.put(frame, timeout=1.0)
                        break
                    except queue.Full:
                        continue
                if stop.is_set():
                    break
        except BaseException as exc:
            failure.append(exc)
        finally:
            try:
                pending.put(done, timeout=1.0)
            except queue.Full:
                pass

    worker = threading.Thread(target=produce, daemon=True)
    worker.start()
    try:
        while True:
            try:
                item = pending.get(timeout=interval)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if item is done:
                break
            yield item
    finally:
        stop.set()

    if failure:
        raise failure[0]
