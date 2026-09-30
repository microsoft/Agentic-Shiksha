# azure_services/persistence

Persistence access for durable application state. Some feature-specific persistence
also lives in service utilities and the teacher analytics package.

| Module | Purpose |
| --- | --- |
| [cosmos_db.py](cosmos_db.py) | Chat threads and messages, user directory, learning state. The main Cosmos access layer. |
| [progress_inference.py](progress_inference.py) | Derives in-progress topics server-side from what was actually taught. |
| [curriculum_git.py](curriculum_git.py) | Version control for course curricula — a bare git repo per course, stored as a compressed tarball in Blob Storage. |
| [image_quota.py](image_quota.py) | Weekly per-user, per-agent image generation quota. |
| [learner_memory.py](learner_memory.py) | Scoped graph/learner repository contracts, conditional Cosmos batches and private evidence blobs; distinct from hosted Foundry memory search. |

## Selected containers

This is not a complete provisioning manifest; inspect `cosmos_db.py` and feature
configuration for the containers required by a particular workflow.

| Container | Partition key | Holds |
| --- | --- | --- |
| `learning_states_v1` | user id | Learning state, and the image-quota documents (already partitioned correctly, so they share it) |
| `users_v1` | `/userId` | Active user profiles |
| `invited_users_v1` | `/email` | Transient invite records, promoted into `users_v1` on first sign-in |

Invites and active users are deliberately separate, so someone invited but not yet
onboarded is never exposed as a user. Rename and delete operations on an institute or
department must update **both** containers.

## Learner preferences

`read_learner_profile` propagates storage failures instead of treating them as an
empty profile. `update_user_custom_instructions` uses the shared Cosmos client to
patch only `/customInstructions` and `/updatedAt` in the authenticated user's
`users_v1` partition. An empty string clears the value. The atomic patch preserves
unrelated and concurrently changed fields, returns the persisted document, and
does not create missing accounts or call the legacy full-profile upsert.

Regression coverage: [test_learner_profile.py](../../tests/test_learner_profile.py).

The separate [repository regressions](../../tests/test_graph_memory_persistence.py)
cover graph/learner partition boundaries, ETags, transactional failures and private
blob validation using mocks/fakes. They do not prove that a graph-memory workflow
has been enabled or its resources provisioned.
The [learner-memory package](../../learner_memory/README.md) documents the opt-in
pipeline, reviewed curriculum publication, deterministic policies, durable worker,
bounded retrieval and rollout. Leave it disabled for a normal installation.
Its `curriculum_graph_v1` and `learner_memory_v1` containers are new physical
boundaries in the existing account, both using `/partitionKey`. Existing legacy
learning-state upserts and quiz assets are not evidence-ledger authorities.
First submissions and their learning events commit together; snapshots, derived
profiles, transition history and receipts also publish transactionally.

`read_learner_learning_state` point-reads the authenticated learner/TA document
without the best-effort runtime cache, state initialization, or writes. Only a
missing document becomes `None`; other storage failures propagate. The typed
`GET /api/learner-profile/learning/{agent_id}` endpoint verifies existing TA
membership and document identity, returns only supported progress collections
and saved preferences, and uses `private, no-store`. Missing collections remain
unavailable. Cached aggregate percentages, unrelated profile fields, and
untracked active-misconception/goal/week values are not returned.

## Per-TA student assignments

The existing `agents_v1` document (partition key `/agentId`) stores the authoritative
`studentIds` roster. Roster replacement patches only `studentIds` and `updatedAt`,
with the editor's ETag as an optimistic-concurrency condition. It does not change
teachers, ownership, other TAs, or the student's institutional affiliation.

Invitations assigned before sign-in retain their original document IDs in rosters.
Membership checks also resolve promoted invitation IDs through the persisted
`oauthUserId` mapping; an email address or department match alone grants nothing.
Directory and identity reads propagate failures, and student roster lookups are not
cached. Existing assignments need no migration.

Regression coverage: [test_student_assignments.py](../../tests/test_student_assignments.py).

## Shared chats

Creating a public chat link records `sharedMessageIds` and `sharedTitle` alongside
`shareToken` and `sharedAt`. The public endpoint returns only the captured message IDs
from the owner's partition, so later messages do not extend an existing share.
Message bodies remain in the messages container; this pins the shared message set,
not a separate copy of the transcript.

Copying an existing link retains its boundary. Revoke the link and share again to
capture a newer point. Older links without a message-ID boundary use their original
`sharedAt` cutoff; missing or invalid boundaries never expose the live thread.
Normal thread sync must preserve all four server-owned fields.

Regression coverage: [test_agent_sharing.py](../../tests/test_agent_sharing.py).

## Progress inference

Progress used to depend entirely on the tutor remembering to call `update_topic_progress`,
which it frequently did not. `progress_inference.py` now derives progress from turn text
instead.

Two deliberate constraints:

- It marks topics **in progress** only. It never infers that a topic was *learned* —
  that requires the misconception check.
- Topic names shorter than two words are ignored. Real curricula contain topics literally
  named "simple", "process" and "Protocol", which would otherwise match constantly.
  Always dry-run before any backfill write.
