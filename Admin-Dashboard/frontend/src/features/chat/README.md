# features/chat

Message components for the admin analytics agent.

| Component | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Normal-message list, date separators, timing display and typing indicator. |
| [ChatBubble.tsx](ChatBubble.tsx) | User text or assistant Markdown, copy controls and optional retry callback. |

Stripped versions of the components in
[Frontend/src/features/chat/](<../../../../../Agentic Shiksha Platform/Frontend/src/features/chat>).
This client renders text messages, not quizzes, challenges, clarifications or
A2UI surfaces. Do not assume a new upstream teaching-block format will be
rendered here. Assistant content passes through the
[shared Markdown sanitizer](../../components/common/README.md); user text is
rendered as text. Some action buttons are presentation-only unless a callback
is supplied; their presence does not imply a persisted feedback/edit API.

Backed by
[Admin-Dashboard/backend/logging_agent_chat.py](../../../../backend/logging_agent_chat.py),
whose four local tools are read-only analytics queries. A chat request still
creates/reuses a **remote Foundry conversation and model responses**; it is not
an offline query and may incur model usage. The chat shell is in
[../../components/chat/](../../components/chat).
The request/stream/abort handling is owned by
[DashboardView.tsx](../../pages/DashboardView.tsx), not by these message
components. Shared message types come from [lib/types.ts](../../lib/types.ts).
