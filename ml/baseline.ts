import { readFileSync } from "node:fs";
/**
 * TF-IDF + logistic-regression baseline for the in/out classification.
 *
 * Deliberately plain: hashless bag of n-grams, sublinear TF, L2-normalised
 * vectors, and a logistic regression trained with AdaGrad. Everything is pure
 * TypeScript so a trained model is a JSON blob the existing Node engine can
 * score in microseconds — no Python runtime on a 961MB droplet.
 *
 * Two experiments, because they answer different questions:
 *   distil  — train on GPT-5.4-nano's labels, score against the gold set.
 *             "Can a local model reproduce what we already pay for?"
 *   gold    — 5-fold CV training on the hand labels alone.
 *             "Can a linear model learn the real target from 500 examples?"
 *
 * Run: npx tsx ml/baseline.ts <path-to-train-raw.jsonl> <path-to-gold.jsonl>
 */

interface Doc {
  id: string;
  title: string;
  excerpt: string;
}

// --- features -------------------------------------------------------------

const STOP = new Set(
  ("the a an and or of to in for with on at by as is are be we you your our this that will from" +
    " have has can who all their its it they them if not but so such more most other than then").split(/\s+/),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./ -]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && t.length < 30 && !STOP.has(t));
}

/**
 * Title and body live in separate feature namespaces: "senior engineer" in the
 * title is a much stronger signal than the same phrase buried in boilerplate.
 * Bigrams matter here — "data scientist", "forward deployed", "account
 * executive" and "machine learning" are the discriminative units, not "data".
 */
function features(d: Doc): string[] {
  const out: string[] = [];
  for (const [ns, text] of [
    ["t", d.title],
    ["b", d.excerpt],
  ] as const) {
    const ts = tokens(text);
    for (const t of ts) out.push(`${ns}:${t}`);
    for (let i = 0; i + 1 < ts.length; i++) out.push(`${ns}:${ts[i]}_${ts[i + 1]}`);
  }
  return out;
}

interface Vectoriser {
  vocab: Map<string, number>;
  idf: Float64Array;
}

function fit(docs: Doc[], minDf: number, maxFeatures: number): Vectoriser {
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const f of new Set(features(d))) df.set(f, (df.get(f) ?? 0) + 1);
  }
  const kept = [...df.entries()]
    .filter(([, n]) => n >= minDf)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFeatures);
  const vocab = new Map<string, number>();
  const idf = new Float64Array(kept.length);
  kept.forEach(([term, n], i) => {
    vocab.set(term, i);
    idf[i] = Math.log((1 + docs.length) / (1 + n)) + 1;
  });
  return { vocab, idf };
}

type Sparse = { idx: Int32Array; val: Float64Array };

function transform(v: Vectoriser, d: Doc): Sparse {
  const counts = new Map<number, number>();
  for (const f of features(d)) {
    const i = v.vocab.get(f);
    if (i !== undefined) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const idx = new Int32Array(counts.size);
  const val = new Float64Array(counts.size);
  let k = 0;
  let norm = 0;
  for (const [i, c] of counts) {
    const w = (1 + Math.log(c)) * v.idf[i]; // sublinear TF
    idx[k] = i;
    val[k] = w;
    norm += w * w;
    k++;
  }
  norm = Math.sqrt(norm) || 1;
  for (let j = 0; j < val.length; j++) val[j] /= norm;
  return { idx, val };
}

// --- model ----------------------------------------------------------------

interface Model {
  w: Float64Array;
  b: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function score(m: Model, x: Sparse): number {
  let z = m.b;
  for (let k = 0; k < x.idx.length; k++) z += m.w[x.idx[k]] * x.val[k];
  return sigmoid(z);
}

/**
 * AdaGrad logistic regression with L2 and class weighting. Positives are ~13%
 * of the post-prefilter population; without the reweighting the model just
 * learns to say "out".
 */
function train(
  X: Sparse[],
  y: Uint8Array,
  nFeatures: number,
  { epochs = 25, lr = 0.5, l2 = 1e-6 } = {},
): Model {
  const w = new Float64Array(nFeatures);
  const g2 = new Float64Array(nFeatures);
  let b = 0;
  let b2 = 0;

  const pos = y.reduce((a, v) => a + v, 0);
  const wPos = (y.length - pos) / Math.max(pos, 1); // balance the classes
  const order = [...X.keys()];
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let e = 0; e < epochs; e++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const i of order) {
      const x = X[i];
      const yi = y[i];
      const sw = yi ? wPos : 1;
      const p = score({ w, b }, x);
      const gBase = (p - yi) * sw;
      for (let k = 0; k < x.idx.length; k++) {
        const f = x.idx[k];
        const g = gBase * x.val[k] + l2 * w[f];
        g2[f] += g * g;
        w[f] -= (lr / (Math.sqrt(g2[f]) + 1e-8)) * g;
      }
      b2 += gBase * gBase;
      b -= (lr / (Math.sqrt(b2) + 1e-8)) * gBase;
    }
  }
  return { w, b };
}

// --- metrics --------------------------------------------------------------

function prf(yTrue: Uint8Array, probs: number[], thr: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  probs.forEach((p, i) => {
    const pred = p >= thr ? 1 : 0;
    if (pred && yTrue[i]) tp++;
    else if (pred && !yTrue[i]) fp++;
    else if (!pred && yTrue[i]) fn++;
    else tn++;
  });
  const prec = tp / (tp + fp || 1);
  const rec = tp / (tp + fn || 1);
  return { tp, fp, fn, tn, prec, rec, f1: (2 * prec * rec) / (prec + rec || 1) };
}

