# Agentic Shiksha: Frequently Asked Questions

This document covers what Agentic Shiksha is, how it behaves, and where its limits are.
It follows the structure of a Responsible AI transparency note. For setup and
troubleshooting questions, see [SUPPORT.md](SUPPORT.md).

> **Status:** research project. It has not been validated for production or commercial
> deployment, and interfaces and data models may change between releases.

---

## About the project

### What is Agentic Shiksha?

An AI-powered teaching-and-learning platform that operationalizes the Ekalaiva framework.
It provides course-specific Teaching Assistant agents that teach against a particular
curriculum, with the goal of shifting education from knowledge *transmission* to
knowledge *transformation*.

### What can it do?

- **Teach from a teacher's own materials.** Each course agent answers using
  retrieval-augmented generation over material the teacher uploaded, rather than general
  web knowledge.
- **Track threshold concepts.** The curriculum is modelled as threshold concepts — ideas
  that are transformative and often troublesome. Progress is recorded per concept, and a
  concept is marked complete only once the learner's misconceptions have been addressed.
- **Emit structured content.** Documents, quizzes, flashcards, challenges and diagrams
  are produced as first-class blocks rather than walls of chat text.
- **Report to teachers.** A dashboard surfaces usage, token analytics, groundedness
  evaluation and per-student progress.

### What is it intended for?

Supporting teachers and learners in a course context, with a teacher in the loop. It is
intended to reduce preparation and explanation overhead and to give teachers visibility
into where a cohort is struggling.

### What is it *not* intended for?

- Grading, assessment of record, admissions, or any other high-stakes decision about a
  person.
- Unsupervised use as a sole source of truth. Generated content must be reviewed before
  it is relied on.
- Domains requiring regulatory validation (healthcare, legal, financial advice).
- Deployment without the safety, privacy and access controls described below.

---

## How it works

### Which models does it use?

Models are configured per deployment through environment variables rather than hardcoded,
so the operator chooses them. The shipped defaults target Azure OpenAI chat models via
Microsoft Foundry (`AZURE_OPENAI_CHAT_MODEL`, `AZURE_AI_MODEL_DEPLOYMENT_NAME`), with a
separately configurable evaluation model (`AZURE_EVAL_MODEL`) and embedding model
(`EMBEDDING_MODEL`). Output quality is bounded by whichever model you point it at.

### How does retrieval work?

Course material is indexed with Azure AI Search's integrated pipeline: a blob data source
feeds a skillset that runs the Document Intelligence Layout skill for structure-aware
chunking — splitting at markdown headings so tables and lists stay intact — then embeds
each chunk. Queries use hybrid vector plus keyword search over an HNSW index, fused with
Reciprocal Rank Fusion and re-scored by the semantic ranker.

The practical consequence: **answer quality is bounded by what was uploaded.** If a topic
is absent from the course material, the agent has nothing grounded to draw on.

### Where is data stored?

Azure Cosmos DB holds chat history, learning progress and identity records. Azure Blob
Storage holds course materials and generated media. Both are resources in the operator's
own Azure subscription — this project does not host a shared service.

### How does it authenticate to Azure?

Through Microsoft Entra ID, using managed identity in deployed environments. No service
keys are required for the supported path, and the application refuses to start if required
configuration is missing rather than falling back to defaults.

---

## Evaluation and safety

### How is output quality measured?

The dashboard runs reference-free RAG metrics, LLM-as-judge style:

| Metric | Question it answers |
| --- | --- |
| Faithfulness / groundedness | Is the response supported by the retrieved context? |
| Answer relevancy | Does the response actually address the question asked? |
| Context precision | Was the retrieved context relevant to the query? |

These are diagnostic signals for teachers and maintainers, not guarantees.

### What safeguards are in place?

- **Groundedness guardrail on claims about a learner's history.** A tutor is encouraging
  by nature and will sometimes narrate the curriculum back as though the student had
  already covered it. Sentences that assert prior work are checked against the student's
  real learning state using Azure AI Content Safety groundedness detection. Only such
  sentences are checked — submitting a whole reply produces false positives, because
  ordinary teaching language is not supported by a progress record.
- **Conservative progress inference.** Progress is derived server-side from turn text
  instead of relying on the model to self-report. It can mark a topic *in progress*; it
  never infers that a topic was *learned*.
- **Retrieval grounding.** Course agents are pointed at curated course material rather
  than open web knowledge.
- **Model-provider content filtering.** Azure OpenAI content filters apply to the
  underlying model deployments the operator configures.

### How is learner privacy handled?

- The user directory is pseudonymized by role. Administrators and teachers see
  placeholder identifiers such as "User 3" with emails withheld and ordering shuffled;
  only the super-admin sees real names and addresses, and a caller always sees their own
  entry in full. Teachers cannot enumerate students.
- Invitations and active profiles are kept in separate containers, so an invited-but-not-
  onboarded person is not exposed as a user.
- Configuration is supplied at runtime; `.env` files are excluded from container images
  so credentials do not ship in a build artifact.

Operators remain responsible for their own deployment: data residency, retention periods,
consent, and compliance with applicable regulations such as GDPR and FERPA are properties
of your Azure subscription and institutional policy, not of this codebase.

---

## Limitations

### What are the known limitations?

- **Research maturity.** Not extensively tested for production use. Human supervision is
  assumed throughout.
- **Hallucination.** Outputs may contain fabricated, outdated or subtly wrong statements
  even when grounded in retrieved material. Review before classroom use.
- **Retrieval dependence.** Quality tracks the coverage and quality of the uploaded
  curriculum. Gaps in the material become gaps in the teaching.
- **Progress tracking is approximate.** Topic matching against free text is deliberately
  restricted to multi-word topic names, because real curricula contain topics literally
  named "simple" or "process" that would otherwise match constantly. Some genuine
  progress will therefore go unrecorded.
- **Language.** Primarily exercised in English. Other languages are untested.
- **Agent changes require re-provisioning.** Instructions and tool schemas are baked into
  a Foundry agent version at creation, so prompt edits do not retroactively change
  existing agents.
- **Operational surface.** Full functionality requires Foundry, AI Search, Cosmos DB and
  Blob Storage to be provisioned and correctly permissioned.

### How can users reduce the impact of these limitations?

- Keep a teacher in the loop; treat output as a draft.
- Curate the course material — it is the highest-leverage input.
- Use the groundedness and relevancy metrics to spot degradation, rather than assuming
  steady quality.
- Do not use progress data as an assessment of record.
- Choose a model appropriate to the subject, and review your Azure OpenAI content filter
  configuration for your audience.
- Restrict administrative roles; the super-admin account is the only one that can see
  real directory data.

---

## Contributing and contact

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the CLA,
repository layout and development setup. This project has adopted the
[Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md).

Report suspected security vulnerabilities privately through the process in
[SECURITY.md](SECURITY.md), never through a public issue. If you observe unexpected or
offensive behaviour from the system, please open an issue describing it so the repository
can be updated with a mitigation.

Licensed under the [MIT License](LICENSE).
