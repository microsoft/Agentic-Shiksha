# Agent Harness

This package owns the TA conversation and tool-execution runtime. It retains the
legacy import alias and adds opt-in, request-scoped graph-memory integration.

## Entry Point

```python
from harness.runtime import GeneralAgent, get_general_agent, with_suggested_queries
```

[runtime.py](runtime.py) owns request context preparation, Foundry conversation turns,
tool dispatch and parallel execution, declared-plan progression, completion decisions,
streamed block events, follow-up suggestions, titles, and the shared runtime cache.

New and continued chat streams emit `context_status` with `preparing` before
building profile, grounding, and turn context, then `ready` after preparation
and any stale-context cleanup, before opening the model response. Failed
preparation does not emit `ready`. SSE carries the phase in `status`; AG-UI
carries it as the `value` of a `CUSTOM` event named `context_status`. These
events contain no context contents and are not conversation message blocks.

HTTP authentication, authorization, routes and SSE/AG-UI encoding remain in
[../backend/](../backend/). Tool schemas and concrete implementations remain in
[../agent_tools/](../agent_tools/). Prompts and Azure persistence/retrieval integrations
remain in their existing packages. Graph-enabled requests use the trusted
[memory adapter](../learner_memory/integration.py); unrelated legacy behavior is unchanged.

## Compatibility and State

[../base_agents/general_agent.py](../base_agents/general_agent.py) aliases this exact
runtime module. Old imports, private-helper imports, cached agents and tool monkeypatches
continue to use the same objects; there is no duplicate implementation or cache.
The logger retains its `base_agents.general_agent` category for existing log consumers.

Runtime instances are shared across learners by endpoint, agent name and material
session. Keep user IDs, credentials for user actions, and turn-local state out of
instance-level mutable state; pass learner identity through each request as before.
Changing this package does not publish remote Foundry agent definitions or prompts.

Foundry Responses requests select a prompt agent with
`extra_body={"agent_reference": {"name": agent_name, "type": "agent_reference"}}`.
The old top-level `agent` property is rejected by the current service. Initial
requests, continued turns, stale-tool recovery and tool-result follow-ups all use
the same envelope, retaining a verified `version` when graph memory pins one.
Conversation IDs and message/tool payloads are unchanged.

## Graph-memory requests

With `GRAPH_MEMORY_ENABLED=false` (the default), there are no memory metadata or
ledger reads on the legacy path. Enabled courses additionally select `off`,
`shadow`, or `authoritative` in server-owned course metadata.

All four active chat endpoints (`start`, `continue`, SSE `stream`, and `agui`)
durably accept the learner turn **before** opening a model stream. Clients send
one stable `event_id` across retries. The server owns the evidence timestamp;
the optional legacy `occurred_at` input cannot backdate or postdate it. Explicit
chat edits use a new ID plus `supersedes_event_id`, and cannot supersede a frozen
assessment or teacher evidence. A storage failure is an HTTP error, not a
successful response followed by a lost background write.

`MemoryToolContext` is passed explicitly through every parallel tool call and
raw-JSON quiz fallback. It never lives on `GeneralAgent`. Conversations are
server-bound to the learner partition, curriculum and learning epoch. Reusing a
conversation from another scope is rejected; old unscoped nonstream callers
cannot bypass graph ingress. Authoritative turns replace previous injected graph
snapshots and pin the verified remote agent version.

The compatibility progress tool cannot set mastery, clear a misconception, or
cross a threshold in authoritative mode. Its original daemon-write behavior is
retained only for legacy courses. Quiz tools freeze server assessment instances;
SSE and AG-UI preserve `assessmentInstanceId`, `quizId`, `curriculumVersion`, and
`serverGraded`. Only server submissions reveal grading.

Hosted memory is not a second state authority. New graph-enabled course creation
does not attach it; authoritative activation and ingress reject any existing
unverified hosted-memory tool without changing its remote definition.

Chat turns display **Concise**, **Balanced** (default), or **Comprehensive**.
Their existing `answer_depth` wire/storage keys remain `quick`, `balanced`, and
`detailed`, so saved choices and older clients remain compatible. The versioned
[answer-depth context](../prompt_store/agents/answer_depth_v2.md) includes only the
selected [Concise](../prompt_store/agents/answer_style_concise_v1.md),
[Balanced](../prompt_store/agents/answer_style_balanced_v1.md), or
[Comprehensive](../prompt_store/agents/answer_style_comprehensive_v1.md) guidance.
It is added to the
current turn's context alongside, not in place of, profile and grounding context.
It is never stored on the shared agent instance. Each new request supplies its
own preference; tool follow-ups use the same conversation context. The preference
does not replace the remote agent's instructions, change models or tools, or
alter the user's saved message.

## Learner instructions

Injected profiles may carry `customInstructions`, shared with the learner-profile
API and Settings. The versioned
[context template](../prompt_store/tools/learner_custom_instructions_context_v1.md)
marks this as learner-scoped preferences, not a new system prompt. New/continued
turns carry the current snapshot verbatim; an explicit empty string clears earlier
snapshots. On replacement, the runtime lists all conversation-item pages, deletes
superseded injected profile snapshots, and confirms they are absent before model
execution. A failed or unconfirmed deletion stops the turn with a generic error.
Ordinary user/assistant messages, tool outputs and other conversations remain.
An omitted field leaves the current snapshot alone. Nothing is stored on the
shared runtime instance or published to the remote agent definition.

## Verification

From the backend service directory, install the test dependencies and use the
[synthetic environment](../tests/README.md#offline-test-environment), which
disables dotenv loading, then run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_plain_text_emission.py tests\test_general_agent_web_search.py tests\test_research_context_injection.py tests\test_tikz_retry_guard.py -q
.\.venv\Scripts\python.exe -m pytest tests\test_graph_memory_access.py tests\test_graph_memory_integration.py -q
```

The compatibility regression verifies module/class/factory/cache identity and shared
monkeypatch behavior. Existing tests cover turn completion, early prose, planned output,
grounding, research context and tool-failure handling. Request-contract tests use
the real OpenAI SDK with an HTTP transport that rejects the deprecated `agent`
property, covering sync/streamed starts, continued turns and version preservation.
Cloud calls are mocked.