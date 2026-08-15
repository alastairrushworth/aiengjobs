"""
Score an existing checkpoint against a given label set, on the same held-out split
train_encoder.py uses.

The point of this is that ml/model/eval.json is not a valid baseline for a model
trained on relabelled data: it was measured against the labels as they stood in
August, and the v4/v4.1 audit moved 294 of them. Comparing a new F1 against that
number would credit the new model for a change in the ground truth.

So we measure the production checkpoint three ways:

  1. vs the labels it was trained on  -> should reproduce eval.json (sanity check)
  2. vs the corrected labels          -> the real baseline for the retrain
  3. the delta between them            -> what the relabel exposed

Usage:
  python ml/eval_against.py --model ml/model --labels ml/gold/labels.jsonl --ads ml/ads
  python ml/eval_against.py --model ml/model --labels /tmp/labels-aug.jsonl --ads ml/ads
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader
from transformers import (AutoModelForSequenceClassification, AutoTokenizer,
                          DataCollatorWithPadding)

from train_encoder import (MAX_TOKENS, PAD_MULTIPLE, Ads, grouped_split, load,
                           metrics, reweighted)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--ads", type=Path, required=True)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--device", default=None, help="cpu / mps / cuda; default auto")
    ap.add_argument("--threshold", type=float, default=None,
                    help="score at this threshold as well as at best-F1")
    args = ap.parse_args()

    rows = load(args.labels, args.ads)
    train, test = grouped_split(rows)
    print(f"rows {len(rows)}  test {len(test)}  test positives {sum(r['y'] for r in test)}")

    dev = args.device or ("cuda" if torch.cuda.is_available()
                          else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"device {dev}  model {args.model}")
    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model).to(dev).eval()
    collate = DataCollatorWithPadding(tok, return_tensors="pt", pad_to_multiple_of=PAD_MULTIPLE)

    probs, ys, ids = [], [], [r["id"] for r in test]
    with torch.no_grad():
        for i, b in enumerate(DataLoader(Ads(test, tok), batch_size=args.batch, collate_fn=collate)):
            ys.extend(b["labels"].tolist())
            b = {k: v.to(dev) for k, v in b.items()}
            logits = model(input_ids=b["input_ids"], attention_mask=b["attention_mask"]).logits
            probs.extend(torch.softmax(logits, -1)[:, 1].cpu().tolist())
            if i % 25 == 0:
                print(f"  {i*args.batch}/{len(test)}", flush=True)
    y, p = np.array(ys), np.array(probs)

    best_t = max(np.arange(0.05, 0.96, 0.01), key=lambda t: metrics(y, p, t)["f1"])
    points = [("@0.50", 0.5), (f"@{best_t:.2f} (best F1)", float(best_t))]
    if args.threshold is not None:
        points.insert(0, (f"@{args.threshold:.2f} (shipped)", args.threshold))
    for name, thr in points:
        m = reweighted(y, p, thr)
        print(f"\n{name}")
        print(f"  held-out split : P={m['precision']:.1%} R={m['recall']:.1%} F1={m['f1']:.1%}"
              f"  (tp {m['tp']} fp {m['fp']} fn {m['fn']})")
        print(f"  at 13% base    : P={m['precision_at_prod_base_rate']:.1%} R={m['recall']:.1%}")

    out = {"model": str(args.model), "labels": str(args.labels),
           "threshold": float(best_t), **reweighted(y, p, float(best_t)),
           "scores": {i: float(v) for i, v in zip(ids, p)}}
    dest = Path("/tmp") / f"eval-{args.model.name}-vs-{args.labels.name}.json"
    dest.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
