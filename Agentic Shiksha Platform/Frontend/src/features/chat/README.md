# features/chat

The teaching chat surface — everything a student sees inside a conversation.

## State and lifecycle ownership

`useAgentChat.ts` owns React state and orchestration. Pure response normalization
lives in `chatResponse.ts`; generation identifiers, typing cadence, and stable tool
status labels live in `generationLifecycle.ts`. These policies stay free of React
state so malformed model output and interrupted generations can be tested without
changing the hook's public API or persisted store shape.

## Message blocks

Each block corresponds to a custom tool in
[Backend/agent_tools/custom/](../../../../Backend/agent_tools/custom):

| Component | Backing tool |
| --- | --- |
| [QuizBlock.tsx](QuizBlock.tsx) | `add_quiz` |
| [ChallengeBlock.tsx](ChallengeBlock.tsx) | `add_challenge` |
| [CircuitBlock.tsx](CircuitBlock.tsx) | `add_circuit` |
| [SimulationWorkspace.tsx](SimulationWorkspace.tsx) | Circuit Lab workspace for `add_circuit` |
| [SlidesBlock.tsx](SlidesBlock.tsx) | `add_slides` |
| [ClarifyBlock.tsx](ClarifyBlock.tsx) | `ask_clarification` |
| [SuggestedQueriesBlock.tsx](SuggestedQueriesBlock.tsx) | `suggest_next_queries` |

Retired `flashcard` blocks are opaque historical data, not supported message blocks.
History loading, pagination, sync, and sharing retain their original payloads; only
render/list boundaries hide them. Legacy tool events are ignored and never create
assets. Removing stored records requires separate, explicit deletion approval.

## Shell and plumbing

The live conversation header has a fixed 44px height, including when a side pane
is open. Course/chat titles remain vertically centered. Chat History and the
More/TA actions menu use 18px icons in 32px buttons for visibility; the other
controls retain their existing sizes and the header stays compact.
The action group is right-aligned with a 12px inset; the course-name inset
on the left is unchanged. The three-dot menu uses a heavier stroke without
increasing the icon or button dimensions. A 2px gap keeps the action buttons
closer together while preserving their click targets.
On narrow screens, the chat title takes the space remaining between the course
name and buttons rather than overlapping the action controls.

Course Info, Library cards and course previews share colored initials on a dark
rounded-square badge in place of the graduation-cap placeholder. The badge uses the
first two word initials, or the first two letters for a one-word course name.
The initials' color is stable for the course name across views. Course titles
remain white, with descriptions and teacher names muted. Uploaded Library/preview
images remain unchanged; profile avatars and curriculum icons are unaffected.
Course Info and Library previews have a visible **Course information** title in
the fixed header. The course name remains inside the scrollable details.
Course Info does not display or poll material-processing status; that progress
remains available in Create/Edit.

Full-screen controls use simple four-corner icons, switching to inward-facing
corners when active.

Full-screen reading panes (including documents and concept inventories) center
their content at a maximum width of 60rem/960px, with at least 16px side padding
on smaller screens. The same margins apply to native full screen and the viewport
fallback, including shared read-only previews. Document/question navigation stays
inside the reading column. Leaving full screen restores the existing split-pane
padding without remounting content or clearing answers. Circuit and
presentation workspaces retain their separate full-screen layouts.

The TA and embedded teacher-dashboard panes use the shared
[CatCompanion](../../components/chat/CatCompanion.tsx). The same kitten sits when
ready, walks while awaiting a response, runs while streaming, stretches for one
4.8-second cycle when work stops, and sleeps after two minutes of inactivity.
Typing, focus, or clicking in the chat wakes it; changing conversations resets
the idle state. Hidden course-companion panels and read-only shares show a paused
sleeping cat. Reduced motion disables all movement.

The artwork is decorative. Assistive technology receives a single waiting or
responding status, and existing tool-status labels remain visible. Pose changes
do not add messages, change the draft, or trigger scrolling. The bouncing ball
and pulsing-dot waiting indicators have been replaced, not layered under the cat.

