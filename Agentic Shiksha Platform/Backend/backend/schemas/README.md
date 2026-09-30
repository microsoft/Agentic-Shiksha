# backend/schemas

Pydantic request, response and artifact contracts used by the extracted
[routers](../routers/README.md) and backend utilities. This directory is populated;
some legacy API models still live inline in [main.py](../main.py).

| Module | Contracts |
| --- | --- |
| [agent_membership.py](agent_membership.py) | TA access records, membership, student assignments and join/manage-code payloads. |
| [chat_preferences.py](chat_preferences.py) | `answer_depth` wire values and per-turn preferences. |
| [chat_sharing.py](chat_sharing.py) | Selected transcript sharing and revoke responses. |
| [chat_suggestions.py](chat_suggestions.py) | Course-grounded suggested questions. |
| [clarification.py](clarification.py) | Questions, saved answers, deadlines and extension revisions. |
| [course_creation.py](course_creation.py) | Creation requests, durable job status and curriculum retry/status responses. |
| [course_form.py](course_form.py) | Form-assistant requests, attachments, suggestions and patches. |
| [course_materials.py](course_materials.py) | Course access, files, uploads, indexing and material job states. |
| [curriculum_translation.py](curriculum_translation.py) | Language/style variants, source hashes and translation results. |
| [learner_profile.py](learner_profile.py) | Self-only preferences and per-TA learning-memory views. |
| [learner_memory.py](learner_memory.py) | Versioned curriculum graphs, learner events/evidence and snapshot contracts for the opt-in [learner-memory package](../../learner_memory/README.md). |
| [circuit.py](circuit.py) | Validated circuit specifications, simulation requests/results and tool status. |
| [circuit_devices.py](circuit_devices.py) | Format-2 device models, controls, instrumentation and fault definitions. |
| [slides.py](slides.py) | Decks, bounded slide layouts, source links, export and tool enablement. |

## Working with contracts

Import via `backend.schemas.<module>` from the service directory. Many write
models forbid extra fields and validate cross-field constraints; do not loosen
them to accept arbitrary model output. Existing wire names and saved-record
compatibility matter to both HTTP clients and persisted chat artifacts.

Use the [offline environment](../../tests/README.md#offline-test-environment)
before running targeted regressions from the backend service directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_slides.py tests\test_curriculum_translation.py tests\test_course_form_assistant.py -q
```
