# features/dashboard/chat

Chat components for the teacher analytics agent.

| Component | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Message list — normal messages only. |
| [ChatBubble.tsx](ChatBubble.tsx) | Single message. |

The pane shares the teaching chat's five-pose
[cat companion](../../../components/chat/CatCompanion.tsx), including waiting,
streaming, settling, and idle behavior. Composer activity wakes the cat, while
read-only and reduced-motion views remain still.

Deliberately stripped versions of the components in [../../chat/](../../chat). The
analytics agent answers questions about cohort progress; it does not teach, so it never
emits quizzes, challenges, clarifications or A2UI surfaces, and this pane does
not carry the code to render them.

Backed by
[Backend/teacher_dashboard/logging_agent_chat.py](../../../../../Backend/teacher_dashboard/logging_agent_chat.py),
whose tools are **read-only** analytics queries.