New turns, retries, edits, and live previews show **Contextualising...** while
request context is prepared, including before the stream opens. The backend's
`context_status` events (`preparing` / `ready`) delimit the actual preparation
phase in both SSE and AG-UI. After `ready`, the normal waiting, tool, or writing
status takes over. This is transient UI state, never a saved message or tool
activity; stopped, failed, completed, and replaced generations clear it.

Companion speech bubbles use compact 7px/10px padding, 13px headlines and 11px
supporting text. Only the headline shimmers during active work, using the shared
text-shimmer animation; resting and clarification-waiting messages stay still.
Reduced-motion and forced-color preferences disable the shimmer and retain
readable solid text without changing live-region announcements.

### Course capabilities

Course Info shows a plain **Capabilities** checklist below **Course details**, using
the same heading style: one checkmark followed by each configured feature name.
Features use two equal columns on desktop and mobile, with long labels wrapping
inside their column. Owner-only enable, confirmation and retry controls span both
columns while interactive so their messages and buttons remain readable.
[AgentCapabilities.tsx](../../components/chat/AgentCapabilities.tsx) reads the
existing agent-details API only while the dialog is open. It maps registered tools
to learner-facing names, deduplicates related tools, and omits unregistered features.
Failed or incomplete reads show a retry rather than a speculative list.
Successful capabilities and circuit/slide statuses are held in a bounded in-memory
cache for five minutes per TA and account/role. Closing and reopening the dialog
renders cached content immediately, without repeating the three requests or
flashing loading indicators. The first uncached load fetches them concurrently and
shows one loading message. Concurrent subscribers share a request; closing one
does not cancel another's read. Errors are never cached. Account changes, course
updates and tool-enable attempts invalidate cached values; old in-flight responses
cannot restore invalidated data. Server authorization and version checks remain
authoritative when enabling tools.
Owners/admins retain the existing explicit-confirmation controls for enabling
circuits or slides, presented as simple rows without decorative icons, divider
cards, or visible Enabled badges. Students can read the checklist but cannot
change tools. Opening Course Info never enables a tool.

### Slide presentations

`add_slides` produces a validated `slides` block, not a generic document or external
MCP URL. [slides.ts](../../lib/slides.ts) validates the complete deck (1–20 slides,
ten layouts, three themes), rejects unknown fields and unsafe source links, and
normalizes optional arrays/text. Legacy SSE uses `slides_start`/`slides`; AG-UI
uses the `Slides` A2UI component and `slides` step. Invalid or cancelled blocks
report an explicit failure instead of rendering empty cards.
The legacy SSE decoder removes the envelope's `thread_id` and `conversation_id`
before validating the slide block. These routing fields are not deck properties
and must not reach saved blocks or export requests. Browser fixtures include the
production envelope, including an eight-slide preview/download/reload regression.

The launch card matches the document card and opens the document-style right-hand
**Presentation pane** in live and shared chat. Desktop keeps the conversation on
the left at half width; mobile uses a full-width pane. The fixed header contains
the title, Notes, and icon buttons for Start presentation, Edit presentation
(signed-in private views), Read aloud, Download PPTX, full screen, and Close.
There is no clipboard Copy button, overflow menu, or navigation arrow beside the
canvas. Shared presentations and standalone asset previews use the same actions;
editing and saving a private copy remain separate from clipboard copying.
Presentation actions are mounted into the header by the viewer so its existing
request cancellation and cleanup stay in one place.

The non-scrolling pane fits its 16:9 canvas to the available width and height. A
fixed bottom strip holds compact thumbnails, earlier/later thumbnail scroll buttons,
and the current/total count. Scrolling the strip does not change the selected slide;
click a thumbnail or use keyboard navigation to change slides. Notes reveals speaker
notes and sources in a bounded scrollable area above the strip. Closing the pane
preserves the chat draft. Saved assets with conversation context
open in the same pane after their target conversation is ready; the navigation
selection is applied after the conversation-reset effect so it is not immediately
closed. Standalone asset previews without a conversation keep the accessible dialog.
Arrow,
Page Up/Down, and Home/End navigation is scoped to the presentation; it never
intercepts typing in chat. Plain React text is used, never HTML/Markdown from the
deck. Dense content is fitted into the canvas, with full screen available for
small screens. There is no separate slide-text transcript or keyboard-help footer;
keyboard shortcuts, speaker notes, and sources remain available.
Preview and shared-chat navigation make no export requests.
Theme colors match the native PowerPoint generator. Replacing a deck, including
its title, resets the selected slide and cancels any old export; equivalent snapshots
retain navigation. Download object URLs are revoked after use and immediately when
the viewer closes, changes deck, or loses its export context.

