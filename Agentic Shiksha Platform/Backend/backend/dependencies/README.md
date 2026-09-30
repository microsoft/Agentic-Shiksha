# HTTP dependencies

Shared authentication and TA-membership checks for the domain routers. These
modules are imported as `backend.dependencies.*` from the service root; they are
not standalone applications.

| Module | Responsibility |
| --- | --- |
| [auth.py](auth.py) | `ActiveUser`, token verification, profile lookup and `get_current_active_user`. |
| [agent_access.py](agent_access.py) | TA record validation, membership checks, editor checks and the `CurrentUser` dependency alias. |

## Authentication

`get_current_active_user` prefers the `session` cookie, then accepts a bearer
token. It verifies the signed token through [the session module](../../auth.py),
reloads the profile from Cosmos, and requires matching identity, an `active`
status, and a supported role. Token claims alone do not establish current access.

Missing/invalid authentication returns `401`; an inactive, malformed or mismatched
profile returns `403`; a failed profile read returns a sanitized `503`.

## Course access

- `require_agent_access` resolves a TA from route/query parameters, loads the
  authoritative record, and stores the validated user on `request.state.agent_user`.
  Students cannot use a different learner's `user_id` path parameter.
- `require_agent_editor` excludes students before applying membership checks.
- `require_body_agent_access` checks a supplied `agent_name` in the JSON body.
  It does not require that field to exist; route-specific body validation remains
  necessary.
- Administrators have existing administrative access; teachers must own the TA
  or appear in its teacher roster. Students require an active TA and explicit
  assignment, including persisted promoted-invitation IDs. A matching department
  or email is not sufficient.

Missing TAs return `404`, denied membership `403`, and failed membership/storage
verification `503`. Use these dependencies deliberately on a router or endpoint;
their existence does not automatically protect every legacy route.

## Verification

Use the [offline test environment](../../tests/README.md#offline-test-environment),
then run from the backend **service** directory:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_student_assignments.py tests\test_learner_profile.py tests\test_agent_sharing.py -q
```

These tests substitute token, account and membership reads; they do not require
real sessions, a running server, or live learner records.
