# Agentic Shiksha / Research guide

**Follow the learning idea first. Open the implementation when you need it.**

[Project](../README.md) · [EKALAIVA](pedagogy/ekalaiva.md) ·
[Memory](memory/README.md) · [See it think](memory/see-it-think.md) ·
[Run it](../INSTALL.md)

[![The research feedback loop: learner, evidence, learner model, teaching strategy, course TA, and back to the learner.](../assets/images/research/04-conceptual-loop.svg)](architecture.md)

**Source snapshot: 2026-09-30.** Current changes are **Unreleased**. Source code,
example configuration, and an offline test are not evidence of a deployed or
enabled feature. Each guide distinguishes implemented behavior, opt-in paths,
and recommendations.

## What would you like to understand?

| Guide | Main question |
| --- | --- |
| [The research architecture](architecture.md) | How does the learner feedback loop work? |
| [Implemented agents](agents/README.md) | Which named agents does the code actually create or call, and which components are workers or tools? |
| [Image generation](image-generation.md) | How can a course TA create a learning illustration, and what does the actual-interface demo show? |
| [Workflow coverage audit](workflows/README.md) | Which UI/API workflows exist, who can use them, what changes, and how do success, failure and retry behave? |
| [Project Ekalaiva](pedagogy/ekalaiva.md) | What is Manohar's framework, where are its source essays, and how does Agentic Shiksha relate to it? |
| [Learner memory](memory/README.md) | How do the Memory Store and custom learner-memory structure differ? |
| [See it think](memory/see-it-think.md) | Can I inspect the basis for the next teaching move? |
| [Research and evaluation](evaluation.md) | Which questions and measurements matter? |
| [Publications and deployments](research.md) | What is published or demonstrated, and what is illustrative? |

## Which architecture view do you need?

| View | Diagram style | Guide |
| --- | --- | --- |
| Research concept | Six components and one learner feedback loop | [Conceptual architecture](architecture.md#the-research-idea) |
| Agent interactions | Actor hand-offs, one workflow at a time | [Agents and dataflow](agent-dataflow.md#agent-interactions) |
| Processing | Record, interpret, validate, publish | [Evidence pipeline](agent-dataflow.md#evidence-processing) |
| Engineering | Service boundaries and managed dependencies | [Deployment/system architecture](deployment.md) |
| Provider modules | Current dependencies versus proposed adapters | [Provider choice](providers.md) |

<details>
<summary>Open the technical reading map</summary>

| Contract | Detailed guide |
| --- | --- |
| Conversational storage and recall | [Memory Store](memory/memory-store.md) |
| Custom structure, update mechanism, scopes, modes, and UI | [Overview](memory/overview.md) |
| Misconceptions, policy, and transitions | [Misconception state](memory/misconception-state.md) |
| Source evidence, provenance, and interpretation | [Evidence model](memory/evidence-model.md) |
| Textbook and threshold-concept research | [Curriculum research agents](agents/curriculum-research.md) |
| Course-TA specification and provisioning | [Creation agent and workflow](agents/course-creation.md) |
| Learner-facing execution and tools | [Course Teaching Assistant](agents/course-ta.md) |
| Course Companion, teacher Insights and admin analytics | [Actual agent names and call sites](agents/README.md) |
| Complete source-to-documentation mapping | [Workflow matrix](workflows/coverage.md) and [API endpoint index](workflows/api-index.md) |

The guides use source-defined agent names rather than invented role acronyms.
Local workers, tools and model calls are identified separately. Setup remains in
the canonical [installation guide](../INSTALL.md), with service-specific details
in the local READMEs.

</details>

## Related guides

- [Repository overview](../README.md) and
  [main platform](<../Agentic Shiksha Platform/README.md>).
- [Admin Dashboard](../Admin-Dashboard/README.md).
- [Installation](../INSTALL.md), [release notes](../RELEASE_NOTES.md), and
  [changelog](../CHANGELOG.md).
- [Remaining Azure resource setup](resources/README.md): Foundry and App Service
  only, with completed infrastructure reused.
- [Refactoring plan](../refactoring_plan.md), which records the staged migration
  rather than asserting that every target layer already exists.
- [Reusable research figures and recorded tutorials](../assets/images/README.md).
- [Contributing](../CONTRIBUTING.md#documentation-maintenance) and
  [security reporting](../SECURITY.md).

## Maintenance

Keep source links and examples current when changing a contract. Update the
affected topic and its service README together. Use synthetic examples, preserve
the distinction between missing evidence and a negative result, and never
include learner records, private endpoints, credentials, or local account paths.
