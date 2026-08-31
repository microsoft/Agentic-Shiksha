# add_quiz

Creates interactive quizzes rendered inline in the chat pane. Students answer
questions and see results without leaving the conversation.

| | |
|---|---|
| Class | `AddQuizTool` |
| Tool name | `add_quiz` |
| Schema | [definition.json](definition.json) |
| Frontend event | `quiz` |

## Arguments

| Field | Notes |
|---|---|
| `title` | Defaults to `"Quiz"` |
| `assessment_type` | `concept_inventory` or `practice_quiz` |
| `threshold_concept` | Exact associated curriculum concept for an inventory; teacher-only |
| `questions` | List of question objects (below) |

Each question:

| Field | Notes |
|---|---|
| `question` | The prompt |
| `options` | List of answer choices |
| `correct` | `int` (single answer) **or** `list[int]` (multiple correct) |
| `explanation` | Shown after answering |
| `targets_misconception` | Exact misconception from the associated concept; teacher-only |

For `concept_inventory`, the tool validates the concept and every targeted
misconception against the course curriculum. Student-facing quiz text does not
render either mapping field; they are retained for the teacher's student asset.

## Answer-index sanitisation

`correct` is validated against the number of options, because models routinely
emit out-of-range indices:

- **`int`** — must be an `int` within `0..len(options)-1`, otherwise coerced to `0`.
- **`list[int]`** — out-of-range and non-`int` entries are filtered out; if
  nothing survives, it falls back to `[0]`.

## Usage

```python
from agent_tools.custom import AddQuizTool

tool = AddQuizTool()
result = tool.execute({"title": "Phase Transitions", "questions": [...]})
message = tool.output(result, arguments)
```

## Notes

The `output` message reports the quiz title and question count, and instructs
the model not to repeat the questions in text.
