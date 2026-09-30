# Release notes

User/operator-facing changes and upgrade implications. The concise change list is
in [CHANGELOG.md](CHANGELOG.md); first-time setup is in [INSTALL.md](INSTALL.md).

## Unreleased - source snapshot, 2026-09-29

This is a research-project source snapshot, **not a newly published release**.
The main backend, main frontend, admin backend and admin frontend are independent
services. Their source or build state does not establish what is running in Azure.
This documentation update performs no deployment, database migration or remote
agent update.

### Highlights

- Create and edit course TAs with a Course Companion that proposes field changes
  without implicitly saving them.
- Resume durable material/creation jobs in a centered recovery dialog. Closing the
  dialog does not discard the saved link; **View saved creation** reopens it.
- Open documents, concept inventories, presentations and simulations alongside chat.
  Slides support editable PPTX export; reading panes preserve answers during fullscreen.
- Use account-level learner instructions and course progress, with explicit loading
  and error states rather than treating unavailable progress as zero.
- Choose Concise, Balanced or Comprehensive answer depth from the compact composer menu.
  This controls response presentation, not model selection or a latency guarantee.
- Course badges, two-column capability lists and narrower-screen controls are
  consistent across the relevant views.

### Upgrade checklist

1. **Record your current revision and service images.** Preserve local configuration
   privately and keep backups appropriate to the data being changed.
2. **Update service paths.** Old root-level `Backend` and `Frontend` paths are now
   `Agentic Shiksha Platform\Backend` and `Agentic Shiksha Platform\Frontend`.
   Update shell working directories, editor tasks, external automation and build
   contexts. Quote paths containing spaces. Admin service paths did not move.
3. **Recreate moved Python environments when necessary.** Virtual environments
   contain absolute paths; do not assume an environment copied with a folder move
   is usable. Keep main/admin Python dependencies isolated.
4. **Install from the current manifests and lockfiles.** Use the runtime versions
   and commands in [INSTALL.md](INSTALL.md), not an old Node 18 setup or a merged
   requirements file. Compare example configuration with your private settings;
   do not overwrite a working `.env` with placeholders.
5. **Rebuild frontends when origins change.** `VITE_` settings are public compile-time
   values. Align API/auth origins, registered redirects, cookies and the Nginx CSP.
   Changing runtime app settings alone does not alter an already built bundle.
6. **Review agent-definition changes separately.** Instructions and tool schemas
   are materialized in remote Foundry definitions. Editing a local prompt does not
   update existing agents. Use only the intended, authorized version/update path.
   Circuit/slide enablement remains an explicit owner/admin action.
7. **Run scoped verification before rollout.** Follow
   [verification](INSTALL.md#verification), inspect state/transport regressions and
   validate the target configuration before any separately authorized deployment.

### Data and behavior compatibility

- **Creation recovery:** resuming uses the saved job; a fresh-start confirmation
  clears the browser link and local form, not the existing server job or originals.
  Already-running work can still complete.
- **Course Companion:** suggestions stay unsaved until Create/Update is explicitly
  submitted. File selection does not bypass preflight, ownership or indexing.
- **Retired flashcards:** new supported creation/rendering excludes them. Stored
  messages/assets remain preserved rather than being destructively migrated.
- **Answer depth:** the preference survives navigation/refresh and resets to
  Balanced on sign-out. It is sent for the current turn in both SSE and AG-UI;
  explicit user formatting instructions take precedence. Display labels changed
  from Quick/Detailed to Concise/Comprehensive without renaming the stored/wire
  keys `quick`, `balanced` and `detailed`.
- **Sharing and invitations:** a read-only snapshot link and a TA join code remain
  different capabilities. Treat both as intentional access-sharing actions.

No destructive data-migration command is prescribed here. The repository contains
operational/migration scripts; review their scope and get approval before running
them against any environment.

### Requirements and known limitations

- Full functionality depends on correctly configured, permissioned external services.
  A mocked browser test or a successful bundle build does not prove live readiness.
- The standalone admin API lacks route-level session/role enforcement; place it
  behind an independently authenticated private access boundary. Browser role
  visibility, CORS and the main API's separate authorization do not secure it.
- TA creation, material readiness and curriculum generation are distinct states.
  Creation can finish before every material or curriculum task is ready.
- Optional speech, retrieval, rendering and simulation features need their own
  configuration/native prerequisites. Python package installation alone is not enough.
- The experimental [learner-memory path](docs/memory/overview.md) is disabled by
  default. Its current source includes worker/API integration, but keep it disabled
  during routine installation and verify feature-specific readiness separately.
  Implementation is not proof of provisioning, a migration, or an enabled rollout.
- Model output and progress signals require human review. See [FAQ.md](FAQ.md).
- Existing dated engineering assessments are historical context, not current release
  certification or proof that all listed issues have been resolved.

## Release verification record

Use the [deployment runbook](docs/deployment.md) and
[evaluation guide](docs/evaluation.md) to distinguish required checks from
checks actually completed for a release.

When a release is actually published, add a dated section containing:

| Field | What to record |
| --- | --- |
| Identity | Real release/tag and source revision |
| Scope | Which of the four services changed; explicitly identify unchanged services |
| Compatibility | Runtime, API, environment, data and remote-agent version implications |
| Validation | Exact build/test commands and outcomes, distinguishing offline from live checks |
| Deployment | Approved target and verified image digest/version, only if deployment occurred |
| Recovery | Rollback reference and any limits on reversing data/agent changes |
| Known issues | Remaining limitations and safe workarounds |

Do not publish secrets, private environment identifiers or learner information in
that record. Report security issues through [SECURITY.md](SECURITY.md).
