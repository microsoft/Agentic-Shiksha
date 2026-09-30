# agent_tools

Tools available to the teaching agents, split by who executes them.

- **`custom/`** — function tools executed **by this backend**. The model emits a
  tool call, the dispatcher runs Python, and the result is returned to the model
  (and usually streamed to the frontend).
- **`hosted/`** — tools executed **by the Azure AI Agents service**. These
  modules only build the tool definition; there is no local handler.

## Custom tools

Most tools have a `definition.json`, a `CustomTool` implementation and a README.
`add_slides` keeps its implementation in `handler.py`; `logging_agent_tools` has
four schemas/classes; `search_knowledge_base` is schema-only and not dispatched.

| Tool | Class | Purpose |
|---|---|---|
| [add_message](custom/add_message) | `AddMessageTool` | Inline text blocks |
| [add_document](custom/add_document) | `AddDocumentTool` | Side-panel documents |
| [add_quiz](custom/add_quiz) | `AddQuizTool` | Interactive quizzes |
| [add_challenge](custom/add_challenge) | `AddChallengeTool` | Problems with hints + solution |
| [add_circuit](custom/add_circuit) | `AddCircuitTool` | Interactive ngspice circuit simulation |
| [add_slides](custom/add_slides) | `AddSlidesTool` | Validated slide decks with native editable PowerPoint export |
| [add_tikz_diagram](custom/add_tikz_diagram) | `AddTikzDiagramTool` | Legacy TikZ pipeline, retained for existing agents but not attached to new TAs |
| [generate_image](custom/generate_image) | `GenerateImageTool` | Foundry image generation with per-user/course quota |
| [ask_clarification](custom/ask_clarification) | `AskClarificationTool` | Timed learner clarification with defaults and extensions |
| [suggest_next_queries](custom/suggest_next_queries) | `SuggestNextQueriesTool` | Three follow-up suggestions |
| [declare_plan](custom/declare_plan) | `DeclarePlanTool` | Upfront tool-execution plan |
| [get_threshold_concepts](custom/get_threshold_concepts) | `GetThresholdConceptsTool` | Curriculum + learning state |
| [update_topic_progress](custom/update_topic_progress) | `UpdateTopicProgressTool` | Per-topic progress writes |
| [logging_agent_tools](custom/logging_agent_tools) | 4 classes | Read-only analytics queries |

Flashcards are retired: new agents do not receive the former `add_flashcard`
tool, and the runtime explicitly rejects calls from older agent definitions.
The UI hides historical flashcard blocks and assets without deleting stored data.

## The tool contract

Every custom tool subclasses `CustomTool` ([custom/base.py](custom/base.py)):

```python
class AddChallengeTool(CustomTool):
    name = "add_challenge"                                  # matches definition.json

    def execute(self, arguments, **context) -> Any: ...     # run the tool
    def output(self, result, arguments) -> str: ...         # message sent back to the model
```

`**context` carries request-scoped values such as `agent_name` and `user_id`.
Progress, concept-inventory validation and image quotas are examples of consumers.
Do not assume only progress tools need context, or store a learner's identity on a
shared tool instance.

## Instantiation

Tools are **stateless** — no `__init__`, no instance state — so consumers build
one shared instance each and reuse it, which is safe under the parallel
`ThreadPoolExecutor` dispatch. Instances are created in
[harness/runtime.py](../harness/runtime.py); the packages export only
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
6. Add dispatch and stream/block handling in [harness/runtime.py](../harness/runtime.py),
   plus the relevant frontend/AG-UI catalog support. Loading a schema alone does
   not make a tool executable.
7. If the agent should be able to plan with it, add the name to the whitelist
   inside `DeclarePlanTool.execute`.

Use the [offline test setup](../tests/README.md#offline-test-environment) and run
from the service directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_tool_definitions.py tests\test_flashcard_retirement.py -q
```

## Notes

Schemas are discovered from **disk**, not imports —
[utils/tool_definitions.py](../utils/tool_definitions.py) globs `*.json` per
folder, so `definition.json` stays decoupled from the Python module.

Importing `agent_tools.custom` loads **all** tools eagerly, and Python runs that
`__init__` before any submodule — so importing one tool pulls in the rest,
including the TikZ tool's `openai` and `azure.ai.projects` dependencies.
