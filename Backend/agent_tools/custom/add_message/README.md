# add_message

Emits a text message block in the content-block sequence. Message blocks are
rendered inline with documents, quizzes, flashcards, and challenges, in the
order the model produces them.

| | |
|---|---|
| Class | `AddMessageTool` |
| Tool name | `add_message` |
| Schema | [definition.json](definition.json) |
| Frontend event | `message_block` |

## Arguments

| Field | Notes |
|---|---|
| `content` | The message text |

## Sequencing rules

- After a **message** block, the agent may only emit: document, quiz,
  flashcard, or end — **no consecutive messages**.
- After a **document / quiz / flashcard** block, the agent may emit: document,
  quiz, flashcard, message, or end.

## Usage

```python
from agent_tools.custom import AddMessageTool

tool = AddMessageTool()
result = tool.execute({"content": "Let's start with the basics."})
message = tool.output(result, arguments)
```

## Notes

`declare_plan` treats a plan of exactly `["add_message"]` as unnecessary and
returns `status: "skip"`, telling the model to reply with plain text instead of
calling this tool.
