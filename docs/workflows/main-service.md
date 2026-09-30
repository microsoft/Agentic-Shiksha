# Main service workflows outside the extracted routers

Source snapshot: **2026-09-30, working tree; not a deployment assertion**.
This guide covers the remaining HTTP handlers declared in `backend/main.py`,
the mounted `teacher_dashboard/routes.py`, and the programmatic documentation
route in `backend/app.py`. During the audit, the eight identity and ten directory
handlers moved from `main.py` into the mounted
[identity router factory][identity-routes] and
[directory router factory][directory-routes]. Their workflows remain owned here,
with the **new factory-qualified handler IDs**, rather than being duplicated
in the domain audit. The sidecar's scope label preserves the original
outside-routers assignment; these two newly extracted factories are its explicit
ownership exceptions. Authentication and persistence helpers are followed
through their implementations. The machine-readable ownership map is
[main-service.json](main-service.json).

The other extracted `backend/routers` endpoints, even when they call an
undecorated function in `main.py`, belong to the domain-workflow audit. In
particular, this is not a second description of the current durable
course-creation/material jobs, learner-memory APIs, course-membership APIs, or
primary learner streaming routes. The standalone Admin Dashboard is a different
service.

## Reading the boundaries

- **Active TA access** means `get_current_active_user` verifies a session cookie
  or bearer token, reloads the profile, checks matching identity and
  `status == "active"`, then `require_agent_access` checks course metadata.
  Teachers must own/co-teach; admin/superadmin roles pass the membership test;
  students need an active TA and explicit assignment. **TA editor** adds a
  non-student check. These dependencies are attached only to specified routes,
  not globally.
- **Directory caller/admin** is a different implementation in
  [IdentityService][identity-service]: signed JWT, then email/profile-role lookup
  or configured super-admin email. It does **not** perform the active-account
  dependency's status/identity checks. [DirectoryService][directory-service]
  retains the privacy and mutation policy; [CosmosDirectoryRepository][directory-store]
  delegates to the existing Cosmos helpers.
- **Dashboard teacher** verifies JWT, resolves a profile by ID or email, and
  permits `teacher` or `admin`, without checking profile status. The explicitly
  enabled `DASHBOARD_ALLOW_DEV_AUTH` fallback accepts a teacher header/query
  identity; its source default is `False`. Dashboard admins can see all courses,
  despite older module comments saying everyone is teacher-scoped.
- **No caller check** below means no session/role/ownership enforcement in the
  inspected handler and its delegated operation. Service credentials,
  partition keys, naming conventions, CORS, and an “admin only” docstring are
  not caller authorization.
- Required model deployments come from `ApplicationSettings`/`ModelSettings`.
  `TEXTBOOK_RESEARCH_AGENT_NAME`, `THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME`, and
  `TEACHER_ANALYTICS_AGENT_NAME` currently default to `None`, not a fabricated
  deployment name. Teacher Insights requires the last setting when invoked.
  The agent catalogue explains roles, but current typed settings take precedence
  over older descriptions of a default `teacher-analytics-agent`.
- **Current** means a present application workflow, not operational approval;
  **compatibility** means a retained legacy/alternate API; **optional** means an
  auxiliary integration; **mixed** explicitly combines such paths.
  Unless stated otherwise, there is no application-level retry, cancellation,
  rollback, or idempotency-key contract. SDK behavior is not a guarantee of
  exactly-once effects.

Sources: [application assembly][factory], [main registry][main],
[identity router/service][identity-routes], [directory router][directory-routes],
[active identity][active-auth], [TA access][agent-access],
[teacher identity][teacher-auth], [teacher scope][teacher-scope],
[typed settings][settings]. Existing context: [architecture](../architecture.md),
[agent catalogue](../agents/README.md), [deployment](../deployment.md).

## Service, sign-in, and directory

<a id="main-system-lifecycle"></a>
### Service assembly, public probes, and preflight

- **Actors / trigger / classification:** browsers, API explorers, health checks,
  and the ASGI process; **current**. `GET /` (`root`) redirects to the configured
  frontend. `GET /docs` (`custom_swagger_ui_html`) serves Swagger;
  `GET /api/a2ui/catalog.json` (`a2ui_catalog`) returns trusted-widget schemas.
  `GET /api/chat/health` (`chat_health`) probes Cosmos.
  `GET /api/teacher-dashboard/health` (`health`) is a static status response.
  `OPTIONS /api/teacher-dashboard/logging-agent/chat/stream`
  (`logging_agent_chat_options`) returns an empty object.
- **Execution:** no conversational agent for these handlers. `create_app`
  installs CORS, documentation styling, error handlers, and the assembled router.
  The factory leaves FastAPI's `/openapi.json` and `/redoc` defaults enabled;
  those are framework-generated routes, not locally declared domain handlers.
- **Permissions:** these routes have no caller check. Configured CORS origins
  allow credentials; CORS is not API authorization. The OPTIONS handler has no
  domain mutation.
- **State:** probes/catalog/redirect/docs do not intentionally mutate domain
  records. Import-time setup loads typed settings and creates local cache
  directories. Lifespan optionally starts the learner-memory worker, widens the
  AnyIO thread pool, and starts one daemon token-usage reconciliation thread.
  Reconciliation writes Cosmos usage events/watermarks; it is not performed by
  each dashboard GET. Lazy clients, caches, shutdown flags, and executors are
  process-local.
- **Success:** production ends with `create_app(router=router,
  allowed_origins=origins)`. Lifespan stops the memory worker, signals research
  shutdown, cancels queued executor work, and closes the async credential.
  `shutdown_async_processor` is also registered as a shutdown callback.
- **Failure / retry / cancellation / idempotency:** Cosmos probe failures are
  503. Missing required settings can prevent startup. Thread-capacity and
  reconciliation-start errors are logged; no periodic reconciliation loop is
  promised. Memory shutdown waits up to 30 seconds before cancellation;
  executor shutdown does not prove an already-running remote call stopped.
  The general error handlers can expose exception text (Azure errors as 400,
  other exceptions as 500). No retry contract for probes.
- **Evidence:** [main: `lifespan`, `shutdown_async_processor`,
  `a2ui_catalog`, `chat_health`][main]; [identity factory `root`][identity-routes];
  [application factory][factory];
  [dashboard health/preflight][teacher-routes];
  [usage reconciliation][token-stats]. Existing docs:
  [backend ownership][backend-readme], [deployment](../deployment.md).

<a id="main-entra-sign-in"></a>
### Microsoft sign-in and invite promotion

- **Actors / trigger / classification:** invited or existing directory users;
  **current**. Browser redirects through `GET /auth/login` (`auth_login`) and
  `GET /auth/callback` (`auth_callback`).
- **Execution:** no AI agent/model. Startup [composition][identity-core] creates
  `EntraAuth`, which uses MSAL authorization-code flow with PKCE.
  `IdentityService.complete_microsoft_login` applies admission policy;
  `create_session_token` signs HS256 application sessions.
- **Permissions:** callback requires a matching pending OAuth state and
  provider completion, a user identifier, and either an email-matched profile
  or invite. Conflicting provider registrations are rejected. An existing
  profile is accepted without an explicit active-status check; this is not the
  stronger active-user dependency.
- **State:** pending flows live only in the process and are popped on
  completion. First login upserts the OAuth-ID profile in `users_v1` with
  `status="invited"`/onboarding incomplete, then marks `invited_users_v1`
  promoted. Student stored names become `student_name`. The browser receives
  the Secure, HttpOnly, SameSite=None `session` cookie; no JWT is placed in the
  success URL. Provider/application sessions are separate.
- **Success:** provider claims become signed session claims; callback redirects
  to the frontend callback. Promotion is not proof onboarding has completed.
- **Failure / retry / cancellation / idempotency:** provider, state, directory,
  and unexpected failures redirect to frontend auth errors, sometimes carrying
  encoded exception descriptions. Restart/another worker can lose pending
  state; restart login rather than replaying a consumed callback. Promotion's
  two writes are not a transaction; no idempotency key or distributed flow
  store is implemented.
- **Evidence:** [identity factory handlers][identity-routes],
  [IdentityService admission][identity-service], [startup composition][identity-core],
  [EntraAuth/session helpers][auth],
  [Cosmos `promote_invited_user`][cosmos]. Existing docs:
  [backend setup][service-readme], [architecture](../architecture.md).

<a id="main-google-sign-in"></a>
### Google sign-in and availability reporting

- **Actors / trigger / classification:** Google account holders already
  allowlisted; **mixed** current sign-in plus a conditional availability path.
  `GET /auth/google/login`, `/auth/google/callback`, `/auth/google/status`
  map to `auth_google_login`, `auth_google_callback`, `auth_google_status`.
- **Execution:** no AI agent. `GoogleAuth` creates PKCE verifier/challenge and
  state, exchanges the code, and requests Google userinfo.
  `IdentityService.complete_google_login` applies admission and issues the same
  application JWT as Microsoft sign-in.
- **Permissions:** matching process-local state, code exchange, user email,
  provider-conflict check, and directory/invite presence. No explicit active
  profile check and no route-level recheck of an `email_verified` field.
  Status is public.
- **State:** pending verifier/state is process-local; invite promotion and
  session cookie effects match Microsoft sign-in. No persistent OAuth
  continuation store. The handler supports “not configured,” but current
  `ApplicationSettings` requires nonempty Google client ID/secret at startup;
  the branch alone does not prove optional startup configuration.
- **Success:** status reports whether the GoogleAuth object exists; successful
  callback redirects with an HttpOnly session cookie.
- **Failure / retry / cancellation / idempotency:** upstream errors, missing
  state/code/email, unknown directory user, or provider conflict redirect to
  auth errors. Token/userinfo HTTP calls have 30/15-second timeouts. The state
  is consumed before exchange; there is no retry loop or callback rollback.
  Restarting login is the recovery path, not replaying a write.
