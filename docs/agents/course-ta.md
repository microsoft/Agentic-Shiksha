# Course Teaching Assistant: named agent and runtime

> Source snapshot: 2026-09-30; Unreleased; source presence is not deployed configuration.

The learner-facing agent is the **course-specific Teaching Assistant (TA)**,
identified by the selected course's stored agent name. Its canonical
Python runtime is `GeneralAgent` in [harness/runtime.py][runtime], not a new
`LearningAgent` service. [BaseAgentManager][manager] supplies lifecycle helpers;
[base_agents/general_agent.py][alias] aliases the canonical runtime rather than
implementing another agent or cache.

The [Ekalaiva guide](../pedagogy/ekalaiva.md) describes intended teaching behavior.
This guide describes execution and its boundaries, not an efficacy guarantee.

## Inputs, outputs, and public entry points

[backend/routers/chat.py][routes] supplies typed, authenticated entry points
under `/api/agents/{agent_id}`:

| Suffix | Result |
| --- | --- |
| `/chat/stream` | Legacy-format server-sent events through `main.agent_chat_stream`. |
| `/chat/agui` | AG-UI events with structured widget messages through `main.agent_chat_agui`. |
| `/chat/start` | A non-streaming response starting a conversation. |
| `/chat/continue` | A non-streaming response continuing an existing conversation. |

All four are POST routes. Inputs include text and/or images, optional
conversation/thread ID, profile context, tool choice, and answer depth.
`quick`, `balanced`, and `detailed` are the answer-depth wire values; they
control presentation rather than changing the model or educational verdict.

The router requires active-user and course access, rejects a mismatched supplied
`user_id`, and binds the authenticated identity. `prepare_chat` also invokes the
opt-in memory integration and passes its request-local context to adapters.
Graph-mode event requirements and receipts are described in the
[memory overview](../memory/overview.md).

## Execution sequence and ownership

1. The HTTP layer validates identity/access and input, loads applicable profile
   and course-material-session context, and obtains `get_general_agent(...)`.
2. `start_chat_stream` creates a Foundry conversation; `continue_chat_stream`
   reuses one. Both require an explicit, nonempty per-request `user_id`.
   The `thread_id` event name remains a compatibility alias for conversation ID.
3. The harness builds turn context: selected answer-depth guidance, profile and
   institute/department context when supplied, images, course grounding, and
   applicable memory context. These are not replacements for remote instructions.
4. The harness requests a response using a named-agent reference. It collects
   function calls and dispatches local custom tools, including batched execution.
5. Tool outputs return to the same conversation as `function_call_output`.
   Declared plans guide artifact sequencing and follow-up decisions.
6. Prose and structured events are emitted to the API adapter. Legacy SSE and
   AG-UI encode them differently; the frontend renders supported artifacts.
7. The API/persistence layers handle saved chat/assets, usage, and applicable
   progress/evidence recording. The cached runtime object is not the learner's
   persistent memory store.

Non-streaming behavior has two paths: without a memory context it calls the
older `start_chat`/`continue_chat` methods, which make a direct response request.
With a memory context the router collects the shared streaming/tool path into
a JSON response. Do not assume the older non-streaming methods implement the
same local tool loop as streaming.

## Tools and grounding

[AgentToolBuilder][builder] is the creation-time registration source.
`_dispatch_tool_call` in the runtime is the local execution source; hosted search
and memory tools have separate builders.

| Capability | Current examples and boundary |
| --- | --- |
| Course/learner context | `get_threshold_concepts` reads the curriculum/legacy state or authorized committed memory context. |
| Assessment | `add_quiz` creates practice/inventory artifacts; memory-context calls use the assessment-freezing integration. |
| Learning artifacts | `add_document`, `add_challenge`, `add_circuit`, `add_slides`, and `generate_image` produce supported structured output. |
| Conversation control | `declare_plan`, `ask_clarification`, `add_message`, and `suggest_next_queries` shape the interaction. |
| Legacy progress | `update_topic_progress` records legacy progress; authoritative-memory calls reject direct state-setting. |
| Hosted retrieval | Course `azure_ai_search`, optional custom search, and conditionally attached summary memory are configuration-dependent. |

New registrations favor `generate_image`; `add_tikz_diagram` remains a
compatibility dispatch path for older agents. Flashcard calls are explicitly
rejected. Do not infer the tool list of an existing remote version from the
current builder alone.

