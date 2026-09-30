# src/hooks

**No hook modules currently live here.** The README keeps this reserved
directory in a clone; it is not another package or setup target.

Existing shared hooks are [useAuth.ts](../lib/useAuth.ts) for session
synchronization and
[useStudentAssignmentAccess.ts](../lib/useStudentAssignmentAccess.ts) for
opt-in, main-API assignment permission checks. Their responsibilities and
limitations are documented in [lib](../lib/README.md).

Keep feature-specific hooks near their feature. Move a hook here only when
multiple callers benefit, updating imports rather than introducing a second
implementation of session or permission state.
