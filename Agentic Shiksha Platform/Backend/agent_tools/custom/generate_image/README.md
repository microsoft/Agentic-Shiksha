# generate_image

Text-to-image generation displayed inline to the student. Wraps a Foundry
`images/generations` deployment on the v1 OpenAI-compatible surface.

For learner instructions, example prompts, limitations and the 35-second
actual-interface demo, see the
[image-generation feature guide](../../../../../docs/image-generation.md).
The recording uses a synthetic image fixture, not this tool's live provider.

| | |
|---|---|
| Class | `GenerateImageTool` |
| Tool name | `generate_image` |
| Schema | [definition.json](definition.json) |

## Arguments

| Field | Notes |
|---|---|
| `prompt` | Full visual specification — see the three tiers below |
| `title` | Image title and accessible name. Required by the schema |
| `quality` | `low` or `medium`. Required by the schema; runtime falls back to `medium` for an absent or unsupported value |
| `caption` | Explanatory caption below the image |

## The one rule

**Treat the model as a renderer, not an authority.** Scientific labels and
relationships can look plausible while being wrong. Specify them from verified
course material and review the result instead of treating generated pixels as
evidence of correctness.

The schema therefore asks for prompts sorted into three tiers:

| Tier | Contents | How to write it |
|---|---|---|
| Literal | All text, labels, axis names, numbers, formulas, legend entries | Verbatim, in quotes, spelled out in full |
| Structural | Position, containment, every arrow as `from -> to`, and what each connection *means* | Explicit; never "connect them appropriately" |
| Stylistic | Palette, line weight, mood, medium, lighting, viewpoint | Free prose — the only tier safe to leave open |

Anything that cannot be pinned down in tier 1 or 2 does not belong in the image; explain
it in words instead. Prompts should also request generous margins, since the model
otherwise packs content edge to edge and crops labels.

## Cost and quota

Quality affects latency and cost; this repository does not guarantee a fixed
speed or price ratio. Select it deliberately. Usage is tracked against the
weekly per-user, per-agent quota in
[azure_services/persistence/image_quota.py](../../../azure_services/persistence/image_quota.py).
The allowance is consumed before generation; a failed image request does not
have a guaranteed refund. Missing identity and some metering-exception paths
can bypass enforcement, so this is not a strict cost ceiling.

Generated images are written to Blob Storage under `STORAGE_ACCOUNT_NAME`.
The model is selected by `AZURE_IMAGE_MODEL`; `AZURE_IMAGE_ENDPOINT` falls back
to `AZURE_FOUNDRY_ENDPOINT`. This is a live Foundry/Storage operation, not an
offline image renderer. See the [example configuration](../../../.env.example).