- **Evidence:** [identity factory Google handlers][identity-routes],
  [IdentityService admission][identity-service], [GoogleAuth][google-auth],
  [settings][settings], [promotion][cosmos]. Existing docs:
  [backend setup][service-readme], [architecture](../architecture.md).

<a id="main-session"></a>
### Session display and logout

- **Actors / trigger / classification:** signed-in browser or compatibility
  bearer client; **current**. `GET /auth/me` (`auth_me`);
  `POST /auth/logout` (`auth_logout`).
- **Execution:** none: `IdentityService.session_profile`, JWT verification, and
  [session transport helpers][session-transport]. The router's
  [service-error adapter][service-errors] preserves 400/401/403/404 domain-error
  mappings; it is not an authorization dependency.
- **Permissions:** `/auth/me` verifies the cookie-preferred token, with bearer
  fallback; it returns token claims rather than reloading the user/status.
  Logout needs no authentication.
- **State:** `/auth/me` changes none. Logout deletes the browser cookie; it
  does not revoke already-issued JWTs or log out the external identity provider.
  Cookie max-age is fixed at seven days; JWT expiry is separately configured.
- **Success:** identity claims for a valid token; `status=ok` after cookie
  deletion.
- **Failure / retry / cancellation / idempotency:** missing/invalid/expired
  token produces 401. Repeated logout is harmless cookie clearing. No server
  revocation list, cancellation operation, or refresh/retry contract.
- **Evidence:** [identity factory session handlers][identity-routes],
  [IdentityService][identity-service], [session transport][session-transport],
  [JWT helpers][auth].
  Existing docs: [backend setup][service-readme], [architecture](../architecture.md).

<a id="main-directory"></a>
### Directory listing, invitations, editing, and removal

- **Actors / trigger / classification:** signed-in directory viewers,
  administrators, configured super-admin; **current**.
  `GET/POST /api/directory` (`api_list_directory`, `api_invite_user`);
  `PATCH/DELETE /api/directory/{user_id}` (`api_update_directory_user`,
  `api_remove_directory_user`).
- **Execution:** none: `IdentityService` caller checks, `DirectoryService`
  workflow policy, and `CosmosDirectoryRepository` forwarding to existing
  invite/profile helpers; no email-sending worker.
- **Permissions:** listing needs a directory caller, not an admin. Super-admin
  receives full data; other callers get shuffled teacher/student pseudonyms
  but retain IDs, organization fields, their own identity, and real admin
  names/emails. Writes require directory-admin. PATCH blocks **granting**
  `admin` to non-super-admin callers; it does not implement the comment's
  broader claim about revocation. POST accepts a string role without that
  grant restriction. DELETE protects the configured super-admin and restricts
  deleting other admins to super-admin. No active-account check here.
- **State:** invites create/update `invited_users_v1`; existing email/institute/
  department combinations are recognized and new affiliations can be appended
  to invites or active profiles. PATCH writes the found container. Removal
  deletes a profile or invite, not a comprehensive erasure of chats, assets,
  affiliated records, or signed JWTs.
- **Success:** invitation reports new/existing/affiliation-added (201 or 200);
  edits return normalized user fields; removal returns deleted identity.
- **Failure / retry / cancellation / idempotency:** 401/403/404 are explicit.
  Helpers can return partial directory results if one container query fails.
  Invite deduplication is read-then-write, not an atomic concurrency guarantee;
  PATCH cannot clear many truthy-only fields. No multi-record rollback or
  idempotency-key/cancellation contract.
- **Evidence:** [directory factory handlers][directory-routes],
  [IdentityService caller checks][identity-service],
  [DirectoryService policy][directory-service], [Cosmos adapter][directory-store],
  [Cosmos `invite_user`, `list_directory_users`, `remove_directory_user`][cosmos].
  Existing docs: [architecture](../architecture.md), [backend setup][service-readme].

<a id="main-affiliations-hierarchy"></a>
### Active affiliation and organization-label maintenance

- **Actors / trigger / classification:** users selecting an affiliation and
  super-admin maintaining labels; **current**.
  `POST /api/directory/{user_id}/switch-affiliation` (`api_switch_affiliation`);
  `POST /api/directory/institutes/{rename,delete}` and
  `/api/directory/departments/{rename,delete}` (`api_rename_institute`,
  `api_delete_institute`, `api_rename_department`, `api_delete_department`);
  `GET /api/directory/onboarding-progress` (`api_onboarding_progress`).
- **Execution:** none: `IdentityService` checks and `DirectoryService` methods
  call the Cosmos adapter/helpers, without an agent or durable worker.
- **Permissions:** switch requires valid JWT and email-resolved self ID, or
  configured super-admin email. Bulk operations/progress require the
  super-admin email in a valid JWT; no active-profile check.
- **State:** switching copies the selected saved affiliation's institute,
  department, role, and college alias into the profile. Bulk operations update
  top-level C1/C2 fields, not nested affiliation arrays or the separate
  department-entity collection. Progress is read-only.
- **Success:** switch returns updated affiliation/role; bulk operations return
  affected counts; onboarding compares non-promoted invites with active users.
  It excludes promoted-but-still-invited profiles from those two counts.
- **Failure / retry / cancellation / idempotency:** 400 for invalid index or
  required blank labels; 401/403 for access. Bulk writes can partially complete.
  Progress lookup failures become zero counts with `done=false`. Reapplying a
  switch replaces the same selected state; label operations are not a
  transaction and stale affiliations can reintroduce older labels. No retry or
  cancellation contract.
- **Evidence:** [directory factory affiliation/bulk handlers][directory-routes],
  [identity checks][identity-service], [directory workflow policy][directory-service],
  [Cosmos `switch_active_affiliation`, label helpers, onboarding counts][cosmos].
  Existing docs: [architecture](../architecture.md), [backend setup][service-readme].

<a id="main-profile-legacy"></a>
### Legacy profile and onboarding persistence

- **Actors / trigger / classification:** profile/onboarding UI and API callers;
  **mixed** current UI use of a legacy broad API. `GET/PUT/DELETE
  /api/user/{user_id}` (`get_user`, `update_user`, `delete_user`).
- **Execution:** none: `get_user_profile`, `upsert_user_profile`,
  `delete_user_profile` via thread offloading.
- **Permissions:** no caller check; the path ID determines the profile.
  This does not inherit the authorization of `/api/learner-profile` or TA APIs.
- **State:** Cosmos profile data persists; student full/display/nickname values
  are normalized to `student_name`. Nonempty values overwrite, empty values
  generally preserve existing fields. Onboarding completion promotes an
  invited profile to active and cannot be cleared through a false value.
  Existing affiliations are retained; the helper reconstructs a fixed profile
  shape, so unrelated fields such as `departments` are not generically
  preserved. Updating invalidates process-local agent-list cache.
- **Success:** GET returns a profile or successful `null`; PUT returns the
  persisted profile; DELETE reports its boolean result. There is no cascade
  deletion or guaranteed browser-local cleanup in these handlers.
- **Failure / retry / cancellation / idempotency:** storage errors may become
  500, or a helper may represent absent data as null. Repeated PUT is an upsert
  but changes timestamps; false/blank fields do not mean explicit clearing.
  No idempotency key, rollback, or cancellation contract.
- **Evidence:** [main profile handlers / UserProfileModel][main],
  [Cosmos `upsert_user_profile`][cosmos]. Existing docs:
  [architecture](../architecture.md), [memory overview](../memory/overview.md).

<a id="main-departments-legacy"></a>
### Department entities and membership lists

- **Actors / trigger / classification:** administration-style API callers;
  **compatibility**. `POST/GET /api/departments`, `GET/PUT/DELETE
  /api/departments/{dept_id}`, `GET/POST /api/departments/{dept_id}/members`,
  `DELETE /api/departments/{dept_id}/members/{user_id}`, and
  `GET /api/users/{user_id}/departments`; the corresponding handlers are
  `create_department_endpoint`, `list_departments_endpoint`,
  `get_department_endpoint`, `update_department_endpoint`,
  `delete_department_endpoint`, `list_department_members_endpoint`,
  `add_department_member_endpoint`, `remove_department_member_endpoint`,
  `get_user_departments_endpoint`.
- **Execution:** none: Cosmos department/profile helpers.
- **Permissions:** no caller check, despite “admin only” comments. Request
  models and existence checks do not establish role or self-membership.
- **State:** department entities persist independently of directory label
  strings. Delete sets `status="inactive"`; membership adds/removes a department
  ID in a user's `departments` array. No domain browser-local state.
- **Success:** creation returns the new entity; lists default to active
  departments; membership reports the resulting array. Repeated add/remove
  recognizes membership already present/absent.
- **Failure / retry / cancellation / idempotency:** existing creation ID is 409;
  missing department/user is 404 where checked. Create check/write is not
  race-safe. Soft-deletion does not remove membership references. Other storage
  failures use application error handling. No retry, cancellation, or
  cross-record transaction.
- **Evidence:** [main department handlers][main],
  [Cosmos department and membership helpers][cosmos]. Existing docs:
  [architecture](../architecture.md), [backend setup][service-readme].

## Builder and Teaching Assistant lifecycle

<a id="main-builder-conversations"></a>
### Compatibility builder and specification conversations

- **Actors / trigger / classification:** builder/edit clients; **compatibility**.
  `POST /api/cca/start`, `/api/cca/step`, `/api/caca/start`, `/api/caca/step`
  (`cca_start`, `cca_step`, `caca_start`, `caca_step`).
- **Execution:** named `course-conversational-agent` and
  `course-agent-creation-agent` references by default; request fields can
  override either reference. These are not Course Companion's
  `form-fill-assistant`. Foundry chooses the referenced definition's model.
- **Permissions:** no caller, teacher-role, agent-membership, or conversation-
  ownership check.
- **State:** Foundry conversations/responses persist remotely; start creates a
  conversation, step appends a turn. No local durable job or course mutation.
  `session` is not used to authorize or persist the turn; CCA's vector-store
  field is returned, not attached by these handlers.
