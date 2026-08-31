# utils

Shared helpers used across the backend. No Azure resource ownership lives here — these
are pure-ish utilities called by the agent runtimes and route handlers.

| Module | Purpose |
| --- | --- |
| [prompt_unifier.py](prompt_unifier.py) | Combines the prompt modules plus CACA's learning/exam prompts into final agent instructions. Also loads prompts from markdown. |
| [tool_definitions.py](tool_definitions.py) | Loads tool schemas from `agent_tools/custom/<tool>/definition.json`, mirroring the prompt loader. |
| [clarification_registry.py](clarification_registry.py) | In-memory registry for clarifications the agent is blocking on, so `ask_clarification` can await the student's answer. |
| [markdown_converter.py](markdown_converter.py) | Converts uploaded documents to markdown for indexing. |
| [section_detector.py](section_detector.py) | Detects logical sections ("Question Paper 1", "Chapter 3") in PDFs via Document Intelligence, and can split on them. |
| [tikz_renderer.py](tikz_renderer.py) | Compiles TikZ source to a base64 PNG: `.tex` → `pdflatex` → PDF → PyMuPDF → PNG. |
| [tikz_geometry.py](tikz_geometry.py) | Shadow-mode geometry checking for generated diagrams, using the vendored gates in [tikzgeom/](tikzgeom). |
| [tikzgeom/](tikzgeom) | Vendored deterministic geometry checker. See its own README. |

## Notes

- `tikz_renderer.py` needs a working LaTeX toolchain on the host (MiKTeX on Windows,
  TeX Live elsewhere). It is the one helper here with a non-Python dependency.
- `clarification_registry.py` is in-process state. It does not survive a restart and is
  not shared across replicas.
