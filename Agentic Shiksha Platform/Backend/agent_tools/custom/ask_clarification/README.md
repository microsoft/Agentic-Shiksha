# ask_clarification

Asks 1–3 clarifying questions and **blocks** while the student answers. The initial
answer window is 60 seconds. When it ends, the student gets a **10-second choice**:
continue with defaults for unanswered questions, or extend answering by another
60 seconds. Each accepted extension is followed by the same 10-second choice.
No choice by the end of that countdown resumes the agent in the same turn using
saved answers and sensible defaults for the rest.

| | |
|---|---|
| Class | `AskClarificationTool` |
| Tool name | `ask_clarification` |
| Schema | [definition.json](definition.json) |

## Arguments

| Field | Notes |
|---|---|
| `questions` | 1–3 question objects, shown one at a time in a single card |

Each question:

| Field | Notes |
|---|---|
| `question` | The prompt shown to the student |
| `options` | Exactly 4 short, mutually distinct choices, in the student's voice |
| `context` | Optional one-line reason for asking (~120 chars) |

## Behaviour that is easy to get wrong

- **It returns mid-turn.** The result contains the student's answers, or a note that they
  did not answer in time. The agent must continue and deliver its full response in the
  *same* turn — not end the turn after calling.
- **At most once per turn, and early.** Every question goes in the one `questions` array;
  calling twice is a contract violation.
- **Never add an "other" option.** The UI always supplies a free-text box and a skip
  action, so a fifth option is redundant.

The block is coordinated through
[utils/clarification_registry.py](../../../utils/clarification_registry.py), which is
**in-process state** — it does not survive a restart and is not shared across replicas.
Status, draft, submit, and extension requests must reach the worker hosting the
stream. They require the active authenticated owner; an administrator cannot answer
another user's questions. Deadlines use a monotonic server clock, and stale extension
revisions or expired waits cannot add time. Partial choices are saved before advancing;
unsubmitted free text stays in the form when extending but is not used as an answer.

The server emits `clarification_done` when the wait finishes. Both SSE and AG-UI
carry the clarification ID so only the matching card and waiting label close.
The UI removes "Generating clarification questions" as soon as the questions arrive.
The endpoints and response codes are documented in
[the backend API documentation](../../../backend/README.md#clarification-timing).

Prose emitted alongside this tool must still reach the student;
[tests/test_plain_text_emission.py](../../../tests/test_plain_text_emission.py) guards the
regression where the question rendered but the surrounding explanation was dropped.
Timing, partial defaults, owner checks, repeated/late extensions, and concurrent
waits are covered by [test_clarification_timing.py](../../../tests/test_clarification_timing.py).
