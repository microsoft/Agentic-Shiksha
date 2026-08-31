# features/dashboard/chat

Chat components for the teacher analytics agent.

| Component | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Message list — normal messages only. |
| [ChatBubble.tsx](ChatBubble.tsx) | Single message. |

Deliberately stripped versions of the components in [../../chat/](../../chat). The
analytics agent answers questions about cohort progress; it does not teach, so it never
emits quizzes, flashcards, challenges, clarifications or A2UI surfaces, and this pane does
not carry the code to render them.

Backed by
[Backend/teacher_dashboard/logging_agent_chat.py](../../../../../Backend/teacher_dashboard/logging_agent_chat.py),
whose tools are **read-only** analytics queries.
