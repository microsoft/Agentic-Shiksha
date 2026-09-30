# features/projects

Conversation threads.

| Component | Purpose |
| --- | --- |
| [ThreadList.tsx](ThreadList.tsx) | Lists a user's conversations. |

Thread titles are generated server-side by the prompt in
[Backend/prompt_store/agents/conversation_title.md](../../../../Backend/prompt_store/agents/conversation_title.md),
which returns a bare 3–6 word title. Any preamble the model adds would appear verbatim in
this list.

Messages load in a bounded initial window rather than the full history — see
`CHAT_INITIAL_MESSAGE_LIMIT` and
[test_chat_initial_load.py](../../../../Backend/tests/test_chat_initial_load.py).
