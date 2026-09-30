import json

import httpx
import pytest
from openai import OpenAI


@pytest.mark.parametrize("conversation_id", [None, "conversation-existing"])
def test_chat_and_tool_followups_use_agent_reference(monkeypatch, conversation_id):
    monkeypatch.setenv("AZURE_AI_PROJECT_ENDPOINT", "https://example.services.ai.azure.com/api/projects/test")
    monkeypatch.setenv("COSMOS_ENDPOINT", "https://example.documents.azure.com:443/")
    from admin_backend.integrations import logging_agent_chat as chat

    bodies = []
    expected_conversation = conversation_id or "conversation-new"

    def handle(request):
        if request.url.path == "/v1/conversations":
            return httpx.Response(200, json={
                "id": expected_conversation, "object": "conversation", "created_at": 0, "metadata": {},
            })
        assert request.url.path == "/v1/responses"
        body = json.loads(request.content)
        bodies.append(body)
        if "agent" in body or "agent_reference" not in body:
            return httpx.Response(400, json={"error": {
                "code": "invalid_payload", "type": "invalid_request_error",
                "message": "The 'agent' property is deprecated. Use 'agent_reference' instead.",
            }})
        if body.get("stream"):
            event = {
                "type": "response.output_item.done", "output_index": 0, "sequence_number": 0,
                "item": {
                    "id": f"item-{len(bodies)}", "type": "function_call", "name": "add_message",
                    "call_id": f"call-{len(bodies)}", "arguments": json.dumps({"content": "Offline reply"}),
                },
            }
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"},
                content=f"data: {json.dumps(event)}\n\ndata: [DONE]\n\n",
            )
        return httpx.Response(200, json={
            "id": "response-final", "object": "response", "created_at": 0,
            "model": "test-model", "status": "completed", "output": [],
        })

    with OpenAI(
        api_key="offline-test-key", base_url="https://example.invalid/v1/",
        http_client=httpx.Client(transport=httpx.MockTransport(handle)), max_retries=0,
    ) as client:
        monkeypatch.setattr(chat, "_get_openai_client", lambda: client)
        events = list(chat.chat_stream("Summarize activity.", conversation_id=conversation_id))

    assert not any(kind == "error" for kind, _data, _conversation in events)
    assert events[-1] == ("done", "", expected_conversation)
    assert len(bodies) == 3
    assert [body["stream"] for body in bodies] == [True, True, False]
    for body in bodies:
        assert "agent" not in body
        assert body["agent_reference"] == {"name": chat.AGENT_NAME, "type": "agent_reference"}
        assert body["conversation"] == expected_conversation
    assert bodies[1]["input"][0]["call_id"] == "call-1"
    assert bodies[2]["input"][0]["call_id"] == "call-2"
