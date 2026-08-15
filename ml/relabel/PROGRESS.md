# v4 gold relabel — done

All 498 reviewable rows of `ml/gold/gold.jsonl` re-read against rubric v4 and
merged back into both `gold.jsonl` and `labels.jsonl`.

## Why this was needed
- `gold.jsonl` was frozen at roughly v1-era judgements: 498 of its 500 rows carried
  no `rubric` field, and it **disagreed with `labels.jsonl` on 34 rows** — the same
  advert, two different labels, in two files that are supposed to agree. Several of
  those disagreements were rules that changed after gold was written (EM of an
  inference team became IN in v2; inference performance engineering in v2.1).
- 498 of the 500 gold rows are also training rows in `labels.jsonl`, so this pass is
  simultaneously a 498-row slice of the wider pre-v3 audit.

## Result

| | before | after |
|---|---|---|
| gold.jsonl IN | 67 | 61 |
| gold.jsonl rows flipped | — | 32 (19 in->out, 13 out->in) |
| labels.jsonl IN | 1,104 | 1,096 |
| labels.jsonl rows touched | — | 498 (22 flipped, 476 confirmed) |
| gold/labels disagreements | 34 | **0** |
| rows flagged `ambiguous` | — | 41 of 498 |

Flipped rows carry `prev_label` so every change is auditable. The 2 rows with no ad
text in `ml/ads` (Zoox V&V Engineer, CaptivateIQ Senior EM — both plainly OUT by
title) keep their label and are stamped `rubric: "v4-carried"`.

### in -> out (19)
Aveva SWE · Thoughtworks Lead DS · Nscale Staff HPC · Faculty DS · CrowdStrike Sr DS ·
Encord Product Eng · Cloudflare MLE · DoorDash MLE Marketplace · Jump Trading ML intern ·
Stripe Agentic Commerce · Cerebras AI Inference Core infra · Cohere Web Data ·
Mastercard Lead AI Eng · Artefact Data Engineer GenAI · Ramp Applied AI Fullstack ·
Reply Senior AI Eng · Airwallex Staff Backend Agentic · Cadence Applied ML Verification ·
Scale AI Infrastructure SWE

### out -> in (13)
Anthropic EM Inference · Cerebras Senior Perf Eng Inference · Klaviyo EM Customer Agent ·
Okta Senior FDE (AI Agents) · PolyAI FDE · OpenAI AI Deployment Engineer Cyber ·
Datadog EM Evaluation & Annotation · Intercom Senior FDE · Anysphere EM Evals ·
Arize AI FDE · PhysicsX FDE · Figma Director Research AI Evals · LangChain EM Evals Platform

The out->in flips are mostly gold catching up with rules that already existed
(EM-of-an-evals/inference-team, the v3 FDE presumption), not v4 loosening anything.

## Acceptance check against the shipped model
`npx tsx ml/acceptance/run.ts` → **42/46**, and 3 of the 4 failures are precisely the
seams v4 targets:

| case | expected | model |
|---|---|---|
| Autodesk — Sr MLOps Developer, Inference, AI/ML Platform | out | **in, p=0.921** |
| Affirm — Engineering Manager, ML Platform | out | **in, p=0.701** |
| Workday — Principal PM, AI Agent Factory | out | **in, p=0.919** |
| FuriosaAI — SWE, Kernel Programming Model | in | **out, p=0.285** |

The first three are the ML-platform default, EM-of-a-business-ML-platform, and AI-PM
cases. The fourth is the known accelerator-software content gap.

## Workflow (reusable)
    node ml/relabel/make-batches.cjs          # ml/batches/v4gold-NN.txt (20 x 25)
    node ml/relabel/show-batch.cjs v4gold-NN  # trimmed adverts for review
    node ml/relabel/show-batch.cjs v4gold-NN --full <id>
    node ml/validate-labels.cjs               # evidence quotes verbatim in the advert
    node ml/relabel/merge.cjs [--write]       # merge into gold.jsonl + labels.jsonl

Every row carries an `evidence` quote that validate-labels.cjs checks appears verbatim
in the advert — the check that the label came from reading rather than from the title.
Median evidence position is 29% into the advert, 86% beyond the first 16%.

## Still to do
1. **The remaining pre-v3 positive class.** `labels.jsonl` still holds ~950 IN rows
   labelled under v1/v2/v2.1 that this pass did not touch. Same method, bigger batch.
2. **Hard negatives for the seams the acceptance test just exposed**: ML platform /
   MLOps with no named workload, EM of a business-ML platform, AI-product PM. Plus
   matched frontier-workload positives so the model does not learn "ML platform => OUT".
3. **Accelerator-software positives** — the FuriosaAI miss is a content gap, not a
   threshold gap.
4. `ml/evaluate.ts` needs `index.jsonl` alongside gold.jsonl to run; it is not in the
   repo, so the population-reweighted estimator cannot currently be recomputed.
