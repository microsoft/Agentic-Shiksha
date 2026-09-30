# Copilot Instructions — Agentic Shiksha

Four independently built and deployed services in one repo. Rules below are repo-wide.
`Agentic Shiksha Platform/Backend/.github/copilot-instructions.md` holds the deeper Python/FastAPI conventions —
read it before non-trivial Backend work.

| Path | Stack | Notes |
| --- | --- | --- |
| `Agentic Shiksha Platform/Backend/` | Python 3.11, FastAPI | Package imports (`from utils.x import y`), run with `PYTHONPATH=.` |
| `Agentic Shiksha Platform/Frontend/` | React 19, TS, Vite, Tailwind **v3** | |
| `Admin-Dashboard/backend/` | Python, FastAPI | **Flat imports** (`from log_safe import scrub`) — not a package |
| `Admin-Dashboard/frontend/` | React, TS, Vite, Tailwind **v3** | |

The two frontends duplicate several files on purpose (`lib/secureId.ts`, etc.) because they
build independently. Fixing a bug in one usually means fixing it in both — check before closing.

## Ground rules

- Search before asserting. Never guess a file location, a line count, or whether something exists.
- Repo memory and docs are hints, not facts. Re-verify against the working tree.
- Ship the regression test with the bugfix, in the same change.
- Prefer editing an existing file over creating a new one. Don't write summary markdown unless asked.
- Only make the change asked for. No drive-by refactors, no speculative abstractions, no
  docstrings on code you didn't touch.
- This repo is public under Microsoft open source. Nothing committed may contain secrets,
  subscription IDs, resource-group names, internal hostnames, or real user data. Use
  `user@example.com` in fixtures.

## Security invariants

These are non-negotiable and have all been violated here before.

- **No secret ever reaches a log, a response body, or a commit.** `.env` stays untracked;
  `.env.example` is the value-free contract. App fails fast at startup on a missing required
  var — never falls back to a default.
- **Auth on every endpoint touching user or org data**, via the shared dependencies. Missing or
  invalid auth is 401/403, never a bypass, never treated as admin.
- **URL host checks use `parsed.hostname`, never `parsed.netloc`.** `netloc` keeps userinfo and
  port, so `https://allowed@attacker.example/` passes an `endswith` check and hands your bearer
  token to the attacker. Compare against the full expected host with `==`.
- **User input never lands in a filesystem path unchecked.** Allowlist the characters, strip
  leading dots, then contain it:

  ```python
  target = os.path.normpath(os.path.join(base, candidate))
  if not target.startswith(base):
      raise HTTPException(status_code=400, detail="Invalid path")
  ```

  Keep that guard as a single plain `startswith` on its own `if`. Compound conditions and
  `commonprefix` are equally correct but CodeQL does not recognise them, so the alert stays open.
- **User input never lands in a log line unscrubbed.** Use `scrub()` (`Agentic Shiksha Platform/Backend/utils/log_safe.py`,
  `Admin-Dashboard/backend/log_safe.py`) or CRLF in a name forges log entries.
- **Exceptions never reach the client.** Log with `exc_info=True`, return a generic message.
  No stack traces, no `str(e)` in a response.
- **Fail closed.** When a validator, discriminator, or LLM-JSON parse fails, the result is
  *reject*. A fallback that returns "pass" on unparseable input is the recurring bug class here.
- Randomness that gates anything security-relevant uses `crypto.getRandomValues`, not
  `Math.random`. (`crypto.randomUUID` is secure-context-only — that's why the fallback exists.)

## Verification

Run these before claiming a change works. Current baselines:

```bash
cd "Agentic Shiksha Platform/Backend" && PYTHONPATH=. python -m pytest tests/ -q
cd Admin-Dashboard/backend && python -m pytest tests/ -q             # 3 passed
python -m compileall -q Backend Admin-Dashboard/backend              # exit 0
cd "Agentic Shiksha Platform/Frontend" && npx vite build
```

The two pytest counts are independent; subtests are not a subset of the first number. Baselines
drift — read the current number rather than trusting this line.

**A green build is not a working build.** Specifically:

- `vite build` exits 0 while emitting an app with zero Tailwind utility classes. If you touch
  Tailwind config or version, diff the emitted CSS: the current build produces 188 `.prose` rules.
  Zero means you shipped an unstyled app that passed CI.
- `compileall` and `ast.parse` both accept an import placed *after* its first use. That raises
  `NameError` only at runtime, on the specific request that hits the line. When adding an import,
  put it at the top of the module and confirm it precedes every use.
- `npx tsc` on `Frontend` reports ~189 pre-existing TS6133/TS6192 unused-symbol errors and always
  has. CI runs `vite build` instead. Grep for `error TS2\d{3}` to find real type errors.
  (CONTRIBUTING.md still tells contributors to run a clean `tsc` — it is wrong.)
- CI does not build the `Admin-Dashboard/*` images, so a change there can show green having never
  been compiled. Build it locally.

## Conventions

**Backend**

- `backend/main.py` is frozen for new routes — new endpoints go in `routers/<domain>.py`.
- Env access goes through `pydantic_settings`, not new `os.getenv` calls.
- Every route gets a typed request model and `response_model=`. No `Dict[str, Any]` on
  external endpoints.
- `logging.getLogger(__name__)`. `print()` is forbidden outside CLI and migration scripts.
- Prompts live in `prompt_store/` as versioned files, never inline strings. Their example plans
  drive model behaviour strongly — treat a prompt edit as a behaviour change.
- Expensive Azure clients come from the startup singleton registry, never per request.
- Retry only transient failures (429, timeout, 5xx), never non-idempotent writes.

**Frontend**

- Switches over `ContentBlock` handle every variant explicitly. A `default` branch that emits a
  document block is how empty cards get rendered — this has regressed more than once.
- Pin a bad transitive dependency with an `overrides` entry in `package.json`; `npm audit fix`
  cannot move a version its parent pins exactly.

## Environment

Windows, PowerShell. A few things that reliably waste time otherwise:

- Multi-line or quote-heavy strings go in a here-string (`@' ... '@`), not inline quotes.
- Set `$env:PYTHONIOENCODING='utf-8'` before Python that prints non-ASCII.
- `gh` needs its WinGet bin directory prepended to `PATH` for the session.
- The repo lives under OneDrive. `gc.auto 0` is set locally to stop file-lock prompts during
  commits — leave it.

## Git

- One concern per commit. Explain *why* in the message; the diff shows *what*.
- Never `--no-verify`, never force-push a shared branch, never discard unfamiliar working-tree
  changes — they may be someone's in-progress work.
- Confirm before anything destructive or anything that touches the remote.