The [grounding prompt][grounding] requests course-material-first answers and
clear source attribution. Standard API adapters currently disable general live
web retrieval even though the runtime supports a web-enabled call path.
Neither a retrieval instruction nor a returned citation proves factual quality.

## State and memory scopes

- **Course scope:** named-agent instructions, curriculum, and the material
  `session_id` used for retrieval. This session is not the learner's identity.
- **Conversation scope:** Foundry conversation history and turn/tool context.
  Conversation IDs alone are not authorization.
- **Learner scope:** identity passed to each request/tool call, with persisted
  progress and any applicable memory context resolved separately.
- **Process scope:** `_agent_cache` is shared by endpoint, agent name, and
  material session. Its optional factory `user_id` argument is deprecated and
  ignored; never put learner-specific mutable state on a cached instance.

Legacy summary memory, learning state, and graph memory are distinct.
Current [settings][memory-settings] default both `GRAPH_MEMORY_ENABLED` and
`GRAPH_MEMORY_WORKER_ENABLED` to false. This is disabled-by-default integration,
not an absent implementation: [main.py][main] registers the chat, assessments,
and learner-memory routers, and its lifespan starts the memory worker only when
both switches are enabled. Availability and authoritative behavior also depend
on course mode and valid published configuration.
See the [memory guide](../memory/overview.md) rather than assuming hosted
`memory_search` is always attached or equivalent to verified learner state.

## Errors, lifecycle, and security limitations

- A failed artifact tool can emit `block_cancel` and an error-prefixed model
  result. It must not be described as a delivered document or completed quiz.
- Clarification is a user-scoped interaction; the runtime emits the request
  before waiting. Declared plans are execution guidance, not a global guarantee
  of bounded tokens, cost, or duration.
- In the no-memory-context legacy branch, progress is acknowledged before a
  daemon thread writes it. A success-sounding acknowledgement is not durable
  persistence and legacy `learned` is not verified `CROSSED`.
- Unknown function names currently fall through to a success-looking output
  string. That fallback is a limitation, not evidence that an unknown tool ran.
- Updating learner custom instructions replaces injected profile snapshots;
  an unconfirmed removal stops the turn. It does not republish the course agent.
- Prompt privacy and academic-integrity instructions are not substitutes for
  server authorization or safe serializers. Do not expose diagnostic mappings,
  another learner's records, infrastructure identifiers, or secrets.
- A chat/conversation deletion is not proof that every related artifact or
  retained assessment was erased. Follow the documented persistence lifecycle.
- Local source changes do not update deployed named-agent versions. Use the
  [deployment guide](../deployment.md) for configuration/publication boundaries.

## Tests and related guides

Existing [runtime tests][runtime-tests] cover prose/tool rendering behavior,
turn completion, and request-local answer depth. [Profile-context tests][profile-tests]
exercise injected learner/research context; [tool tests][tool-tests] check
definitions and creation-time retrieval scope. [Inventory tests][inventory-tests]
and [first-attempt tests][attempt-tests] cover assessment-related contracts.
These are not evidence of deployed configuration, complete access isolation,
or learning gains; see [evaluation](../evaluation.md).

Read [curriculum research](curriculum-research.md) for research outputs,
[course creation](course-creation.md) for provisioning,
[the agent catalogue](README.md), [the harness README][harness], and
[architecture](../architecture.md).

[runtime]: <../../Agentic Shiksha Platform/Backend/harness/runtime.py>
[manager]: <../../Agentic Shiksha Platform/Backend/base_agents/agent_manager.py>
[alias]: <../../Agentic Shiksha Platform/Backend/base_agents/general_agent.py>
[routes]: <../../Agentic Shiksha Platform/Backend/backend/routers/chat.py>
[builder]: <../../Agentic Shiksha Platform/Backend/azure_services/agents/agent_creation.py>
[grounding]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/knowledge_grounding.md>
[runtime-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_plain_text_emission.py>
[profile-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_research_context_injection.py>
[tool-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_tool_definitions.py>
[inventory-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_concept_inventory_mapping.py>
[attempt-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_quiz_first_attempts.py>
[harness]: <../../Agentic Shiksha Platform/Backend/harness/README.md>
[memory-settings]: <../../Agentic Shiksha Platform/Backend/learner_memory/settings.py>
[main]: <../../Agentic Shiksha Platform/Backend/backend/main.py>
