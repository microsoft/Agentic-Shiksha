# add_message

Emits a text message block in the content-block sequence. Message blocks are
rendered inline with documents, quizzes, and challenges, in the
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

The prompt discourages consecutive message blocks and repeating content that is
already visible in an artifact. These are conversational rules, not an exhaustive
list of widget types or a validator in this tool. Current artifacts also include
slides, circuits and generated images; see the [tool inventory](../../README.md).

## Usage

```python
from agent_tools.custom import AddMessageTool

tool = AddMessageTool()
arguments = {"content": "Let's start with the basics."}
result = tool.execute(arguments)
message = tool.output(result, arguments)
```

## Notes

`declare_plan` treats a plan of exactly `["add_message"]` as unnecessary and
returns `status: "skip"`, telling the model to reply with plain text instead of
calling this tool.
