# prompt_store/tools

Prompts belonging to individual tools rather than to an agent's persona.

## Course and learner workflows

| File | Used for |
| --- | --- |
| [course_creation_request_v1.md](course_creation_request_v1.md) | Typed course-creation request assembly. |
| [teacher_resources_context_v1.md](teacher_resources_context_v1.md) | Teacher-supplied resource context for creation. |
| [course_material_grounding_v1.md](course_material_grounding_v1.md) | Grounded course-material generation requests. |
| [course_material_grounding_context_v2.md](course_material_grounding_context_v2.md) | Current course-material context injected by the harness. |
| [course_followups_v1.md](course_followups_v1.md) | Course-grounded follow-up suggestions. |
| [learner_custom_instructions_context_v1.md](learner_custom_instructions_context_v1.md) | Learner-scoped preference snapshots, including replacement/clearing. |
| [syllabus_translation_default_v1.md](syllabus_translation_default_v1.md) | Editable default translation preferences. |
| [syllabus_translation_v4.md](syllabus_translation_v4.md) | Current system contract for native-script curriculum translations. |

Earlier grounding/translation versions remain for reference. Callers choose the
version explicitly; see [harness/runtime.py](../../harness/runtime.py),
[utils/course_creation.py](../../utils/course_creation.py), and the
[translation router](../../backend/routers/curriculum_translation.py).
Changing a file does not migrate already-saved translations or remote agent
versions, and module-level prompt constants need a process restart to reload.

## Document conversion

| File | Used by |
| --- | --- |
| [markdown_transcriber_system.md](markdown_transcriber_system.md) | [utils/markdown_converter.py](../../utils/markdown_converter.py) — single-document transcription |
| [markdown_transcriber_batch.md](markdown_transcriber_batch.md) | The same, for batched pages |

## Legacy TikZ diagram pipeline

| File | Stage |
| --- | --- |
| [tikz_generator_system.md](tikz_generator_system.md) | Generate TikZ source from a description |
| [tikz_generator_retry_prefix.md](tikz_generator_retry_prefix.md) | Prepended on retry, carrying the previous failure's feedback |
| [tikz_discriminator_system.md](tikz_discriminator_system.md) | Judge whether the rendered diagram is good enough |
| [tikz_generator_polish.md](tikz_generator_polish.md) | Improve an already-working diagram |

The generate → render → judge → retry loop is bounded;
[tests/test_tikz_retry_guard.py](../../tests/test_tikz_retry_guard.py) enforces that it
terminates. Models are selected by `TIKZ_GENERATOR_MODEL`, `TIKZ_DISCRIMINATOR_MODEL` and
`TIKZ_POLISHER_MODEL`.

The discriminator judges by eye. Deterministic geometry gates in
[utils/tikzgeom/](../../utils/tikzgeom) run alongside it and produce measurements rather
than opinions — when the two disagree, the measurement is the one that can be checked.
