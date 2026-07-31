# ml/ — replacing the classification LLM call

How the in/out classification moved off the OpenAI API and into the engine. See
[RUBRIC.md](RUBRIC.md) for the labelling definition and
[gold/gold.jsonl](gold/gold.jsonl) for the hand-labelled evaluation set.

## Outcome

**Shipped.** `train_encoder.py` fine-tunes ModernBERT-base on the 4,898 labels in
`gold/labels.jsonl`; the result is exported to fp32 ONNX (571MB) and run
in-process by `engine/src/pipeline/encoder.ts`. There is no API key.

Held-out split — whole companies held out, so near-duplicate reposts cannot leak
across it — at the 1024-token production window and the 0.70 operating point:

| | Precision | Recall | Precision @13% base rate |
|---|---|---|---|
| GPT-5.4-nano (what it replaced) | 86.0% | 70.8% | 86.0% |
| **Encoder @0.70, as shipped (Node fp32 ONNX)** | **94.6%** | **86.9%** | **92.0%** |

Better on both axes. The fp32 graph reproduces PyTorch to 1.4e-06 with zero
differing decisions, so the shipped path and the training reference agree.

### Why not int8

An int8 build is 144MB against 571MB and roughly 1.6x faster (1,841ms vs
2,858ms per advert, single-threaded). It is not what ships, because ONNX Runtime
uses `VPMADDUBSW` for int8 matmuls on x86-64 AVX2/AVX512 without VNNI, and that
instruction saturates. The same int8 graph scoring 0.9992 on an ARM Mac scored
**0.6583** on a GitHub runner, collapsing every decision toward 0.5 — a silent,
architecture-dependent accuracy collapse that no amount of local testing on
Apple Silicon could have caught. `reduce_range=True` mitigates it; fp32 removes
it. The 961MB droplet that made quantisation necessary no longer exists, and
runners have 16GB, so there is nothing left to buy with the risk.

Model files are fetched from a release asset at run time and verified against
the committed `ml/model/manifest.json` before every ingest, so a truncated or
swapped download fails the run rather than quietly degrading it.

The threshold was picked off the precision/recall curve rather than by
maximising F1: the curve knees at 0.70, and pushing to 0.87 buys ~1pp of
precision for 13 more missed roles out of 183.

Two things the LLM did that the encoder does not:

- It backfilled `country`, `city`, `remoteType` and `seniority` where the feed
  was silent. Measured on 3,703 live IN jobs, dropping it costs **3.8%** of
  country, **5.3%** of city and **26.2%** of seniority values. `remoteType` is
  unaffected. This was accepted deliberately; `inferSeniority` reads only the
  title, so a body-text parser is the obvious way to claw the 26% back.
- It read salary. That is already covered by `parseSalaryFromDescription`, which
  sits ahead of it in `pay()`'s precedence chain.

## Why this exists

The nightly ingest made at most one GPT-5.4-nano call per new-or-changed
posting. That call returned classification, salary, location and seniority —
but everything except the classification is either overridden by feed data or
(in the case of skills) provably redundant, so the classification decision is
the only part worth replacing with a local model.

## Hardware constraint (historic)

This was designed for a **1 vCPU / 961MB** droplet with no GPU, which is what
ruled out a generative model and drove every sizing decision below. The refresh
now runs on a GitHub Actions runner (4 vCPU / 16GB, free on public repos), so
the memory ceiling no longer binds — but the model stays small because runner
minutes are metered if the repo ever goes private.

Measured footprint at a 1024-token window: the int8 graph peaks at **527MB RSS**
and **1.8s per posting** single-threaded; the fp32 graph that actually ships is
larger and takes **2.9s**. A 3072-token window needs 1.6GB even at int8 (the
eager-attention mask is quadratic in sequence length) and would not have fit the
droplet at all.

## The gold set

`gold/gold.jsonl` — 500 open postings, hand-labelled against RUBRIC.md, ignoring
the labels GPT-5.4-nano previously assigned. Fields: `label` (in/out),
`confidence` (high/med/low), `reason`, plus the sampling `stratum`, the previous
live decision (`prev_cls`, `prev_conf`) and the excerpt that was labelled.

