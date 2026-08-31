# prompt_store/tools

Prompts belonging to individual tools rather than to an agent's persona.

## Document conversion

| File | Used by |
| --- | --- |
| [markdown_transcriber_system.md](markdown_transcriber_system.md) | [utils/markdown_converter.py](../../utils/markdown_converter.py) — single-document transcription |
| [markdown_transcriber_batch.md](markdown_transcriber_batch.md) | The same, for batched pages |

## TikZ diagram pipeline

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
