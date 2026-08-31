# features/chat

The teaching chat surface — everything a student sees inside a conversation.

## Message blocks

Each block corresponds to a custom tool in
[Backend/agent_tools/custom/](../../../../Backend/agent_tools/custom):

| Component | Backing tool |
| --- | --- |
| [QuizBlock.tsx](QuizBlock.tsx) | `add_quiz` |
| [FlashcardBlock.tsx](FlashcardBlock.tsx) | `add_flashcard` |
| [ChallengeBlock.tsx](ChallengeBlock.tsx) | `add_challenge` |
| [ClarifyBlock.tsx](ClarifyBlock.tsx) | `ask_clarification` |
| [SuggestedQueriesBlock.tsx](SuggestedQueriesBlock.tsx) | `suggest_next_queries` |

## Shell and plumbing

| Module | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Message list. |
| [ChatBubble.tsx](ChatBubble.tsx) | Single message; exports `ChatMsg`. |
| [useAgentChat.ts](useAgentChat.ts) | Streaming chat hook; exports `ThinkingToken`. |
| [A2UISurface.tsx](A2UISurface.tsx) | Renders A2UI surfaces by mapping catalog types to components. |
| [AskTASelection.tsx](AskTASelection.tsx) | "Ask the TA" action on selected text. |
| [chatQueryEvent.ts](chatQueryEvent.ts) | Cross-component events and their dispatch helpers. |

## Two coupling points to respect

- **`A2UISurface.tsx` is one half of a contract.** The other half is
  [Backend/agent_tools/a2ui/catalog.py](../../../../Backend/agent_tools/a2ui/catalog.py).
  A surface whose component type this file does not recognise cannot be rendered, so a new
  widget requires a change on both sides.
- **`ClarifyBlock` completes a blocking backend call.** `ask_clarification` holds the turn
  open for up to 60 seconds waiting for the answer submitted here. If the submission path
  breaks, the agent stalls rather than failing loudly.

`chatQueryEvent.ts` uses DOM custom events (`CHAT_SEND_QUERY_EVENT`,
`CLARIFICATION_SUBMITTED_EVENT`, `ASK_TA_QUOTE_EVENT`) to cross the component tree without
threading callbacks through every layer. Always dispatch through the exported helpers so
the payload shape stays in one place.

Assistant prose must survive turns that also call tools — the regression is guarded by
[test_plain_text_emission.py](../../../../Backend/tests/test_plain_text_emission.py).
