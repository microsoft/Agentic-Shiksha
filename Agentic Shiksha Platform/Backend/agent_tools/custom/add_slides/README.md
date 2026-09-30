# add_slides

Creates a structured presentation for the chat preview, speaker notes and an
editable PowerPoint download. The tool accepts deck data, not Python code, file
paths, HTML, or a remote presentation URL.

| File | Responsibility |
| --- | --- |
| [definition.json](definition.json) | Agent-visible argument schema. |
| [handler.py](handler.py) | `AddSlidesTool`: validates the deck and verifies that it can be exported before returning a block. |
| [__init__.py](__init__.py) | Exports the tool class and `ADD_SLIDES_TOOL_DEFINITION`. |

## Input and output

A minimal deck:

```json
{
  "title": "An introduction to learning",
  "theme": "academic",
  "slides": [
    {
      "layout": "title",
      "title": "An introduction to learning",
      "subtitle": "Goals and a first question",
      "speaker_notes": "Today we will connect your existing ideas to a new learning goal.",
      "component_notes": [
        {"target": "subtitle", "text": "We will start with a learning goal and a question about what you already know."}
      ]
    }
  ]
}
```

[SlideDeck](../../../backend/schemas/slides.py) accepts 1–20 slides. Layouts are
`title`, `section`, `content`, `two_column`, `question`, `summary`, `process`,
`timeline`, `quote`, and `key_stat`; themes are `academic`, `midnight`, and `warm`.
Title/section slides use a subtitle instead of bullets. Two-column slides require
exactly two columns (each with 1–4 bullets) and no top-level bullets;
content/question/summary slides require 1–5 bullets. Process/timeline slides use
2–5 ordered captions in `bullets`. Quote slides use exactly one bullet for the
quotation and `subtitle` for attribution. Key-statistic slides use exactly one
bullet of at most 40 Unicode code points and `subtitle` for its caption/context.
Only `two_column` may contain columns. Text, sources and density are bounded;
extra fields are rejected.

### Component scripts

`speaker_notes` keeps its existing name and 4000-character maximum and provides
the topic/slide introduction. Optional `component_notes` defaults to `[]` and
contains at most 12 `{target, text}` objects, with no extra properties. Target
IDs are exact and 1-based:

| Target | Existing component required |
| --- | --- |
| `title` | The slide title. |
| `subtitle` | A nonblank subtitle, including quote attribution/statistic caption. |
| `bullet-1` … `bullet-5` | The corresponding actual top-level bullet, process step or timeline event. Quotes/statistics use `bullet-1`. |
| `column-1`, `column-2` | A two-column heading/section. |
| `column-1-bullet-1` … `column-1-bullet-4` | The actual bullet in the first column. |
| `column-2-bullet-1` … `column-2-bullet-4` | The actual bullet in the second column. |

Each target is unique within a slide. Missing components and out-of-range indexes
are rejected. `text` must be nonblank XML-safe text of at most 1200 Unicode code
points. Introduction plus all component text is limited to 8000 Unicode code
points per slide; supplementary characters such as emoji count once. Scripts are
preserved verbatim, including legal whitespace; surrounding whitespace is not
discarded to fit a limit. These limits do not include generated labels or sources.
Legacy/manual decks may omit component notes and remain valid.

New generated decks should author narration **once** alongside visible content:
a useful introduction and a concrete, grounded explanation for **every substantive**
bullet, process step, timeline event, column bullet, quote and statistic. Use plain
speakable text, not repeated bullets or bracketed stage directions. Ground
statistics, quotes and source references in approved course resources; invent none.
TTS consumes the stored scripts rather than requesting a second model pass.

`execute` returns `{type: "slides", slidesId, title, deck}` with a new ID. `output`
returns a JSON confirmation including `presentation_id` and `slide_count`, not
the presentation bytes. Validation or layout failures abort the tool rather than
claiming a usable deck exists. The runtime may send `slides_start` before execution;
failure must clear that placeholder.

## Export and storage

[slide_export.py](../../../utils/slide_export.py) generates native text/shapes,
speaker notes, component scripts and source hyperlinks in memory using the pinned `python-pptx`
dependency. No Office installation, code interpreter or new storage container is
needed. Source links must be HTTP(S) URLs without credentials; export does not
fetch them. Arbitrary images, animation and live simulations are not supported.
The browser preview is not a pixel-identical PowerPoint rendering.
Native notes contain the unchanged introduction, then `Component scripts:` with
each `<target>:` label and its exact text in stored order, followed by `Sources:`.
Absent introductions or scripts are not synthesized from visible slide content.

Deck JSON uses existing chat/asset persistence. The authenticated
`POST /api/agents/{agent_name}/slides/export` route regenerates the download after
checking course access. Exporting through the API still requires the normal
authentication/storage configuration, even though rendering itself is local.

`POST /api/agents/{agent_name}/slides/save` accepts only `{"deck": ...}` and uses
the same active-user and course-access checks. A successful `200` returns
`{assetId: string, block: {type: "slides", slidesId, title, deck}}`. Saving makes a
**new private copy**, not an edit to the AI's original chat or asset. Both IDs are
fresh; ownership comes only from the verified user. The asset has category
`presentation`, type `json`, `isPublic: false`, and the originating `agentId`.
Its JSON content embeds the slides block plus that `agentId`; the response block
omits `agentId`, so the client retains the originating TA.

Rendering preflight must succeed before persistence. Invalid/overcrowded decks
return `422` without a write; internal failures return a logged, generic `503`.
The API rejects owner, visibility, source IDs and thread/message IDs in the body.
Successful responses are `private, no-store`. Saves are not idempotent and are
never automatically retried; check the asset library after an uncertain failure
before saving again. The tool's generation contract and existing agents are
unchanged by this save endpoint.

New TAs receive `add_slides` through the tool registry. Tool status reports
`{enabled, agent_version, update_available}`. An existing tool's description and
parameter schema are compared with the registry, so older agents show an available
update for the new layouts and script contract. Status reads never update agents.
An explicit, confirmed owner/admin enable/refresh action posts `{expected_version}`
and creates a version while preserving other definition fields and tools. Stale
versions are rejected; an already-current tool is not duplicated or rewritten.
Updates are not automatically retried. Repository edits, previews, exports and
private-copy saves alone never mutate live agents.
See the [presentation API](../../../backend/README.md#presentations).

## Verification

Use the [offline test environment](../../../tests/README.md#offline-test-environment),
then run from the backend service directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_slides.py tests\test_tool_definitions.py -q
```

The tests cover schema/layout validation, exact Unicode component-script
roundtrips and limits, native PowerPoint shapes/notes, authorization,
private-copy ownership and persistence, original preservation, failure handling,
tool-version updates and registry contracts without live cloud calls.
