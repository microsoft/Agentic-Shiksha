# declare_plan

The agent calls this **first**, before executing any other tool, to declare the
sequence of tools it intends to use. The backend then enforces that sequence via
`tool_choice` on each subsequent round.

| | |
|---|---|
| Class | `DeclarePlanTool` |
| Tool name | `declare_plan` |
| Schema | [definition.json](definition.json) |
| Frontend event | none — consumed by the backend dispatcher |

## Arguments

| Field | Notes |
|---|---|
| `tools` | Ordered list of tool names the agent intends to call |

## Return statuses

| `status` | When | Effect |
|---|---|---|
| `accepted` | Valid, non-trivial plan | Dispatcher stores `plan_data` and enforces the sequence |
| `skip` | Plan is exactly `["add_message"]` | Model is told to reply with plain text instead |
| `error` | Empty list, or unknown tool names | Message lists the invalid names and the valid set |

## Valid tool names

`add_message`, `add_document`, `add_quiz`, `add_flashcard`, `add_challenge`,
`add_tikz_diagram`, `get_threshold_concepts`,
`update_topic_progress`.

> This whitelist is maintained **inside** `execute` and is not derived from the
> tool registry. Adding a new tool means updating it here too, or valid plans
> referencing that tool will be rejected.

## Usage

```python
from agent_tools.custom import DeclarePlanTool

tool = DeclarePlanTool()
result = tool.execute({"tools": ["add_message", "add_quiz"]})
message = tool.output(result, arguments)
```

## Notes

`output` reads the tool list from `arguments` (not from `result`) and names the
first tool to execute, nudging the model straight into step one.
