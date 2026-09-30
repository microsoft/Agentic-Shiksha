# add_quiz

Creates interactive quizzes rendered inline in the chat pane. Students answer
questions and see results without leaving the conversation.

## Graph-memory assessments

Graph-enabled requests require the server's `memory_context` and tool `call_id`.
The adapter creates a durable assessment identity from the accepted learner event
and tool call, independent of the SSE or AG-UI surface ID. Send exact published
`problem_ids` (and `questions: []`) for catalog diagnostics; generated questions
remain non-qualifying practice.

The public payload contains `assessmentInstanceId`, `quizId`,
`curriculumVersion`, `serverGraded` and public questions/option keys, never
pre-submit answer keys or misconception mappings. Submission uses the frozen
server instance and a stable event ID. Browser-supplied `correct`, question text,
scores and mappings are ignored for grading. Repeated identical first attempts
return the original result; changed answers conflict. Saved quiz assets are
display caches, not grading or learner-state authorities.

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

## Legacy-only answer-index sanitisation

`correct` is validated against the number of options, because models routinely
emit out-of-range indices:

- **`int`** — must be an `int` within `0..len(options)-1`, otherwise coerced to `0`.
- **`list[int]`** — out-of-range and non-`int` entries are filtered out; if
  nothing survives, it falls back to `[0]`.

## Usage

```python
from agent_tools.custom import AddQuizTool

tool = AddQuizTool()
arguments = {
    "title": "A quick check",
    "assessment_type": "practice_quiz",
    "questions": [{
        "question": "What is 2 + 2?",
        "options": ["3", "4", "5"],
        "correct": 1,
        "explanation": "Adding two pairs gives four.",
    }],
}
result = tool.execute(arguments)
message = tool.output(result, arguments)
```

## Notes

The `output` message reports the quiz title and question count, and instructs
the model not to repeat the questions in text.
