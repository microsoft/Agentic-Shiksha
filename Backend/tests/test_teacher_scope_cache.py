import threading
import time

from teacher_dashboard import teacher_scope


def test_teacher_agent_queries_are_single_flight(monkeypatch):
    query_count = 0
    count_lock = threading.Lock()
    start = threading.Barrier(8)
    expected = [{"id": "course-1", "name": "Course 1"}]

    class FakeAgentsContainer:
        def query_items(self, **_kwargs):
            nonlocal query_count
            with count_lock:
                query_count += 1
            time.sleep(0.05)
            return expected

    monkeypatch.setattr(teacher_scope.cq, "_init", lambda: None)
    monkeypatch.setattr(teacher_scope.cq, "_agents", lambda: FakeAgentsContainer())

    results = []

    def list_agents():
        start.wait()
        results.append(teacher_scope.get_teacher_agents("teacher-concurrency"))

    threads = [threading.Thread(target=list_agents) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in threads)
    assert query_count == 1
    assert results == [expected] * 8