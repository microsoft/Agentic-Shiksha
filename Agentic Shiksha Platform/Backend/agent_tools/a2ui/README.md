# agent_tools/a2ui

A2UI protocol support for EKALAIVA's educational widget catalog.

[A2UI](https://a2ui.org) lets an agent describe UI declaratively while the client decides
how to render it. That keeps the rendering decision on the client instead of letting the
model emit markup.

| Module | Purpose |
| --- | --- |
| [catalog.py](catalog.py) | The custom catalog — the widget component types this project defines. |
| [adapters.py](adapters.py) | Converts EKALAIVA widget payloads into A2UI protocol messages. |

Each widget becomes one A2UI **surface**, whose component tree is a single custom
component from the catalog. The frontend counterpart is
[Frontend/src/features/chat/A2UISurface.tsx](../../../Frontend/src/features/chat/A2UISurface.tsx),
which maps each catalog type to a React component.

Adding a widget means changing both sides: the catalog and adapter here, and the renderer
there. A surface whose type the client does not recognise cannot be displayed.
