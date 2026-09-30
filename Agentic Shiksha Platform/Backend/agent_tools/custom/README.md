# agent_tools/custom

Function tools executed **by this backend**. The model emits a tool call, the dispatcher
runs Python, and the result goes back to the model — usually streamed to the frontend as
well.

Compare [../hosted/](../hosted), whose tools run inside Foundry and have no local handler.

## Layout

Most tools have a `definition.json` schema, a `CustomTool` class and a README.
`add_slides` defines its class in `handler.py` and re-exports it; the logging
subpackage has four tools, and `search_knowledge_base` is a schema-only reference.

| Tool | Purpose |
| --- | --- |
| [add_message](add_message) | Inline text blocks |
| [add_document](add_document) | Side-panel documents |
| [add_quiz](add_quiz) | Interactive quizzes |
| [add_challenge](add_challenge) | Problems with hints and a solution |
| [add_circuit](add_circuit) | Bounded ngspice simulation with editable schematic and numerical traces |
| [add_slides](add_slides) | Slide previews, speaker notes and editable PowerPoint downloads |
| [add_tikz_diagram](add_tikz_diagram) | Legacy TikZ rendering; dispatched for older agents, not attached to new TAs |
| [declare_plan](declare_plan) | Upfront declaration of which tools a turn will use |
| [ask_clarification](ask_clarification) | One to three timed questions, each with four options plus free text |
| [suggest_next_queries](suggest_next_queries) | Three clickable follow-up queries |
| [generate_image](generate_image) | Text-to-image generation |
| [search_knowledge_base](search_knowledge_base) | Schema-only reference; no local dispatch |
| [get_threshold_concepts](get_threshold_concepts) | Curriculum plus current learning state |
| [update_topic_progress](update_topic_progress) | Per-topic progress writes |
| [logging_agent_tools](logging_agent_tools) | Read-only analytics queries |

`add_flashcard` is retired, excluded from new tool definitions, and explicitly
rejected by the runtime. Do not restore it by copying an old schema. Historical
flashcard records are retained but are not offered as new content.

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

## Slide decks

`add_slides` takes a complete structured deck, validates it, and verifies PowerPoint
generation before emitting `slides_start` / `slides` content (the start event may
precede execution). AG-UI maps this to the `Slides` component. Failed generation
cancels the placeholder; a successful result contains `slidesId`, `title`, and
`deck`, never a shared server filename or public URL.

The first version supports 1-20 slides with `title`, `section`, `content`,
`two_column`, `question`, and `summary` layouts; `academic`, `midnight`, and `warm`
themes; speaker notes; and up to three source references per slide. Text is plain
text, not HTML or executable code. Titles are limited to 120 characters, subtitles
to 180, bullets to five entries of 160 characters, and notes to 4,000 characters.
Two-column slides require exactly two headings with at most four 140-character
bullets each, and no top-level bullets. Title and section slides use subtitles,
not bullets. Dense text that cannot fit at a readable size is rejected instead
of silently clipped. Sources must have a title and an optional HTTP(S) URL without
credentials; the exporter does not fetch external resources.

The validated JSON deck is stored with the existing chat and asset records.
Downloads regenerate native editable text/shapes in memory using
`python-pptx==1.0.2`; no Office installation, code interpreter, MCP server, new
storage container, global presentation state, or shared temporary files are
required. The browser preview is not an exact PowerPoint rendering. This version
does not export live simulations, HTML/JavaScript, animation, or arbitrary images.

After deploying the backend and frontend, new agents receive the tool during
creation. For an existing agent, the owner/admin must explicitly enable slides;
the authenticated tool endpoint creates a version while preserving instructions,
model, metadata and all existing tools. The implementation itself does not mutate
live agents. See the [presentation API](../../backend/README.md#presentations).

See the [dedicated tool guide](add_slides/README.md) and use the
[offline environment](../../tests/README.md#offline-test-environment), then run
from the backend service directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_slides.py tests\test_tool_definitions.py -q
```
