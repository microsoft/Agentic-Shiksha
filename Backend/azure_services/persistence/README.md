# azure_services/persistence

Durable state. Everything a restart must not lose lives here.

| Module | Purpose |
| --- | --- |
| [cosmos_db.py](cosmos_db.py) | Chat threads and messages, user directory, learning state. The main Cosmos access layer. |
| [progress_inference.py](progress_inference.py) | Derives in-progress topics server-side from what was actually taught. |
| [curriculum_git.py](curriculum_git.py) | Version control for course curricula — a bare git repo per course, stored as a compressed tarball in Blob Storage. |
| [image_quota.py](image_quota.py) | Weekly per-user, per-agent image generation quota. |

## Containers

| Container | Partition key | Holds |
| --- | --- | --- |
| `learning_states_v1` | user id | Learning state, and the image-quota documents (already partitioned correctly, so they share it) |
| `users_v1` | `/userId` | Active user profiles |
| `invited_users_v1` | `/email` | Transient invite records, promoted into `users_v1` on first sign-in |

Invites and active users are deliberately separate, so someone invited but not yet
onboarded is never exposed as a user. Rename and delete operations on an institute or
department must update **both** containers.

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
