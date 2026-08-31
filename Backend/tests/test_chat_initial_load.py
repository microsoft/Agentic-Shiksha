from azure_services.persistence import cosmos_db


def test_recent_message_hydration_uses_bounded_partition_query(monkeypatch):
    captured = {}

    class FakeMessagesContainer:
        def query_items(self, **kwargs):
            captured.update(kwargs)
            return []

    monkeypatch.setattr(
        cosmos_db,
        "_get_containers",
        lambda: (object(), FakeMessagesContainer()),
    )

    assert cosmos_db.get_recent_messages_for_user("user-1", 10) == []
    assert "SELECT TOP 200" in captured["query"]
    assert captured["partition_key"] == "user-1"