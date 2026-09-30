# features/edit

Editing an existing Teaching Assistant.

| Module | Purpose |
| --- | --- |
| [EditView.tsx](EditView.tsx) | Agent editing with Simplistic and Advanced modes. |

Simplistic mode exposes the fields a teacher normally changes; Advanced mode exposes the
underlying configuration.

Creation is a separate flow in [../create/](../create).

## File indexing details

Edit no longer displays the large material-processing panel above the form.
Each course-file card has an info button beside its existing actions. It opens
a compact, keyboard-accessible dialog with the file's readiness and number of
indexing files (prepared copies, not search chunks). Uploaded textbook files
expose the same control in the Textbooks section.

One shared job monitor supplies all file controls in both Configure modes.
Statuses are matched by source ID and material scope; legacy files without an ID
use an exact filename match within their scope. Staged uploads and files without
known status are never presented as ready. Processing errors, interrupted jobs,
status-check retries and per-source indexing retries remain available. Opening
file info neither saves the form nor starts indexing.

Creation/recovery dialogs keep their existing full material-status panel.
Regression: `npx playwright test chat-persistence.spec.ts --grep "material file info"`.

Prerequisites use the Authors-style text-tag input in both Simplistic and Advanced
Configure forms. Enter/comma or blur adds a name; X or Backspace removes it. **None**
is an exclusive tag, persisted using the existing `__none__` value. Legacy course
identifiers remain intact when other tags are added or removed. Changes stay local
until **Update** is pressed.

## Course Companion

The same [FormAssistant](../create/FormAssistant.tsx) used during creation is
available from the bottom-right **Course Companion** button in the simple edit
form and the advanced **Configure** tab. The desktop panel sits beside the form;
on smaller screens it temporarily replaces the form below the editor header.
Closing it restores the current inputs without resetting them.

Requests include the loaded course fields and any newer unsaved edits. Suggested
changes use the shared conflict-aware patch and undo helpers, highlight updated
fields, and participate in the normal dirty-state check. **Update** is still
required to persist changes; the companion does not save, regenerate instructions,
upload files, or press Update itself. Course-name changes are rejected because
existing TA names are read-only. Images, agent IDs, material-session IDs and index
references remain outside assistant writes.

Companion conversation scope is `edit:<agentId>` within the existing user-scoped
browser history, not the course's Blob/material session or the create-form draft.
Closing, leaving Configure, navigating to another TA, switching accounts or
starting Update cancels outstanding assistant requests. Loading or failed setup
details cannot be overwritten by a late assistant response. The launcher is not
offered to students.

Explicitly added course files are queued in **Additional Course Material** and
still use the existing saved session, preflight confirmation and indexing flow
when Update is pressed. Metadata-only assistance also works when an older TA has
no saved material session; existing file-write restrictions remain in place.

Run the focused browser regression from `Frontend` with
`npx playwright test chat-persistence.spec.ts --grep "edit companion"`.

Instructions and tool schemas are baked into a Foundry agent version, so a change here may
require the agent to be re-provisioned rather than patched in place. Edits that only touch
stored metadata apply immediately; edits that touch instructions or tools do not.
