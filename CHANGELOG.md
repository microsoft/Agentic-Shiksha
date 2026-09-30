# Changelog

Notable changes to Agentic Shiksha. This file is a curated source history, not an
inventory of every commit or proof that a particular environment was deployed.
See [RELEASE_NOTES.md](RELEASE_NOTES.md) for upgrade guidance and
[INSTALL.md](INSTALL.md) for dependencies and setup.

## Unreleased

The following describes the working source as of **2026-09-30**. No release tag or
deployment is assigned to this section. Keep new work here until a release is
explicitly verified.

### Added

- [Course Companion](<Agentic Shiksha Platform/Frontend/src/features/create/README.md>)
  for creation and existing-TA configuration, with permission-controlled form
  patches, cancellation, browser-scoped history and undo.
- [Durable creation and material recovery](<Agentic Shiksha Platform/Frontend/src/features/create/README.md>):
  resume saved jobs, retry failed work and confirm a non-destructive fresh start.
- [Slide presentations](<Agentic Shiksha Platform/Frontend/src/features/chat/README.md#slide-presentations>)
  with structured previews, saved artifacts and editable PowerPoint export.
- Course-linked Circuit Lab simulation workspace.
- [Learner profile and answer depth](<Agentic Shiksha Platform/Frontend/src/components/chat/README.md>):
  default instructions, recorded progress and Concise/Balanced/Comprehensive responses.

### Changed

- Main services now live under [Agentic Shiksha Platform](<Agentic Shiksha Platform/README.md>);
  [Admin-Dashboard](Admin-Dashboard/README.md) remains separate.
- Saved TA creation uses a centered, dismissible recovery dialog instead of
  replacing the Create page. Reopening it preserves the saved job.
- Course Info, Library cards and previews use stable colored initials on dark
  rounded-square badges when no uploaded Library/preview image is present.
- Course Info capabilities use two columns; management confirmations retain room
  for their controls. Material-processing details remain in Create/Edit, not Course Info.
- Fullscreen reading panes use a centered maximum width of 960px, preserving
  navigation and answers in native fullscreen and its viewport fallback.
- The answer-depth menu is compact and has no visible heading while retaining
  descriptions, selected state and accessible labels. New display names retain the
  `quick`, `balanced` and `detailed` storage/transport keys.
- Chat uses the shared five-pose cat companion with reduced-motion handling.

### Fixed

- First conversation starters are editable and reorderable, with deletion subject
  to the existing minimum count rather than an implicit first-item lock.
- Valid slide events no longer fail artifact validation because of SSE transport
  metadata; saved presentations retain their document-style side-pane behavior.
- Narrow-screen chat controls avoid overlap without changing the selected answer
  depth or the draft.

### Removed

- Industrial Trainer UI, private exercise APIs, tool inputs, and memory capture.
  Circuit Lab simulation remains available; historical trainer records are retained.
- Text responses, Clarifying questions, and Follow-up suggestions from capability
  listings, plus the simulation subtitle. Their existing chat behavior is unchanged.
- Flashcard creation/rendering from supported teaching surfaces. Existing stored
  flashcard data is retained but filtered from supported views; this is not deletion
  of historical course or learner records.

### Documentation

- Applied the [official Azure service icons](assets/images/azure-icons/README.md) to
  source-backed architecture diagrams, with embedded originals, regenerated
  downloads and retained Microsoft usage terms.
- Clarified the [two memory parts](docs/memory/README.md): hosted conversational
  [Memory Store](docs/memory/memory-store.md) versus the custom learner-memory
  structure, its persistence, evidence-to-state mechanism, and authority gates.
- Reworked the research-facing README entry points around a conceptual learner
  loop, learner-memory graph, and observable misconception/strategy example.
  Added separate [agent/dataflow](docs/agent-dataflow.md),
  [provider-boundary](docs/providers.md), and [research-evidence](docs/research.md)
  guides; synthetic demos and missing publication/deployment evidence are labeled.
- Added the [design and operations guides](docs/README.md) on 2026-09-30:
  architecture, Ekalaiva pedagogy, learner memory/evidence, agent roles,
  evaluation, and deployment. These describe Unreleased source, not a rollout.
- Added the installation guide, this changelog and release notes.
- Filled README gaps across maintained source/reference areas and refreshed service
  navigation, setup and architecture descriptions after the directory move.
- Defined README coverage and Unreleased-entry maintenance in
  [CONTRIBUTING.md](CONTRIBUTING.md#documentation-maintenance).
- Documented the new [Graph Memory UI](<Agentic Shiksha Platform/Frontend/src/features/memory/README.md>),
  including feature modes, evidence reads and explicit draft/publication boundaries,
  and updated the frontend feature/API and test indexes.

## 2026-09-04 - recorded source history

These entries are grounded in existing Git commits, not a named application release.

### Fixed

- Knowledge-base filename containment checks (`04062dd`, `e6168d4`).
- Removal of internal exception detail from streaming error events (`17c536a`).
- Log interpolation and related path/error handling (`c4f8700`, `79134d7`, `e16c4ed`).
- Dependency advisory updates for frontend transitive packages (`4d59d5f`).

## Maintaining this file

Use **Added**, **Changed**, **Fixed**, **Removed** and, when relevant, **Deprecated**
or **Security** headings. Describe observable changes and link to implementation
guides; keep upgrade instructions in the release notes.

When publishing, move the relevant Unreleased entries into an actual version/tag
and date, record which services were included, and link the corresponding release.
Do not infer releases from npm's placeholder package version, Docker image names,
local test output or a documentation edit.
