# Learner-memory images for READMEs

**Shared knowledge. Personal memory. Traceable evidence.**

Original, self-contained figures with synthetic examples. These diagrams describe
the **custom learner-memory structure**, not the hosted Memory Store. The overview
is embedded in the [project README](../../../README.md#learner-memory) and
[memory README](../../../docs/memory/README.md#part-2-custom-learner-memory-structure).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="01-connected-memory-graphs-dark.svg">
  <img src="01-connected-memory-graphs.svg" width="1200" alt="A shared curriculum graph connected by stable IDs to separate learner states, sessions and evidence. Shared misconceptions are not duplicated; observations and policy remain separate from evidence.">
</picture>

## Choose an image

| Figure | Best use | Light | Dark |
| --- | --- | --- | --- |
| **01 / Two connected graphs** | README overview: shared definitions versus personal memory. | [SVG](01-connected-memory-graphs.svg) / [PNG](01-connected-memory-graphs.png) | [SVG](01-connected-memory-graphs-dark.svg) / [PNG](01-connected-memory-graphs-dark.png) |
| **02 / Shared misconceptions** | Explain many-to-many curriculum relationships without duplicated definitions. | [SVG](02-curriculum-many-to-many.svg) / [PNG](02-curriculum-many-to-many.png) | [SVG](02-curriculum-many-to-many-dark.svg) / [PNG](02-curriculum-many-to-many-dark.png) |
| **03 / Evidence and insights** | Separate recorded responses, interpretations, state, and a proposed read-only Insights Agent. | [SVG](03-evidence-and-longitudinal-insights.svg) / [PNG](03-evidence-and-longitudinal-insights.png) | [SVG](03-evidence-and-longitudinal-insights-dark.svg) / [PNG](03-evidence-and-longitudinal-insights-dark.png) |

**SVG** stays sharp at any size and contains no scripts, external images, or remote
fonts. **PNG** is a 2x export, 3200 pixels wide, for presentations and tools that
do not accept SVG. The light and dark versions have identical content and layout.

Open the [image gallery](../../web/memory/index.html) for keyboard-accessible tabs,
light/dark previews, full-size zoom, downloads, and **Copy Markdown**. If clipboard
access is denied, the snippet is selected and a manual-copy instruction is shown.
When opened directly from disk, **Open PNG / Open SVG** opens the export for saving
from the browser. When served over HTTP, these become download links.

## Use in a README

This example works in this image directory:

```markdown
[![Shared curriculum and personal learner memory](01-connected-memory-graphs.svg)](../../../docs/memory/overview.md)
```

For the repository's main README, use the image path
`assets/images/memory/01-connected-memory-graphs.svg` and link to
`docs/memory/overview.md`. For a README under `docs/memory`, prefix the image path
with `../../`. Change `.svg` to `.png` if your Markdown renderer needs a raster image.

To follow the reader's light/dark preference, use a picture element (paths below
are relative to this image directory):

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="01-connected-memory-graphs-dark.svg">
  <img src="01-connected-memory-graphs.svg" width="1200"
       alt="Shared curriculum definitions connect to separate learner states and traceable evidence. Synthetic example.">
</picture>
```

Keep the synthetic-example caption visible. A state label in an illustration is
not a learning assessment or evidence of a live feature.

## Edit and reproduce

The [artwork](../../web/memory/artwork.mjs) and
[generator](../../web/memory/generate.mjs) live under `assets/web/memory/`.
From the repository root, run:

```powershell
node assets\web\memory\generate.mjs
node --test assets\web\memory\artwork.test.mjs assets\web\memory\gallery.test.mjs
node --test assets\web\assets.test.mjs
```

Edit the artwork or generator, not the generated gallery or image files.
The generator uses original SVG artwork rather than a screenshot of Mermaid.
Every image uses a 1600-unit canvas with enlarged text, color-coded roles, and
explicit relationship labels. It checks text clipping, overlapping labels, and
node bounds before writing each export. Tests also check text contrast, both
themes, PNG dimensions, standalone SVG content, and README/gallery integration.
It reuses the main frontend's Playwright dependency and installed Microsoft Edge
(override with `PLAYWRIGHT_CHANNEL`). No learner records or remote APIs are read.

## Meaning and boundaries

Mermaid files are generated semantic companions, not the visual layout source.
The overview bundles `INSTANCE_OF` connections in the **Shared IDs** reference key
rather than drawing ambiguous cross-panel arrows. Ownership
of the shared misconception state and the insight's evidence citations remain in
the semantic graph even where lines are collapsed in the artwork. `NEXT_SESSION`
shows chronological order, not causation. Learner-state association lines are
view projections of the domain mappings, not new backend relationship types.
The curriculum close-up intentionally focuses on two TCs and their three
misconceptions; it is not a complete curriculum inventory.

`HAS_COMMON_MISCONCEPTION` displays the inverse of the current stored
`MISCONCEPTION ASSOCIATED_WITH TC` relationship. `SUPPORTS` refers to evidence
for misconception presence, not approval of the displayed state's label.
The state annotations are illustrative, not reducer-computed assessment results.
The overview's bottom strip summarizes the update process, not additional graph
edges. The Insights Agent appears only in the detailed third view and remains
explicitly **proposed / read-only**. These images do not change application behavior
or establish a deployed memory service, agent, or learning outcome.
See the [current memory model](../../../docs/memory/overview.md) and
[state semantics](../../../docs/memory/misconception-state.md).