- **Success:** start returns compatibility `thread_id` (actually conversation
  ID); CCA strips the final fenced JSON block, CACA returns the full reply.
- **Failure / retry / cancellation / idempotency:** missing opening/turn fields
  produce 400. Clients close in `finally`; upstream failures propagate through
  app error handling. Repeated starts create new conversations and repeated
  steps can append twice. No retry/idempotency key or cancellation endpoint.
- **Evidence:** [main builder handlers / `strip_final_json_block`][main].
  Existing docs: [agent catalogue](../agents/README.md),
  [course creation](../agents/course-creation.md).

<a id="main-agent-inspection"></a>
### Name checks, definitions, tools, and platform diagnostics

- **Actors / trigger / classification:** builder/library clients and TA users;
  **mixed**. `GET /api/agents/check-name` (`check_agent_name`, two declarations);
  `GET /api/agents/{agent_id}/tools` and later
  `/api/agents/{agent_name}/tools` (`get_agent_tools`, two declarations);
  `GET /api/agents/{agent_name}/details` (`get_agent_details`);
  `GET /api/platform/agents` (`list_platform_agents`).
- **Execution:** `AgentCreator.list_agents` and the compatibility
  `AgentsClientAdapter`; no conversational inference.
- **Permissions:** name/platform checks have no caller check. Both tools
  declarations and details require active TA access.
- **State:** reads do not intentionally write remote definitions; clients and
  credential state are process-local.
- **Success:** name existence is case-insensitive; tools/details inspect the
  versioned definition. The earlier tools handler tries the adapter first and
  falls back to version data if its tool list is empty.
- **Failure / retry / cancellation / idempotency:** not-found details are 404;
  SDK errors can become 400/500. The platform handler currently omits the
  required `model_deployment` constructor argument and also treats the
  list-valued result as a mapping: do not present it as a verified working
  inventory. No retry/cancellation contract.
- **Registration caveat:** Python rebinding a name does not remove the earlier
  registered callable. The first `check_agent_name` route wins ordinary HTTP
  matching; the two tools paths have identical matching shapes despite
  different parameter names. Their signatures/response shapes differ.
  Preserve both registrations; an OpenAPI listing alone is not exhaustive.
- **Evidence:** [main duplicated handlers][main],
  [AgentCreator constructor and list return][agent-creation]. Existing docs:
  [agent catalogue](../agents/README.md), [backend ownership][backend-readme].

<a id="main-agent-update"></a>
### Instruction, tool, and version maintenance

- **Actors / trigger / classification:** TA editors; **mixed**.
  `POST /api/agents/{agent_id}/tools/clear` (`clear_agent_tools`);
  `POST /api/agents/{agent_id}/update` and `PUT /api/agents/{agent_name}`
  (two `update_agent` declarations); `POST /api/agents/{agent_id}/regenerate-prompt`
  (`regenerate_agent_prompt`).
- **Execution:** adapter updates / `AgentCreator.create_agent` create Foundry
  versions. Regeneration calls `course-agent-creation-agent` once for a
  specification, then `unify_agent_prompts`; it is not the two-agent/two-prompt
  sequence claimed by older comments.
- **Permissions:** all require TA editor. The minimal POST accepts model and
  instructions; these update routes do not apply create-direct's deployment
  allowlist. Course access is not protection for unrelated unguarded setup APIs.
- **State:** remote definitions/versions persist. Clear tries to retain Bing
  grounding by runtime type if requested, and clears tool resources.
  Regeneration updates description/context in Cosmos and setup Blob/local
  backup, with cache invalidation. PUT rebuilds tools from requested/default
  flags, rather than preserving every old capability.
- **Success:** minimal POST with no supported nonempty fields is a no-op;
  PUT reports new version; regeneration returns description and instruction
  lengths, preserving existing starters when the helper returns none.
- **Failure / retry / cancellation / idempotency:** 400/404/500 paths differ.
  Meta-agent malformed JSON can fall back to raw instructions; metadata/setup
  errors after the remote update are non-fatal. Repeated version updates are
  not idempotent; no transactional rollback or cancellation. Both update
  symbols are registered, but their distinct methods/paths remain reachable.
- **Evidence:** [main update handlers / `call_meta_agent_for_prompt`][main],
  [AgentCreator / AgentToolBuilder][agent-creation]. Existing docs:
  [course creation](../agents/course-creation.md), [course TA](../agents/course-ta.md).

<a id="main-agent-create-compatibility"></a>
### Alternate direct and simple course creation

- **Actors / trigger / classification:** legacy builder/integration callers;
  **compatibility**. `POST /api/agents/create-direct` (`create_agent_direct`)
  and `POST /api/agents/create-course` (`create_course_agent`).
- **Execution:** direct uses `course-agent-creation-agent`, prompt unification,
  optional hosted memory, shared Search pipeline, and `AgentCreator`.
  Simple course creation uses caller/default instructions and session-filtered
  Search. Function tools come from `AgentToolBuilder`; web/custom search is
  selected by flags. Model defaults use `AZURE_AI_AGENT_MODEL_DEPLOYMENT`.
- **Permissions:** no caller/teacher/creator-identity check. Direct validates
  kind/name and its model allowlist; simple course creation does not perform
  the same model allowlist check.
- **State:** Foundry versions, optional memory store, Search resources, and
  local agent configuration can be created. Direct attempts Cosmos metadata
  with caller-supplied creator fields; its current call references undefined
  `additional_context` inside a caught block, so success can lack metadata.
  Simple course creation does not save directory metadata/setup in its handler.
- **Success:** responses identify the named version/search configuration.
  Pipeline/memory failures may be logged and direct creation may continue
  without them. Enabling learner memory suppresses hosted-memory tool attachment
  in `AgentToolBuilder`; creating a store is not proof the tool was attached.
- **Failure / retry / cancellation / idempotency:** direct maps name conflicts
  to 409 and creation errors to 400; simple creation checks the pipeline tuple
  and can return 500. Neither is a durable creation job or atomic multi-service
  operation. Repeated same-name calls can create versions; partial resources
  have no rollback/cancellation contract.
- **Evidence:** [main alternate creation handlers][main],
  [AgentCreator/AgentToolBuilder][agent-creation], [memory manager][memory-store],
  [Search pipelines][search-manager]. Existing docs:
  [current creation workflow](../agents/course-creation.md).

<a id="main-agent-setup"></a>
### Setup metadata and local compatibility backup

- **Actors / trigger / classification:** builder/editor/library callers;
  **mixed**. `POST /api/agents/setup/save` (`save_agent_setup_endpoint`);
  `GET/DELETE /api/agents/setup/{agent_id}` (`fetch_agent_setup`,
  `delete_agent_setup`).
- **Execution:** none: setup Blob helpers, Cosmos metadata, local filesystem.
- **Permissions:** save has no caller check. Fetch requires active TA access;
  deletion requires TA editor. Typed avatar validation is not authorization.
- **State:** save persists setup to Blob, optionally updates avatar metadata,
  then best-effort local `user_data/agent_setups` backup and cache invalidation.
  GET can migrate a local backup or reconstruct Cosmos metadata **and write
  Blob on read**. DELETE removes the local setup directory only, not the
  canonical Blob setup.
- **Success:** save returns `ok`; fetch overlays metadata image/avatar/starters;
  delete returns `ok`, including when no local directory exists.
- **Failure / retry / cancellation / idempotency:** missing avatar metadata/
  setup is 404; canonical save failure raises. Local backup errors are ignored.
  Filesystem deletion retries PermissionError up to three times, then logs and
  still allows `ok`. Deleting local cache is not durable setup erasure. No
  multi-store rollback, caller idempotency key, or cancellation contract.
- **Evidence:** [main setup handlers / `_save_setup_json`, `_load_setup_json`,
  `safe_rmtree`][main], [Blob-backed setup helpers][cosmos]. Existing docs:
  [course creation](../agents/course-creation.md), [architecture](../architecture.md).

<a id="main-agent-images"></a>
### Course image upload, proxy, and deletion

- **Actors / trigger / classification:** course editors and library readers;
  **mixed**. `POST /api/agents/image/upload` (`upload_agent_image`);
  `GET/DELETE /api/agents/image/{agent_id}` (`get_agent_image`,
  `delete_agent_image`).
- **Execution:** none: Pillow conversion and Blob/Cosmos helpers.
- **Permissions:** upload has no caller check; GET needs active TA access;
  DELETE needs TA editor. Upload validates media type, sniffed image format,
  and a 5 MiB limit; those are not editor checks.
- **State:** upload converts to bounded progressive JPEG, overwrites the
  agent's image Blob, attempts blob-public container policy, and best-effort
  stores a cache-busted proxy URL in Cosmos. Delete removes the image prefix
  and tries to clear metadata. GET returns content plus caching/ETag headers.
- **Success:** upload returns the proxy URL; GET returns the first image Blob;
  DELETE returns deleted count. Public Blob policy may not be permitted by the
  deployment; its attempted setup does not prove anonymous Blob availability.
- **Failure / retry / cancellation / idempotency:** bad file is 400; upload can
  succeed even when Cosmos URL update fails. GET errors become 404.
  DELETE catches failures and can report `ok` with zero deleted. Same-name
  overwrite is not atomic with metadata; no rollback/retry/cancellation API.
- **Evidence:** [main image handlers][main], [typed deployment settings][settings].
  Existing docs: [course creation](../agents/course-creation.md),
  [backend setup][service-readme].

<a id="main-chat-titles-starters"></a>
### Conversation titles and personalized starter suggestions

- **Actors / trigger / classification:** learner/chat and course-library UI;
  **current**. `POST /api/chat/generate-title` (`generate_chat_title`);
  `GET /api/agents/{agent_id}/conversation-starters`
  (`generate_conversation_starters`).
