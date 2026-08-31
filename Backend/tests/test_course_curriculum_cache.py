import json
import threading
import time

from azure_services.persistence import cosmos_db


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