# features/chat

Message components for the admin analytics agent.

| Component | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Message list — normal messages only. |
| [ChatBubble.tsx](ChatBubble.tsx) | Single message. |

Stripped versions of the components in
[Frontend/src/features/chat/](../../../../../Frontend/src/features/chat). The analytics
agent reports on usage and progress rather than teaching, so it never emits quizzes,
flashcards, challenges, clarifications or A2UI surfaces, and these components carry no
code to render them.

Backed by
[Admin-Dashboard/backend/logging_agent_chat.py](../../../../backend/logging_agent_chat.py),
whose tools are read-only analytics queries. The chat shell is in
[../../components/chat/](../../components/chat).
