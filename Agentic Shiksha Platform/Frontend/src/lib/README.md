# Frontend library

Shared API clients, state, contracts and pure helpers. Feature-local types still
belong with their feature; do not make this folder an alternative component layer.

| Modules | Responsibilities |
| --- | --- |
| [config.ts](config.ts) | API origins, AG-UI opt-in and model configuration lookup |
| [api.ts](api.ts) | Named service functions such as `listAzureAgents`, material/creation jobs and streaming |
| [agui.ts](agui.ts), [aguiAdapter.ts](aguiAdapter.ts) | AG-UI event transport and conversion to chat callbacks |
| [chatApi.ts](chatApi.ts) | Persisted conversations, profiles and assets |
| [learningProgress.ts](learningProgress.ts) | Shared topic counts, completion percentages and learned/in-progress coverage ordering for the curriculum card and learner profile; missing collections remain unavailable |
| [learnerMemoryApi.ts](learnerMemoryApi.ts) | Authenticated Graph Memory contracts, evidence/cohort reads and explicit curriculum draft/publication operations; see [memory UI](../features/memory/README.md) |
| [chatStore.ts](chatStore.ts), [userStore.ts](userStore.ts) | Browser state and signed-in user metadata |
| [useChatSync.ts](useChatSync.ts), [useMessagePagination.ts](useMessagePagination.ts) | Synchronization and bounded history loading |
| [useAuth.ts](useAuth.ts), [msalConfig.ts](msalConfig.ts) | Backend-mediated sign-in/session flow and the deprecated no-op MSAL compatibility module |
| [roles.ts](roles.ts), [userDirectory.ts](userDirectory.ts) | Role-aware presentation and directory mappings |
| [types.ts](types.ts) | Shared chat, agent and answer-depth contracts |
| [slides.ts](slides.ts), [circuit.ts](circuit.ts) | Structured artifact validation and simulation contracts |
| [circuitDevices.ts](circuitDevices.ts), [circuitExamples.ts](circuitExamples.ts) | Circuit devices and example circuits |
| [citationSources.ts](citationSources.ts), [retiredContent.ts](retiredContent.ts) | Source metadata and read-only filtering of retired content |
| [starters.ts](starters.ts), [secureId.ts](secureId.ts), [utils.ts](utils.ts) | Starter edits/order, identifiers, names and class merging |
| [loggingService.ts](loggingService.ts), [LOGGING_README.md](LOGGING_README.md) | Local diagnostic logging |
| [ThemeProvider.tsx](ThemeProvider.tsx), [tabStore.ts](tabStore.ts), [updateStore.ts](updateStore.ts), [composerBorder.ts](composerBorder.ts) | Theme, tabs, update state and composer visuals |

## Boundaries

- Import actual named functions; there is no generic `API.getAgents()` wrapper.
- Use `credentials: "include"` where the authenticated service requires its session
  cookie. Session tokens are not readable browser-local storage values.
- `VITE_API_BASE_URL` drives the main API; `VITE_API_URL` is used by authentication.
  Keep them aligned. Public build variables are not a secret store.
- Model deployments come only from `/api/config` (`default_model`, `agent_model`,
  `allowed_models`, `version`). The response is validated, including membership of
  the default in the allowed list, before it is cached. Failed requests are not
  cached or replaced with guessed deployments. The app context exposes this
  configuration and accepts selections only from its server-provided allowed list.
- SSE and AG-UI must retain equivalent request semantics for answer depth, retries,
  attachments and thread identity.
- Validate saved and streamed artifact shapes rather than trusting model text.
  Transport-envelope fields are not artifact schema fields.
- Changing local storage does not migrate server data or update a remote TA.

See [frontend verification](../../README.md#verification) and the
[source map](../README.md) before adding another state store or API abstraction.