- **Execution:** despite its route comments, `GeneralAgent.generate_title`
  makes a direct Responses call with configured `AZURE_OPENAI_CHAT_MODEL`,
  without an agent reference, conversation, or tools. Starters do call the
  selected course TA in a new named-agent conversation. The title dependency
  requires active identity even for its no-agent-name fallback.
- **Permissions:** title checks TA access when `agent_name` is supplied.
  Starters require TA access, but their optional query `user_id` is used to
  load a profile without binding it to the caller; the dependency's user-ID
  self-check only examines path parameters.
- **State:** starters create remote conversations; the title call does not.
  Neither handler saves a chat title or starter list to Cosmos. Returned values
  must be applied by the caller. Profile/course metadata is read for starters;
  browser state is outside these handlers.
- **Success:** title cleans the direct-model response and caps it at 50
  characters, or falls back to the first five words; starters parse up to ten
  title/prompt entries and use stock course questions if unusable.
- **Failure / retry / cancellation / idempotency:** missing title input is 400,
  missing agent metadata is 404. Title errors fall back rather than fail.
  Starters retry credential-authentication errors up to three attempts with
  1/2-second waits; other upstream failures can propagate. Each retry can
  create a conversation. No request idempotency or remote cancellation.
- **Evidence:** [main title/starter handlers][main],
  [harness title generation][runtime], [access dependency][agent-access].
  Existing docs: [course TA](../agents/course-ta.md), [agent catalogue](../agents/README.md).

<a id="main-manage-codes"></a>
### Compatibility manage-code checks

- **Actors / trigger / classification:** already-authorized course editors;
  **compatibility**. `POST /api/agents/{agent_id}/verify-code`
  (`verify_manage_code`); `GET /api/agents/{agent_id}/manage-code`
  (`get_manage_code`).
- **Execution:** none: metadata lookup/code-generation helpers.
- **Permissions:** both first require TA editor. A correct manage code does
  not enroll a learner or grant a previously unauthorized editor access.
  GET additionally tests the supplied `requester_id` for creator/admin, but
  does not bind that query value to the authenticated actor.
- **State:** verification changes none. GET can generate and persist a missing
  code and metadata timestamp; it is not always read-only.
- **Success:** verified flag or existing/generated code.
- **Failure / retry / cancellation / idempotency:** absent code is 400, mismatch
  or requester restriction is 403, missing metadata is 404. Code creation is a
  read-then-upsert; no race-safety or idempotency-key guarantee. No retry or
  cancellation contract.
- **Evidence:** [main manage-code handlers][main],
  [Cosmos manage-code helpers][cosmos], [TA editor dependency][agent-access].
  Existing docs: [course creation](../agents/course-creation.md),
  [architecture](../architecture.md).

<a id="main-agent-delete"></a>
### Best-effort Teaching Assistant teardown

- **Actors / trigger / classification:** TA editors; **current**.
  `DELETE /api/azure/agents/{agent_id}` (`azure_agents_delete`).
- **Execution:** `AgentCreator`, hosted-memory manager, Cosmos deletion helpers,
  Blob client, shared indexer, and local `safe_rmtree`; no inference agent.
- **Permissions:** TA editor is enforced before the handler.
- **State:** attempts chat/message cleanup, agent metadata deletion, hosted
  memory-store deletion, legacy learning-state deletion, remote agent/config
  removal, local setup-directory removal, and session-material Blob deletion.
  It may trigger indexing after Blob deletion. Canonical setup Blob and
  graph-memory erasure are not explicitly completed by this sequence.
- **Success:** always returns `ok` after its best-effort stages; that is not
  evidence every resource was deleted. `AgentCreator.delete_agent` can return
  false without raising, and the caller does not inspect that boolean.
- **Failure / retry / cancellation / idempotency:** most failures log and
  continue; local directory removal has bounded permission-error retries.
  There is no durable teardown ledger or rollback. After metadata deletion, a
  subsequent request may fail the pre-handler TA lookup, so repeating DELETE
  is not a reliable cleanup retry for earlier partial failures.
- **Evidence:** [main `azure_agents_delete`][main],
  [AgentCreator.delete_agent][agent-creation], [Cosmos helpers][cosmos],
  [hosted memory][memory-store]. Existing docs:
  [course creation](../agents/course-creation.md), [memory store](../memory/memory-store.md).

## Knowledge, storage, and auxiliary processing

<a id="main-knowledge-files"></a>
### Legacy knowledge-file and extracted-image browsing

- **Actors / trigger / classification:** knowledge-management clients and image
  renderers; **compatibility**. `GET /api/knowledge/list`
  (`knowledge_list_files`); `GET /api/knowledge/blob/{session}/{filename}`
  (`knowledge_download_blob_file`); `GET /api/knowledge/download/{session}/{filename}`
  (`knowledge_download_file`); `DELETE /api/knowledge/files/{session}/{filename}`
  (`knowledge_delete_file`); `GET /api/knowledge/images`
  (`list_extracted_images`); `GET /api/knowledge/images/{image_path:path}`
  (`get_extracted_image`).
- **Execution:** none: local files, configured material/image Blob containers.
- **Permissions:** no caller/course check. Local paths pass session/scope/
  filename validation and containment helpers; Blob download uses basename
  plus caller session/scope. Image read rejects `..`. Image listing without a
  session filter lists the shared image container.
- **State:** local DELETE removes raw file and same-stem derived files, not
  canonical Blob content or Search documents. Reads use local data first, then
  Blob when the local list is empty. No browser-local state mutation.
- **Success:** file metadata/downloads or cached image bytes. The returned
  vector-store ID is an echoed compatibility value, not a retrieval attachment.
- **Failure / retry / cancellation / idempotency:** local validation is 400,
  missing downloads/images 404; Blob-list failure can yield an empty file list.
  Missing local deletion targets still return `ok`; per-derived-file errors
  log and continue. No reindex guarantee, cross-store deletion transaction,
  retry, or cancellation contract.
- **Evidence:** [main knowledge handlers / `_kb_base`, `_kb_file`][main],
  [image-container helper][search-manager]. Existing docs:
  [course creation](../agents/course-creation.md), [providers](../providers.md).

<a id="main-knowledge-attachment"></a>
### Compatibility Search attachment to an existing agent

- **Actors / trigger / classification:** knowledge-attachment clients;
  **compatibility**. `POST /api/knowledge/attach` (`knowledge_attach`).
- **Execution:** Azure AI Search tool builder plus compatibility agent adapter;
  no inference. Connection comes from configured Search connection settings.
- **Permissions:** no caller or TA-editor check. `index_name` is required;
  `agent_id` is supplied by the caller. Rejecting obsolete `vector_store_id`
  attachment does not authorize the replacement target.
- **State:** remote agent tools are replaced with prior non-Search tools plus
  a new Search tool. This handler supplies no session filter. No setup/Cosmos
  ownership update is performed.
- **Success:** returns Search mode/index/query type/tool count.
- **Failure / retry / cancellation / idempotency:** missing index is 400;
  attachment failures are 500. `agents_client_with_retry` retries particular
  credential-cache/file-lock failures, not an exactly-once write protocol.
  Repeated updates can create versions. No rollback or cancellation.
- **Evidence:** [main `knowledge_attach`, `agents_client_with_retry`,
  `AgentsClientAdapter`][main]. Existing docs:
  [providers](../providers.md), [course creation](../agents/course-creation.md).

<a id="main-session-search-compatibility"></a>
### Per-session Search indexes and knowledge bases

- **Actors / trigger / classification:** older provisioning/retrieval clients;
  **compatibility**. `POST /api/knowledge/create-index`,
  `DELETE /api/knowledge/delete-index` (`create_course_index`,
  `delete_course_index`); `POST /api/knowledge/create-unified-index`,
  `DELETE /api/knowledge/delete-unified-index`
  (`create_unified_index_endpoint`, `delete_unified_index_endpoint`);
  `POST /api/knowledge/create-unified-kb`, `DELETE /api/knowledge/delete-unified-kb`,
  `POST /api/knowledge/retrieve-unified` (`create_unified_knowledge_base`,
  `delete_unified_knowledge_base`, `retrieve_from_unified_kb`);
  `POST /api/knowledge/create-knowledge-base`,
  `DELETE /api/knowledge/delete-knowledge-base`, `POST /api/knowledge/retrieve`
  (`create_knowledge_base`, `delete_knowledge_base`, `retrieve_from_kb`).
- **Execution:** Search REST pipelines create datasource/index/skillset/indexer,
  index/web knowledge sources, and knowledge bases. Retrieval asks Search for
  semantic chunks/answer. Embedding/retrieval configuration is in the helper;
  these are not additional application agents.
- **Permissions:** no caller/session-owner check. Scoped KB creation verifies
  an index exists; supplied teacher URL text is JSON-decoded, not a permission
  boundary. Unified versus scope-specific names determine resource reach.
- **State:** persistent cloud resources and indexed content change on create/
  delete; retrieval is read-only apart from service processing. No durable
  application job or browser-state write.
- **Success:** index resources are created sequentially, then indexing is
  requested; KB creation can omit a failed optional web source. The unified
  helper may try a web source even without teacher URLs. “Created” does not
  mean indexing finished or every source is restricted to teacher-supplied URLs.
- **Failure / retry / cancellation / idempotency:** 400 for malformed URL JSON/
  missing scoped index; create failures 500. Delete failures may be `ok=false`,
  retrieval failures `ok=false` with empty chunks. Indexer-start failure can be
  logged while pipeline creation succeeds. PUT-based resource replacement
  and accepted delete-404s provide limited repeatability, not transactions;
  partial resources remain. No application retry/cancellation contract.
- **Evidence:** [main per-session endpoints][main],
  [course_index_manager pipeline/retrieval implementations][search-manager].
  Existing docs: [providers](../providers.md), [architecture](../architecture.md).

<a id="main-shared-search-pipeline"></a>
### Shared-index maintenance behind MCP-era names