Download PPTX explicitly posts `{deck}` to
`/api/agents/{originating-agent}/slides/export` using the credentialed API base.
Only a successful, nonempty PowerPoint MIME response becomes a download; failures
remain visible and retryable. Shared-chat export is disabled, but notes and
preview remain available without sign-in. Completed decks retain their originating
agent ID, order, sources, and speaker notes in chat metadata and JSON assets under
the existing `document` category. Completion without a `done` event, Stop, navigation,
and page reload retain complete decks. Assets open with the same viewer, never raw JSON.

#### Editing and saving a copy

[SlidesEditor.tsx](SlidesEditor.tsx) edits presentation metadata, all ten slide
layouts, all three themes, bullets, columns, speaker notes and source links with
a live [SlideCanvas.tsx](SlideCanvas.tsx) preview. Add, duplicate, reorder and
delete slides within the existing 1-20 slide limit. At least one slide and the
required layout content must remain. Changing between body types preserves the
old content in notes; a conversion that would exceed the notes limit is rejected.
If a conversion would detach an authored component script from its content, it
is refused until those component notes are moved or removed. Compatible changes,
such as a process becoming a timeline, retain the exact script associations.
Undo/redo keeps up to 50 changes, groups typing in a field and restores selection.
Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+S work inside the editor.

In addition to title, section, content, comparison, question and summary layouts,
decks support numbered **process** cards, a connected **timeline**, a **quotation**
and a large **key statistic**. Process/timeline layouts have 2-5 items; a quotation
has one text item, with attribution in the subtitle; a key statistic has one
featured value of at most 40 Unicode characters, with explanatory context in the
subtitle. The same layouts export as editable PowerPoint text and shapes, not
screenshots. Switching to a more restrictive layout preserves incompatible text
in notes instead of silently dropping it.

The editor's **Presentation check** links to slides with missing speaker notes,
missing component scripts,
long headlines, dense text or unsourced quotations/statistics, and suggests a
clear closing takeaway and useful visual variety. These are transparent writing
suggestions, not an AI quality score or a claim that the deck's facts are verified.
For a stronger result, specify the audience, learning goal, duration and available
evidence when asking the TA for slides; use notes for spoken explanations,
examples and transitions rather than filling the slide with paragraphs.

**Save copy to Assets** explicitly posts `{deck}` to the originating TA's
authenticated `/slides/save` endpoint. The server checks course access,
validates and preflights PowerPoint rendering, then creates a private presentation
asset with a fresh ID. Neither the original chat message nor previous assets are
overwritten. A confirmed response updates the open preview; saved copies reopen
from Assets after reload. Failures retain the draft, display a retryable error and
never report success or retry writes automatically. Shared chats cannot open the
editor or save/export a deck. Account changes cancel open editing work.

The editor can import a bounded JSON deck/slide-block backup (at most 2 MB), with
confirmation and undo, or download the current valid draft as JSON or PPTX.
This is not a PowerPoint-file importer. Invalid fields, unsupported XML text,
extra JSON fields and unsafe links prevent import/save/export. Unicode text,
notes and references survive round trips. Closing a dirty editor asks before
discarding, and refreshing a dirty page uses the browser's unsaved-change warning.

#### Slide and component scripts

`speaker_notes` is the slide/topic introduction, including introductions on title
and section slides. Optional `component_notes` stores `{target, text}` for specific
components. One-based targets are `title`, `subtitle`, `bullet-1` through
`bullet-5`, `column-1`/`column-2`, and `column-1-bullet-1` through
`column-2-bullet-4`. Process steps, timeline milestones, quotations and featured
statistics use their corresponding bullet targets. A target must actually exist
on that slide; duplicate targets, unknown fields, unsafe text and excessive
scripts are rejected. There are at most 12 component notes, 1,200 characters each,
with an 8,000-character combined slide-and-component script limit.

