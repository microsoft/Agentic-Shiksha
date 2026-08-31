import threading
import time

from backend import main


def test_concurrent_agent_lists_share_one_cosmos_fill(monkeypatch):
    query_count = 0
    count_lock = threading.Lock()
    start = threading.Barrier(8)

    def list_agents_for_user(**_kwargs):
        nonlocal query_count
        with count_lock:
            query_count += 1
        time.sleep(0.05)
        return [{"id": "course-1", "name": "Course 1", "status": "active"}]

    monkeypatch.setattr(main, "get_user_profile", lambda _user_id: {"role": "teacher"})
    monkeypatch.setattr(main, "list_agents_for_user", list_agents_for_user)
    monkeypatch.setattr(main, "get_users_batch", lambda _user_ids: {})

    with main._agent_list_cache_lock:
        main.azure_agents_list._cache = {}
        main.azure_agents_list._cache_time = {}
        main._agent_list_inflight.clear()

    results = []

    def get_agents():
        start.wait()
        results.append(
            main.azure_agents_list(
                force_refresh=False,
                created_by_id=None,
                user_id="teacher-concurrency",
            )
        )

    threads = [threading.Thread(target=get_agents) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in threads)
    assert query_count == 1
    assert all(result[0]["id"] == "course-1" for result in results)