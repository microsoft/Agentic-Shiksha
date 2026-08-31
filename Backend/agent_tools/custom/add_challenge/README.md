# add_challenge

Creates interactive challenges — coding problems, equations, case studies, and
problem-solving exercises — rendered as interactive UI components in the chat
pane. Students can view the problem, reveal hints one at a time, and finally
reveal the solution.

| | |
|---|---|
| Class | `AddChallengeTool` |
| Tool name | `add_challenge` |
| Schema | [definition.json](definition.json) |
| Frontend event | `challenge` |

## Arguments

| Field | Notes |
|---|---|
| `title` | Defaults to `"Challenge"` |
| `description` | The problem statement |
| `difficulty` | `easy` \| `medium` \| `hard` — anything else is coerced to `medium` |
| `challenge_type` | `coding` \| `problem` \| `case_study` \| `equation` \| `puzzle` — anything else is coerced to `problem` |
| `hints` | List of strings; blank and non-string entries are dropped |
| `solution` | Revealed by the student on demand |

## Usage

```python
from agent_tools.custom import AddChallengeTool

tool = AddChallengeTool()
result = tool.execute({"title": "Balance NH3 + O2", "difficulty": "hard"})
message = tool.output(result, arguments)
```

## Notes

`execute` never raises on bad enum values — it coerces them to the defaults
above, so a malformed model response still produces a renderable challenge.
The `output` message instructs the model not to repeat the challenge in text,
since the frontend already displays it.
