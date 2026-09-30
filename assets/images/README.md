# Documentation images

**A visual language for the learning idea, not a wall of infrastructure boxes.**

[Project](../../README.md) · [Research gallery](../web/research/index.html) ·
[Recorded tutorials](../web/motion/index.html) · [Evidence policy](../../docs/research.md)

## Folder layout

| Folder | Contents |
| --- | --- |
| [`assets/images/`](.) | PNG, SVG and GIF images, grouped by topic, with their guides and licensing documents |
| [`assets/web/`](../web/README.md) | HTML galleries, scripts, videos, captions, manifests, dependencies and downloadable bundles |

SVG files are images even when Windows displays a Microsoft Edge icon for them.
The image filenames stay stable for README embeds; web pages and generation
scripts use the separate `assets/web/` tree.

## Project branding

The supplied [Agentic Shiksha logo](branding/agentic-shiksha-logo.png) lives in
`assets/images/branding/`, moved unchanged from the platform folder. The
[light README banner](research/shiksha-research-banner.svg) and
[dark variant](research/shiksha-research-banner-dark.svg) embed it, so both SVGs
work independently without external image requests. The main README always uses
the light banner, regardless of the reader's theme.
The complete logo fits proportionally without cropping; after replacing the PNG,
regenerate the banners with the command below.

Both banners center the logo above the single-line tagline **From knowledge
transmission to knowledge transformation.** The right-hand learning-path
illustration is omitted. The 2400 x 600 canvas keeps the tagline close to the logo
and trims excess top and bottom space without resizing or clipping either;
PNG exports are 4800 x 1200.
Original teal/blue flowing lines and small connected points decorate only the
edges, with soft color washes and a fade that keeps the center clear. This is
decorative artwork, not a copy of another project's banner or an architecture
diagram; the supplied logo remains unchanged.
The tagline expresses teaching intent, not a product
screenshot or a claim of measured learning. Edit the banner in
[artwork.mjs](../web/research/artwork.mjs) and regenerate with
`node assets\web\research\generate.mjs --png`.

### GitHub README navigation

