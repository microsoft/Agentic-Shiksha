# ask_clarification

Asks 1–3 clarifying questions and **blocks** for up to 60 seconds while the student
answers, then lets the agent finish its response in the same turn.

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

Prose emitted alongside this tool must still reach the student;
[tests/test_plain_text_emission.py](../../../tests/test_plain_text_emission.py) guards the
regression where the question rendered but the surrounding explanation was dropped.
