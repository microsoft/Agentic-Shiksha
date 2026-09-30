# Source-to-documentation workflow audit

**Agentic Shiksha: actors, real agents/tools, permissions, state, success and
failure/retry behavior, traced from the source.**

[Research documentation](../README.md) / [Agent catalogue](../agents/README.md) /
[Agent hand-offs](../agent-dataflow.md)

**Source snapshot: 2026-09-30; Unreleased.** This is a static implementation
audit, not a live deployment inventory, an authorization certification or an
end-to-end cloud test. Configuration and feature flags can make a
source-supported workflow unavailable in a particular deployment.

## Read the coverage

| Surface | Human-readable workflow contracts | Machine-readable mapping |
| --- | --- | --- |
| Main frontend routes, tabs, dialogs and artifact actions | [Main UI](main-ui.md) | [main-ui.json](main-ui.json) |
| Main API service, authentication, provisioning, research and embedded teacher dashboard | [Main service](main-service.md) | [main-service.json](main-service.json) |
| Extracted main API domains, course access, chat, assets, curriculum and memory | [Main domains](main-domains.md) | [main-domains.json](main-domains.json) |
| Standalone Admin Dashboard frontend and backend | [Administration](admin.md) | [admin.json](admin.json) |
| Every explicit production API registration | [Endpoint-to-workflow index](api-index.md) | [Static API inventory](api-inventory.json) |
| Verified counts, workflow matrix, UI-to-API hand-offs and source fingerprints | [Coverage results](coverage.md) | [coverage.json](coverage.json) |

The main and admin products have **four separately built services**: two React
frontends and two FastAPI backends. The embedded teacher dashboard belongs to the
main product. The standalone admin dashboard is not a proxy for every main API.
Its cross-service assignment and placement actions must be traced to the main
backend contract, not attributed to the admin analytics agent.

Each API handler has **one primary workflow**. Several methods or aliases can
reach the same handler, and several handlers can implement a single workflow.
The UI contracts link to the API contracts instead of treating a client-side
permission gate as server authorization.

Ownership follows the workflow, not just a folder name. The identity and
directory handlers moved into main backend router factories during this audit;
their functional contracts remain in the main-service guide. The domain guide's
explicit hand-offs for those handlers are **not** exclusions from overall API
coverage. The standalone admin inventory follows its current `admin_backend`
package and application factory, not the former flat modules.

## What each workflow records

| Dimension | Required content |
| --- | --- |
| Actors | Anonymous visitor, learner, teacher, administrator, capability-token holder, service or worker, as actually applicable. |
| Actual agent/tool | The invoked source identifier or configured reference; explicit "no agent" for ordinary API/UI work. |
| Permissions | Session/role/ownership/scope checks that exist, inherited dependencies, capability checks, feature gates and meaningful missing enforcement. |
| State changes | Browser, conversation, profile, artifact, course, job, assessment, memory or administration records changed; explicit read-only cases. |
| Success path | The operation sequence and what constitutes a completed result, including separate readiness stages. |
| Failure/retry | Validation and permission failures, conflicts, provider/storage failures, cancellation, retry checkpoints, idempotency limits and partial side effects. |
| Source and documentation | Implementation paths and the corresponding existing guides, plus a stable workflow anchor. |

The structured records use `actors`, `agent_tools`, `permissions`,
`state_changes`, `success`, `failure_retry`, `source_refs` and `doc_refs`.
`classification` distinguishes current, optional and compatibility behavior.
The endpoint index retains registration status rather than quietly dropping
conditional or shadowed declarations.

## Boundaries that matter

- **Only real agent references are named.** Learners use the selected course TA.
  Course Companion uses `form-fill-assistant`; TA specification uses
  `course-agent-creation-agent`. Configured curriculum, teacher-analytics,
  admin-analytics and institute-research references are distinct integrations.
  There is no implemented LACA, TCA or separate `LearningAgent` service.
  See the [agent catalogue](../agents/README.md) for precise call sites.
- **A tool or worker is not another agent.** Artifact tools, durable material
  jobs, memory reducers and projection workers are identified separately.
  SSE/AG-UI streaming is transport, not a new actor with authority.
- **UI success is not always durable success.** General profile synchronization
  can log a save failure while local settings appear saved. Strict
  learner-instruction saves use a separate acknowledged contract. Local sign-out
  clears browser state even if its server request fails.
- **Permissions are not uniform.** The [standalone admin audit](admin.md)
  found no session/role enforcement on its 43 explicit handlers. CORS and
  cosmetic browser admin flags are not substitutes. Main-API assignment and
  placement controls have a separate authorization boundary. Deployment
  isolation was not inspected.
- **Retry is not rollback.** Retrying a conversation turn does not undo completed
  tools. Uploads can remain after a later submission fails. Creation recovery
  uses persisted job checkpoints; starting a new draft is not cancellation of a
  running job. Contract-specific retries and conflicts are recorded in the
  workflow pages.
