# Agentic Shiksha Architecture Atlas

Five source-backed static views and an overview/contact sheet are stored here.
The [local gallery](../../web/architecture/index.html), [generator](../../web/architecture/generate.mjs)
and [download bundle](../../web/architecture/shiksha-architecture-set.zip) live under `assets/web/architecture/`.
Use this style for architecture views: flat cards, fine dashed groups, generous
white space, and the full **Agentic Shiksha** name. System relationships and
source-snapshot caveats are retained in the gallery and SVG descriptions. The
diagrams omit repeated project-name headers, AS badges, the page counter,
snapshot footer, inline Focus/Supporting layer legend, and inventory footer
label. Descriptive topic titles, content captions, cards, and connections
remain. These are not a live Azure inventory.

## Logo palette

Colours are sampled from the supplied
[Agentic Shiksha logo](../branding/agentic-shiksha-logo.png), with a white canvas.
Original Microsoft service icons retain their own colours; the surrounding
diagram shapes and typography stay within the project palette.

| Colour | RGB | Use |
| --- | --- | --- |
| Navy | `#07183A` | Titles, body text, connectors and group boundaries |
| Royal blue | `#033CF2` | Focal capabilities, links and primary actions |
| Azure | `#019BFA` | Brand accent |
| Cyan | `#22F1EC` | Brand accent |
| Teal | `#02B3C3` | Supporting accents |
| Light blue | `#CEE7FD` | Supporting cards |
| Pale blue-white | `#F0F6FB` | Context panels and gallery surfaces |
| White | `#FFFFFF` | Canvas and text on royal blue |

Service cards pair explicit product labels with the matching official Microsoft
icons, embedded unchanged so standalone SVGs need no external image requests.
Existing `shiksha-*` filenames remain stable for links; displayed project names
always say **Agentic Shiksha**.

## Regenerate

From the repository root:

```powershell
node assets\web\architecture\generate.mjs --png
```

This updates all SVGs, 3600 × 2400 diagram PNGs, the 2400 × 1440 overview,
the palette key, and the gallery and ZIP under `assets/web/architecture/`. Rendering uses the main
frontend's existing `@playwright/test` dependency and installed Chromium.
Without `--png`, generation is dependency-free and the gallery/ZIP offer only
fresh SVGs, not potentially stale PNGs.

The ZIP preserves this same `images` / `web` layout. Extract both folders together,
then open `web\architecture\index.html`. It includes the current diagram assets,
generator, original project logo, service-icon helper, original Microsoft SVGs
and their usage terms.

Regeneration checks source references, the project palette, full project names,
unchanged icon bytes, service/logo mappings, icon clearance, text bounds and overlaps, PNG dimensions,
desktop/mobile gallery layout, and archive contents. Browser layout checks run
in `--png` mode. Regenerating requires the full repository; extracted diagrams
and the gallery can be viewed without it, but repository source links will not
resolve outside the repository.

## Architecture coverage

| View | Named service labels |
| --- | --- |
| 01 Ecosystem | Microsoft Foundry, Azure AI Search, Cosmos DB, Blob Storage |
| 02 Service architecture | Microsoft Foundry, Azure AI Search, Cosmos DB, Blob Storage |
| 03 Teaching runtime | Microsoft Foundry only |
| 04 Course knowledge | Blob Storage, Document Intelligence, Azure AI Search, Foundry |
| 05 Learner memory | Concepts and evidence processing, not standalone Azure service nodes |

The overview includes a logo palette key, not additional services.
Composite cards bind validation metadata to the actual product subtitle;
the layout/embedding card does not mislabel Azure OpenAI as Foundry.

The [official Azure icon collection](../azure-icons/README.md) and its usage
terms remain unchanged. Product symbols are not recoloured, cropped or stretched.
They identify the corresponding Microsoft services, not generic agents,
curriculum concepts or evidence-processing responsibilities.

Run the icon and generated-figure regression checks after regeneration:

```powershell
node --test assets\web\azure-icons\diagram-icons.test.mjs
```
