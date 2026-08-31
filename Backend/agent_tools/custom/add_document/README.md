# add_document

Creates structured educational documents — study guides, notes, summaries — that
are displayed in a separate panel in the frontend rather than inline in the chat.

| | |
|---|---|
| Class | `AddDocumentTool` |
| Tool name | `add_document` |
| Schema | [definition.json](definition.json) |
| Frontend event | `document` |

## Arguments

| Field | Notes |
|---|---|
| `title` | Defaults to `"Untitled Document"` |
| `content` | Document body |
| `doc_type` | Defaults to `"markdown"` |

## Usage

```python
from agent_tools.custom import AddDocumentTool

tool = AddDocumentTool()
result = tool.execute({"title": "Phase Diagrams", "content": "# Overview\n..."})
message = tool.output(result, arguments)
```

## Notes

`doc_type` drives the frontend render mode: `code` and `html` select dedicated
renderers, anything else falls back to markdown. The value flows handler -> SSE
payload -> `useAgentChat`.

The `output` message tells the model its response is complete, to stop it
emitting follow-up messages or documents unprompted.