The editor shows each component's actual text alongside its narration field.
Focusing a note highlights its component in the preview. Deleting a bullet removes
its linked script and renumbers later script targets; Undo restores both.
Saved copies, JSON backups, AG-UI/SSE restoration and PowerPoint speaker notes
retain both levels of script. Old decks without component notes remain valid.

#### Presenting

[SlidesPresenter.tsx](SlidesPresenter.tsx) starts at the selected slide in an
accessible viewport-filling dialog; native full screen is optional, not a
prerequisite. It provides previous/next, position and progress, elapsed time,
notes/sources (hidden by default), blank screen and exit controls. Arrow keys,
Page Up/Down, Space, Home/End and touch swipes navigate; B toggles blanking and
Escape exits. Exit restores the selected position and keyboard focus in the
underlying viewer, including saved-asset dialogs. Entering editing or presenting
exits the viewer's existing full-screen surface so portals remain visible.
Playback makes no model, save or export requests and works in read-only shares.

#### Reading slides aloud

**Read aloud** in the preview or presenter opens text-to-speech controls.
Choose **Saved notes & scripts** for the saved script or **Slide text** for the
visible content, select an installed local voice and speed, and explicitly start
playback. In notes mode, TTS reads the saved slide/topic introduction first, then
the exact saved component scripts in visual order. It does not call a model,
rewrite notes, assign a generic explanation to a bullet, or silently substitute
slide text. Missing scripts are reported; the user can select Slide text explicitly.
The current spoken component is highlighted on the canvas and in the notes panel;
pause retains that highlight and Stop clears it. Pause/resume and Stop are
available; optional auto-advance proceeds
only after narration finishes successfully. Manual navigation, closing the panel,
opening the editor/presenter, blanking the presentation and leaving the page stop
the relevant narration session. Opening a deck never starts speech automatically.

The default **On-device voices** provider uses browser Web Speech synthesis with
local voices only. An installed Indian English voice is preferred when available.
A browser without speech synthesis or an installed local voice shows an explicit
availability message; it never silently switches to a cloud voice.

Signed-in private presentation views also offer **Azure Indian voices**:
**Neerja** and **Prabhat** (Indian English), **Swara** and **Madhur** (Hindi).
Choose that provider and explicitly select Play to send the selected script to
Azure Speech for synthesis. The UI discloses cloud processing and possible usage
charges before playback. Voice selection does not translate or rewrite notes;
use Hindi notes for Hindi narration. Public read-only shares remain local-only.

The authorized originating-course `/slides/voices` endpoint reports whether Azure
Speech is configured, and `/slides/speech` returns private MP3 audio. Azure
credentials stay server-side; no API key is embedded in the client. Missing
configuration, permission failures and audio errors are visible and retryable.
The same narration sequence drives both providers' component highlights;
stopping, navigation, provider/voice/rate changes and unmount abort pending audio
requests and revoke playback object URLs. Neither provider starts automatically.

Narration is live playback:
PowerPoint export retains both levels of notes but does **not** embed an audio
recording or the app's runtime component-highlighting sequence.

The Playwright presentation suites are [slides.spec.ts](../../../slides.spec.ts),
[presentation-editor.spec.ts](../../../presentation-editor.spec.ts),
[presentation-player.spec.ts](../../../presentation-player.spec.ts) and
[presentation-narration.spec.ts](../../../presentation-narration.spec.ts). They cover
generation/restoration, failure handling, private copies, imports, history,
mobile layouts, read-only sharing, full-screen transitions, richer visuals and
narration lifecycle behavior with deterministic speech and Azure-audio mocks.

Course owners/admins can enable slides in **Course Info > Slide presentations**.
Opening the panel only GETs `/slides/tool`; explicit confirmation POSTs
`{expected_version}`. A failed/stale update requires rechecking the version.
The backend preserves other tools and adds slides automatically only to new TAs.
When a TA has an older slide schema or generation guidance, its owner sees
**Update slides**. Explicit confirmation refreshes only that tool in a new agent
version, preserving other tools and settings; stale versions require a recheck.
Students cannot change tool registration. No live-agent mutation happens on mount.

