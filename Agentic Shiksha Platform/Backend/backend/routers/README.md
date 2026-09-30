# Domain routers

Feature-specific `APIRouter` modules assembled by [main.py](../main.py) and
[app.py](../app.py). Run the single service via `backend.main:app`; none of these
files is a separate server. Legacy routes still exist in `main.py`, so this is
not a complete endpoint inventory. See the [API guide](../README.md) and `/docs`.

| Module | Prefix / area | Responsibility |
| --- | --- | --- |
| [system.py](system.py) | `/api/health`, `/api/healthz`, `/api/config` | Public liveness and client configuration; a factory accepts explicit configuration without cloud clients. |
| [agent_membership.py](agent_membership.py) | `/api` | Student assignments, teacher membership, join/manage codes and scoped TA listing. |
| [chat_sharing.py](chat_sharing.py) | `/api/chat/thread` | Owner-authorized creation/revocation of bounded public transcript shares. |
| [chat_suggestions.py](chat_suggestions.py) | `/api/agents` | Course-grounded starter/follow-up questions. |
| [clarification.py](clarification.py) | `/api/clarify` | Owner-only wait state, answer drafts, submissions and timed extensions. |
| [learner_profile.py](learner_profile.py) | `/api/learner-profile` | Self-only instructions and typed, per-TA learning-memory views. |
| [course_creation.py](course_creation.py) | `/api/agents` | Durable TA creation jobs, curriculum status and bounded retry entry points. |
| [course_form_assistant.py](course_form_assistant.py) | `/api/course-form` | Typed course-form companion, local attachment extraction and its model-client lifespan. |
| [course_materials.py](course_materials.py) | `/api` | Course-material access, uploads, indexing, durable jobs and their workers. |
| [curriculum_translation.py](curriculum_translation.py) | `/api/agents/{agent_name}/course-curriculum/translations` | Shared/default and caller-scoped translations with versioned caching. |
| [circuit.py](circuit.py) | `/api/agents` | Bounded ngspice simulation and explicit circuit tool updates. |
| [slides.py](slides.py) | `/api/agents` | Validated editable PowerPoint export and explicit owner/admin tool enablement. |

## Boundaries

Request/response contracts live in [schemas/](../schemas/README.md), shared identity
and membership checks in [dependencies/](../dependencies/README.md), and service
work in [utils/](../../utils/README.md) and
[azure_services/](../../azure_services/README.md).

The public system routes are not readiness probes for Azure. Other modules apply
their own active-user, owner/editor or membership requirements; preserve these when
moving or adding handlers. Do not derive authorization from a caller-supplied user ID.

Router lifespans are part of the assembled application: material/curriculum jobs
start workers, and form/translation features manage model clients. Starting the
whole application with placeholder endpoints is not an offline smoke test.
Clarification state is process-local and needs worker affinity.

## Verification

The factory can receive an explicit test router and `allowed_origins` without
importing the production registry. After the
[test setup](../../tests/README.md#offline-test-environment), run from the backend
service directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_application_factory.py tests\test_clarification_timing.py tests\test_slides.py -q
```

These tests exercise local HTTP behavior with mocked cloud dependencies. Circuit
integration tests additionally use a local ngspice binary when available.
