# Project Ekalaiva: framework, sources, and Agentic Shiksha

> This guide describes the repository as reviewed on 30 September 2026. Features
> shown in source code may require configuration and may not be enabled in every
> deployment.

[Project overview](../../README.md#background) ·
[Framework reading map](#ekalaiva-framework-and-blog-series) ·
[Agentic Shiksha's connection](#how-agentic-shiksha-relates-to-the-vision) ·
[References](#references-ekalaiva-blog-series)

## Story mode: From Ekalavya to EKALAIVA

The name **Ekalaiva** evokes **[Ekalavya](https://en.wikipedia.org/wiki/Ekalavya)**, a character from the *Mahabharata*. Ekalavya, a young prince of the Nishadas, sought to learn archery from **[Dronacharya](https://en.wikipedia.org/wiki/Drona)**, the royal teacher of the Kuru princes, but was not accepted as his disciple. Determined to learn, he continued practising independently in the forest, using a clay image of Drona as his teacher, and eventually became an exceptionally skilled archer.

Ekalavya's story has endured as more than an account of determination and self-directed learning. It has also become associated with questions of **access, exclusion, agency, mentorship, and opportunity in education**. Modern interpretations have particularly examined the social exclusion present in the episode and Ekalavya's position as a learner who developed extraordinary capability despite being denied access to the formal system.

Project **EKALAIVA** brings these questions into the age of AI. It does not seek to recreate Ekalavya's isolation. Instead, it imagines an educational environment in which learners can have greater access to knowledge and guidance, exercise meaningful agency, and receive support beyond the traditional limits of a classroom.

In this sense, Ekalavya's story provides a useful lens through which to think about what education could become when access to capable learning systems is far more widely available.

## What EKALAIVA means

**EKALAIVA** expands to:

> **Education, Knowledge-skills Acquisition, and Livelihoods in the Age of AI: Vision and Aspirations**

Project Ekalaiva is a broader educational vision for rethinking education, skilling, assessment, faculty roles, and lifelong learning in a world where AI changes both access to knowledge and the nature of work.

A central question behind the framework is:

> **If powerful AI is available throughout a learner's journey, what should education itself become?**

The [swamimanohar – Medium](https://medium.com/@swamimanohar_73269) framework
answers this through six pillars of educational transformation:

1. **Flipped-by-AI Pedagogy with Threshold Concepts**
   AI can reduce the burden of information delivery, allowing teaching to focus more deeply on concepts that transform how learners understand a discipline.

2. **Grand Challenge-Driven Unified Pedagogy**
   Learning is organized around meaningful, often multidisciplinary problems that connect knowledge to situations that matter.

3. **Portfolio-Based Assessment**
   Assessment shifts from reproducing information toward demonstrating application through projects, artifacts, iteration, and evidence of capability.

4. **Micro-Credentialing and Flexible Learning Pathways**
   Learners can progress through modular, flexible pathways rather than being constrained to a single uniform route.

5. **Lifelong Learning and Lifelong Earning**
   Learning and work are treated as continuing, interleaved activities rather than separate stages of life.

6. **Faculty Transformation**
   Faculty increasingly act as mentors, guides, designers of learning experiences, researchers, and co-learners in an AI-supported environment.

The framework therefore extends well beyond a tutoring interface. It connects **learning, assessment, credentials, faculty practice, learner agency, institutional structures, and livelihoods**.

## Where Agentic Shiksha fits

**Project Ekalaiva is the broader educational vision; Agentic Shiksha is a research platform exploring part of it.**

Agentic Shiksha focuses primarily on the course-level teaching and learning loop. Teachers shape the course, identify important concepts and troublesome ideas, review the teaching approach, and remain part of the instructional process. Course-specific teaching assistants then use this context together with evidence from learner interactions, misconceptions, and progress to determine what support may be useful next.

The shift is from an AI system that only answers:

> **What is the answer?**

toward one that also asks:

> **What does this learner currently understand?**
> **What misconception may be blocking further progress?**
> **What should we ask, explain, or practise next?**
> **What changed in the learner's understanding?**

Threshold concepts provide one of the strongest bridges between Project Ekalaiva and Agentic Shiksha. When access to information is abundant, teaching can spend less effort transmitting every piece of content and more effort helping learners cross conceptual barriers that change how they understand and use knowledge.

Agentic Shiksha does **not** claim to implement the full Ekalaiva vision. It currently explores a narrower question: how teacher-shaped, course-specific agents can support deeper understanding, learner agency, adaptation, and evidence-informed teaching.

The framework described in the
[swamimanohar – Medium](https://medium.com/@swamimanohar_73269) essays, the
pedagogy expressed in prompts and design documents, and behavior actually
enforced by code are different forms of evidence. Their presence in this
repository should not be interpreted as measured learning benefit, production
readiness, or proof that the complete Ekalaiva framework has been deployed.

## Ekalaiva framework and blog series
Start with the [six-pillar overview][ekalaiva-overview], then use this reading map
to explore the supplied essays. The numbered associations below follow the
reading list; they are not a renumbering of this repository's teaching ideas.

| Reading | Focus | Why it matters here |
| --- | --- | --- |
| [Framework overview][ekalaiva-overview] | The six-pillar educational-transformation framework. | Places the software in a wider educational vision rather than defining education around a chat interface. |
| [Pillar 1: Flipped-by-AI pedagogy][ekalaiva-flipped] | AI as a learning partner, threshold concepts, and learning agents. | Closest pedagogical connection to course-grounded agents and teaching toward changes in understanding. |
| [Pillar 2: Grand challenge-driven unified pedagogy][ekalaiva-challenges] | Learning through meaningful problems. | Connects concept-level work with contextual and multidisciplinary challenges. |
| [Pillar 3: Portfolio-based assessment][ekalaiva-portfolios] | Evidence of application rather than reproduction. | Motivates inspecting learner reasoning and artifacts without treating a correct answer as sufficient proof. |
| [Pillar 5: Lifelong learning and lifelong earning][ekalaiva-lifelong] | The relationship between continuing learning and livelihoods. | Establishes a longer horizon than a single course or chat history. |
| [Pillar 6: Faculty transformation][ekalaiva-faculty] | Faculty as guides in an AI-supported learning environment. | Frames teachers' role in shaping courses, reviewing evidence, and guiding learning. |
| [The agentic-internet vision][ekalaiva-agentic-internet] | Lumens, lifelong agents, institutional Orbits, portfolio memory, and agentic infrastructure. | The most directly relevant architectural reading for connecting learning agents and memory to the broader Ekalaiva vision. |

The supplied bibliography has no separate Pillar 4 article. Consult the
[overview][ekalaiva-overview] for the complete six-pillar framework; this guide
does not invent a missing pillar or substitute one of the local teaching ideas.

Full titles, dates, and links are in the [references](#references-ekalaiva-blog-series).

## How Agentic Shiksha relates to the vision

The [agentic-internet essay][ekalaiva-agentic-internet] on
[swamimanohar – Medium](https://medium.com/@swamimanohar_73269) is a useful bridge
from pedagogy to architecture. Its broader vocabulary should not be read as a
list of services already implemented in this repository.

| Connection | What this repository explores | Boundary |
| --- | --- | --- |
| AI as a learning partner | [Course Teaching Assistants](../agents/course-ta.md) grounded in teacher-shaped courses and threshold concepts. | A course TA is not, by itself, a lifelong agent spanning institutions. |
| Evidence of application | Challenges, learner artifacts, and [evidence-aware assessment](../memory/evidence-model.md). | Saved artifacts and software checks do not establish a complete portfolio-assessment or credentialing system. |
| Memory over time | A [Memory Store and custom learner-memory structure](../memory/README.md), with separate recall and evidence/state responsibilities. | Course-scoped memory is not automatically a portable lifelong portfolio. |
| Faculty as guides | Teacher-reviewed course material, curriculum, and evidence policies. | Generated material does not replace disciplinary review or demonstrate faculty transformation. |
| Lumens and institutional Orbits | Architectural context for reading the broader essay alongside the [research architecture](../architecture.md). | These terms are not asserted to be implemented application objects or an interoperable institutional network. |

The remaining sections describe Agentic Shiksha's local interpretation, not a
replacement for the author's framework. See [research and evaluation](../evaluation.md)
for the distinction between a design motivation and an educational result.

## Educational intent
The active [identity module][identity] expands EKALAIVA as *Education,
Knowledge-skills Acquisition, and Livelihoods in the Age of AI: Vision and
Aspirations*. Its course-level aim is a change in learners' understanding, not
simply delivery of explanations or completion of a syllabus.

The tutor is intended to facilitate reasoning: let learners choose a direction,
work through a meaningful problem, articulate a principle, and demonstrate its
use. Mastery-oriented progression is an aspiration, not a competitive ranking.

The prompt asks for playful exploration without points, badges, or leaderboards.

Portfolio and credentialing language in the vision is not proof of a complete
portfolio or credentialing service.

<a id="six-ekalaiva-pillars"></a>

## Pedagogical ideas in this implementation
The six cards below are **this repository's teaching guide, not the framework's
six pillars**. The active prompt constitution has five commitments:

**Transform, Agency, Ludic, Contextualize, and Proof**. The cards instead group
pedagogical ideas present in the [identity][identity] and [pedagogical][pedagogy]
modules. They do not redefine the framework, its pillar numbering, or the acronym.

[![Six local teaching ideas: threshold concepts, concept inventories, contextualization, ludic design, contextual challenges, and grand challenges. Not the six pillars of the Ekalaiva framework.](../../assets/images/research/07-ekalaiva-pillars.svg)](../../assets/images/research/07-ekalaiva-pillars.svg)

### Threshold concepts
Target a change in how a learner understands a discipline, not just another
completed topic. The tutor elicits reasoning around one transformative idea and
supports the uncertainty of crossing it; a claimed insight is not by itself a
verified crossing.

### Concept inventories
Probe understanding through questions whose distractors reflect specific
misconceptions. Generated questions are candidate practice resources; only
reviewed, appropriately mapped evidence can contribute to the graph policy's
crossing decision. A correct choice alone is not proof of understanding.

### Contextualization
Begin with a genuine situation from the learner's world, let a method emerge
from their reasoning, then recover the underlying principle. Personalize the
framing, not the intellectual standard: an attractive story cannot replace the
concept or the test of transfer.

### Ludic design
Invite voluntary play through puzzles, predictions, exploration, and attempts to
break an idea. The challenge should be worth pursuing in its own right. The
prompts distinguish this from points, badges, streaks, or competitive grading;

enjoyment is not an assessment result.

### Contextual challenges
Give the learner a meaningful problem to solve, modify, and eventually frame
anew. Elicit one commitment at a time, use a counterexample only for a
misconception actually expressed, and close with transfer and reflection.

A finished artifact is not automatically qualifying diagnostic evidence.

### Grand challenges
Connect concepts through multidisciplinary problems rooted in a campus,
neighbourhood, or community. Break an open-ended goal into concept-linked
milestones while retaining learner choice. The prompt's portfolio intent does
not establish a complete credentialing system or demonstrated real-world impact.

Across all six, the tutor facilitates rather than simply supplies answers.

Learner memory can help choose the next probe; [See it think](../memory/see-it-think.md)
illustrates that evidence-to-teaching connection without presenting a model's
private reasoning or claiming educational efficacy.

## The pedagogical building blocks
| Element | Intended use | Important boundary |
| --- | --- | --- |
| Threshold concept | An idea that reorganizes how a learner thinks within a discipline. | Not every topic, technique, or implementation detail is a threshold. |
| Troublesome knowledge and liminality | Recognize confusion, imitation, and changing explanations while understanding develops. | Do not diagnose a learner's ability or failure from missing evidence. |
| Misconception | A specific incorrect mental model, elicited through the learner's reasoning. | A generated misconception bank is a candidate resource, not a validated diagnosis. |
| Contextualization | Begin with a recognizable situation, then recover the underlying invariant. | Change the setting, not the intellectual standard. |
| Ludic design | Use voluntary prediction, exploration, and challenges. | Engagement or enjoyment alone does not establish learning. |
| Concept inventory | Use carefully targeted checks and plausible distractors to probe understanding. | A correct choice alone need not demonstrate explanation, independence, or transfer. |
| Transfer | Ask the learner to use the principle in a changed setting or constraint. | Repeating a worked solution is not an independent transfer demonstration. |

The [pedagogical module][pedagogy] names the traditional threshold properties:

transformative, integrative, irreversible, bounded, and troublesome.

"Irreversible" describes the educational concept, not an immutable software
verdict; recorded state may change when new or stale evidence warrants it.

## Intended teaching cycle
1. **Choose a target.** Retrieve the actual course map and recorded learner
   context; do not invent a syllabus or prior progress.

2. **Elicit reasoning.** Offer a contextual problem and ask for one prediction
   or commitment at a time. Avoid supplying the mechanism inside the question.

3. **Expose a contradiction.** Vary scale, constraints, or a boundary case.

   Respond to the misconception the learner actually expressed rather than
   announcing the entire misconception bank.

4. **Support reconstruction.** Give limited hints after a genuine attempt.

   Let the learner develop the method and eventually name the formal idea.

5. **Probe independently.** Use an appropriate inventory and a changed-context
   task. Generated practice remains distinct from approved diagnostic evidence.

6. **Consult state and continue.** Respond to unresolved evidence gaps.

   Do not replace a committed verdict with the tutor's confidence or praise.

Learning mode is the default. The prompts allow explicit Exam mode for
preparation, revision, and practice, while pending graded work remains guided
rather than solved on the learner's behalf. [Safety instructions][safety] and
academic-integrity expectations still apply.

## Three different meanings of progress
| Layer | Current meaning | What must not be inferred |
| --- | --- | --- |
| Prompt language | The tutor is asked to discuss thresholds and evidence, sometimes with `not-entered`, `liminal`, and `crossed` wording. | These words are not themselves a persisted state transition. |
| Legacy learning state | Topics and concepts use `not_started`, `in_progress`, and `learned`; tools can record summaries and addressed misconceptions. | Legacy `learned` is **not** verified graph `CROSSED`. |
| Opt-in graph-memory path | Current prompts and tools support reading committed, scoped state and rejecting model-authored crossing updates in authoritative mode. | Do not assume the mode is enabled, published, fresh, or operational merely because its code exists. |

In the legacy [progress writer][state], a topic can become `learned` while its
matching threshold concept stays `in_progress`. The concept-level guard checks
whether the addressed-misconception list is nonempty; it is not a requirement
that every misconception was cleared by independent, fresh assessment evidence.

The legacy [progress tool][progress] also formats crossing language from the
topic-level result. Treat that wording and its runtime acknowledgement as
non-authoritative. The legacy [inference fallback][inference] can mark named
untouched topics `in_progress` from a teaching turn; it never infers `learned`.

This is an engagement signal, not competence measurement.

The supplied graph-memory design is a **proposal**, not blanket implementation
evidence. Its verified-crossing intent requires approved requirements,
independent misconception evidence, required transfer, and valid version/freshness
context. Current source includes opt-in integration beyond the old legacy path.

[Settings][memory-settings] disable graph memory and its worker by default;

the [course TA runtime guide](../agents/course-ta.md) describes the existing
conditional worker and registered routes. Older scaffold-only summaries are not
the implementation baseline for this guide.

Consult the [memory overview](../memory/overview.md) for what is implemented,
enabled, authoritative, and still limited; do not infer those details from this
pedagogical summary.

## Where intent meets implementation
- [Prompt composition][unifier] loads five core modules: identity, pedagogy,
  course grounding, tool handling, and safety, then combines course-specific
  configuration with them. Prompt updates are behavior changes, not just prose.

- [Threshold research][research] proposes course concepts, misconceptions, and
  example questions. [Curriculum research](../agents/curriculum-research.md)
  documents the actual named research calls;

  [course creation](../agents/course-creation.md) documents the CACA specification
  request and provisioning of the course TA.

- [Tool guidance][tools] asks for course retrieval and progress lookup.

  [Grounding guidance][grounding] prioritizes course materials and distinguishes
  retrieved content from generated material. These instructions do not guarantee
  source quality, complete retrieval, or model compliance.

- The shared pedagogical module still contains an AlgoAscent/CLRS reference
  atlas. It is not every course's generated curriculum and is not an approved
  prerequisite graph. Its ordering language must not override the explicit
  published-prerequisite rule in the active teaching instructions.

- [Quiz creation][quiz] has separate legacy and memory-context paths.

  First-attempt retention and curriculum-label matching are useful engineering
  contracts, but neither validates an instrument's educational quality.

## Human review and evaluation
Before using generated resources as diagnostic evidence, a course expert should:

1. Confirm genuine thresholds, coverage, and explicit prerequisite relationships.

2. Check each misconception against disciplinary evidence and learner language.

3. Review distractors, answer keys, rubrics, and question-to-target mappings.

4. Identify independent probe families and realistic transfer requirements.

5. Check localization, accessibility, ambiguity, and accidental answer cues.

6. Use the documented review/publication workflow for authoritative policies;

   curriculum-generation completion is not approval.

During teaching, inspect disputed interpretations and contradictory evidence.

Keep "not assessed" and "insufficient evidence" distinct from demonstrated
difficulty. Avoid announcing private diagnostic mappings or using uncertainty as
a label on the learner.

[Evaluation](../evaluation.md) separates software regressions from educational
validation. Relevant existing tests include [inventory mapping][mapping-tests],

[first-attempt retention][attempt-tests], and [progress inference][progress-tests].

They do not establish durable understanding, transfer, fairness, or comparative
learning gains. See the [course TA guide](../agents/course-ta.md) for
execution boundaries and [architecture](../architecture.md) for system ownership.

<a id="references-manohars-blog-series"></a>

## References: Ekalaiva blog series

These are [swamimanohar – Medium](https://medium.com/@swamimanohar_73269) blog
essays on the framework and vision, not peer-reviewed Agentic Shiksha outcome
studies. Titles, publication dates, and pillar associations follow the supplied
reading list. Direct Medium retrieval was unavailable during this update, so the
descriptions above stay within those supplied topics rather than quoting or
reconstructing inaccessible article text.

1. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Project Ekalaiva: The Six Pillars of Educational Transformation**][ekalaiva-overview].

   **Medium**, December 11, 2025. Framework overview.

2. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Flipped-by-AI Pedagogy: When AI Becomes the Learning Partner**][ekalaiva-flipped].

   **Medium**, December 12, 2025. Pillar 1.

3. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Grand Challenge-Driven Unified Pedagogy: Learning Through Problems That Matter**][ekalaiva-challenges].

   **Medium**, December 13, 2025. Pillar 2.

4. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Portfolio-Based Assessment: From Proof of Reproduction to Proof of Application**][ekalaiva-portfolios].

   **Medium**, December 17, 2025. Pillar 3.

5. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Ekalaiva's Fifth Pillar: Lifelong Learning AND Lifelong Earning**][ekalaiva-lifelong].

   **Medium**, January 11, 2026. Pillar 5.

6. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Faculty Transformation: From Gatekeepers to Guides in the AI Age**][ekalaiva-faculty].

   **Medium**, December 31, 2025. Pillar 6.

7. [swamimanohar – Medium](https://medium.com/@swamimanohar_73269).
   [**Building an Agentic Internet for Educational Transformation: The Ekalaiva Vision**][ekalaiva-agentic-internet].

   **Medium**, February 15, 2026. Broader agentic architecture and educational vision.

[ekalaiva-overview]: https://medium.com/@swamimanohar_73269/project-ekalaiva-the-six-pillars-of-educational-transformation-9e7c022b2964

[ekalaiva-flipped]: https://medium.com/@swamimanohar_73269/flipped-by-ai-pedagogy-when-ai-becomes-the-learning-partner-a6fefe8d4060

[ekalaiva-challenges]: https://medium.com/@swamimanohar_73269/grand-challenge-driven-unified-pedagogy-learning-through-problems-that-matter-5362616101b7

[ekalaiva-portfolios]: https://medium.com/@swamimanohar_73269/portfolio-based-assessment-from-proof-of-reproduction-to-proof-of-application-9d1125b3ef55

[ekalaiva-lifelong]: https://medium.com/@swamimanohar_73269/ekalaivas-fifth-pillar-breaking-the-linear-prison-of-education-lifelong-learning-and-lifelong-38df2bb8cbec

[ekalaiva-faculty]: https://medium.com/@swamimanohar_73269/faculty-transformation-from-gatekeepers-to-guides-in-the-ai-age-10761c31249a

[ekalaiva-agentic-internet]: https://medium.com/@swamimanohar_73269/building-an-agentic-internet-for-educational-transformation-the-ekalaiva-vision-25638f411f10

[identity]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/agent_behavior.md>

[pedagogy]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/pedagogical_framework.md>

[safety]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/safety_guardrails.md>

[state]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/cosmos_db.py>

[progress]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/update_topic_progress/__init__.py>

[inference]: <../../Agentic Shiksha Platform/Backend/azure_services/persistence/progress_inference.py>

[unifier]: <../../Agentic Shiksha Platform/Backend/utils/prompt_unifier.py>

[research]: <../../Agentic Shiksha Platform/Backend/prompt_store/research_agents/threshold_concept_research_agent.md>

[tools]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/tool_handling.md>

[grounding]: <../../Agentic Shiksha Platform/Backend/prompt_store/core_agent_prompts/knowledge_grounding.md>

[quiz]: <../../Agentic Shiksha Platform/Backend/agent_tools/custom/add_quiz/__init__.py>

[mapping-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_concept_inventory_mapping.py>

[attempt-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_quiz_first_attempts.py>

[progress-tests]: <../../Agentic Shiksha Platform/Backend/tests/test_progress_inference.py>

[memory-settings]: <../../Agentic Shiksha Platform/Backend/learner_memory/settings.py>
