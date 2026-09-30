# Research, publications, and evidence

[Project overview](../README.md) / [Evaluation](evaluation.md) / [Documentation](README.md)

Agentic Shiksha explores whether course-grounded agents can teach toward changes
in understanding using threshold concepts, misconceptions, and traceable learner
evidence. This is a research question, not a demonstrated outcome.

## What can be cited today?

| Title | Kind / paper link | Project or documentation |
| --- | --- | --- |
| **Agentic Shiksha** | Research software; no verified paper link recorded in this source snapshot | [Public repository](https://github.com/microsoft/Agentic-Shiksha) |
| **Project Ekalaiva — Swami Manohar's blog series** | Author essays on educational transformation and the agentic-internet vision, not an Agentic Shiksha results paper | [Reading guide and full citations](pedagogy/ekalaiva.md#references-manohars-blog-series) |
| **EKALAIVA: pedagogical intent and implementation** | Repository design notes, not a peer-reviewed publication | [Pedagogy guide](pedagogy/ekalaiva.md) |
| **Learner memory: evidence, interpretation, and state** | Implementation/design notes, not a results paper | [Memory guide](memory/overview.md) |

Do not substitute a paper about another Shiksha project for an Agentic Shiksha
publication. Cite Manohar's essays as the framework sources, separately from the
software revision or an empirical learning study. A future paper entry should include its exact title, authors,
date/venue, stable paper URL, associated project/docs link, and publisher BibTeX
when available.

## What is actual deployment evidence?

| Material | What it establishes | What it does not establish |
| --- | --- | --- |
| Source and software tests | Implemented contracts and testable behavior | Feature enablement, live health, or learning improvement |
| Two recorded UI tutorials | Real application interactions with synthetic responses | A real model session, student participation, or deployment latency |
| Research figures and example learner state | An explanation of the design | A screenshot, participant record, or experimental finding |
| Pilot/study reports | None linked with verifiable results in this snapshot | No cohort size, institution, or learning-gain claim is made |

No verified public hosted demo URL is recorded here. Use the
[recorded demonstrations](../README.md#demo-gallery) or the
[local installation guide](../INSTALL.md); a local/private deployment URL is not
a public demo. These documentation gaps do not establish that no private pilot
or unpublished research exists.

## How should a study be reported?

Add a study only with an approved public source. Identify the setting, dates,
participants and consent basis, intervention and comparator, assessment design,
uncertainty, and limitations. Separate feasibility/usage from learning outcomes.
Keep the README to one short finding and link the report and
[evaluation methodology](evaluation.md#recommended-research-protocol).

Use real deployment media only with permission. Never use an illustrative or
AI-generated classroom image as participant evidence.

## Reusable media and attribution

The [research figures](../assets/images/README.md) are original editable vector artwork.
The two tutorials use the actual UI, synthetic identities, and intercepted API
responses. They do not access real learners or cloud services. Existing media
generation retains its locally licensed font and reproducibility instructions.

No external classroom photos, copied framework artwork, or photorealistic
AI-generated images are added by these documentation examples. The diagrams use
common research-figure conventions without copying another project's artwork.
If future photorealistic AI media is added, label it:
**"AI-generated illustration; not from study participants."**

## Cite the software

Use a revision-pinned repository URL when reporting an experiment. The entry
below intentionally cites software rather than inventing paper metadata.

```bibtex
@misc{agentic_shiksha,
  author       = {{Agentic Shiksha contributors}},
  title        = {Agentic Shiksha},
  year         = {2026},
  howpublished = {\url{https://github.com/microsoft/Agentic-Shiksha}},
  note         = {Research software. Specify the revision used.}
}
```

The project uses the [MIT License](../LICENSE). Contributor and third-party
trademark requirements remain in [Contributing](../CONTRIBUTING.md).
