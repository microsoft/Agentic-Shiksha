# backend/utils

**Currently empty.** Nothing imports it.

## Do not add an `__init__.py` here without renaming it

Shared helpers live in [Backend/utils/](../../utils), and the application imports them as
top-level `utils` — `from utils import clarification_registry` — because `PYTHONPATH`
points at `Backend/`, not at `Backend/backend/`.

Turning this directory into a package called `utils` puts a second module of that name on
the path. Which one wins then depends on `sys.path` order, so the failure would surface as
an import that resolves correctly in one entry point and not another. If this folder is
ever populated, give it a distinct name.

Git does not track empty directories, so this folder does not currently survive a clone.
Deleting it is a reasonable alternative to keeping this note.
