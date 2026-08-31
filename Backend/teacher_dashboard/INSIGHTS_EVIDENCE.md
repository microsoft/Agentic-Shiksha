# Teacher Insights Evidence Mechanism

## Request flow

1. The dashboard sends `agent_id` and `student_ids` to the teacher-dashboard
   insights endpoint. An empty `student_ids` list means the whole course.
2. The route verifies that the teacher owns the course and that every selected
   student belongs to that course.
3. The server builds a bounded evidence bundle and injects it into the analytics
   request. The same authorization scope is applied to every local tool call.
4. The Foundry `teacher-analytics-agent` uses `get_learning_evidence` as its
   primary grounding tool and returns evidence-backed findings, uncertainty,
   teaching actions, and verification steps.

Changing the course or student selection starts a new Foundry conversation, so
evidence from one scope cannot carry into another scope.

## Evidence hierarchy

Evidence is weighted from strongest to weakest:

1. Immutable concept-inventory first attempts: score, wrong responses, selected
   and expected options, and the student's reason.
2. Threshold-concept progress: status, addressed misconceptions, summaries, and
   observation dates.
3. Syllabus-topic progress: status, module, latest summary, and observation date.
4. Student-created assets: metadata and bounded content excerpts.
5. Recent chat turns: bounded excerpts of the student prompt and the tutor reply
   from course threads only. Chat is contextual evidence, not proof of mastery.

Non-chat items receive stable request-local references (`S1-CI1`, `S1-TC1`,
`S1-TP1`, `S1-AS1`). The agent cites those references inline. The server resolves
only references present in the authorized catalog and emits them as structured
SSE metadata. Chat excerpts never receive references or leave the backend in a
citation payload; the UI shows only "Chat signals reviewed; excerpts hidden."

Every student record includes evidence-coverage counts. Missing evidence must be
reported as a limitation, not interpreted as lack of ability or effort.

## How chat history is stored

Chat evidence is rebuilt from the same records the tutor writes during a normal
conversation. Nothing is duplicated for analytics.

| Container | Partition key | Purpose |
| --- | --- | --- |
| `chat_threads_v1` | `/userId` | One doc per conversation, tagged with `agentId` and `title`. |
| `chat_messages_v1` | `/userId` | One doc per message: `threadId`, `role`, `content`, `createdAt`. |

A conversation turn is identified by `messageGroupId`, which is shared by a
student message and the assistant replies to it. Two fields record revisions:

- `isLatest = false` marks a row superseded by an edit.
- `retryNumber` increments per regeneration; `0` is the original.

The canonical turn is therefore the surviving row (`isLatest` not false) with the
largest `retryNumber` for each role in the group. `_student_chat_evidence`
applies exactly that rule, so the agent sees what the student actually saw
rather than abandoned drafts. Turns where a retry or edit occurred are flagged
with `was_retried_or_edited`, which is itself a signal worth noting.

Scoping is enforced by the storage layout: threads are read from the student's
own partition and filtered to the requested `agentId`, so a course's evidence
can never include another course's conversations.

## Privacy and safety

- Course and student scope are enforced in Python, not by model instructions.
- Teacher/admin records and students from other courses are excluded.
- Raw user IDs are removed from the model-facing evidence bundle.
- Asset and chat excerpts are truncated and marked as untrusted data. The agent
  is instructed never to follow instructions embedded in those excerpts.
- The agent must not infer intelligence, disability, mental health, motivation,
  intent, or other sensitive traits.
- Important findings should identify the evidence category and observation date.

## Scale limits

- Up to 25 students are included in one request.
- Requests with more than 8 students use compact evidence (fewer observations,
  assets, inventories, and chat excerpts per student).
- The bundle reports `truncated` and `detail_level`; the agent must disclose this
  when it limits a class-level conclusion.

## Output contract

An insight response should contain:

1. Scope and evidence coverage.
2. Observed facts.
3. Clearly labeled inferences with confidence or uncertainty.
4. Evidence-backed strengths and learning needs.
5. Concrete teaching actions.
6. A follow-up assessment or observation to verify each inference.