Sampling was stratified to over-represent the regions where the current system
can be wrong, with diversity caps (max 8 per company, 12 per title family, 1 per
company×title-family pair) so Anduril and Sopra Steria could not dominate.
`gold/strata.json` records pool and draw sizes; weights recover population
estimates. 230 companies, 350 title families, 68 in-scope / 432 out.

Annotator confidence: 391 high, 64 med, 45 low. Report metrics with and without
the low bucket — those are the rows where the posting is boilerplate or the call
is genuinely arguable.

## What the gold set showed

Scoring the live system (`npx tsx ml/evaluate.ts`, kept in scratch):

| | Precision | Recall | F1 |
|---|---|---|---|
| Sample, unweighted | 71.9% | 67.6% | 69.7% |
| Excluding low-confidence rows | 81.3% | 86.7% | 83.9% |
| Reweighted to the 42,249-posting population | 86.0% | 70.8% | 77.7% |

Three findings:

1. **The aggressive regex pre-filter is safe.** Across 162 sampled postings from
   the `heur_out` and `offtopic_out` strata — 13,472 postings that never reach
   the LLM — there were **zero** false negatives. Nothing in scope is being
   silently discarded before the model sees it. A classifier only needs to run
   on the remaining 28,777 postings.
2. **Precision leaks through two title shapes.** 12 of 18 false positives are
   forward-deployed / solutions-architect roles, and 4 are manager/director
   roles; `IN_TITLE_PATTERNS` pins them IN at 0.85 and the veto does not fire.
   Of 56 manager/director titles in the gold set, **none** are in scope.
3. **Recall is lost at the confidence floor and to the veto.** 12 false
   negatives sit in the ambiguous band at 0.55–0.83, and 8 are heuristic-IN
   titles the LLM vetoed — including Cerebras' kernel engineer and H Company's
   training-infrastructure role.

## Baseline results

`npx tsx ml/baseline.ts <train-raw.jsonl> <gold.jsonl>` — TF-IDF (title and body
in separate namespaces, uni+bigrams, 60k features) plus AdaGrad logistic
regression, all in TypeScript.

| Model | Precision | Recall | F1 |
|---|---|---|---|
| Live system (teacher) | 71.9% | 67.6% | 69.7% |
| Distilled from nano labels, @0.55 | 69.4% | 73.5% | 71.4% |
| Trained on gold labels only, 5-fold CV | 57.1% | 64.7% | 60.7% |

The distilled student reaches parity with the teacher it copied — slightly
better recall, slightly worse precision — at zero API cost, and agrees with the
teacher on 92.3% of gold rows. But it also inherited the teacher's mistake:
`t:forward_deployed` is one of its strongest IN features. Distillation
reproduces the bias, it does not fix it.

Training on the 500 gold labels alone is clearly under-powered — 68 positives
against a 60k-feature space. More gold labels, or a pretrained encoder that
brings its own language understanding, is the way past this.

The feature list also exposes junk the excerpting let through: Databricks
requisition IDs (`b:csq227r88`) are being learned as IN-signals. Worth stripping
before any real training run.

## The cheapest win is not machine learning

Two regex additions to `OUT_TITLE_PATTERNS`, tested against the gold set:

| Change | Precision | Recall | F1 |
|---|---|---|---|
| Live system | 71.9% | 67.6% | 69.7% |
| Drop forward-deployed / solutions titles | 87.8% | 63.2% | 73.5% |
| Drop manager / director / head-of titles | 76.7% | 67.6% | 71.9% |
| Both | **93.5%** | 63.2% | 75.4% |

Precision goes from 71.9% to 93.5% for the cost of 4.4pp recall — and all three
lost postings are rows labelled *low* confidence. Not applied: dropping
forward-deployed roles removes real listings from the board, which is a product
call rather than a bug fix.

## Files

- `RUBRIC.md` — the labelling definition, including how judgement calls were resolved
- `gold/gold.jsonl` — 500 hand-labelled postings
- `gold/strata.json` — sampling pool/draw sizes for population reweighting
- `baseline.ts` — TF-IDF + logistic regression, both experiments
