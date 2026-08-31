# prompt_store/agents

Small, single-purpose prompts for background tasks — not agent personas. Course teaching
instructions live in [../core_agent_prompts/](../core_agent_prompts).

| File | Purpose |
| --- | --- |
| [conversation_title.md](conversation_title.md) | Generates a 3–6 word title for a conversation. |

`conversation_title.md` requires a bare title as output — no quotes, no prefix, no
explanation — because the result is written straight into the thread list in
[Frontend/src/features/projects/ThreadList.tsx](../../../Frontend/src/features/projects/ThreadList.tsx).
Any preamble the model adds becomes part of the visible title.
