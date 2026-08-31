# features/edit

Editing an existing Teaching Assistant.

| Module | Purpose |
| --- | --- |
| [EditView.tsx](EditView.tsx) | Agent editing with Simplistic and Advanced modes. |

Simplistic mode exposes the fields a teacher normally changes; Advanced mode exposes the
underlying configuration.

Creation is a separate flow in [../create/](../create).

Instructions and tool schemas are baked into a Foundry agent version, so a change here may
require the agent to be re-provisioned rather than patched in place. Edits that only touch
stored metadata apply immediately; edits that touch instructions or tools do not.
