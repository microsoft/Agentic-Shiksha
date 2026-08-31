# components/common

Shared presentational components used across more than one feature.

| Component | Purpose |
| --- | --- |
| [Markdown.tsx](Markdown.tsx) | Renders markdown, including maths and code. |
| [Chat.tsx](Chat.tsx) | Generic `ChatBubble` and `ChatPane` primitives. |
| [SectionScrollRail.tsx](SectionScrollRail.tsx) | Scroll rail linking to sections of a long document. |
| [SectionTitle.tsx](SectionTitle.tsx) | Section heading. |
| [DarkFileInput.tsx](DarkFileInput.tsx) | File picker styled for the dark theme. |

`Markdown.tsx` renders model-generated content, so its sanitisation and allowed-element
configuration is a security boundary, not a styling choice. Widening it to permit raw HTML
would turn any model output — or any text a student can influence — into an XSS vector.

The chat primitives here are deliberately generic. The teaching-specific chat surface,
with quizzes, flashcards and A2UI widgets, lives in
[../../features/chat/](../../features/chat).
