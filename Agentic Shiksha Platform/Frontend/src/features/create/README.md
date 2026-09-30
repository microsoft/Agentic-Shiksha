# features/create

The creation flow for a new Teaching Assistant.

Course pictures show colored initials automatically as the course name is typed.
Click the picture to customize up to three letters/numbers and their color, or
reset to automatic. **Upload image** is inside the picture dialog and accepts
PNG, JPEG, GIF and WebP files up to 5 MB.
Uploaded images take precedence; **Use initials** restores the initials without
discarding their customization. The same controls are available when editing.
Picture settings are saved with the course and used in the library and Course Info.

| Module | Purpose |
| --- | --- |
| [CreateView.tsx](CreateView.tsx) | Entry point for the flow; creates a single teaching assistant. |
| [FormAssistant.tsx](FormAssistant.tsx) | Docked Shiksha conversation panel with edit permissions, cancellation, and undo. |
| [MaterialWorkflow.tsx](MaterialWorkflow.tsx) | Preflight confirmation and durable per-file processing status/retry controls. |
| [SetupPhase.tsx](SetupPhase.tsx) | Setup step UI. |
| [useSetupPhaseLogic.ts](useSetupPhaseLogic.ts) | State machine and side effects for the setup step. |
| [builderTypes.ts](builderTypes.ts) | Types shared across the flow. |
| [sharedUI.tsx](sharedUI.tsx) | Presentational pieces used by more than one step. |
| [designSystem.ts](designSystem.ts) | Tokens local to the creation flow. |
| [markdownUtils.ts](markdownUtils.ts) | Markdown helpers for curriculum text. |

Creation is where course material is uploaded and indexed, so it is the highest-leverage
step in the product: retrieval quality is bounded by what gets ingested here, and a gap in
the material becomes a gap in the teaching.

Editing an existing agent is a separate flow in [../edit/](../edit), which reuses
Course Companion for unsaved edits in its Configure form. The edit adapter keeps
the TA's name, identity and material session fixed and scopes its conversations
separately from new-course drafts.

Prerequisites use the same text-tag box as textbook Authors. Type a prerequisite
name and press Enter or comma; leaving the field also adds pending text. Remove
individual tags with their X button, or use Backspace in an empty input to remove
the last tag. Entries are not limited to existing TAs. Type **None** to explicitly
choose no prerequisites; it remains stored as `["__none__"]` and cannot coexist
with other tags. Existing course-name identifiers are displayed as readable tags
but retained unchanged in saved data. The same field is used in both edit modes,
keeps the required/locked states, and wraps long names on narrow screens.

Create runs material preflight before any upload and asks the teacher to confirm the results.
The browser uploads one original at a time to an owner-bound server draft, then queues TA
creation. It no longer creates shared Search resources, starts a second indexer run, or
treats an upload receipt as successful indexing. Course and textbook materials use the same
validation and processing API with distinct categories.

The supported formats and limits are described in the [backend API documentation](../../../../Backend/backend/README.md#upload-and-creation-jobs).
The original PDFs remain intact; indexing copies have bounded byte/page sizes and retain
original-page references. TXT/Markdown use escaped HTML indexing copies. OCR-heavy or
otherwise unprocessable files can fail independently and expose a retry action.

The UI distinguishes TA creation from material processing and readiness. Setup, ownership,
and conversation starters are saved by the backend before it returns a completed TA.
A user-scoped browser key stores only the creation job ID before the request is sent, so a
lost response or reload can resume status without creating the agent or uploading files again.
Files not yet uploaded remain local selections and must be reselected after reload.
Restored jobs show their course name, saved failure, and explicit recovery actions instead
of a disabled empty form. Retry resumes the same job and saved checkpoints; completed jobs
can be opened without creating another TA. A draft with no accepted creation request is
reported as not submitted and can return to the form. Missing/unavailable jobs keep their
saved link and show a status error rather than an endless creation spinner.

Saved creations open in a centered, responsive dialog over the Create form.
The dialog includes recovery actions, errors and material status, with scrollable
details and visible action buttons on small screens. Closing it or pressing Escape
keeps the saved job and uploads intact; **View saved creation** reopens it.
The form stays inactive until the teacher returns to an unsubmitted draft or
confirms a fresh start. Creation status checks and active creation continue when
dismissed.

**Start a new TA** requires confirmation and clears only this browser's creation link and
form, using a fresh material session. It does not cancel/delete the server job, agent, or
uploaded originals; already-running work may still finish. Late responses from the previous
operation cannot change the new draft. Terminal material jobs expose unfinished files as
needing retry instead of indefinitely showing indexing spinners.

The creation and edit workflows expose material status and per-file retry; Course Info
does not show processing details. Edits wait for verified readiness before reporting a
successful save.

The monochrome bottom-right assistant button opens a docked chat panel. On desktop, the form
narrows to its left without being covered; below 1024px, chat uses the main area until closed.
Closing restores the same form and scroll state. The composer supports Enter to send,
Shift+Enter for a new line, Stop, starter suggestions, and a new conversation without clearing
the draft. Done acknowledges the last applied changes; Undo restores only unchanged values.

Requests send the teacher's text, current editable fields, available prerequisite names,
up to six recent messages (2000 characters each), and the Allow form edits setting to
`POST /api/course-form/assist`. File contents and session/owner IDs are excluded. The assistant
can answer form questions, ask for clarification, and propose requested edits. With editing
disabled, both frontend and backend block field changes. Newer manual edits are preserved;
closing, stopping, navigating away, switching drafts, or starting TA creation prevents a late
response from changing the form. The assistant never uploads files or presses Create.
Conversation history is scoped to the signed-in user in browser storage, with a
separate draft/TA scope for automatic restoration, not a persisted Foundry
conversation. File bytes and image preview URLs are not saved in this history.

Because instructions and tool schemas are baked into a Foundry agent version at creation,
what this flow submits is what the agent will keep — later prompt changes do not
retroactively apply.
