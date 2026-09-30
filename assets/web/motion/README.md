# Motion galleries and architecture exports

This directory contains source-backed architecture animations and separately
labelled actual-UI tutorials with synthetic data. See the
[image index](../../images/README.md) for the complete catalogue and tutorial recording
instructions.

## Playback in GitHub READMEs

The canonical [project README](../../../README.md#demos) embeds the existing
animated GIF versions of the two introductory walkthroughs. GitHub does not
render repository-relative MP4 links or repository HTML galleries as inline video
players. MP4 links therefore use `?raw=1` and are labelled as downloads, with still
previews and captions alongside them. Open the downloaded MP4 in a video player,
or open [index.html](index.html) from a local checkout for play/pause, seeking and
captions. The MP4s remain H.264/YUV420p videos with fast-start metadata.

For a native player inside GitHub Markdown, upload the MP4 as a
[GitHub video attachment](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)
and use its returned attachment URL on its own line. Do not substitute a
`blob/main/...mp4` URL or an unsupported `<video>`/`iframe` element.
The root [README](../../../README.md) points to the canonical overview rather
than maintaining a second copy with drifting links.

Illustrated architecture scenes omit repeated project-name header strips, AS
badges, and top-right level/duration stamps in every SVG, PNG, GIF, and MP4
export. Descriptive scene titles, phase labels, and instructional captions stay
visible. Gallery headings and actual-interface tutorial recordings are separate
from this diagram styling.

## How the UI demos are generated

The demos are **scripted recordings of the actual React interfaces**, not
text-to-video generations or redrawn screenshots. Application source is not
modified to create them. The recording adds only a decorative pointer and an
external title/caption frame.

### Capture pipeline

1. **Start an isolated frontend.** Vite serves the real main application in test
   mode with its API origins pointing to the same loopback address. No backend
   process, Azure account or model API key is required.
2. **Create a fresh browser context.** [record-platform.mjs](record-platform.mjs)
   launches Playwright Chromium at 1280 x 800, with service workers and external
   networking blocked. It does not reuse a signed-in browser session.
3. **Install controlled data.** [platform-demo.mjs](platform-demo.mjs) seeds a
   synthetic account/course and intercepts authentication, profile, chat and
   asset APIs. Unknown API requests fail explicitly. Fonts are served from the
   locally installed Sora package. Scenario-specific handlers override only
   the exact endpoints they demonstrate.
4. **Exercise native controls.** Each recipe uses Playwright locators to click,
   type, select tabs and open artifacts. Teaching responses are delivered as
   controlled SSE events through the application's normal chat parser. Assertions
   check the visible outcome and the submitted request, not just a screenshot.
5. **Capture a readable timeline.** `recorder.chapter`, `type`, `move`, `click`
   and `hold` collect screenshots and chapter timings. Course-chat welcome
   screens show four starters. Navigation collapses before assets open.
   Screenshot acquisition may take longer than the exported timeline; these
   videos are explanations, **not model-latency benchmarks**.
6. **Encode locally.** The media package's FFmpeg combines frames at 12 fps into
   H.264 MP4 (`yuv420p`, CRF 18, fast-start, no audio). It adds the lavender
   `#EDE9FE` header, dark `#30264D` project title and burned-in captions. There is
   no top-right badge. A 192-colour palette produces a 10 fps, infinitely looping
   GIF. A representative frame becomes the PNG poster; captions are also written
   as WebVTT.
7. **Verify and publish.** The recorder decodes MP4/GIF outputs and checks frame
   counts, dimensions, changing frames, GIF looping and file size. It writes a
   JSON record of timings and scenario evidence. [generate.mjs](generate.mjs)
   reads those records to publish and validate both galleries. Temporary frame
   files are removed after capture.

The one-screen output is **1360 x 928**. The paired student/teacher recording is
2656 x 976 and captures two independent browser contexts. The gallery keeps
simulation disclosures alongside the videos; removing the header badge does not
make the data or model replies live.

### The two regenerated walkthroughs

| Recording / selector | What the real interface does | What is simulated and checked |
| --- | --- | --- |
| [Learning preferences](shiksha-learning-preferences-tutorial.mp4) / `preferences` | Opens Learner profile, edits and saves Default instructions, sends a chat turn, then reopens the saved preference. | The profile API is in-memory. The recipe verifies the next chat request contains the saved `user_profile.customInstructions`, and the reopened field still matches. The assistant response is scripted, not a live model evaluation. |
| [Learner memory](shiksha-learner-memory-tutorial.mp4) / `memory` | Opens Course Curriculum > Graph Memory, answers a diagnostic with reasoning, reviews pending processing, refreshes state, and opens evidence behind the next probe. | Two prior probes and the before/after snapshots are synthetic. The new evidence quote comes from the answer actually typed in the demo. The recipe checks snapshot 1/pending 0, snapshot 1/pending 1, then snapshot 2/pending 0; state becomes Progressing/Resolving while the threshold stays Not crossed. |

The preferences recipe is in [additional-demos.mjs](additional-demos.mjs);
the custom learner-memory recipe is in [memory-demo.mjs](memory-demo.mjs).
The latter demonstrates the project's custom evidence/state structure, not the
separate hosted Memory Store. It does **not** run a live memory worker, model or
state reducer, and it does not enable memory for a real course. The refreshed
state is an explicit scenario fixture rather than a claim that one correct
answer proves mastery.

### Reproduce these two demos

Run commands from the repository root in Windows PowerShell. Requirements:
Node.js/npm, the main frontend's existing Playwright package, its Chromium
browser, and the dependencies in [package.json](package.json). Caption rendering
uses the Windows Segoe UI font.

If those dependencies are not installed, restore them first:

```powershell
npm --prefix "Agentic Shiksha Platform\Frontend" ci
npm --prefix assets\web\motion ci
Push-Location "Agentic Shiksha Platform\Frontend"
npx playwright install chromium
Pop-Location
```

**Terminal A - isolated main frontend:**

```powershell
$env:VITE_API_BASE_URL = "http://127.0.0.1:4188"
$env:VITE_API_URL = "http://127.0.0.1:4188"
$env:VITE_DASHBOARD_API_URL = "http://127.0.0.1:4188"
$env:VITE_USE_AGUI = "false"
npm --prefix "Agentic Shiksha Platform\Frontend" run dev -- --host 127.0.0.1 --port 4188 --strictPort --mode test
```

**Terminal B - check, record and publish:**

```powershell
npm --prefix assets\web\motion run check
node assets\web\motion\record-platform.mjs --demo "preferences,memory" --check-flow
node assets\web\motion\record-platform.mjs --demo "preferences,memory"
node assets\web\motion\generate.mjs --stills-only
```

The first two commands validate source syntax and real UI interactions without
video encoding. The third **re-records only the two selected tutorials** and
overwrites their MP4/GIF/PNG/VTT/JSON files. The last republishes all gallery
entries using their existing recordings; it does not re-record the other demos.
The gallery generator also refreshes its conceptual-flow still and banner copy.
Preserve the complete existing media collection if regenerating only a subset.

If port 4188 is already in use, reuse it only if it is the intended isolated
test frontend. Otherwise choose an unused port, change all three Vite origins
and the server `--port` in Terminal A, then set
`$env:TUTORIAL_BASE_URL = "http://127.0.0.1:<chosen-port>"` in Terminal B.
Do not stop an unrelated process or point the recorder at production.

### Output files and checks

For each recording basename:

| Output | Location | Purpose |
| --- | --- | --- |
| `.mp4` | `web\motion` | Native play/pause/seek video, with burned-in captions |
| `.gif` | `images\motion` | Looping animation for README/docs embeds |
| `.png` | `images\motion` | Poster/thumbnail |
| `.vtt` | `web\motion` | Reusable caption text and timing |
| `.json` | `web\motion` | Duration, frame counts, chapters, provenance and assertions |

[asset-paths.mjs](asset-paths.mjs) owns this split. Do not copy the image outputs
back into `web\motion`. Generated pages use repository-relative image links.

The preference recording is about **30 seconds**; the memory recording is about
**44 seconds**. Exact measured durations live in their JSON files and the
generated [tutorials.json](tutorials.json) catalogue. Visual bytes can differ
between runs because of browser versions, timestamps and native UI animations;
repeatable behavior and assertions matter more than identical media hashes.

Before sharing:

- Ensure the recording exits successfully with no unexpected API calls or page
  errors. A successful encoding alone is insufficient.
- Confirm the four starters, collapsed asset navigation and badge-free title.
- Inspect multiple exported frames, including saved preferences and the memory
  baseline, pending receipt, committed update and evidence quote.
- Confirm gallery playback, seeking, exact metadata dimensions/durations,
  desktop/mobile layout and all local download links. The generator performs
  these checks against the current collection.
- Refresh ZIP snapshots if distributing downloads. They are **not** rebuilt by
  the recorder or `generate.mjs`. The video-only archive flattens image URLs in
  its offline gallery and includes every selected MP4/GIF/PNG/VTT/JSON plus the
  gallery/player/catalogue. The complete archive preserves `web` and `images`.
  Validate each ZIP entry with SHA-256 and check the offline gallery's links.

If the application UI or API contract changes, let the dry run fail, inspect the
current component/contract, and update only the relevant recipe or scoped
fixture. Do not mask failures with forced clicks, blanket API success responses,
production credentials or edits to the application itself.

## Role-based video demos

[demos.html](demos.html) presents seventeen recordings, including the new
[image-generation walkthrough](demos.html#image-generation). Five others cover
onboarding/profile setup, teacher roster and usage workflows, and two
standalone administrator workflows. The main app and separate admin frontend
remain unchanged; fresh browser contexts and explicit local fixtures isolate
all identities, analytics and writes.

The main recording server defaults to `http://127.0.0.1:4188`. Admin scenarios
use `http://127.0.0.1:4190`, configurable through `TUTORIAL_ADMIN_BASE_URL`.
Both origins must be local HTTP. Full startup settings, including the
admin assignment flag, are documented in [the media gallery](index.html#guide).

```powershell
node assets\web\motion\record-platform.mjs --demo "onboarding-profile,teacher-roster,teacher-usage,admin-overview,admin-assignments" --check-flow
node assets\web\motion\record-platform.mjs --demo "onboarding-profile,teacher-roster,teacher-usage,admin-overview,admin-assignments"
node assets\web\motion\generate.mjs --stills-only
```

The first command exercises UI actions and assertions without recording frames.
The second exports MP4, GIF, PNG, captions and verification metadata. The third
publishes and checks the gallery. The older selectors and `--all` still work.
Four conversation starters apply to course-chat welcome screens, not to the
standalone admin dashboard. Native navigation is collapsed before assets
where that control exists. Every video retains the lavender, badge-free header.

### Image generation

For the product feature, example prompts, configuration and limitations, read
the [image-generation guide](../../../docs/image-generation.md).
This section describes the separate offline recording process.

The [image-generation demo](demos.html#image-generation) opens a course with four
starters, sends a labeled-illustration request, shows the native **Generating
image** state, opens the result in the actual image preview, then asks a
follow-up in the same conversation. The left navigation collapses before the
image appears.

[image-generation-demo.mjs](image-generation-demo.mjs) delivers the real
`generated_image_start` and `generated_image` event shapes. Its response includes
base64 pixels and an isolated local image URL, matching the live-versus-restored
image contract. Assertions verify the 1536 x 1024 result, preview, conversation
identity and image reference in the intercepted chat-sync payload.

The [solar-irrigation SVG](../../images/motion/shiksha-image-generation-example.svg)
is original tutorial artwork, rasterized locally to a
[PNG fixture](../../images/motion/shiksha-image-generation-example.png).
**It is not live model output.** No image-generation provider, quota or real
learner record is accessed, and recorded timing is not a model-speed benchmark.
The common synthetic configuration includes the current required `agent_model`
and `version` fields; no application configuration was changed.

With the isolated frontend running as described above:

```powershell
node assets\web\motion\record-platform.mjs --demo image-generation --check-flow
node assets\web\motion\record-platform.mjs --demo image-generation
node assets\web\motion\generate.mjs --tutorials-only
```

`--tutorials-only` updates and verifies the two video galleries and their
catalogue without rerendering any existing recording, architecture illustration,
research banner or memory artwork. Direct MP4/GIF/PNG/caption downloads include
the new recording; existing ZIPs remain explicitly labelled earlier snapshots.

## Architecture diagrams

- [architecture.html](architecture.html): five layered/dataflow architecture views.
- [index.html](index.html): the original architecture flow alongside the tutorial
  collection and research figures.
- [scenes.js](scenes.js): deterministic scene geometry, service labels and phases.
- [player.js](player.js): paused-by-default playback, seeking and one-player policy.
- [generate.mjs](generate.mjs): offline rendering, geometry/media checks and export.
- [architecture-manifest.json](architecture-manifest.json): generated animation
  duration, decoded-frame, file-size and hash evidence.

Images remain in [`images\motion`](../../images/motion), while these pages,
scripts, manifests, recordings, captions and ZIP downloads live in `web\motion`.
Image URLs use `../../images/motion/`; MP4, VTT, JSON and ZIP links stay local.

Download the [five architecture GIFs](shiksha-architecture-gifs.zip), or the
[complete updated architecture set](../architecture/shiksha-azure-architecture-diagrams.zip)
with static/research figures and all six animation formats. These diagram bundles
include Microsoft's icon usage terms. They are separate from the tutorial-video
collection snapshots.

Existing Azure service nodes use the [official icon collection](../../images/azure-icons/README.md).
The generator embeds unchanged original SVG data into the gallery and exported
SVGs, rather than recoloring a generic glyph. PNG, GIF and MP4 versions are
regenerated from those same scenes. No external image request is needed.
Pedagogical concepts and local application components are not replaced with
Microsoft product branding.

The original diagram layout is project artwork. Embedded Microsoft icons remain
subject to the [Microsoft usage terms](../../images/azure-icons/Microsoft_Terms_of_Use.pdf);
retain those terms when redistributing a selected diagram bundle.

## Regeneration

Run from repository root with the existing media and main-frontend dependencies:

```powershell
npm --prefix assets\web\motion run check
npm --prefix assets\web\motion run check:paths
node --test assets\web\azure-icons\diagram-icons.test.mjs
node assets\web\motion\generate.mjs --architecture --stills-only
node assets\web\motion\generate.mjs --architecture
node assets\web\motion\generate.mjs
```

The architecture option exports five 20-second scenes; without it, the generator
exports the original 16-second flow and refreshes the existing tutorial gallery
metadata. It does not rerecord the real-UI tutorial videos. `--stills-only`
regenerates SVG/PNG posters and checks phases but deliberately leaves GIF/MP4
files unchanged; run the full commands before sharing updated animation downloads.
Use `--tutorials-only` instead when publishing a new recording without touching
diagram exports.
All rendering, recording, inspection and restyling commands keep PNG/SVG/GIF
outputs in `images\motion` and MP4/VTT/JSON/HTML outputs here. Existing media ZIPs
are retained unchanged as downloadable snapshots; these commands do not rebuild
them. When repackaging, take image files from `images\motion`, not this directory.

Validation checks icon data against the source assets, label/icon containment and
overlap, animation timing, distinct decoded frames, looping, file-size limits,
local links and desktop/mobile galleries. Keep source-versus-deployment and
disabled-memory caveats intact. Rendering does not access Azure resources or
change application configuration.