The [main README](../../README.md) uses five
[Shields.io static badges](https://shields.io/badges) for Get Started, Demos,
Documentation, Architecture, and EKALAIVA. The compact `plastic` style uses
rounded corners, a subtle gloss, and cyan (`#22F1EC`) icons in deep-navy
(`#07183A`) leading segments. The label colors follow the Agentic Shiksha
banner: royal blue (`#033CF2`), azure (`#0078B8`), teal (`#007F8B`), blue
(`#2451C6`), and turquoise (`#147A78`), in navigation order. The brighter logo
hues are darkened to keep the small white text readable. Labels retain their
original letter case rather than being forced to uppercase.
These 20 px linked images preserve the navigation targets and accessible labels
without custom README CSS or scripts. Badge rendering requires access to
`img.shields.io`; they are navigation links, not live build or quality claims.
The earlier local SVG designs remain available in [branding/](branding/).

## Official Azure service icons

The [Azure icon collection](azure-icons/README.md) includes original SVGs and
transparent PNGs for Blob Storage, Microsoft Foundry, AI Search, Cosmos DB,
Document Intelligence and Speech, plus a storage-account alternative.
Microsoft's source and usage terms are included. These icons identify Microsoft
services in diagrams; they do not replace Agentic Shiksha branding.
The [updated architecture-diagram bundle](../web/architecture/shiksha-azure-architecture-diagrams.zip)
contains the static atlas, Azure research figures and all six architecture
animations, including their SVG/PNG exports and Microsoft terms. Use this bundle
for the latest icon-integrated diagrams; older tutorial collection ZIPs are
separate snapshots.
Azure-service nodes in the architecture atlas, research service figures and motion
diagrams embed the original SVGs unchanged. Corresponding PNG/GIF/MP4 downloads are
rendered from the same sources; purely conceptual learning figures keep their
original symbols. See the [embedding helper](../web/azure-icons/diagram-icons.mjs).

## Signature README figures

For explicit node-and-edge memory diagrams, see the
[memory graph image gallery](../web/memory/index.html) and
[PNG/SVG downloads](memory/README.md). These show the two connected graphs,
many-to-many misconception relationships, and temporal evidence separately.

The three principal views share an original, restrained research-paper style.
The learner examples are **synthetic illustrations**, not screenshots, participant
records, or measured outcomes.

| Figure | Question | Reusable files |
| --- | --- | --- |
| [Learner feedback loop](../../docs/architecture.md) | How does evidence change the next teaching move? | [SVG](research/04-conceptual-loop.svg) / [PNG](research/04-conceptual-loop.png) |
| [Learner memory](../../docs/memory/overview.md) | How do concepts, misconceptions, evidence, and trajectory connect? | [SVG](research/05-learner-memory.svg) / [PNG](research/05-learner-memory.png) |
| [See it think](../../docs/memory/see-it-think.md) | What observable information supports a proposed next move? | [SVG](research/06-see-it-think.svg) / [PNG](research/06-see-it-think.png) |
| [Local EKALAIVA teaching ideas](../../docs/pedagogy/ekalaiva.md#pedagogical-ideas-in-this-implementation) | Which pedagogical ideas guide this implementation? Not Manohar's six framework pillars. | [SVG](research/07-ekalaiva-pillars.svg) / [PNG](research/07-ekalaiva-pillars.png) |

The conceptual loop has six components. It deliberately excludes service names,
provider wiring, and deployment topology. Separate
[agent/dataflow](../../docs/agent-dataflow.md),
[provider/module](../../docs/providers.md), and
[engineering](../../docs/deployment.md) views carry that detail.

Use the direct downloads above for these figures; previously exported tutorial
ZIPs do not automatically acquire new artwork.

## Actual-platform tutorials and research figures

See [how the UI demos are generated](../web/motion/README.md#how-the-ui-demos-are-generated)
for the Playwright/FFmpeg pipeline, local synthetic-data boundaries, and exact
commands to regenerate the learning-preferences and learner-memory walkthroughs.

The [seventeen-video gallery](../web/motion/demos.html) and
[complete media gallery](../web/motion/index.html) contain tutorials captured in the
**actual Agentic Shiksha React application**, not a drawn-chat imitation:

- Image generation: request a labeled illustration, follow the native loading
  state, inspect the full-size preview and ask a follow-up. The original
  solar-irrigation illustration is a local synthetic fixture, not live model output.
- Onboarding and profile: complete first-run questions, review the saved profile
  in Settings, update a detail and start a course.
- Teacher roster: review fictional learner progress and work in the embedded
  teacher dashboard.
- Teacher usage: explore course usage and learning activity with actual filters.
- Admin overview: inspect institution/course analytics in the independent
  Admin Dashboard frontend.
- Admin assignments: manage synthetic student course access with actual controls;
  intercepted saves never change real permissions.
- Learner memory: open Graph Memory, inspect a scoped snapshot, submit a
  diagnostic, distinguish pending evidence from committed state, open a citation
  and inspect the next recommended probe (about 44 seconds).
- Side-by-side learner and teacher: two concurrent application sessions; the
  learner practises while the teacher queries the Insights agent for a scoped
  activity summary and an updated teaching next step.
- Challenges: request a task, open the challenge and work through its guidance.
- Learner: Library, Start Chat, answer depth, streamed explanation, concept
  inventory, answer reasoning, submission and feedback (about 37 seconds).
- Teacher: Create, Course Companion, proposed fields and draft review (about
  32 seconds). The recording stops before submitting Create.
- Answer depth: compare Concise and Comprehensive on successive turns.
- Documents: generate notes, read in full screen and navigate their sections.
- Slides: browse a generated lesson, inspect speaker notes and present it.
- Circuit Lab: change a hypothetical resistor and compare local fixture readings.
- Learner preferences: save instructions, use them in chat and reopen them.
- Companion review: compare Chat only and Allow editing, inspect edits and Undo.

The original interface, components and Sora font are retained. The recordings
use fresh browser contexts with synthetic identities and in-memory API
responses. No real learner data, remote agents or cloud resources are accessed.
Course welcome screens show four conversation starters. Before any document,
quiz, image, challenge, slide deck or circuit is opened, the actual left navigation is collapsed
to give the asset more space. The recorder asserts both presentation rules and
stores the verification in each video's timing metadata.
Unknown API requests fail; third-party services and telemetry are blocked.
Captions and a pointer are added for readability, and timing is not a latency
benchmark. Single-screen exports are 1360 x 928 and the paired recording is
2656 x 976, with PNG stills, VTT captions and timing
metadata. The conceptual architecture animation remains separately labelled.
Video headers are soft lavender with dark titles; the former top-right badge is
removed. Simulation provenance stays in gallery notes and this documentation.
The paired Insights replies use the learner's intercepted demo question and
quiz receipt, verifying the change from zero to one submitted check. They are
not live cloud-generated analytics or a claim of automatic polling.
The memory demo represents the project's custom learner-memory mechanism,
not the hosted Memory Store. It uses explicit synthetic snapshot fixtures and
does not run a live memory worker or reducer. A newly typed response supplies
the displayed evidence quote. The scenario checks that pending work leaves the
old snapshot intact and that one improving response does not create mastery
or a threshold crossing.

The [research gallery](../web/research/index.html) adds an improved research banner and
three detailed SVG/PNG figures: a dark course-creation pipeline, a two-phase
evidence lifecycle, and a light cloud/service topology. These describe current
source, not an assumed live deployment or additional unconfigured Azure services.

Install media dependencies and start the frontend in the isolated test mode
documented in the gallery. Then record from the repository root:

```powershell
npm --prefix assets\web\motion ci
npm --prefix assets\web\motion run record-platform -- --all
node assets\web\motion\generate.mjs --stills-only
```

Use `--demo "onboarding-profile,teacher-roster,teacher-usage,admin-overview,admin-assignments"`
for the five role-based walkthroughs, or `--demo image-generation` for the new
image walkthrough. `--all` includes all seventeen; `--additional`
retains the earlier six-demo group. Admin demos use a separate isolated frontend
on port 4190; see [startup instructions](../web/motion/index.html#guide).
Add `--check-flow` for a faster actual-UI check without video encoding.
The original `--learner` and `--teacher` selectors remain supported.

The isolated media package supplies FFmpeg and a licensed local Sora font.
Rendering reuses the main frontend's existing Playwright and Chromium.
Application source and dependencies are unchanged. The
[recorder](../web/motion/record-platform.mjs) uses actual UI actions, while
[platform-demo.mjs](../web/motion/platform-demo.mjs) provides only synthetic state and
network responses, following the frontend's existing browser-test approach.
The additional interaction recipes live in
[additional-demos.mjs](../web/motion/additional-demos.mjs) and
[artifact-demos.mjs](../web/motion/artifact-demos.mjs), with the new
[challenge scenario](../web/motion/challenge-demo.mjs) and
[paired Insights recorder](../web/motion/record-insights.mjs) and
[custom learner-memory scenario](../web/motion/memory-demo.mjs). Circuit values are mathematically
consistent local fixtures, not a claim that a live simulator was contacted.

Regenerate the research figures using their gallery instructions before running
`node assets\web\motion\generate.mjs --stills-only` to update the compatibility banner
and publish/validate both seventeen-video galleries and illustration layout.
For gallery-only publication, use
`node assets\web\motion\generate.mjs --tutorials-only`; this preserves concurrently
edited research/memory artwork and all existing recordings.
The video-only download includes an offline gallery and all MP4/GIF, PNG, VTT
and timing metadata files. The [combined ZIP](../web/motion/shiksha-motion-set.zip)
extracts into sibling `motion`, `research`, and `architecture` folders. It is a
preserved download snapshot, not a mirror of the repository's separate `images`
and `web` trees, and is not rebuilt by the motion generator. Source links and
regeneration still require the repository.

## Agentic Shiksha Architecture Atlas

The [five-view Atlas](../web/architecture/index.html) is the primary static
architecture style for the README and documentation: flat cards, dashed groups,
and only the [logo palette](architecture/README.md#logo-palette).
Always use **Agentic Shiksha** in visible project names. Research illustrations
and the separately labelled motion studies below serve different purposes.

### Architecture in motion

The [architecture-motion gallery](../web/motion/architecture.html) expands the pastel
architecture-flow study into five original, source-backed animations. Three
structural zoom levels are followed by two focused dataflow views, rather than
claiming that every view is a separate deployment layer.

| View | Animated GIF |
| --- | --- |
| Level 1: people, platform and dependencies | [System context](motion/shiksha-level-1-context.gif) |
| Level 2: four independently built services | [Service boundaries](motion/shiksha-level-2-services.gif) |
| Level 3: scoped context, harness, tools and streaming | [Teaching runtime](motion/shiksha-level-3-runtime.gif) |
| Material processing and scoped passage retrieval | [Course grounding](motion/shiksha-course-grounding.gif) |
| Validated evidence, policy and atomic snapshots | [Opt-in learner memory](motion/shiksha-learner-memory-flow.gif) |

Each GIF is 1280 x 720, 20 seconds, 10 fps and loops indefinitely. Matching H.264
MP4s, editable SVG posters and 2560 x 1440 PNGs are linked in the gallery.
Previews start paused and allow play, pause, seeking and keyboard replay; only one
plays at a time. Raw downloaded GIFs do not have embedded pause controls.

The visuals are not live infrastructure inventories or timing benchmarks.
Graph memory and its worker are off by default. The admin analytics path's
dashed route denotes required external protection, not built-in authentication.
Memory-flow dashed arrows denote the opt-in path, not a default live service.
Every view includes source references and a four-step transcript. Applicable
service nodes use the official Azure icons with their original proportions and
colors; the icons are embedded so downloaded diagrams remain self-contained.

Regenerate using the existing media package and frontend Playwright installation:

```powershell
npm --prefix assets\web\motion run check
npm --prefix assets\web\motion run render-architecture
```

Add `-- --stills-only` for a quick SVG/PNG and layout-validation pass.
This mode leaves the existing tutorials, research banner and original flow
exports untouched. The full export checks decoded frame counts, duration,
infinite looping, dimensions, distinct frames and the 8 MiB per-GIF ceiling;
[architecture-manifest.json](../web/motion/architecture-manifest.json) records those
results and file hashes. Gallery checks cover all phases and 1440/390/320px
layouts without external network access.

### Detailed static views

The [architecture gallery](../web/architecture/index.html) contains five coordinated,
source-grounded views: platform ecosystem, service architecture, teaching-agent
runtime, course/knowledge pipeline, and opt-in learner memory. Each view is an
editable SVG and a 3600 x 2400 PNG; an overview image previews the complete set.
The visual language uses white space, dashed groups, pale-blue supporting layers,
royal-blue highlights and navy text sampled from the project logo. Actual service
labels are paired with their official Microsoft logos, embedded unchanged with
their original colours and proportions. Generic learning and memory nodes retain
their own symbols. These are not a live Azure inventory.

To regenerate from the repository root:

```powershell
node assets\web\architecture\generate.mjs --png
```

The [generator](../web/architecture/generate.mjs) uses the main frontend's existing
Playwright dependency and installed Chromium for PNG export and layout checks.
Omit `--png` for dependency-free SVG-only generation. The gallery includes source
references, interpretation notes, editing instructions and the shared palette.
Graph-memory enablement and other source-versus-deployment caveats are explicit.

Use synthetic or appropriately licensed illustrations with descriptive filenames
and Markdown alt text. Do not add screenshots containing credentials, private
resource details or real learner records.

Application assets belong in the [frontend asset directories](<../../Agentic%20Shiksha%20Platform/Frontend/src/assets/README.md>),
not here. See the [repository guide](../../README.md).
