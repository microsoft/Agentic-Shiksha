import threading
import time

import common_azure_auth
from azure_services.persistence import cosmos_db
from teacher_dashboard import cosmos_queries as dashboard_cosmos


def test_get_cosmos_client_initializes_once_for_concurrent_callers(monkeypatch):
    created_clients = []
    creation_lock = threading.Lock()
    start = threading.Barrier(8)

    class FakeDatabase:
        def get_container_client(self, _name):
            return object()

    class FakeCosmosClient:
        def __init__(self, **_kwargs):
            with creation_lock:
                created_clients.append(self)
            time.sleep(0.05)

        def get_database_client(self, _name):
            return FakeDatabase()

    monkeypatch.setattr(cosmos_db, "CosmosClient", FakeCosmosClient)
    monkeypatch.setattr(common_azure_auth, "get_sync_credential", lambda: object())
    monkeypatch.setattr(cosmos_db, "_cosmos_client", None)

    results = []

    def get_client():
        start.wait()
        results.append(cosmos_db.get_cosmos_client())

    threads = [threading.Thread(target=get_client) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=2)

    assert all(not thread.is_alive() for thread in threads)
    assert len(created_clients) == 1
    assert all(client is created_clients[0] for client in results)


def test_teacher_dashboard_reuses_shared_cosmos_client(monkeypatch):
    class FakeDatabase:
        def get_container_client(self, _name):
            return object()

    class FakeClient:
        def get_database_client(self, _name):
            return FakeDatabase()

    shared_client = FakeClient()
    calls = []

    def get_shared_client():
        calls.append(True)
        return shared_client

    monkeypatch.setattr(dashboard_cosmos, "get_cosmos_client", get_shared_client)
    monkeypatch.setattr(dashboard_cosmos, "_client", None)

    dashboard_cosmos._init()

    assert calls == [True]
    assert dashboard_cosmos._client is shared_client


def test_cosmos_client_uses_configured_blocking_http_pool(monkeypatch):
    captured = {}

    class FakeDatabase:
        def get_container_client(self, _name):
            return object()

    class FakeCosmosClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        def get_database_client(self, _name):
            return FakeDatabase()

    monkeypatch.setattr(cosmos_db, "CosmosClient", FakeCosmosClient)
    monkeypatch.setattr(common_azure_auth, "get_sync_credential", lambda: object())
    monkeypatch.setattr(cosmos_db, "_cosmos_client", None)

    cosmos_db.get_cosmos_client()

    transport = captured["transport"]
    assert transport._session_owner is True
    for prefix in ("https://", "http://"):
        adapter = transport.session.adapters[prefix]
        assert adapter._pool_connections == cosmos_db.COSMOS_CONNECTION_POOL_SIZE
        assert adapter._pool_maxsize == cosmos_db.COSMOS_CONNECTION_POOL_SIZE
        assert adapter._pool_block is True