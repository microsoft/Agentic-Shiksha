# utils

Shared implementations used by the runtime and route handlers. This is not a
pure-Python-only or cloud-free layer: several modules own feature clients, durable
jobs or native-process execution.

| Module | Purpose |
| --- | --- |
| [prompt_unifier.py](prompt_unifier.py) | Combines the prompt modules plus CACA's learning/exam prompts into final agent instructions. Also loads prompts from markdown. |
| [tool_definitions.py](tool_definitions.py) | Loads tool schemas from `agent_tools/custom/<tool>/definition.json`, mirroring the prompt loader. |
| [clarification_registry.py](clarification_registry.py) | In-memory registry for clarifications the agent is blocking on, so `ask_clarification` can await the student's answer. |
| [markdown_converter.py](markdown_converter.py) | Converts uploaded documents to markdown for indexing. |
| [section_detector.py](section_detector.py) | Detects logical sections ("Question Paper 1", "Chapter 3") in PDFs via Document Intelligence, and can split on them. |
| [course_creation.py](course_creation.py) | Durable course/TA creation, curriculum work and model-client lifecycle. |
| [course_materials.py](course_materials.py) | Material access, indexing and grounded course context. |
| [material_jobs.py](material_jobs.py), [material_uploads.py](material_uploads.py) | Durable material job workers and upload handling. |
| [curriculum_translation.py](curriculum_translation.py) | Versioned curriculum translations, storage and concurrency control. |
| [form_attachments.py](form_attachments.py) | Bounded local extraction of small course-form attachments. |
| [metadata_cache.py](metadata_cache.py) | Bounded metadata caching and explicit invalidation. |
| [circuit_simulation.py](circuit_simulation.py), [circuit_devices.py](circuit_devices.py), [circuit_measurements.py](circuit_measurements.py) | Validated ngspice execution, device models and numerical readings. |
| [slide_export.py](slide_export.py) | Local, in-memory editable PowerPoint generation. |
| [log_safe.py](log_safe.py) | Sanitization helpers for log fields. |
| [tikz_renderer.py](tikz_renderer.py) | Compiles TikZ source to a base64 PNG: `.tex` → `pdflatex` → PDF → PyMuPDF → PNG. |
| [tikz_geometry.py](tikz_geometry.py) | Shadow-mode geometry checking for generated diagrams, using the vendored gates in [tikzgeom/](tikzgeom). |
| [tikzgeom/](tikzgeom) | Vendored deterministic geometry checker. See its own README. |

## Notes

- `tikz_renderer.py` needs a working LaTeX toolchain on the host (MiKTeX on Windows,
  TeX Live elsewhere). PDF conversion/extraction additionally needs Poppler, and
  numerical circuit simulation needs ngspice. See the
  [native-program requirements](../README.md#dependencies-and-native-programs).
- Slide export uses `python-pptx`; Microsoft Office is not required.
- `clarification_registry.py` is in-process state. It does not survive a restart and is
  not shared across replicas.

For checks, use the [offline test setup](../tests/README.md). Native numerical tests
may be skipped when ngspice is absent; a plain module import is not a reliable
offline check for utilities that load cloud configuration.