`slides.spec.ts` uses the existing mocked Playwright server to cover streaming,
split-pane bounds, absence of the clipboard Copy button, draft preservation, navigation,
six compact-layout viewport sizes, absence of side arrows/overflow menus, notes,
full screen, binary downloads/failures, chat reload, assets,
public shares, malformed/cancelled responses, explicit enabling, and maximum-bound
decks on desktop/mobile. Run from `Frontend` in PowerShell:
`$env:PLAYWRIGHT_CHANNEL='msedge'; npx playwright test slides.spec.ts`.
Set `$env:VITE_USE_AGUI='true'` before running to exercise the AG-UI transport
against the same fixtures. Neither run needs live agents or remote credentials.
For focused visual review, run with `--grep 'slides visual review'` and
`$env:PLAYWRIGHT_OUTPUT_DIR='test-results-slides-review'`. Each theme produces desktop
and mobile screenshots with navigation, notes, and sources visible. The browser-only
`slides-browser-harness.tsx` exercises prop replacement on the real open viewer,
including pending-export cancellation and download URL cleanup.

Circuits use `CircuitLaunchCard` in the transcript. The `onCircuitOpen` callback passes
through the chat containers to the existing document pane, where `AssetContent` validates
and renders the complete simulator. Do not render the editor inline. Public shares use
the same pane read-only, with visual playback and CSV export still available.
Circuit and document launch cards keep their titles and metadata on single lines,
truncating on narrow screens so the cards stay aligned and Open remains available.

While a circuit is open in its owner's active course conversation, chat requests include
the current draft and simulation status as user-provided context. Valid completed runs
include signed, unit-labelled final-sample readings and instrument quantities, not full
waveform arrays or animation playback values. Unsimulated, invalid, pending, or failed
drafts never send previous readings as current. The snapshot is scoped to the user,
agent, and thread, clears when the pane closes, and is neither cached in localStorage
nor added to the visible user message. Both chat transports and edited messages use it.

The circuit pane is a viewport-sized workspace, not a scrolling document. Run and
playback remain visible; a dock separates Components, Simulation, Meters, Waveforms, and
Readings. Container queries in [CircuitBlock.css](CircuitBlock.css) put the dock beside
the schematic on short, wide screens. Waveforms select a signal, readings page through
four tiles at a time, and CSV retains every trace. The green Run button solves unsimulated
changes and becomes Pause during playback; playing a current result does not rerun
ngspice. Electron/current mode, loop, and speed are in the top toolbar, without a
separate restart button. Editable circuits keep Reset changes beside Download. The
chevron beside zoom hides/shows the dock. The info button opens a keyboard-accessible
model dialog; Download offers the complete circuit SVG and results CSV. Schematic
zoom/pan changes the SVG viewBox without growing a scrollable canvas. Zooming out to
the minimum restores the fitted view; there is no separate Fit button. Keep the pane's
height constraint and `min-height: 0` chain intact.

Circuit connectivity comes from component terminal node names, not SVG intersections.
Draw wire bridges at crossings with unrelated rails and junction dots only at actual
terminals. Symbols must stay clear of crossing rails; flow markers follow the same
bridges and symbol gaps. Rendering must never modify the persisted circuit to remove
an apparent intersection. The fixed-state SPST switch is not a source selector.

Select two node labels or junctions to insert a component between those exact nodes.
The picker is a canvas overlay, not a default-ground append control. Select one node
and Ground to explicitly attach/remove a common 0 V reference, with confirmation.
Grounding that shorts a connected component is rejected by the backend. Ground references
are saved in `circuit.grounds`; normalize A2UI's empty map encoding to an empty array.

To insert in series, select a connected component and use **Series** in the Components
dock, then choose its positive or negative lead and the new part. `insertSeriesComponent`
creates a collision-free intermediate node used by exactly those two parts, rewires only
the chosen lead, and preserves other branches, probes, ground references, and polarity.
The new part is placed next to its target row. This is an electrical edit: playback stops
until Run succeeds. Disconnected targets and the format-specific component/node limits block series
insertion. Two-node insertion remains the separate add-branch operation.