- **Read-only sharing is not authenticated learning evidence.** Public share
  views, local challenge hints, diagram replay and presentation-only actions do
  not automatically commit assessment, mastery or memory transitions.
- **Graph memory is gated.** Off, shadow and authoritative modes differ.
  Saving a curriculum draft, publishing a reviewed immutable version and
  activating it are separate operations. Pending work is not committed state.
- **Scope matters for analytics.** Teacher Insights, admin analytics and
  curriculum research have different callers, tools and data scopes. An
  analytical response is not itself a state mutation or proof of learner
  understanding.

## What is counted and what is excluded

The API extractor follows the production application assembly and router
mounts without importing application modules. It records explicit HTTP
registrations, handler identities, prefixes, dependencies, conditional mounts,
duplicate/shadowed registrations and source hashes. Framework-generated
documentation endpoints and unmounted declarations remain separate in the
inventory; they are not silently promoted to application workflows.

The UI route checks parse the actual TypeScript/TSX declarations. Root layouts,
index redirects, fallback routes and the main frontend's development-only
companion preview remain explicit. Tabs, modals, streamed artifacts, local
actions and cross-service calls have additional manually traced action-family
entries; they do not need their own URL to be included.

<a id="framework-api-documentation"></a>
### Framework-generated schema and documentation

The [endpoint index](api-index.md#framework-generated-surfaces) separately maps
the generated GET/HEAD operations: main OpenAPI/ReDoc, and admin
OpenAPI/Swagger/OAuth-redirect/ReDoc. The custom main `GET /docs` handler is an
explicit registration and belongs to the main-service guide instead.

- **Actors:** API client or operator able to reach the backend.
- **Agent/tool:** FastAPI/Starlette documentation and schema handlers; no agent.
- **Permissions:** the generated entries have no application-handler dependency
  attached in this snapshot. Dependencies attached to a business handler do not
  protect its documentation page. Application middleware and deployment access
  restrictions are separate; live access was not tested.
- **State:** OpenAPI generation can cache the schema in process. Reading a page
  or schema does not itself execute a business operation or write learner/course
  records.
- **Success:** the configured schema, documentation page or Swagger OAuth
  redirect helper is served.
- **Failure/retry:** schema/HTTP errors or browser asset-loading failures require
  a read/reload retry. Executing an operation from Swagger follows that
  operation's own authorization, mutation and retry contract.
- **Evidence:** factory configuration and source lines in the endpoint index;
  the matching structured contract is included in [coverage.json](coverage.json).

### Explicit exclusions and limits

The audit excludes:

- Retired Flashcards and the separate Industrial Trainer. Current Circuit Lab
  support is documented in its own workflow; it does not revive the retired
  trainer.
- Unrouted page components, unused client exports, old builder modules and agent
  definition helpers merely present on disk, unless a current caller reaches
  them. Relevant exclusions and compatibility paths are recorded in each guide.
- Static research galleries, illustrative memory graphs, media-recording
  fixtures, synthetic tutorial accounts and generated demo assets. These are
  documentation or test material, not production application routes.
- Cloud resources, private learner records, actual provisioned agent versions,
  deployment settings and every combinatorial sequence of user events. None
  was queried to produce this audit.

**Coverage is relative to this source snapshot.** A zero-unmapped result proves
that the discovered registrations and route declarations have documentation
owners. It does not prove that all semantic descriptions remain correct after
an unrelated source change, or that every failure has been reproduced in a live
environment. Source fingerprints and the checks below expose drift; behavior
changes still require reviewing the corresponding contract.

## Reproduce and maintain the audit

Run from the repository root, using the project's configured Python interpreter
and the Node version supported by the frontend. The Python extractor uses the
standard library. The UI validator uses the main frontend's existing TypeScript
dependency; it does not add a package or import running application code.

```powershell
python docs\workflows\tools\inventory.py --check
python -m unittest discover -s docs\workflows\tools -p "test_*.py"
node docs\workflows\tools\validate.mjs --self-test
node docs\workflows\tools\validate.mjs
```

When an intentional source change introduces a new route or changes a contract:

1. Re-extract the inventory and inspect the change, including mount order and
   conditional/compatibility status.
2. Add or amend the primary workflow in the owning JSON sidecar and its
   human-readable guide. Trace the actual caller, authorization, mutations and
   failure handling; do not just attach the new route to an unrelated row.
3. Update affected UI routes/actions and their API hand-offs. Check the
   [agent catalogue](../agents/README.md) if a real agent reference changes.
4. Regenerate the main UI guide, endpoint index and coverage fingerprints only
   after reviewing the changed source:

   ```powershell
   python docs\workflows\tools\inventory.py
   node docs\workflows\tools\validate.mjs --write
   ```

5. Run the read-only checks again. The validator rejects missing contracts,
   duplicate primary handler assignments, unresolved routes, missing evidence
   files/anchors, UI/API mismatches and stale generated output.

This is documentation tooling. It neither provisions resources nor invokes
OAuth providers, remote agents, production APIs or background application
workers. No application behavior has been changed by the audit.