/** Threshold that maximises F1 on the given scores — reported, not tuned on test. */
function bestThreshold(yTrue: Uint8Array, probs: number[]) {
  let best = { thr: 0.5, f1: -1 } as { thr: number; f1: number };
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const f1 = prf(yTrue, probs, t).f1;
    if (f1 > best.f1) best = { thr: t, f1 };
  }
  return best;
}

const pct = (x: number) => (100 * x).toFixed(1) + "%";
function report(name: string, r: ReturnType<typeof prf>) {
  console.log(
    `${name.padEnd(34)} TP=${String(r.tp).padStart(4)} FP=${String(r.fp).padStart(4)} FN=${String(r.fn).padStart(4)} TN=${String(r.tn).padStart(5)}  P=${pct(r.prec).padStart(6)} R=${pct(r.rec).padStart(6)} F1=${pct(r.f1).padStart(6)}`,
  );
}

// --- experiments ----------------------------------------------------------

const [trainPath, goldPath] = process.argv.slice(2);
if (!trainPath || !goldPath) {
  console.error("Usage: npx tsx ml/baseline.ts <train-raw.jsonl> <gold.jsonl>");
  process.exit(1);
}

const readJsonl = (p: string) =>
  readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const pool = readJsonl(trainPath) as (Doc & Record<string, unknown>)[];
const gold = readJsonl(goldPath) as (Doc & { label: string; confidence: string; prev_cls: string })[];
const goldIds = new Set(gold.map((g) => g.id));

// Nano's decision for every pooled posting, from the live DB snapshot.
const index = readJsonl(`${trainPath.replace(/[^/]+$/, "")}index.jsonl`) as {
  id: string;
  cls: string;
}[];
const nanoLabel = new Map(index.map((r) => [r.id, r.cls === "in" ? 1 : 0]));

// The prefilter removes heur_out/offtopic_out before a classifier ever runs,
// so the gold rows outside that population aren't part of this task.
const poolIds = new Set(pool.map((p) => p.id));
const goldEval = gold.filter((g) => poolIds.has(g.id));

console.log(`pool=${pool.length}  gold=${gold.length}  gold within post-prefilter population=${goldEval.length}\n`);

// ---- experiment 1: distil nano -------------------------------------------
const distilDocs = pool.filter((p) => !goldIds.has(p.id));
const vec = fit(distilDocs, 3, 60_000);
console.log(`vocabulary: ${vec.vocab.size} features\n`);

const Xtr = distilDocs.map((d) => transform(vec, d));
const ytr = Uint8Array.from(distilDocs.map((d) => nanoLabel.get(d.id) ?? 0));
const model = train(Xtr, ytr, vec.vocab.size);

const Xg = goldEval.map((d) => transform(vec, d));
const yg = Uint8Array.from(goldEval.map((g) => (g.label === "in" ? 1 : 0)));
const pg = Xg.map((x) => score(model, x));

console.log("=== Experiment 1: distil GPT-5.4-nano, evaluate on gold ===");
report("student @0.5", prf(yg, pg, 0.5));
const bt = bestThreshold(yg, pg);
report(`student @${bt.thr.toFixed(2)} (best-F1)`, prf(yg, pg, bt.thr));
const yNano = Uint8Array.from(goldEval.map((g) => (g.prev_cls === "in" ? 1 : 0)));
report("teacher (live system)", prf(yg, [...yNano].map(Number), 0.5));

// How faithfully does the student copy the teacher, on held-out pooled data?
const teacherAgree = goldEval.filter(
  (g, i) => (pg[i] >= bt.thr ? 1 : 0) === (g.prev_cls === "in" ? 1 : 0),
).length;
console.log(`student/teacher agreement on gold rows: ${pct(teacherAgree / goldEval.length)}\n`);

// ---- experiment 2: learn the gold target directly ------------------------
console.log("=== Experiment 2: 5-fold CV on the gold labels alone ===");
const folds = 5;
const idxs = goldEval.map((_, i) => i);
let s = 7;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = idxs.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
}
const oof = new Array<number>(goldEval.length).fill(0);
for (let f = 0; f < folds; f++) {
  const test = new Set(idxs.filter((_, k) => k % folds === f));
  const trDocs = goldEval.filter((_, i) => !test.has(i));
  const v2 = fit(trDocs, 2, 60_000);
  const m2 = train(
    trDocs.map((d) => transform(v2, d)),
    Uint8Array.from(trDocs.map((d) => (d.label === "in" ? 1 : 0))),
    v2.vocab.size,
    { epochs: 60 },
  );
  for (const i of test) oof[i] = score(m2, transform(v2, goldEval[i]));
}
report("gold-trained @0.5", prf(yg, oof, 0.5));
const bt2 = bestThreshold(yg, oof);
report(`gold-trained @${bt2.thr.toFixed(2)} (best-F1)`, prf(yg, oof, bt2.thr));

// ---- what the distilled model learned ------------------------------------
console.log("\n=== Strongest features (distilled model) ===");
const terms = [...vec.vocab.entries()].map(([t, i]) => [t, model.w[i]] as const);
const top = [...terms].sort((a, b) => b[1] - a[1]).slice(0, 18);
const bot = [...terms].sort((a, b) => a[1] - b[1]).slice(0, 18);
console.log("toward IN :", top.map(([t]) => t).join(", "));
console.log("toward OUT:", bot.map(([t]) => t).join(", "));