Drag symbols to reorder rows and change their placement along a branch; Alt+arrow keys
and up/down controls provide keyboard alternatives. `position` is bounded visual data,
not an electrical node. Layout-only changes preserve results and save without a solve.
Disconnect preserves the part and terminal names but removes both connections and the
part's solver traces; reconnect restores the connections and requires Run. Read-only
shares allow navigation/playback/export but never electrical or placement editing.

Touchpad pinch (Ctrl-wheel), wheel zoom, two-finger pan, and touch-pointer pinch operate
on the SVG viewBox, not page zoom. The export resets the cloned SVG to the full scene.

[AssetFullscreenButton.tsx](../../components/assets/AssetFullscreenButton.tsx) sits
beside Close in live and shared document panes, covering documents, concept inventories,
challenges and circuits. It targets the nearest `data-fullscreen-surface`.
Embedded blocks suppress duplicate controls. Full screen expands the existing surface through the Fullscreen API (or a
viewport fallback), while circuit focus only hides the dock. Native exit, Escape, and
closing the pane clean up full-screen state without remounting content, losing answers,
or clearing unsimulated circuit edits.

Bulbs have an explicit `bulb` kind, fixed resistance, and a rated voltage (default 12 V).
`bulbReading` derives power and illustrative brightness from the ngspice branch current,
never from particle animation speed. The lamp symbol, power readout, and above-rating
state follow the selected transient sample. A resistor can be converted explicitly with
Load type; do not infer bulb kind from a label. Shared results retain the lamp display.

Flow uses signed ngspice component-current traces; it is illustrative, not electron drift
at physical speed. Edits or failed runs stop flow, incomplete legacy traces never invent
branch currents, and reduced-motion preferences prevent automatic playback. The existing
chat persistence browser suite covers pane placement, reruns, reload/share, playback,
direction changes, and zero/open/legacy results. It also checks every dock tab and all
legacy 32 traces in a 24-component circuit across desktop, tablet, mobile, and landscape sizes,
including control clipping, scroll overflow, paging, CSV, and draft retention. Full-screen
bounds, native/fallback exit, bulb conversion/rating/glow, and streamed/saved/shared bulb
metadata are also covered. Node-first insertion, ground/reconnect persistence, drag
placement, gesture zoom/pan, tile layout, SVG/CSV contents, and information dialogs in
fullscreen are covered by the same suite. Wait for fonts and finite transitions before measuring cards,
and poll native full-screen dimensions until browser resizing settles.

Asset full-screen regressions cover live/shared desktop and mobile views, document
downloads, concept-inventory answer/reason retention, challenge hints/solutions, and
mixed histories containing retired blocks.

## Circuit Lab

The general circuit editor now also supports format-2 industrial circuits. Device metadata
and bounds live in [circuitDevices.ts](../../lib/circuitDevices.ts), with named terminal,
parameter and PLC editors in [CircuitDevices.tsx](CircuitDevices.tsx). The Simulation
dock holds model-compatible events, fault injection and conductor roles. N/PE labels never
imply electrical bonds. [circuitExamples.ts](../../lib/circuitExamples.ts) provides nine
editable examples, including DOL, reversing, star-delta and sequencing, with confirmation
before replacing a draft. Multi-terminal pins are drawn explicitly; topology stays in node
names. Format 1 retains its 24-part/17-node limits; format 2 permits 48 parts/64 nodes.

[CircuitInstruments.tsx](CircuitInstruments.tsx) adds differential AC/DC voltage, signed
multi-conductor clamps, power/energy/PF/frequency, two-channel scope, RPM and explicit-model
lux readings. Ammeter is a zero-burden series component. All numerical meter values come
from the backend's full solver samples; playback never changes energy or calibration.
Instrument references are reconciled after deleting/disconnecting topology. Result notices
state model limits; unavailable/undersampled readings never become invented numbers.

