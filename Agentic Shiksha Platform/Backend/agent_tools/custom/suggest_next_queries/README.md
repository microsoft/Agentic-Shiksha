# suggest_next_queries

Renders three clickable follow-up queries at the end of a response.

| | |
|---|---|
| Class | `SuggestNextQueriesTool` |
| Tool name | `suggest_next_queries` |
| Schema | [definition.json](definition.json) |

## Arguments

| Field | Notes |
|---|---|
| `queries` | Exactly 3 short messages written in the student's voice |

## Rules

- Called **last**, on every turn — including short plain-text answers that use no other
  tool. This is the deliberate exception to the rule that a plain response should not call
  tools.
- Written as messages the student would send (`Show me a worked example of gradient
  descent`), not as offers (`Would you like an example?`).
- Under ~80 characters each so they fit on a button.
- Specific to what was just discussed, meaningfully different from each other, and not a
  repeat of the student's previous question.
- Not repeated in the response text — the UI renders them as buttons, so listing them
  again duplicates them on screen.
