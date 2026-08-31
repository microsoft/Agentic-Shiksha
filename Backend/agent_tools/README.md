# agent_tools

Tools available to the teaching agents, split by who executes them.

- **`custom/`** — function tools executed **by this backend**. The model emits a
  tool call, the dispatcher runs Python, and the result is returned to the model
  (and usually streamed to the frontend).
- **`hosted/`** — tools executed **by the Azure AI Agents service**. These
  modules only build the tool definition; there is no local handler.

## Custom tools

Each tool is a subpackage: a `definition.json` schema, an `__init__.py` holding
one `CustomTool` subclass, and a `README.md`.

| Tool | Class | Purpose |
|---|---|---|
| [add_message](custom/add_message) | `AddMessageTool` | Inline text blocks |
| [add_document](custom/add_document) | `AddDocumentTool` | Side-panel documents |
| [add_quiz](custom/add_quiz) | `AddQuizTool` | Interactive quizzes |
| [add_flashcard](custom/add_flashcard) | `AddFlashcardTool` | Flippable flashcards |
| [add_challenge](custom/add_challenge) | `AddChallengeTool` | Problems with hints + solution |
| [add_tikz_diagram](custom/add_tikz_diagram) | `AddTikzDiagramTool` | TikZ diagrams via agent pipeline |
| [declare_plan](custom/declare_plan) | `DeclarePlanTool` | Upfront tool-execution plan |
| [get_threshold_concepts](custom/get_threshold_concepts) | `GetThresholdConceptsTool` | Curriculum + learning state |
| [update_topic_progress](custom/update_topic_progress) | `UpdateTopicProgressTool` | Per-topic progress writes |
| [logging_agent_tools](custom/logging_agent_tools) | 4 classes | Read-only analytics queries |

## The tool contract

Every custom tool subclasses `CustomTool` ([custom/base.py](custom/base.py)):

```python
class AddChallengeTool(CustomTool):
    name = "add_challenge"                                  # matches definition.json

    def execute(self, arguments, **context) -> Any: ...     # run the tool
    def output(self, result, arguments) -> str: ...         # message sent back to the model
```

`**context` carries request-scoped values (`agent_name`, `user_id`) that only
`get_threshold_concepts` and `update_topic_progress` need; the rest ignore it.

## Instantiation

Tools are **stateless** — no `__init__`, no instance state — so consumers build
one shared instance each and reuse it, which is safe under the parallel
`ThreadPoolExecutor` dispatch. Instances are created in
[general_agent.py](../base_agents/general_agent.py); the packages export only
classes.

```python
from agent_tools.custom import AddChallengeTool

add_challenge_tool = AddChallengeTool()
```

> If you ever add instance state to a tool, sharing becomes a data race across
> dispatch threads.

## Adding a tool

1. Create `custom/<tool>/` with `definition.json`, `__init__.py`, `README.md`.
2. Subclass `CustomTool`; set `name` to match `definition.json`.
3. Re-export the class from [custom/\_\_init\_\_.py](custom/__init__.py).
4. Register it in `HANDLER_MODULES` in
   [tests/test_tool_definitions.py](../tests/test_tool_definitions.py).
5. Add it to `_FUNCTION_TOOL_SOURCES` in
   [agent_creation.py](../azure_services/agents/agent_creation.py) so agents get
   the schema.
6. If the agent should be able to plan with it, add the name to the whitelist
   inside `DeclarePlanTool.execute`.

## Notes

Schemas are discovered from **disk**, not imports —
[utils/tool_definitions.py](../utils/tool_definitions.py) globs `*.json` per
folder, so `definition.json` stays decoupled from the Python module.

Importing `agent_tools.custom` loads **all** tools eagerly, and Python runs that
`__init__` before any submodule — so importing one tool pulls in the rest,
including the TikZ tool's `openai` and `azure.ai.projects` dependencies.
