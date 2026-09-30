# backend/utils

**README-only placeholder.** There are no utility implementations in this
directory; the README itself is tracked, so the directory does survive a clone.

## Where the shared helpers live

Shared helpers live in [the service-level utils package](../../utils/README.md),
and the application imports them as
top-level `utils` — `from utils import clarification_registry` — because `PYTHONPATH`
points at the outer `Agentic Shiksha Platform\Backend` service directory, not at
its inner `backend` package.

Do not add this directory or the inner `backend` directory to `PYTHONPATH` to
repair imports: that can shadow the service-level `utils` package. New HTTP
dependencies belong in [../dependencies/](../dependencies/README.md); shared
non-HTTP implementations currently belong in the service-level package.
