# Gold-set labelling rubric

The definition of IN/OUT used to hand-label `gold/labels.jsonl`. Written from
first principles for a **strict AI-engineering job board**, deliberately without
reference to the labels GPT-5.4-nano previously assigned — those are known to
contain mistakes and are what the gold set exists to measure.

## The core test

> Is the primary, day-to-day work of this role **building, training, evaluating,
> serving, or researching AI/ML models and systems**, as a hands-on individual
> contributor?

Both halves must hold. "Hands-on IC" excludes people-managers; "AI/ML models and
systems" excludes generic software that merely lives near AI.

## IN

- **LLM application engineering** — RAG/retrieval, agents, tool use, prompting
  and context systems, LLM-powered product features built by this role.
- **Model development** — training, fine-tuning, distillation, architecture work
  across any modality (NLP, CV, speech, multimodal, robotics learning).
- **AI/ML research** — research scientist and research engineer, including
  applied research. Alignment and safety research counts.
- **Evaluation and model quality** — evals, benchmarking, red-teaming, LLM-as-judge
  systems, when built by the role rather than consumed.
- **Inference and serving** — model deployment, serving infrastructure, inference
  optimisation, quantisation, GPU/accelerator kernel and runtime work.
- **ML platform / MLOps** — where the artefact being built is explicitly the
  training or serving of models (feature stores, training orchestration,
  experiment infra), not general data plumbing.

## OUT

- **Non-IC leadership** — manager, director, head of, VP, chief, unless the
  posting makes clear the work is majority hands-on model building.
- **Analytics** — data analyst, BI, analytics engineer, and data scientists whose
  work is reporting, dashboards, experimentation or statistical analysis rather
  than building models that ship.
- **Generic software engineering** — backend, frontend, full-stack, platform,
  infra, security, SRE, QA, embedded — *even at an AI company*, and even when the
  posting adds a token "experience with AI is a plus".
- **Model consumers** — roles that integrate or call a model owned by another
  team, without themselves training, fine-tuning, evaluating, serving or building
  the LLM/agent system. (Building a RAG or agent system on a third-party API is
  IN; wiring an existing internal scoring model into a service is OUT.)
- **Data engineering** — pipelines, warehouses, ETL, streaming, unless the role
  centres on training/serving data for models.
- **Non-engineering AI-adjacent** — AI trainers, data annotators, RLHF raters,
  prompt writers with no engineering scope, AI-tool-using content roles.
- **Everything commercial and operational** — sales, marketing, PM, TPM,
  recruiting, finance, legal, support, design, ops.
- **Hardware** — chip design, EE, mechanical, unless the role is accelerator
  *software* (kernels, compilers, runtimes) for ML workloads.
- **Non-specific postings** — open/spontaneous applications, talent pools,
  rotation and graduate programmes without a concrete engineering role.
- **Quantitative finance** — quant researcher/trader, unless the posting is
  explicitly ML/DL model research rather than statistical trading strategy.

## Judgement calls, resolved consistently

| Case | Call | Why |
|---|---|---|
| Research Engineer at an AI lab | IN | Research engineers build and train models |
| Forward-Deployed Engineer at an AI company | IN only if building AI systems for customers, OUT if integration/consulting delivery | The work, not the employer |
| "AI Engineer" at a non-AI company | IN if the posting describes building LLM/agent systems | Title alone is not evidence |
| Software Engineer, ML Platform | IN | Artefact is model training/serving |
| Software Engineer, Payments at an AI lab | OUT | Generic SWE near AI |
| Data Scientist, Personalisation building ranking models | IN | Ships models |
| Data Scientist, Product Analytics | OUT | Analysis, not model building |
| Solutions/Sales Engineer at an AI company | OUT | Commercial, pre-sales |
| Engineering Manager, ML (hands-on not stated) | OUT | Non-IC by default |
| PhD internship in ML research | IN | Hands-on research |
| Prompt Engineer with engineering scope (evals, pipelines) | IN | Builds systems |
| Content/annotation "AI Trainer" | OUT | Not engineering |

## Annotator confidence

Every row carries `confidence`:

- **high** — the excerpt makes the call obvious.
- **med** — the call follows the rubric but the posting is thin or mixed.
- **low** — genuinely ambiguous, or the excerpt is pure boilerplate with no role
  detail. Report metrics with and without these; they are the rows where any
  classifier, human or model, is guessing.

`reason` records the deciding evidence in a few words, so a disagreement can be
traced to either a rubric gap or a labelling slip.
