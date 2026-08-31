# components/chat

Chat surfaces shared across features — the shell and side panels, rather than the
individual message blocks.

| Component | Purpose |
| --- | --- |
| [UnifiedChatContainer.tsx](UnifiedChatContainer.tsx) | Consistent chat shell used across the app. |
| [ChatHistoryDrawer.tsx](ChatHistoryDrawer.tsx) | Past conversations drawer. |
| [ChatQueryRail.tsx](ChatQueryRail.tsx) | Rail of queries within the current conversation. |
| [ResearchSidePanel.tsx](ResearchSidePanel.tsx) | Side panel for research output. |
| [ResearchMessageCard.tsx](ResearchMessageCard.tsx) | A single research result. |
| [ResearchMCQ.tsx](ResearchMCQ.tsx) | `parseMCQQuestions`, `ResearchMCQQuestion`, `ResearchMCQ`. |

Message-level rendering — bubbles, quizzes, flashcards, clarifications, A2UI widgets —
lives in [../../features/chat/](../../features/chat). Keep the split: this folder owns
the container, that one owns what goes inside it.

`parseMCQQuestions` parses model output and must degrade gracefully on an unexpected
shape rather than throwing.