- **Actors / trigger / classification:** material/index administration callers;
  **mixed** current shared pipeline exposed through compatibility routes.
  `POST /api/knowledge/create-mcp-pipeline` (`create_mcp_pipeline_endpoint`);
  `DELETE /api/knowledge/delete-mcp-pipeline` (`delete_mcp_pipeline_endpoint`);
  `GET /api/knowledge/indexer-status` (`get_indexer_status`);
  `POST /api/knowledge/run-indexer` (`run_indexer`);
  `POST /api/knowledge/recreate-pipeline` (`recreate_pipeline`).
- **Execution:** `ensure_common_index_pipeline`, `run_common_indexer`,
  `delete_session_documents`; no conversational agent or MCP server is
  provisioned by these handlers.
- **Permissions:** no caller/admin/course ownership checks.
- **State:** shared Search resources/indexing; session deletion batch-deletes
  matched index keys and best-effort extracted-image Blobs. It does not remove
  the source material Blobs here. `_pipeline_ensured` is process-local.
  Recreate deletes the shared indexer/datasource before calling the cached
  ensure helper.
- **Success:** returns configured index/session filter/status; `teacher_urls`
  in create is not used. Run reports the helper boolean. Deletion reads at
  most one configured-size result batch (10,000) before deleting in chunks.
- **Failure / retry / cancellation / idempotency:** create/recreate ignore
  returned false tuples from some helper calls and can still report `ok`.
  Status can hide a helper error inside absent/default fields. Recreate does
  not reset `_pipeline_ensured`; cached ensure can skip reconstruction.
  Deletion accepts multi-status without proving each item deleted. No
  exhaustive-cleanup, atomicity, durable retry, or cancellation guarantee.
- **Evidence:** [main shared-index handlers][main],
  [ensure/run/delete implementations][search-manager]. Existing docs:
  [providers](../providers.md), [course creation](../agents/course-creation.md).

<a id="main-indexer-callbacks"></a>
### Indexing webhook, health probe, and section skills

- **Actors / trigger / classification:** Event Grid, Search custom-skill
  clients, operators; **optional**. `POST/GET /api/knowledge/eventgrid-webhook`
  (`eventgrid_webhook`, `eventgrid_webhook_health`);
  `POST /api/skills/detect-sections` (`detect_sections_skill`);
  `POST /api/skills/detect-sections-di` (`detect_sections_with_di_skill`).
- **Execution:** Event Grid queues `_debounced_run_indexer` with FastAPI
  BackgroundTasks. Both section handlers use text patterns; the `-di` handler
  delegates to `get_logical_section` and does **not** call Document Intelligence.
  No AI agent/model is invoked by the section handlers.
- **Permissions:** no webhook signature, session, or caller-role validation.
  Validation events echo their code. Blob event selection tests a
  `course-material` substring, not an authenticated resource identity.
- **State:** webhook may cause remote indexing and updates a process-local
  last-trigger timestamp; skill results/health change no domain records.
- **Success:** subscription validation response or event acknowledgement;
  blob create/delete events queue indexing; skills return per-record section
  labels/null with the custom-skill envelope.
- **Failure / retry / cancellation / idempotency:** invalid webhook JSON is 400;
  unvalidated event shapes can raise errors. Debounce is 30 seconds per
  process, not distributed deduplication; timestamp is set before execution,
  and failure is logged without retry. Queued background work is not a durable
  job. Skills return an error envelope rather than a failed HTTP status on
  caught errors. No caller cancellation or replay ledger.
- **Evidence:** [main webhook/skill handlers][main],
  [section detector][section-detector], [indexer helper][search-manager].
  Existing docs: [providers](../providers.md), [backend setup][service-readme].

<a id="main-blob-legacy"></a>
### General Blob upload, listing, deletion, and proxy

- **Actors / trigger / classification:** file and image clients; **compatibility**.
  `POST /api/blob/upload`, `/api/blob/upload-multiple`
  (`upload_file_to_blob`, `upload_multiple_files_to_blob`);
  `GET /api/blob/list` (`list_blobs`); `DELETE /api/blob/{blob_name:path}`
  (`delete_blob`); `GET /api/blob/proxy` (`proxy_blob_image`).
- **Execution:** none: lazy Blob service client using configured credentials.
- **Permissions:** no caller check. Container, organization IDs and filenames
  are caller-selected; prefixes are organization conventions, not ownership.
  Proxy restricts HTTPS hostname to the configured storage account and rejects
  traversal components, but does not restrict to a caller-owned container/blob.
- **State:** uploads overwrite Blob names and metadata; single upload attempts
  container creation. Listing/proxy are read-only; proxy advertises public
  cache headers. Deletion removes the requested Blob.
- **Success:** single upload returns URL/name; batch returns successful files
  plus per-file failures; listing uses an optional user/agent prefix; proxy
  streams stored media type.
- **Failure / retry / cancellation / idempotency:** single upload can return
  HTTP-success with `success=false`; batch is partial, without rollback.
  List/delete/proxy storage errors become 500, bad proxy URL 400. Same-name
  overwrite is repeatable but not a conditional update; retrying batch does
  not restore failed/previous values. No size bound in these upload handlers,
  idempotency key, or cancellation contract.
- **Evidence:** [main Blob handlers / `get_blob_service_client`][main].
  Existing docs: [providers](../providers.md), [backend setup][service-readme].

<a id="main-document-extraction"></a>
### PDF OCR and course-description text extraction

- **Actors / trigger / classification:** course-description and document clients;
  **mixed**. `POST /api/pdf/extract` (`extract_text_from_pdf`);
  `POST /api/document/extract-text` (`extract_text_from_document`).
- **Execution:** Document Intelligence `prebuilt-layout` for PDFs;
  python-docx, optional python-pptx, or direct text decoding for other supported
  forms. No conversational agent.
- **Permissions:** no caller check. The broad document route branches by
  extension; accepting `.doc`/`.ppt` names does not prove the modern-file
  libraries can parse those binary formats.
- **State:** extraction alone retains data in request memory. PDF extraction
  can persist both extracted text and the original PDF to the configured Blob
  container using caller user/agent organization fields. No course draft is
  submitted or agent updated by this handler.
- **Success:** return text/Markdown and optional Blob references; the browser
  can then place extracted text into its unsaved form.
- **Failure / retry / cancellation / idempotency:** parse/OCR failures generally
  return `success=false` in a successful HTTP response; missing PPTX library
  reports unavailable, not automatic installation. Optional Blob writes can
  partially complete; repeated writes overwrite names. No polling-job record,
  rollback, retry, or cancellation endpoint.
- **Evidence:** [main extraction handlers and result formatters][main].
  Existing docs: [course creation](../agents/course-creation.md),
  [providers](../providers.md).

<a id="main-async-file-compatibility"></a>
### Awaited file batches and legacy vector-store creation

- **Actors / trigger / classification:** alternate upload/integration clients;
  **compatibility**. `POST /api/async/process-files`,
  `/api/async/process-single-file`, `/api/async/create-agent-with-files`,
  `/api/async/create-vector-store` (`async_process_files`,
  `async_process_single_file`, `async_create_agent_with_files`,
  `async_create_vector_store_from_blobs`); `POST /api/blob/create-vector-store`
  (`create_vector_store_from_blobs`).
- **Execution:** `AsyncFileProcessor`, semaphore/thread pool (default five),
  Document Intelligence OCR for PDF/images, Blob upload, legacy AgentsClient
  vector-store polling / agent creation. No durable background-job worker.
- **Permissions:** no caller or owner check. Supplied IDs and Blob URIs are
  forwarded. The local staging helper joins the supplied filename; do not
  generalize knowledge-file containment checks to this separate path.
- **State:** staging files are created and cleaned in the processor's runtime
  temporary area; processed Blobs, vector stores and optional remote agent
  persist. The singleton fixes Markdown output: the batch endpoint's
  `output_format` argument is not forwarded. Non-OCR files, including DOCX,
  are uploaded directly, not all converted to text.
- **Success:** request awaits batch completion. A batch may report
  `success=true` while `failed_files>0`. Agent-with-files requires at least one
  successful Blob, creates a vector store, but supplies no Search index/
  connection to its helper, so the agent is created **without retrieval tools**.
- **Failure / retry / cancellation / idempotency:** partial uploads/resources
  are retained; cleanup runs in `finally`, not a rollback. Single binary-file
  preview can fail after upload. `/api/blob/create-vector-store` references an
  undefined `async_agents_client` in current source and catches it as
  `success=false`. No job polling, idempotency key, automatic operation retry,
  or supported cancellation API.
- **Evidence:** [main async/vector handlers][main],
  [AsyncFileProcessor real pipeline][blob-processor]. Existing docs:
  [providers](../providers.md), [course creation](../agents/course-creation.md).

<a id="main-hosted-memory-legacy"></a>
### Hosted Foundry memory-store compatibility APIs

- **Actors / trigger / classification:** hosted-memory integration clients;
  **compatibility**. `GET /api/memory/stores` (`list_memory_stores`);
  `GET/POST/DELETE /api/memory/stores/{agent_id}` (`get_agent_memory_store`,
  `create_agent_memory_store`, `delete_agent_memory_store_endpoint`);
  `GET /api/memory/stores/{agent_id}/memories` (`search_agent_memories`);
  `DELETE /api/memory/stores/{agent_id}/user/{user_id}`
  (`delete_user_memories_endpoint`).
- **Execution:** `MemoryStoreManager` calls Foundry preview memory-store APIs;
  create requires configured `MEMORY_CHAT_MODEL` and `MEMORY_EMBEDDING_MODEL`.
  These are not the separate deterministic learner-memory API or worker.
- **Permissions:** no caller/course/user-ownership checks. Agent-derived store
  names and caller-supplied `scope=user_id` are not authenticated isolation.
- **State:** named remote memory stores/memories persist; list/get/search are
  reads; delete removes a store or supplied user scope. Cached manager/client
  is process-local.
- **Success:** existing store is returned before creating a new one; query
  selects contextual versus static memories, with bounded requested result
  count on the search route.
