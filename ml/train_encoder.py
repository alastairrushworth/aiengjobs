"""
Fine-tune a small encoder to make the in/out classification call, replacing the
per-posting GPT-5.4-nano call.

Design constraints that drive every choice here:

* The droplet is 1 vCPU / 961MB RAM, no GPU. That rules out a generative model and
  points at an encoder small enough to run under ONNX Runtime inside the existing
  Node engine. ~150M params quantised sits comfortably in the budget.
* Adverts are long — measured at median 1,288 tokens, p99 2,916, max 5,783. A 512-token
  window would cut the requirements section, the exact mistake that produced the first,
  bad version of this dataset. ModernBERT handles 8192 natively; 3072 covers 99.2% of
  adverts whole and keeps attention memory tractable.
* The label set is skewed by construction (21% positive vs ~13% in production),
  because sampling oversampled AI-titled roles to get enough positives. Every
  metric is therefore reported twice: on the held-out split as-is, and reweighted
  to the production base rate. The second number is the one that predicts the board.

Split policy: grouped by company. A random split would put two of Palantir's four
near-identical "Forward Deployed Engineer" adverts on either side and report
memorisation as generalisation. Title families are deliberately allowed to span the
split — see grouped_split for why holding out both is impossible on this corpus.

Usage:
  python ml/train_encoder.py --labels ml/gold/labels.jsonl --ads <ads-dir> [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset
from transformers import (AutoModelForSequenceClassification, AutoTokenizer,
                          DataCollatorWithPadding)

MODEL = "answerdotai/ModernBERT-base"   # 8192-token window, 149M params
MAX_TOKENS = 3072                        # measured: covers 99.2% of adverts whole
PAD_MULTIPLE = 512                       # see the collator note in main()
PROD_POSITIVE_RATE = 0.13                # measured on the 42,249 open postings
SEED = 20260730


# --- data ------------------------------------------------------------------

def title_family(title: str) -> str:
    """Collapse seniority and location noise so near-duplicate postings group together."""
    t = title.lower()
    t = re.sub(r"\(.*?\)|\[.*?\]", " ", t)
    t = re.split(r"[,\-–—|/]", t)[0]
    t = re.sub(
        r"\b(senior|sr|staff|principal|lead|junior|jr|intern|graduate|associate|"
        r"head of|director|vp|chief|i{1,3}|iv|v|\d+)\b", " ", t)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", t)).strip()


def load(labels_path: Path, ads_dir: Path):
    rows = []
    for line in labels_path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        ad = ads_dir / f"{r['id']}.txt"
        if not ad.exists():
            continue
        rows.append({
            "id": r["id"],
            "text": ad.read_text(),
            "y": 1 if r["label"] == "in" else 0,
            "company": r.get("company", "?"),
            "family": title_family(r.get("title", "")),
            "ambiguous": bool(r.get("ambiguous")),
        })
    return rows


def grouped_split(rows, frac=0.2):
    """
    Hold out whole COMPANIES.

    Two earlier attempts failed and the reasons are worth recording:

    1. Selecting companies and families independently leaks — a posting reaches test
       via its title family while its employer stays in train, so both sides end up
       sharing companies (measured: 214 of 452).
    2. Holding out connected components of the company–family graph is airtight but
       useless here: that graph is essentially one component (companies post many
       families, families recur across many companies), so the largest holdout you can
       take is 87 rows with 12 positives.

    Company-only grouping is the right trade. The leakage that actually matters is
    near-duplicate reposts — Palantir has four near-identical forward-deployed adverts
    — and those share an employer. A "Forward Deployed Engineer" at Databricks in train
    and at Palantir in test is genuine generalisation, which is what production faces.
    """
    rng = random.Random(SEED)
    companies = sorted({r["company"] for r in rows})
    rng.shuffle(companies)
    test_co, n = set(), 0
    target = int(len(rows) * frac)
    by_co = defaultdict(int)
    for r in rows:
        by_co[r["company"]] += 1
    for c in companies:
        if n >= target:
            break
        test_co.add(c)
        n += by_co[c]
    train = [r for r in rows if r["company"] not in test_co]
    test = [r for r in rows if r["company"] in test_co]
    return train, test


class Ads(Dataset):
    def __init__(self, rows, tok):
        self.rows, self.tok = rows, tok

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        r = self.rows[i]
        enc = self.tok(r["text"], truncation=True, max_length=MAX_TOKENS)
        return {**enc, "labels": r["y"]}


# --- metrics ---------------------------------------------------------------

def metrics(y, p, thr):
    pred = (p >= thr).astype(int)
    tp = int(((pred == 1) & (y == 1)).sum())
    fp = int(((pred == 1) & (y == 0)).sum())
    fn = int(((pred == 0) & (y == 1)).sum())
    tn = int(((pred == 0) & (y == 0)).sum())
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": prec, "recall": rec,
            "f1": f1, "accuracy": (tp + tn) / max(len(y), 1)}


def reweighted(y, p, thr, target=PROD_POSITIVE_RATE):
    """
    Recompute precision at the production base rate. Recall is unaffected by class
    balance; precision is not, and on a set that is ~30% positive it reads high.
    """
    m = metrics(y, p, thr)
    tpr = m["recall"]
    fpr = m["fp"] / max(m["fp"] + m["tn"], 1)
    w_pos, w_neg = target, 1 - target
    denom = tpr * w_pos + fpr * w_neg
    return {**m, "precision_at_prod_base_rate": (tpr * w_pos / denom) if denom else 0.0,
            "fpr": fpr}


# --- main ------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", type=Path, required=True)
    ap.add_argument("--ads", type=Path, required=True)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--out", type=Path, default=Path("ml/model"))
    ap.add_argument("--dry-run", action="store_true", help="report the split and exit")
    args = ap.parse_args()

    torch.manual_seed(SEED)
    rows = load(args.labels, args.ads)
    train, test = grouped_split(rows)
    pos = sum(r["y"] for r in rows)
    print(f"rows {len(rows)}  positive {pos} ({100*pos/len(rows):.0f}%)")
    print(f"train {len(train)}  test {len(test)}")
    print(f"  test positives {sum(r['y'] for r in test)}"
          f"  test contested {sum(r['ambiguous'] for r in test)}")
    leak_co = {r["company"] for r in train} & {r["company"] for r in test}
    leak_fam = {r["family"] for r in train} & {r["family"] for r in test}
    print(f"  company overlap {len(leak_co)} (must be 0)   "
          f"family overlap {len(leak_fam)} (expected, see grouped_split)")
    if args.dry_run:
        return

    dev = ("cuda" if torch.cuda.is_available()
           else "mps" if torch.backends.mps.is_available() else "cpu")
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL, num_labels=2).to(dev)

    # class weighting so the majority class does not swamp the loss
    w = torch.tensor([1.0, (len(rows) - pos) / max(pos, 1)], device=dev, dtype=torch.float)
    lossf = torch.nn.CrossEntropyLoss(weight=w)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr)
    # Pad to a multiple of 512 rather than to each batch's exact max. Purely dynamic
    # padding gives every batch a distinct sequence length, so MPS allocates a fresh
    # buffer shape each step and reuses nothing — that fragmentation, not the model,
    # is what exhausted 40GB on the first attempt. Bucketing caps it at six shapes.
    collate = DataCollatorWithPadding(tok, return_tensors="pt", pad_to_multiple_of=PAD_MULTIPLE)
    model.gradient_checkpointing_enable()
    dl = DataLoader(Ads(train, tok), batch_size=args.batch, shuffle=True, collate_fn=collate)

    for ep in range(args.epochs):
        model.train()
        total = 0.0
        for i, b in enumerate(dl):
            b = {k: v.to(dev) for k, v in b.items()}
            out = model(input_ids=b["input_ids"], attention_mask=b["attention_mask"])
            loss = lossf(out.logits, b["labels"])
            loss.backward()
            opt.step()
            opt.zero_grad()
            total += loss.item()
            if i % 100 == 0 and dev == "mps":
                torch.mps.empty_cache()
            if i % 50 == 0:
                print(f"  epoch {ep+1} step {i}/{len(dl)} loss {total/(i+1):.4f}", flush=True)
        print(f"epoch {ep+1} mean loss {total/len(dl):.4f}")

    model.eval()
    probs, ys = [], []
    with torch.no_grad():
        for b in DataLoader(Ads(test, tok), batch_size=args.batch, collate_fn=collate):
            ys.extend(b["labels"].tolist())
            b = {k: v.to(dev) for k, v in b.items()}
            logits = model(input_ids=b["input_ids"], attention_mask=b["attention_mask"]).logits
            probs.extend(torch.softmax(logits, -1)[:, 1].cpu().tolist())
    y, p = np.array(ys), np.array(probs)

    best = max(((t, metrics(y, p, t)["f1"]) for t in np.arange(0.05, 0.96, 0.01)),
               key=lambda x: x[1])
    for name, thr in (("@0.50", 0.5), (f"@{best[0]:.2f} (best F1)", best[0])):
        m = reweighted(y, p, thr)
        print(f"\n{name}")
        print(f"  held-out split : P={m['precision']:.1%} R={m['recall']:.1%} F1={m['f1']:.1%}")
        print(f"  at 13% base    : P={m['precision_at_prod_base_rate']:.1%} R={m['recall']:.1%}")

    args.out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    (args.out / "eval.json").write_text(json.dumps(
        {"threshold": float(best[0]), **reweighted(y, p, best[0])}, indent=2))
    print(f"\nsaved to {args.out}")


if __name__ == "__main__":
    main()
