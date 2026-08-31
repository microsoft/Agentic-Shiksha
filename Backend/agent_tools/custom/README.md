# agent_tools/custom

Function tools executed **by this backend**. The model emits a tool call, the dispatcher
runs Python, and the result goes back to the model — usually streamed to the frontend as
well.

Compare [../hosted/](../hosted), whose tools run inside Foundry and have no local handler.

## Layout

Each tool is a subpackage containing a `definition.json` schema, an `__init__.py` with one
`CustomTool` subclass, and a `README.md`.

| Tool | Purpose |
| --- | --- |
| [add_message](add_message) | Inline text blocks |
| [add_document](add_document) | Side-panel documents |
| [add_quiz](add_quiz) | Interactive quizzes |
| [add_flashcard](add_flashcard) | Flippable flashcards |
| [add_challenge](add_challenge) | Problems with hints and a solution |
| [add_tikz_diagram](add_tikz_diagram) | TikZ diagrams via the rendering pipeline |
| [declare_plan](declare_plan) | Upfront declaration of which tools a turn will use |
| [ask_clarification](ask_clarification) | A clarifying question with four options plus free text |
| [suggest_next_queries](suggest_next_queries) | Three clickable follow-up queries |
| [generate_image](generate_image) | Text-to-image generation |
| [search_knowledge_base](search_knowledge_base) | Course material lookup |
| [get_threshold_concepts](get_threshold_concepts) | Curriculum plus current learning state |
| [update_topic_progress](update_topic_progress) | Per-topic progress writes |
| [logging_agent_tools](logging_agent_tools) | Read-only analytics queries |

## The contract

```python
class AddChallengeTool(CustomTool):
    name = "add_challenge"                                  # must match definition.json

    def execute(self, arguments, **context) -> Any: ...     # run the tool
    def output(self, result, arguments) -> str: ...         # what the model sees back
```

`base.py` holds the abstract base class. `name` is the join between the Python class and
the JSON schema, and a mismatch means the tool call never dispatches.

## Keeping schemas in sync

Tool schemas are baked into a Foundry agent version at creation, so editing a
`definition.json` does not change existing agents.
[tests/test_tool_definitions.py](../../tests/test_tool_definitions.py) is the guardrail
against drift between the registry, the schemas and the classes — run it before
deploying.