- **Failure / retry / cancellation / idempotency:** some manager failures become
  empty lists/None/false, so 404 or empty success is not proof of absence.
  Create's existing-store check is not atomic and can be fooled by a failed
  lookup. Delete errors vary between 404 and 500. No rollback, durable retry,
  identity revocation, or cancellation contract.
- **Evidence:** [main hosted-memory handlers][main],
  [MemoryStoreManager][memory-store], [ToolSettings][settings]. Existing docs:
  [memory store](../memory/memory-store.md), [memory overview](../memory/overview.md).

## Chats, assets, feedback, and curriculum records

<a id="main-course-chat-local"></a>
### Process-local course-chat sessions

- **Actors / trigger / classification:** older multi-chat clients;
  **compatibility**. `POST/GET /api/course-chats/sessions`
  (`create_course_chat_session`, `list_course_chat_sessions`);
  `GET /api/course-chats/sessions/{chat_id}` (`get_course_chat_session`);
  `POST /api/course-chats/sessions/{chat_id}/messages`
  (`send_course_chat_message`).
- **Execution:** selected named course TA through `GeneralAgent.start_chat`/
  `continue_chat`; no separate learner agent.
- **Permissions:** no caller, course membership, or session ownership check.
  Agent/kind/text validation is not authentication. The delegated non-streaming
  runtime calls `validate_tool_context(None, ...)`, which rejects graph-enabled
  courses: this API does not supply an authorized learner-memory context.
- **State:** session/message dictionaries are process-local, not Cosmos; all
  workers/restarts do not share them. Foundry conversation history can persist
  remotely. User message is appended locally **before** inference.
- **Success:** create returns a UUID chat; list filters/sorts in-memory
  sessions; for a permitted graph-off runtime, send uses the remote
  `output_text`, appends the reply, and stores the conversation ID. It does not
  run the primary streaming route's local tool-dispatch/evidence loop.
- **Failure / retry / cancellation / idempotency:** bad kind/text is 400,
  unknown local chat is 404. Graph-context rejection or model failure can leave
  an unmatched user message.
  Retrying send can duplicate local/remote turns. No durable recovery,
  idempotency key, deletion/cancellation API for this local-session surface.
- **Evidence:** [main course-chat models and handlers][main], [runtime][runtime],
  [learner-memory context guard][memory-integration].
  Existing docs: [course TA](../agents/course-ta.md), [architecture](../architecture.md).

<a id="main-chat-persistence"></a>
### Legacy thread/message storage, hydration, and batch sync

- **Actors / trigger / classification:** browser synchronization/history clients;
  **mixed** current persistence behind legacy identity boundaries.
  `GET /api/chat/threads/{user_id}` (`get_user_threads`);
  `GET/PUT/DELETE /api/chat/thread/{thread_id}` (`get_single_thread`,
  `update_existing_thread`, `delete_chat_thread`);
  `POST /api/chat/thread` (`create_new_thread`);
  `DELETE /api/chat/user/{user_id}/all` (`delete_all_user_chat_data`);
  `GET /api/chat/thread/{thread_id}/messages` (`get_thread_messages`);
  `POST /api/chat/message` (`create_new_message`);
  `DELETE /api/chat/message/{message_id}` (`delete_chat_message`);
  `POST /api/chat/sync` (`sync_chat_data`);
  `GET /api/chat/load/{user_id}` (`load_all_chat_data`).
- **Execution:** none: Cosmos helpers offloaded to threads; image-URL signing
  on reads. This does not invoke the TA or independently run evaluation.
- **Permissions:** no caller check; body/path/query user IDs select partitions.
  `thread_id` on message deletion is not used by the delete helper.
- **State:** persistent threads/messages and associated ordinary assets;
  metadata carries grouping/retry/latest flags. Sync preserves server-owned
  share boundary fields, but accepts supplied message state. Hydration returns
  recent messages (ten per thread within a broader read cap), not guaranteed
  complete history; page reads handle older messages. Generated-image SAS URLs
  are refreshed in responses, not written back. Browser storage is the caller's
  responsibility.
- **Success:** create/rename/list/page; batch returns upsert counts and
  completeness. Thread deletion removes messages and non-immutable assets.
  Delete-all is not a universal account/data-erasure workflow.
- **Failure / retry / cancellation / idempotency:** some misses are 404, deletes
  can return false, storage exceptions commonly become 500. Sync catches per-row
  errors, reports partial success and requests retry; upserts with the same IDs
  avoid new rows but provide no batch transaction or concurrent-write control.
  Explicit creates can conflict, and cascades can partially fail. No backend
  cancellation or guaranteed retry schedule.
- **Evidence:** [main persistence handlers / `_sign_generated_images`][main],
  [Cosmos thread/message/batch helpers][cosmos]. Existing docs:
  [architecture](../architecture.md), [course TA](../agents/course-ta.md).

<a id="main-conversation-compatibility"></a>
### Remote conversation diagnostic and deletion

- **Actors / trigger / classification:** course-authorized integration callers;
  **compatibility**. `GET/DELETE /api/conversations/{conversation_id}`
  (`get_conversation`, `delete_conversation`), with `agent_name` query.
- **Execution:** cached `GeneralAgent`/OpenAI conversation client; no inference
  is requested by the handler.
- **Permissions:** active TA access to the supplied `agent_name`; the handler
  does not prove the supplied conversation belongs to that TA or caller.
- **State:** GET initializes/obtains a runtime wrapper but returns a placeholder
  “history retrieval is limited” response, not history. DELETE removes the
  remote conversation, not corresponding Cosmos/local chat records.
- **Success:** diagnostic information or successful remote deletion.
- **Failure / retry / cancellation / idempotency:** exceptions become 500.
  Repeated DELETE is SDK-dependent, with no explicit not-found normalization,
  rollback or idempotency key. This is not a stream/run cancellation API.
- **Evidence:** [main conversation handlers][main], [runtime][runtime],
  [TA access][agent-access]. Existing docs:
  [course TA](../agents/course-ta.md), [architecture](../architecture.md).

<a id="main-public-chat-share"></a>
### Public read-only chat shares

- **Actors / trigger / classification:** anyone holding a share token;
  **current**. `GET /api/shared/{share_token}` (`get_shared_chat`).
- **Execution:** none: Cosmos token lookup/bounded-message read and generated
  image signing. Share creation/revocation lives in the extracted router audit.
- **Permissions:** intentionally public capability lookup, not sign-in. The
  helper matches stored `shareToken`; it does not enforce a separate expiry
  timestamp despite the not-found error mentioning expiration.
- **State:** reads stored thread/messages; response signing refreshes selected
  configured-account generated-image URLs. No domain write or live subscription.
- **Success:** explicit `sharedMessageIds` bound the snapshot; legacy records
  use valid timezone-aware `sharedAt` and latest messages at/before that time.
  Sensitive top-level thread fields are omitted; message metadata remains part
  of the response, so this is not a universal content-redaction promise.
- **Failure / retry / cancellation / idempotency:** no token match is 404;
  malformed/missing legacy boundary yields no messages rather than all history;
  unexpected failures are generic 500. Repeat reads are read-only, although
  signed image URLs change. No retry or cancellation contract.
- **Evidence:** [main shared handler][main],
  [Cosmos `get_thread_by_share_token`, `get_messages_for_shared_thread`][cosmos].
  Existing docs: [architecture](../architecture.md), [course TA](../agents/course-ta.md).

<a id="main-assets-legacy"></a>
### Saved artifacts and public asset browsing

- **Actors / trigger / classification:** learner artifact UI and public viewers;
  **mixed**. `POST/GET /api/assets` (`create_asset_endpoint`, `list_assets`);
  `GET /api/assets/public` (`list_public_assets`); `GET/PUT/DELETE
  /api/assets/{asset_id}` (`get_asset_endpoint`, `update_asset_endpoint`,
  `delete_asset_endpoint`).
- **Execution:** none: Cosmos asset helpers. Generation/assessment-specific
  handlers live elsewhere.
- **Permissions:** no caller check. Supplying `user_id` permits the private
  partition lookup; omitting it on GET restricts lookup to public assets.
  Public listing filters `isPublic`. That distinction is not self-identity
  authorization for private CRUD.
- **State:** Cosmos asset content, tags, type, associations, and visibility.
  Each create generates a fresh ID; updates permit only selected fields.
  Immutable assessment assets refuse update/delete. No browser-local save is
  guaranteed by these endpoints.
- **Success:** created/read/updated asset, filtered list, or deletion flag.
  Typed create/update validation rejects retired flashcard types and detectable
  disguised flashcard payloads; existing stored data is not deleted.
- **Failure / retry / cancellation / idempotency:** missing or immutable
  update/delete is surfaced as 404; read helper errors can also look absent.
  Validation is 422 and other failures can be 500. Repeating create duplicates
  assets; overwrite/delete is not a multi-document transaction. No retry,
  idempotency-key or cancellation contract.
- **Evidence:** [main asset models and handlers][main],
  [Cosmos asset CRUD/public helpers][cosmos]. Existing docs:
  [course TA](../agents/course-ta.md), [architecture](../architecture.md).

<a id="main-feedback"></a>
### General feedback and attachments

- **Actors / trigger / classification:** feedback UI and API callers;
  **current**. `POST /api/feedback/upload-image` (`upload_feedback_file`);
  `POST/GET /api/feedback` (`post_feedback`, `get_feedback`).
- **Execution:** none: Blob attachment upload and Cosmos feedback helper.
- **Permissions:** no caller check. Supplied user/name/email and attachment
  URLs are accepted as data; unfiltered GET is not admin-only. Upload only
  enforces a 5 MiB size bound, not image-type identity or course ownership.
- **State:** UUID attachment Blobs in the feedback container and UUID feedback
  records persist independently. Upload does not submit the feedback form;
  failed/abandoned submissions can leave attachments.
- **Success:** attachment URL, submitted feedback ID, or optionally
  user-filtered records.
