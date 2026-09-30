# Agents implemented or referenced by Agentic Shiksha

**Use the names in the source, and keep agents separate from their tools and workers.**

[Agent interactions](../agent-dataflow.md#agent-interactions) ·
[Workflow coverage](../workflows/README.md) ·
[Architecture](../architecture.md) · [Documentation](../README.md)

**Source snapshot: 2026-09-30; Unreleased.** The table below is grounded in
agent definitions and request call sites, not a live Foundry inventory.
A configured reference is not proof that the remote agent is provisioned,
enabled, or running a particular model/version.

`LACA` and `TCA` are not implemented agent identifiers in this repository.
There is also no separate `LearningAgent` service: learners talk to a
course-specific Teaching Assistant. The former documentation role labels have
been removed from the guides.

## Main application and research agents

| User-facing function | Actual agent reference | Source-backed responsibility |
| --- | --- | --- |
| Course Teaching Assistant (TA) | The selected course's agent name; created per course | Handles learner turns through `GeneralAgent` in [harness/runtime.py][runtime]. Uses course context and registered tools to explain, ask questions and create artifacts. See [Course TA](course-ta.md). |
| Course Companion | `form-fill-assistant` | Teacher-facing form assistance. [course_form_assistant.py][form] sends a named-agent request and validates a `CourseFormResult`; the UI reviews/undoes draft edits. This does not submit Create or Update. |
| Teaching Assistant Creation Agent (CACA in source comments) | `course-agent-creation-agent` | Generates the course-specific specification used by [generate_specification][creation]. Local creation code validates it, composes prompts/tools and creates the course TA version. Also used to reframe the syllabus. See [Course creation](course-creation.md). |
| Textbook research | The value of `TEXTBOOK_RESEARCH_AGENT_NAME` | The curriculum workflow in [main.py][main] requires this configured reference to research textbook coverage against the syllabus. See [Curriculum research](curriculum-research.md). |
| Threshold-concept research | The value of `THRESHOLD_CONCEPT_RESEARCH_AGENT_NAME` | The same workflow requires this configured reference to propose course concepts, misconceptions and example diagnostic questions. It does not decide an individual learner's mastery or crossing. |
| Teacher dashboard Insights | The value of `TEACHER_ANALYTICS_AGENT_NAME` | [teacher_dashboard/logging_agent_chat.py][teacher-chat] requires this configured reference and uses teacher/course/student-scoped tools. The UI calls this Insights; it is a different integration from the admin analytics agent. |

The two curriculum-research names and the teacher-analytics name are explicit
[application settings][settings], with no built-in name default; their call sites
require them when used. Older example names do not establish a deployed identity.
The form assistant
currently pins an explicit version in its router; consult that source rather
than assuming the local prompt is already deployed remotely.

### Course Companion is not the creation agent

The [form endpoint][form] is `POST /api/course-form/assist`. Its request can carry
the current form, teacher message, attachments and whether edits are allowed.
The response proposes validated field values or advice. The frontend's
[FormAssistant][form-ui] applies eligible changes to the unsaved draft and
offers Undo. An explicit Create/Update submission is still required.

The CACA request comes later in the durable [creation workflow][creation].
It produces `description` and `instructions`; application code, not a new
"creator agent", provisions the TA and saves course metadata. TA creation,
material readiness and curriculum readiness remain separate states.

### Teacher Insights is a scoped analytics conversation

The embedded dashboard calls
`POST /api/teacher-dashboard/logging-agent/chat/stream` in
[teacher routes][teacher-routes]. Despite the route/module name, the referenced
agent reference is the configured **`TEACHER_ANALYTICS_AGENT_NAME`**, not a
source-default `teacher-analytics-agent` identity. The backend constructs the
permitted course/student scope and dispatches [teacher analytics tools][teacher-tools].
Changing that scope may start a new conversation rather than reuse another
scope's history. Insights can summarize available records; it does not itself
commit learner-memory state or establish mastery.

## Standalone Admin Dashboard agents

| Function | Actual agent reference | Implementation |
| --- | --- | --- |
| Admin analytics chat | The value of `LOGGING_AGENT_NAME` | [Admin logging_agent_chat.py][admin-chat] reads `logging_agent_name` from [admin settings][admin-settings], calls the configured named agent and dispatches its analytics tools. The entry point is `/api/dashboard/logging-agent/chat/stream`, not the embedded teacher endpoint. |
| Institute and department research | The value of `INSTITUTE_RESEARCH_AGENT_NAME` | [ResearchService][admin-research-service] coordinates both background research jobs through [research_agent.py][admin-research-agent], using `research_agent_name` from [admin settings][admin-settings]. There is not a separate department-research agent in that flow. |

These belong to the independently built Admin Dashboard backend. Do not describe
the admin API as a proxy for the main API or infer equivalent access enforcement;
see the [deployment boundaries](../deployment.md). Both names must be configured;
route names and older comments do not establish their deployed values.

## Builder, preview and optional research paths

| Reference | Where it exists | Boundary |
| --- | --- | --- |
| `course-conversational-agent` (CCA) | `cca_start` / `cca_step` in [main.py][main], and builder/edit callers such as [EditView][edit-ui] | A teacher-facing builder conversation. It is not the learner's course TA and is not the `form-fill-assistant` used by Course Companion. |
| `temp-course-agent` | Preview target in [frontend configuration][frontend-config] and the `updateTempPreviewAgent` helper in [api.ts][frontend-api] | A registered preview/compatibility target. Do not assume every current course-creation path uses it or that it is the TA eventually assigned to learners. |
| Configured `DEEP_RESEARCH_AGENT_ID` | Named-agent requests in `/api/deep-research` and its streaming path in [main.py][main] | An optional deep-research integration. The actual remote identifier comes from configuration; this guide does not invent a deployed name. |

## What is not another agent

- **`GeneralAgent`, `BaseAgentManager` and `AgentCreator`** are runtime/lifecycle
  classes, not three more remote agents. The legacy `base_agents/general_agent.py`
  import aliases the canonical harness.
- **Material and curriculum workers** coordinate persisted jobs. They invoke
  the named agents above where required; they are not agents called LACA or TCA.
- **Learner memory** records evidence, validates observations and applies
  deterministic state policy. Its profile, reducer and worker are not a
  separate learner agent; its observation extractor uses configured model calls.
- **Teaching tools** such as `add_quiz`, `add_challenge`, `add_document`,
  `add_slides` and `add_circuit` are tools of the course TA, not independent
  learning agents. SSE, AG-UI and A2UI are transport/presentation contracts.
- **Prompt files and unused agent-definition helpers** are not enough to
  establish an active agent. For example, the [legacy TikZ tool][tikz] retains
  generator/discriminator/polisher agent names and provisioning helpers, while
  its rendering stages call model chat completions. Do not turn those stage
  names into a current platform-agent inventory without checking the caller.
- **`agents_config.json` and `/api/platform/agents`** are not a complete
  inventory of the source integrations. The former is saved configuration; the
  latter checks a small predefined builder/preview subset.

## Detailed guides

- [Course TA and its runtime](course-ta.md)
- [Course-TA creation with `course-agent-creation-agent`](course-creation.md)
- [Curriculum research with the textbook and threshold-concept agents](curriculum-research.md)
- [Memory and state authority](../memory/overview.md)
- [Evaluation](../evaluation.md) and [deployment](../deployment.md)

[runtime]: <../../Agentic Shiksha Platform/Backend/harness/runtime.py>
[creation]: <../../Agentic Shiksha Platform/Backend/utils/course_creation.py>
[main]: <../../Agentic Shiksha Platform/Backend/backend/main.py>
[settings]: <../../Agentic Shiksha Platform/Backend/deployment_settings.py>
[form]: <../../Agentic Shiksha Platform/Backend/backend/routers/course_form_assistant.py>
[form-ui]: <../../Agentic Shiksha Platform/Frontend/src/features/create/FormAssistant.tsx>
[teacher-chat]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_chat.py>
[teacher-routes]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/routes.py>
[teacher-tools]: <../../Agentic Shiksha Platform/Backend/teacher_dashboard/logging_agent_tools.py>
[admin-chat]: ../../Admin-Dashboard/backend/admin_backend/integrations/logging_agent_chat.py
[admin-research-service]: ../../Admin-Dashboard/backend/admin_backend/services/research.py
[admin-research-agent]: ../../Admin-Dashboard/backend/admin_backend/integrations/research_agent.py
[admin-settings]: ../../Admin-Dashboard/backend/admin_backend/core/settings.py
[edit-ui]: <../../Agentic Shiksha Platform/Frontend/src/features/edit/EditView.tsx>
[frontend-config]: <../../Agentic Shiksha Platform/Frontend/src/lib/config.ts>
[frontend-api]: <../../Agentic Shiksha Platform/Frontend/src/lib/api.ts>
[tikz]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/add_tikz_diagram/__init__.py>
