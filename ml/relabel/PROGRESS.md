# v4 gold relabel — progress

Relabelling all 498 reviewable rows of `ml/gold/gold.jsonl` against rubric v4.

## Why
- `gold.jsonl` was frozen at roughly v1-era judgements: 498 of its 500 rows carry no
  `rubric` field, and it disagrees with `labels.jsonl` on **34 rows** (same advert,
  two different labels, in two files that are supposed to agree).
- 498 of the 500 gold rows are ALSO training rows in `labels.jsonl`, so this pass is
  simultaneously a 498-row slice of the full pre-v3 positive-class audit.
- Note: the held-out P/R figures come from `train_encoder.py`'s grouped split of
  `labels.jsonl`, NOT from gold.jsonl. Gold is the population-reweighted estimator
  (it carries strata + weights), which makes it the right instrument for "what
  fraction of the live board is wrong" — but fixing it alone does not fix the
  held-out metric. That still needs the remaining ~979 pre-v3 IN rows.

## Workflow
    node ml/relabel/make-batches.cjs          # writes ml/batches/v4gold-NN.txt (20 x 25)
    node ml/relabel/show-batch.cjs v4gold-NN  # prints trimmed adverts for review
    node ml/relabel/show-batch.cjs v4gold-NN --full <id>   # one advert untrimmed
    node ml/validate-labels.cjs               # audits evidence quotes verbatim

Labels land in `ml/labels/v4gold-NN.jsonl`. Every row carries `rubric: "v4"` and an
`evidence` quote that must appear verbatim in the advert — that is the check that
the label came from reading rather than from the title.

## Status

| batch | done | flips | notes |
|---|---|---|---|
| v4gold-01 | yes | 1 in->out | Aveva Experienced Software Developer (garnish rule) |
| v4gold-02 | yes | 2 in->out | Thoughtworks Lead DS; Nscale Staff HPC (ML-platform default) |
| v4gold-03..20 | pending | | |

## Carried over unreviewed (no ad text in ml/ads)
- `j_f779d6b3844f1f76` Zoox — System Verification and Validation Engineer [out]
- `j_c4d6d485bde81c09` CaptivateIQ — Senior Engineering Manager [out]

Both keep their existing OUT label and are stamped `rubric: "v4-carried"` in the merge.

## Still to do after the relabel
1. Merge: rewrite `gold.jsonl` with v4 labels, and reconcile the 498 matching
   `labels.jsonl` rows so the two files agree.
2. Re-run `ml/acceptance/run.ts` — expect regressions on cases v4 moved.
3. Then the remaining pre-v3 IN rows in `labels.jsonl` (~979 minus the gold overlap).
