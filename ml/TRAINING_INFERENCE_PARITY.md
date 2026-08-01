# Training/inference parity — read this before changing anything in the pipeline

**A fine-tuned encoder is only valid on inputs shaped the way its training
inputs were shaped.** Every rule below exists because breaking it does not throw,
does not fail a test that was not written for it, and does not show up in the
logs. It silently makes every classification worse, and the board fills with
wrong decisions that look exactly like right ones.

This is not a style guide. It is the correctness contract for the classifier.

## The rule

> Inference must reproduce the training conditions exactly. When they disagree,
> **the training run is authoritative** and inference changes to match — never
> the reverse.

If you want to change the inference side, you are changing the model. That means
retraining, re-exporting, and re-evaluating. There is no version of "just bump
the constant on the serving side and see if it looks fine".

## Why the rule is stated this strongly

It was broken, in exactly the quiet way described above.

`train_encoder.py` trains at `MAX_TOKENS = 3072`, which covers 99.5% of live
adverts whole. Inference shipped with a 1024-token window, sized for a 961MB
droplet that could not hold the quadratic attention mask at 3072. Nothing failed.
Nothing warned. What actually happened:

- **70.2%** of live adverts were truncated, to a mean of **80%** of their text
  (the longest tenth kept only 54%).
- The cut always lands at the end of the advert — often the requirements and
  tech-stack section, which is the signal the classifier most needs.
- It moved real decisions. One sampled advert scored **0.148 truncated against
  0.971 whole** — OUT and IN across the same 0.70 threshold.

The droplet that forced 1024 was deleted months before anyone noticed the window
had outlived it. The constant survived the constraint.

## The parity surfaces

Each of these is a way the served input can diverge from the trained input.

| # | Surface | Training side | Inference side | Guarded by |
|---|---|---|---|---|
| 1 | Token window | `MAX_TOKENS` in `train_encoder.py` | `ENCODER_WINDOW` in `engine/src/config.ts` | `tests/trainInferenceParity.test.ts` |
| 2 | Advert serialisation | the `ml/ads/*.txt` corpus | `serialiseAdvert()` in `engine/src/pipeline/encoder.ts` | `tests/trainInferenceParity.test.ts` |
| 3 | Truncation semantics | HF Python tokenizer | transformers.js + the `[SEP]` repair in `encoder.ts` | see below |
| 4 | Tokenizer | packaged with the checkpoint | `ml/model/tokenizer.json`, loaded with `allowRemoteModels = false` | `scripts/verify-classifier.ts` checksums |
| 5 | Numeric precision | PyTorch fp32 | fp32 ONNX (`ENCODER_FILE`) | `scripts/verify-classifier.ts` sanity cases |

### 1. Token window

`ENCODER_WINDOW` is deliberately **not** environment-overridable. It is one half
of a contract with a committed constant, not a tuning knob. The test parses
`MAX_TOKENS` straight out of the training script, so there is no third copy to
keep in sync, and it fails closed if it cannot find the constant at all.

Changing the window means retraining at the new length.

### 2. Advert serialisation

The header is not decoration:

```
ID: {id}
TITLE: {title}
COMPANY: {company}
LOCATION: {location}

FULL JOB ADVERT (verbatim, untruncated):
{body}
```

It puts the title in front of the body, which is the strongest single feature.
`ml/ads/*.txt` holds the 4,898 files the weights were actually fitted on, and
`train_encoder.py` reads them verbatim (`"text": ad.read_text()`), so the corpus
*is* the specification. The test round-trips real files through
`serialiseAdvert()` and demands byte equality — a hand-written fixture would just
get edited to match whatever the code now does.

Note that `verbatim, untruncated` is a literal part of the trained prompt, not a
claim about what the model receives. It stays even when the advert is truncated,
because it was there during training.

### 3. Truncation semantics

Python's tokenizer truncates the *content* and keeps the closing `[SEP]`.
transformers.js truncates *after* adding special tokens and drops it, leaving a
stray content token in the final slot. The model was trained with `[SEP]` there,
so without the repair in `encoder.ts` every advert over the window scores
off-distribution — measured at up to 0.25 absolute probability drift.

This one has no automated guard because it lives inside the tokenizer's
behaviour. If you change tokenizer library or version, re-verify it by hand.

### 4 & 5. Tokenizer and precision

The weights and tokenizer are fetched from a release asset at run time and
checksummed against the committed `ml/model/manifest.json` before every ingest.

fp32 ships even though int8 is a quarter the size and ~1.6x faster: ONNX Runtime
uses `VPMADDUBSW` for int8 matmuls on x86-64 AVX2/AVX512 without VNNI and that
instruction saturates. The same int8 graph scoring 0.9992 on an ARM Mac scored
**0.6583** on a GitHub runner, collapsing every decision toward 0.5. That is the
canonical example of a parity break that no test caught and no log reported.

## If you are changing the model

1. Change the training side first. It is authoritative.
2. Retrain, re-export to fp32 ONNX, refresh `ml/model/manifest.json`.
3. Update the inference constants to match, and run
   `npx vitest run tests/trainInferenceParity.test.ts`.
4. Run `npx tsx scripts/verify-classifier.ts` — checksums plus sanity cases.
5. Re-evaluate on the held-out split (companies held out, not rows — see
   `train_encoder.py`) and update the numbers in `README.md`.
6. The board still holds classifications made by the *old* model. Re-score it
   with `npm run reclassify -w @aiengjobs/engine` against a database copy, or
   accept that the board is a mix of two models until those adverts change.

## If you are an agent working in this repo

Do not "fix" a parity test by changing the assertion, relaxing the comparison, or
skipping it. The test failing means the classifier is now wrong, not that the
test is now wrong. If a change genuinely requires new training conditions, say so
and stop — retraining is a deliberate, human-approved act, not a step you can
take to make a red test green.