Use the existing Playwright suite for UI, persistence, sharing and protocol regression.
`CIRCUIT_PYTHON` can point at the backend interpreter to additionally solve every exact
frontend preset with real ngspice. `PLAYWRIGHT_PORT` and `PLAYWRIGHT_OUTPUT_DIR` allow an
isolated run when another session is using the default port; default behavior is unchanged.

[SimulationWorkspace.tsx](SimulationWorkspace.tsx) opens from simulation cards generated
in the chat when the learner requests a supported simulation. There is no standalone
Simulation shortcut in the TA actions menu. It opens **Circuit Lab** directly
inside the existing asset pane/full-screen control, without a trainer mode.

The `add_circuit` tool returns the validated circuit specification and computed result.
Both SSE and AG-UI carry them through message persistence, reload, assets and sharing.
Shared/read-only views retain playback without editing or starting new simulations.
Course capabilities label this tool **Simulation**. Owners may explicitly update an older
tool schema using the existing version-checked confirmation flow; mounting the UI makes
no agent-version changes. Routine Text responses, Clarifying questions, and Follow-up
suggestions are not listed as capabilities; their chat behavior remains available.
The simulation row has no descriptive subtitle.

For example, a learner can ask "Simulate a 12 V resistor circuit". The TA calls
`add_circuit` and the reply contains
an Open card. Backend per-turn guidance uses this path even for existing named TAs;
unavailable/outdated tools require the owner's enable/update action in capabilities.
Missing model details are clarified; unsupported simulations are not invented.

Industrial Trainer is retired. Historical `industrial_trainer` assets are hidden through
the read-only retired-content filter. Saved circuit envelopes ignore their obsolete
trainer metadata and continue opening as circuits. No stored learner records are deleted.

| Module | Purpose |
| --- | --- |
| [ChatPane.tsx](ChatPane.tsx) | Message list. |
| [ChatBubble.tsx](ChatBubble.tsx) | Single message; exports `ChatMsg`. |
| [useAgentChat.ts](useAgentChat.ts) | Streaming chat hook; exports `ThinkingToken`. |
| [A2UISurface.tsx](A2UISurface.tsx) | Renders A2UI surfaces by mapping catalog types to components. |
| [AskTASelection.tsx](AskTASelection.tsx) | "Ask the TA" action on selected text. |
| [chatQueryEvent.ts](chatQueryEvent.ts) | Cross-component events and their dispatch helpers. |

## Two coupling points to respect

- **`A2UISurface.tsx` is one half of a contract.** The other half is
  [Backend/agent_tools/a2ui/catalog.py](../../../../Backend/agent_tools/a2ui/catalog.py).
  A surface whose component type this file does not recognise cannot be rendered, so a new
  widget requires a change on both sides.
- **`ClarifyBlock` completes a blocking backend call.** `ask_clarification` holds the turn
  open for a 60-second answer window, followed by a 10-second choice to continue with
  defaults or extend by 60 seconds. Every extension gets the same decision window.
  If no choice is made, the server resumes with saved answers and defaults for the rest.
  The timer is loaded from the server, not the message creation time or a new mount.
  Partial choices are saved before advancing; extension preserves selections and unsent
  free text. Failed submissions/extensions remain visible and retryable, without
  pretending the agent resumed or the timer was extended. The generation status row
  disappears once the question card arrives, and `clarification_done` clears only the
  matching card's waiting state on either transport.

Clarification browser regressions use synthetic SSE/AG-UI streams and a controlled clock:
`npx playwright test chat-persistence.spec.ts --grep "clarification"`.
Run with `VITE_USE_AGUI=false` and `VITE_USE_AGUI=true` to cover both transports.

`chatQueryEvent.ts` uses DOM custom events (`CHAT_SEND_QUERY_EVENT`,
`CLARIFICATION_SUBMITTED_EVENT`, `ASK_TA_QUOTE_EVENT`) to cross the component tree without
threading callbacks through every layer. Always dispatch through the exported helpers so
the payload shape stays in one place.

Assistant prose must survive turns that also call tools — the regression is guarded by
[test_plain_text_emission.py](../../../../Backend/tests/test_plain_text_emission.py).
