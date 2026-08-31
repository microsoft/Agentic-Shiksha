# components/chat

Chat shell for the admin analytics agent.

| Component | Purpose |
| --- | --- |
| [UnifiedChatContainer.tsx](UnifiedChatContainer.tsx) | Chat container, dashboard variant. |

A stripped version of the container in
[Frontend/src/components/chat/](../../../../../Frontend/src/components/chat). The
analytics agent answers questions about usage and progress; it does not teach, so this
shell carries no quiz, flashcard, challenge or A2UI rendering.

Message components live in [../../features/chat/](../../features/chat).