- **Failure / retry / cancellation / idempotency:** oversized upload is 400,
  storage failures 500. Retrying upload/submission can create duplicates;
  neither operation has a linking transaction, idempotency key, automatic
  retry, or cancellation/cleanup endpoint here.
- **Evidence:** [main feedback handlers][main], [Cosmos feedback helpers][cosmos].
  Existing docs: [architecture](../architecture.md), [evaluation](../evaluation.md).

<a id="main-curriculum-history"></a>
### Curriculum history, comparison, and semantic deduplication

- **Actors / trigger / classification:** course readers/editors; **mixed**.
  `GET /api/agents/{agent_name}/course-curriculum/versions`,
  `/versions/{version_id}`, `/diff` (`list_curriculum_versions`,
  `get_curriculum_version`, `diff_curriculum_versions`);
  `POST /api/agents/{agent_id}/dedup-threshold-concepts`
  (`dedup_threshold_concepts`).
- **Execution:** Blob-backed Git history for versions; dedup uses configured
  `THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME` through streamed Foundry output.
  This edits curriculum concepts, not a student's mastery.
- **Permissions:** history/diff require active TA access; dedup requires
  TA editor. Listing history can write despite only requiring reader access.
- **State:** if history is absent but a curriculum exists, GET seeds a version.
  History helper stages a local Git repository and stores a tarball in Blob;
  this is application data history, not a repository commit by this audit.
  Dedup overwrites curriculum Blob, best-effort metadata pointer and cache;
  it does not explicitly save a version or remap all learner evidence.
- **Success:** version list/snapshot or two curricula for client-side diff;
  snapshot lookup supports old per-version Blobs. Fewer than two concepts
  skips dedup; otherwise parsed groups merge related modules, misconceptions
  and questions, and report before/after counts.
- **Failure / retry / cancellation / idempotency:** missing content/version is
  404, missing groups/save failures 500. Dedup has a 30-minute client timeout,
  no durable job/cancellation, and no validation proving every original concept
  appears exactly once. Repeated runs can differ. History seeding is
  check-then-write, not an atomic single-seed guarantee.
- **Evidence:** [main history/dedup handlers][main],
  [Cosmos curriculum save/version wrappers][cosmos], [curriculum Git][curriculum-git].
  Existing docs: [curriculum research](../agents/curriculum-research.md),
  [memory evidence](../memory/evidence-model.md).

<a id="main-course-records"></a>
### Compatibility course-record reads

- **Actors / trigger / classification:** course/integration clients;
  **compatibility**. `GET /api/courses/{course_id}` (`get_course`);
  `GET /api/courses` (`list_courses`).
- **Execution:** none: Cosmos course container reads.
- **Permissions:** no caller/course-owner check. Documents containing
  `job_type` are excluded; that is a record-kind filter, not access control.
- **State:** no domain write; no browser-local mutation.
- **Success:** single record or all queried non-job course records sorted by
  creation time. `limit` is passed as Cosmos `max_item_count` (page sizing),
  not a guaranteed overall result cap.
- **Failure / retry / cancellation / idempotency:** missing/job-kind single
  records are 404; storage errors 500 (list uses a generic error). Repeated
  reads are read-only; no retry, cursor, or cancellation contract.
- **Evidence:** [main course-read handlers][main], [Cosmos course container][cosmos].
  Existing docs: [course creation](../agents/course-creation.md),
  [architecture](../architecture.md).

<a id="main-deep-research"></a>
### Auxiliary deep-research request and SSE conversation

- **Actors / trigger / classification:** research clients; **optional**.
  `POST /api/deep-research` (`deep_research`);
  `POST /api/deep-research/stream` (`stream_deep_research`).
- **Execution:** configured `DEEP_RESEARCH_AGENT_ID`. Non-streaming uses
  AIProjectClient conversations/responses; streaming instead uses legacy
  AgentsClient threads/runs in a daemon thread. Request `agent_name` and
  `instructions` are not used to select/configure the non-streaming agent.
  The source does not establish a deployed model from descriptive constants.
- **Permissions:** no caller or supplied-thread ownership check. Although
  auxiliary, current ApplicationSettings requires the deep-research endpoint,
  agent ID, and Bing connection setting at startup.
- **State:** remote conversations or threads/runs persist; queue/thread is
  process-local. Streaming retains a thread for heuristic MCQ clarification,
  attempts deletion after a final research answer, and does not store an
  application research-job record.
- **Success:** response text/citations or SSE status, thread ID, thinking,
  clarification/complete events. Classification of clarification is textual
  heuristics, not a validated educational assessment.
- **Failure / retry / cancellation / idempotency:** non-streaming returns
  `status=error` in its response model. Streaming polls every two seconds for
  up to 30 minutes; timeout/error does not explicitly cancel the remote run.
  Client disconnect does not stop the daemon worker. Repeated requests can
  duplicate remote work; no restart/resume/idempotency contract.
- **Evidence:** [main deep-research handlers][main], [settings][settings].
  Existing docs: [agent catalogue](../agents/README.md),
  [curriculum research](../agents/curriculum-research.md).

## Embedded teacher dashboard

All paths in this section use `/api/teacher-dashboard`. These are the merged
main-service endpoints, not `/api/dashboard` in the independently deployed
Admin Dashboard.

<a id="main-teacher-roster"></a>
### Teacher identity, courses, roster, and progress views

- **Actors / trigger / classification:** teachers/co-teachers and admins opening
  the embedded dashboard; **current**. GET `/me` (`whoami`), `/agents`
  (`my_courses`), `/summary` (`summary`), `/overview/courses`
  (`courses_overview`), `/agents/{agent_id}/overview` (`agent_overview`),
  `/agents/{agent_id}/curriculum` (`agent_curriculum`), and
  `/agents/{agent_id}/students/{user_id}` (`student_detail`).
- **Execution:** none: teacher-scope and Cosmos analytics helpers, with live
  curriculum lookup/projection. No learner agent is asked to certify progress.
- **Permissions:** dashboard teacher dependency on all seven routes; teachers
  own/co-teach, admins can query all courses. Course-specific routes check TA
  scope. Student detail uses course-specific state plus profile; it does not
  separately require current explicit roster membership. The dependency's
  lack of status validation/dev fallback must not be replaced in prose by the
  stronger active-account contract.
- **State:** reads only at route level; metadata/state/curriculum reads may
  initialize caches. Teacher-course cache lasts 15 seconds and active-user
  cache 30 seconds, both process-local. Browser selection/rendered roster is
  not persisted by these handlers.
- **Success:** roster combines recorded states with assigned/active-chat
  students and fills zero-progress rows; duplicate/blank names get stable
  roster labels. Detail attaches email and projects status onto live modules,
  retaining off-plan topics. For authoritative graph-memory courses,
  `agent_overview` returns `progress_available=false` instead of asserting
  legacy progress is authoritative. Counts/labels are observations, not proof
  of mastery or outcomes.
- **Failure / retry / cancellation / idempotency:** 401/403/404 for identity/
  course/missing state; many storage errors are 500, some helper errors
  degrade to empty/cached results. No mutation retry or cancellation contract;
  reloading refreshes only subject to cache/data availability.
- **Evidence:** [teacher route handlers][teacher-routes], [identity][teacher-auth],
  [scope/admin behavior][teacher-scope], [query/projection layer][teacher-queries].
  Existing docs: [architecture](../architecture.md), [memory overview](../memory/overview.md).

<a id="main-teacher-assets"></a>
### Teacher inspection of student artifacts

- **Actors / trigger / classification:** dashboard teacher opening a roster
  student's work; **current**. GET
  `/api/teacher-dashboard/agents/{agent_id}/students/{user_id}/assets`
  (`student_assets`) and the same path plus `/{asset_id}` (`student_asset`).
- **Execution:** none: Cosmos asset list/get helpers.
- **Permissions:** dashboard teacher and course ownership/co-teaching/admin
  scope. Lists filter by user and course; detail also checks stored asset
  `agentId` equals the requested course. Neither route independently tests
  current explicit student enrollment.
- **State:** no intentional domain write. List returns metadata; detail returns
  the body for preview. Browser preview state is local to the client.
- **Success:** bounded metadata list or a course-matched artifact with content.
  Older comments saying bodies are never sent do not apply to the detail route.
- **Failure / retry / cancellation / idempotency:** list helper failure can
  produce an empty list; detail missing/wrong-course/read failure becomes 404;
  other failures can be 500. Repeat reads are read-only; no retry/cancellation
  contract or proof of learning from merely creating an artifact.
- **Evidence:** [teacher asset routes][teacher-routes],
  [query helpers `student_assets`, `student_asset`][teacher-queries].
  Existing docs: [course TA](../agents/course-ta.md), [architecture](../architecture.md).

<a id="main-teacher-usage"></a>
### Teacher usage and activity analytics

- **Actors / trigger / classification:** dashboard teachers/admins viewing usage
  and activity tabs; **current**. GET
  `/api/teacher-dashboard/overview/tokens` (`token_usage_overview`),
  `/overview/tokens/per-student` (`token_usage_per_student`),
  `/usage/analytics` (`token_usage_analytics`),
  `/activity/analytics` (`learning_activity_analytics`).
- **Execution:** none: persisted Cosmos usage facts and message/activity
  aggregation. Foundry reconciliation is a startup daemon, **not a network
  call to Foundry on each dashboard read**.
- **Permissions:** dashboard teacher; optional `agent_id` requires course access,
  otherwise the query uses permitted course IDs. Per-student endpoint returns
  student identity/usage; time-series endpoint is aggregate-only. Admin scope
  remains all courses.
- **State:** these GETs do not write domain usage. Startup reconciliation
  persists response-derived events and a watermark, with process-local lock;
  stream usage is written elsewhere before forwarding SSE. Browser date/
  granularity selections are not server state.
