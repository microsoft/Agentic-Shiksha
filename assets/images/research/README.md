# Research artwork

[Open the gallery](../../web/research/index.html) for the figures, editable standalone SVGs, PNGs,
source trails, and reading caveats. These are logical **2026-09-30 source
snapshots**, not live Azure inventories, deployment evidence, product
screenshots, or measured learning outcomes.

Figures keep their descriptive titles, subtitles, and content labels, but omit
repeated project-name header strips, header icons, date stamps, and top-right
badges. Synthetic-example and source context remain in the gallery, SVG
descriptions, and relevant explanatory captions. Identity banners are unchanged.

## Official service icons versus original artwork

The diagrams, conceptual glyphs, and pedagogical illustrations are original
project artwork. The supplied Agentic Shiksha logo remains unchanged in both
identity banners.

Only existing managed-service nodes use downloaded official Microsoft marks:

| Figure | Existing node | Official service icons |
| --- | --- | --- |
| 01 · Course creation | Blob material storage | Azure Blob Storage |
| 01 · Course creation | Common material search index | Azure AI Search |
| 01 · Course creation | Named Foundry agent | Microsoft Foundry |
| 01 · Course creation | Application and curriculum records | Azure Cosmos DB + Azure Blob Storage |
| 03 · Platform topology | Managed-services layer | Microsoft Foundry, Azure AI Search, Azure Cosmos DB, Azure Blob Storage |

The shared [`azureServiceIcon` helper](../../web/azure-icons/diagram-icons.mjs) embeds
the original service SVGs as base64 image data. The marks retain their complete
view boxes, original colors, and proportions, without added clipping,
recoloring, rotation, mirroring, or distortion. Separate light backing plates
keep the marks legible on the dark diagram; they do not modify the marks.

See the [official-icon provenance and archive mapping](../azure-icons/README.md)
and [bundled Microsoft terms](../azure-icons/Microsoft_Terms_of_Use.pdf).
Microsoft service marks retain their own usage terms and do **not** inherit the
repository's MIT license. They identify Microsoft services, not project branding
or Microsoft endorsement.

No service or relationship is added. Backend agents, tools, workers, and
conceptual storage operations retain their original glyphs. The evidence
lifecycle and pedagogical figures 04–07 do not acquire Azure product marks.

## Reproduce and validate

From the repository root:

```powershell
node assets\web\research\generate.mjs --png
```

The renderer uses the main frontend's existing Playwright and Chromium
installation. Omitting `--png` regenerates only SVGs, the gallery, and manifest;
it does not perform browser layout validation or refresh PNGs.

Repeatable edits belong in [artwork.mjs](../../web/research/artwork.mjs). Use explicit `serviceIcons` options
only for actual service nodes, never a global replacement for the `agent`,
`database`, or other conceptual glyphs.

The generator checks source assertions, embedded images byte-for-byte against
their originals, reviewed service placements, icon/text clearance, text bounds
and overlaps, connector clearance, unmodified icon presentation, image decoding,
PNG dimensions, local links, and gallery layouts at 1440, 768, and 390 pixels.
It blocks HTTP(S) requests and records source, original-image, and output hashes
in [manifest.json](../../web/research/manifest.json). Every SVG, including the contact sheet, is self-contained;
there are no relative or external image dependencies in exported artwork.
