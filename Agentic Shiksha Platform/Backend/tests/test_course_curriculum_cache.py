import json
import threading
import time

from azure_services.persistence import cosmos_db
from utils.metadata_cache import MetadataCache, setup_cache, definition_cache, invalidate_agent_metadata
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
import pytest


def test_concurrent_curriculum_cache_misses_download_once(monkeypatch):
    curriculum = {
        "course_name": "Concurrency",
        "all_threshold_concepts": [{"name": "Single-flight loading"}],
    }
    payload = json.dumps(curriculum).encode("utf-8")
    download_count = 0
    count_lock = threading.Lock()
    start = threading.Barrier(8)

    class FakeDownload:
        def readall(self):
            nonlocal download_count
            with count_lock:
                download_count += 1
            time.sleep(0.05)
            return payload

    class FakeBlobClient:
        def download_blob(self):
            return FakeDownload()

    class FakeBlobService:
        def get_blob_client(self, **_kwargs):
            return FakeBlobClient()

    monkeypatch.setattr(cosmos_db, "_get_blob_service_client", lambda: FakeBlobService())
    cosmos_db.invalidate_course_curriculum_cache("course-concurrency")

    results = []

    def load_curriculum():
        start.wait()
        results.append(cosmos_db.get_course_curriculum("course-concurrency"))

    threads = [threading.Thread(target=load_curriculum) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in threads)
    assert download_count == 1
    assert results == [curriculum] * 8


def test_curriculum_cache_is_bounded(monkeypatch):
    class FakeDownload:
        def __init__(self, agent_id):
            self.agent_id = agent_id

        def readall(self):
            return json.dumps({
                "course_name": self.agent_id,
                "all_threshold_concepts": [{"name": "Bounded caching"}],
            }).encode("utf-8")

    class FakeBlobClient:
        def __init__(self, agent_id):
            self.agent_id = agent_id

        def download_blob(self):
            return FakeDownload(self.agent_id)

    class FakeBlobService:
        def get_blob_client(self, *, blob, **_kwargs):
            return FakeBlobClient(blob.split("/", 1)[0])

    monkeypatch.setattr(cosmos_db, "_get_blob_service_client", lambda: FakeBlobService())
    cosmos_db.invalidate_course_curriculum_cache()

    for index in range(70):
        cosmos_db.get_course_curriculum(f"course-{index}")

    assert len(cosmos_db._course_curriculum_cache) <= 64


def test_metadata_cache_singleflight_and_mutation_isolation():
    cache = MetadataCache()
    entered = threading.Event()
    release = threading.Event()
    calls = []

    def load():
        calls.append(True)
        entered.set()
        assert release.wait(2)
        return {"sessionUuid": "example-session"}

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(cache.get, ("project", "course-example"), load) for _ in range(6)]
        assert entered.wait(2)
        release.set()
        results = [future.result(timeout=3) for future in futures]
    assert len(calls) == 1
    results[0]["sessionUuid"] = "changed"
    assert cache.get(("project", "course-example"), load)["sessionUuid"] == "example-session"


def test_metadata_cache_expiry_invalidation_and_bound(monkeypatch):
    from utils import metadata_cache

    now = [0.0]
    monkeypatch.setattr(metadata_cache, "monotonic", lambda: now[0])
    cache = MetadataCache(ttl=30, limit=2)
    load = Mock(return_value={"version": "1"})
    key = ("project", "course-example")
    cache.get(key, load)
    cache.get(key, load)
    assert load.call_count == 1
    now[0] = 31
    cache.get(key, load)
    assert load.call_count == 2
    cache.invalidate("course-example")
    cache.get(key, load)
    assert load.call_count == 3
    cache.get(("project", "course-two"), load)
    cache.get(("project", "course-three"), load)
    assert len(cache._values) == 2


def test_invalidation_during_load_does_not_restore_stale_metadata():
    cache = MetadataCache()
    entered = threading.Event()
    release = threading.Event()

    def old_load():
        entered.set()
        assert release.wait(2)
        return {"version": "old"}

    key = ("project", "course-example")
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(cache.get, key, old_load)
        assert entered.wait(2)
        cache.invalidate("course-example")
        cache.get(key, lambda: {"version": "new"})
        release.set()
        pending.result(timeout=3)
    assert cache.get(key, lambda: {}) == {"version": "new"}


def test_cache_does_not_store_errors_or_absence():
    cache = MetadataCache()
    load = Mock(side_effect=[RuntimeError("Unavailable"), None, {"version": "new"}])
    key = ("project", "course-example")
    with pytest.raises(RuntimeError):
        cache.get(key, load)
    assert cache.get(key, load) is None
    assert cache.get(key, load) == {"version": "new"}
    assert load.call_count == 3


def test_saving_setup_invalidates_setup_and_definition(monkeypatch):
    monkeypatch.setattr(cosmos_db, "_ensure_agent_setups_container", lambda: None)
    monkeypatch.setattr(cosmos_db, "_get_blob_service_client", Mock())
    name = "course-cache-save"
    setup_cache.get((cosmos_db._AGENT_SETUPS_CONTAINER, name), lambda: {"sessionUuid": "old"})
    definition_cache.get(("project", name), lambda: {"version": "1"})
    assert cosmos_db.save_agent_setup(name, {"sessionUuid": "new"})
    assert setup_cache.get((cosmos_db._AGENT_SETUPS_CONTAINER, name), lambda: {"sessionUuid": "new"}) == {"sessionUuid": "new"}
    assert definition_cache.get(("project", name), lambda: {"version": "2"}) == {"version": "2"}
    invalidate_agent_metadata(name)