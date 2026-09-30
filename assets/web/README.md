# Web pages and demo tools

Browsable pages and their supporting files live in `assets/web/`, alongside the
[PNG, SVG and GIF image assets](../images/README.md) in `assets/images/`.
Both folders share the repository's [assets parent](../).

| Folder | Entry point | Supporting files |
| --- | --- | --- |
| `research/` | [Research gallery](research/index.html) | Artwork definitions, generator and manifest |
| `architecture/` | [Agentic Shiksha Architecture Atlas](architecture/index.html) | Logo-palette diagram generator and downloadable bundle |
| `memory/` | [Memory graph images](memory/index.html) | Editable Mermaid graphs and PNG/SVG generator; synthetic conceptual examples |
| `motion/` | [Media gallery](motion/index.html), [video demos](motion/demos.html), [architecture animations](motion/architecture.html) | Players, recorders, videos, captions, metadata, bundles and the media package |
| `azure-icons/` | [Diagram embedding helper](azure-icons/diagram-icons.mjs), [icon bundle](azure-icons/azure-icons.zip) | Loads the unchanged [official image assets and usage terms](../images/azure-icons/README.md) |

From the repository root:

```powershell
Start-Process .\assets\web\motion\demos.html
Start-Process .\assets\web\research\index.html
```

Generation keeps image exports under `assets/images/<topic>/` and pages, scripts,
videos and metadata under `assets/web/<topic>/`. Keep both trees when copying the
galleries; their image links are relative. SVG files remain in `assets/images/`
regardless of whether Windows associates them with a web browser.

```powershell
node --test assets\web\assets.test.mjs
npm --prefix assets\web\motion run check
node assets\web\research\generate.mjs --png
node assets\web\architecture\generate.mjs --png
```

The asset tests check folder separation, gallery and guide links, manifest
hashes, and access to the original image files.
Atlas diagrams retain the project palette while allowing embedded, unchanged
official service icons. The checks reject unrecognized or external images,
modified icon content, distorted proportions, scripts and foreign objects.

See the [media guide](../images/README.md) for recording commands, source
provenance and reproduction requirements.
