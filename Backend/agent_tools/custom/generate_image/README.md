# generate_image

Text-to-image generation displayed inline to the student. Wraps a Foundry
`images/generations` deployment on the v1 OpenAI-compatible surface.

| | |
|---|---|
| Class | `GenerateImageTool` |
| Tool name | `generate_image` |
| Schema | [definition.json](definition.json) |

## Arguments

| Field | Notes |
|---|---|
| `prompt` | Full visual specification — see the three tiers below |
| `title` | Shown above the image. Required |
| `quality` | `low` or `medium`. Required, no default |
| `caption` | Explanatory caption below the image |

## The one rule

**The model is a renderer, not an author.** It has no physics, biology, mathematics or
domain knowledge. Anything that must be *correct* cannot be left to it — a label or
relationship the prompt does not pin down comes back plausible and wrong, and a
confidently wrong figure teaches the student something false.

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

`medium` takes roughly twice as long and costs noticeably more than `low`, so `low` is the
right default for anything the student will merely glance at. Usage is bounded by the
weekly per-user, per-agent quota in
[azure_services/persistence/image_quota.py](../../../azure_services/persistence/image_quota.py).

Generated images are written to Blob Storage under `STORAGE_ACCOUNT_NAME`.