- **Success:** course/learner totals or day/week/month buckets; default range
  is the latest 30 dates. Time series merges message and persisted event sources.
  Activity supports `threshold_crossings` and `assets_created`, excluding
  staff through helper logic. Legacy crossing events are derived from stored
  state; authoritative graph courses do not supply legacy state scans.
- **Failure / retry / cancellation / idempotency:** reversed dates or spans
  of 1,095 days or more are 400; enum/date validation can be 422; storage errors
  become 500. Reconciliation is capped at 50 pages, advances its watermark only
  after complete traversal, and uses event IDs for duplicate handling; that is
  not a global exactly-once guarantee. No route-level retry/cancellation.
- **Evidence:** [teacher usage routes][teacher-routes], [queries][teacher-queries],
  [token_stats reconciliation/read separation][token-stats]. Existing docs:
  [evaluation](../evaluation.md), [architecture](../architecture.md).

<a id="main-teacher-feedback-evaluation"></a>
### Teacher feedback attachments and saved evaluation results

- **Actors / trigger / classification:** dashboard teachers/admins;
  **current**. GET `/api/teacher-dashboard/feedback` (`get_feedback`),
  `/blob/proxy` (`proxy_blob`),
  `/evaluation/groundedness/agent/{agent_id}` (`agent_groundedness`),
  `/evaluation/groundedness` (`all_groundedness`).
- **Execution:** none: stored Cosmos feedback/evaluation queries and Blob
  proxy. These GETs do not run an evaluator or a model.
- **Permissions:** dashboard teacher. Feedback filters the newest-first query by
  students found through teacher course states/active chats, then applies the
  requested limit; it is not course-at-submission filtering. The helper's
  `limit=1000` is Cosmos page sizing, not an overall query cap. Proxy restricts
  HTTPS to the configured account, feedback-attachment container prefix, and
  non-traversal path, but does not bind a Blob to a scoped feedback record.
  Evaluations use course access plus course session IDs; admins see all courses.
- **State:** read-only domain operations; proxy sends public cache headers.
  No annotation, evaluation write, or browser-local persistence.
- **Success:** scoped feedback, attachment bytes, or saved evaluations with
  mean scores and count. No session UUID yields empty evaluations. Aggregation
  can repeat evaluations when courses share a session; scores are not
  educational-outcome evidence.
- **Failure / retry / cancellation / idempotency:** malformed proxy path is 400;
  storage/query errors can be 500, and feedback/evaluation helper failures can
  appear empty. A student's feedback is not separately linked to the course in
  which it was submitted. No retries, recomputation trigger, or cancellation
  contract.
- **Evidence:** [teacher feedback/proxy/evaluation routes][teacher-routes],
  [teacher student-scope helper][teacher-scope], [query helpers][teacher-queries].
  Existing docs: [evaluation](../evaluation.md), [architecture](../architecture.md).

<a id="main-teacher-insights"></a>
### Scoped Insights conversation and evidence citations

- **Actors / trigger / classification:** teacher/admin selecting a course and
  optionally students, then asking Insights; **current**. `POST
  /api/teacher-dashboard/logging-agent/chat/stream`
  (`logging_agent_chat_stream`). OPTIONS belongs to the system/preflight group.
- **Execution:** the named reference from `TEACHER_ANALYTICS_AGENT_NAME`
  (currently no built-in default), plus `add_message`, `get_learning_evidence`,
  `list_agents`, `list_all_students`, `get_student_progress`, and
  `get_agent_overview`. These are analytics tools, not a second course TA.
  The referenced remote definition determines the model.
- **Permissions:** **both** dashboard-teacher and active-user dependencies.
  One course must be selected/uniquely inferred and authorized. Legacy scope
  validates selected learners against assigned/active/state-derived students,
  excluding teacher/admin profiles; empty selection means whole class.
  Authoritative graph mode uses `resolve_course_roster` and authorized learner
  accesses instead. Tool dispatch rejects out-of-scope courses/students,
  disallows whole-class overview in selected mode, and graph tools refresh
  membership on each execution.
- **State:** Foundry conversations persist remotely; conversation-scope
  fingerprints and clients are process-local. Known matching scope can reuse a
  conversation; unknown/changed scope starts a new one. Legacy fingerprint
  covers course/student selection, not a durable per-teacher owner record;
  graph fingerprints also include actor/memory scopes. This route does not
  write learner progress or Insights history to Cosmos.
- **Success:** bounded evidence bundle and inference rules are supplied as
  context; SSE emits conversation ID, message blocks/deltas, resolved evidence
  citations and done. Citation references map back to authorized students for
  UI navigation. Prompt rules ask for uncertainty and distinguish observations
  from inference; they are not a guarantee of model accuracy.
- **Failure / retry / cancellation / idempotency:** missing text/ambiguous
  course is 400, invalid selection 403; identity failures precede streaming.
  Unknown/mis-scoped tool requests produce bounded errors; upstream stream
  errors are surfaced generically. Follow-up tool failures can end a turn
  without a complete answer. There is no general tool-round ceiling, durable
  retry ledger, explicit disconnect-to-remote cancellation, or idempotency key.
  Process restart loses scope fingerprints and therefore starts new history.
- **Evidence:** [teacher Insights route][teacher-routes],
  [conversation stream/scope fingerprint][teacher-chat],
  [scoped tool dispatch and citations][teacher-tools],
  [active identity][active-auth], [typed settings][settings]. Existing docs:
  [agent catalogue](../agents/README.md), [memory evidence](../memory/evidence-model.md).

## Coverage and evidence limitations

Validation found **40 workflows, 156 unique fully qualified HTTP handler
symbols, and 159 explicit HTTP registrations**: 120 decorated declarations in
`main.py`, eight in the identity factory, ten in the directory factory, 20 in
teacher routes, and the application's one programmatic `/docs` handler.
Identity/directory IDs now use
`create_identity_router.<locals>.<handler>` and
`create_directory_router.<locals>.<handler>` in their new source files.
The three additional registrations are the repeated symbols below; these
numbers do not count framework-generated routes or shutdown callbacks.

The sidecar assigns each fully qualified handler symbol to one primary workflow.
`check_agent_name`, `get_agent_tools`, and `update_agent` each have two
declarations in `main.py`; both callable registrations are described in their
one owning workflow. The sidecar uses the exact Python symbol rather than
inventing a renamed handler. Registration order, parameter names and methods
above distinguish the occurrences.

| Symbol occurrence | Method and path | Snapshot source |
| --- | --- | --- |
| `check_agent_name`, first synchronous definition | GET `/api/agents/check-name` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L1275>) |
| `check_agent_name`, later async definition | GET `/api/agents/check-name` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L9961>) |
| `get_agent_tools`, first synchronous definition | GET `/api/agents/{agent_id}/tools` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L1508>) |
| `get_agent_tools`, later async definition | GET `/api/agents/{agent_name}/tools` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L10497>) |
| `update_agent`, first synchronous definition | POST `/api/agents/{agent_id}/update` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L1616>) |
| `update_agent`, later async definition | PUT `/api/agents/{agent_name}` | [definition](<../../Agentic Shiksha Platform/Backend/backend/main.py#L10542>) |

Static source inspection and sidecar/link/decorator validation are the evidence
for this guide. No application import, environment-value read, user-data read,
network/cloud execution, or runtime smoke test was performed. Consequently,
deployed named-agent definitions, SDK-version-specific runtime behavior, remote
resource existence, credentials/RBAC, background shutdown completion, and
multi-worker behavior remain unverified. The known legacy source inconsistencies
are documented, not remediated or silently presented as working.

[main]: <../../Agentic Shiksha Platform/Backend/backend/main.py>
[factory]: <../../Agentic Shiksha Platform/Backend/backend/app.py>
[settings]: <../../Agentic Shiksha Platform/Backend/deployment_settings.py>
[auth]: <../../Agentic Shiksha Platform/Backend/auth.py>
[google-auth]: <../../Agentic Shiksha Platform/Backend/google_auth.py>
[identity-routes]: <../../Agentic Shiksha Platform/Backend/backend/routers/identity.py>
[identity-service]: <../../Agentic Shiksha Platform/Backend/backend/services/identity.py>
[identity-core]: <../../Agentic Shiksha Platform/Backend/backend/core/identity.py>
[directory-routes]: <../../Agentic Shiksha Platform/Backend/backend/routers/directory.py>
[directory-service]: <../../Agentic Shiksha Platform/Backend/backend/services/directory.py>
[directory-store]: <../../Agentic Shiksha Platform/Backend/backend/integrations/directory.py>
[session-transport]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/session.py>
[service-errors]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/service_errors.py>
[active-auth]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/auth.py>
[agent-access]: <../../Agentic Shiksha Platform/Backend/backend/dependencies/agent_access.py>
[cosmos]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>
[agent-creation]: <../../Agentic Shiksha Platform/Backend/azure_services/agents/agent_creation.py>
[runtime]: <../../Agentic Shiksha Platform/Backend/harness/runtime.py>
[search-manager]: <../../Agentic Shiksha Platform/Backend/azure_services/tools/search/course_index_manager.py>
[blob-processor]: <../../Agentic Shiksha Platform/Backend/azure_services/storage/blob_storage_manager.py>
[memory-store]: <../../Agentic Shiksha Platform/Backend/azure_services/tools/memory/memory_store_manager.py>
[memory-integration]: <../../Agentic Shiksha Platform/Backend/learner_memory/integration.py>
[curriculum-git]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/curriculum_git.py>
[section-detector]: <../../Agentic Shiksha Platform/Backend/utils/section_detector.py>
[teacher-routes]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>
[teacher-auth]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/teacher_auth.py>
[teacher-scope]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/teacher_scope.py>
[teacher-queries]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/cosmos_queries.py>
[teacher-chat]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_chat.py>
[teacher-tools]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py>
[token-stats]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/token_stats.py>
[service-readme]: <../../Agentic Shiksha Platform/Backend/README.md>
[backend-readme]: <../../Agentic Shiksha Platform/Backend/backend/README.md>
