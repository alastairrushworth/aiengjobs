import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ENCODER_DIR, ENCODER_THRESHOLD, ENCODER_WINDOW } from "../config.ts";

/**
 * Local in/out classification: a ModernBERT-base encoder fine-tuned on 4,898
 * hand-labelled adverts, quantised to int8 and run under ONNX Runtime.
 *
 * Replaces the per-posting GPT-5.4-nano call. Measured through THIS path (not
 * the PyTorch reference) on the held-out split — companies held out, so
 * near-duplicate reposts cannot leak across it — at the default threshold:
 * 93.9% precision / 84.7% recall, 91.0% precision reweighted to the 13%
 * production base rate. The LLM it replaces scored 86.0% / 70.8%.
 *
 * onnxruntime-node and onnxruntime-python disagree slightly on int8 kernels:
 * 5 of 984 held-out decisions differ from PyTorch (mean probability delta
 * 0.008, max 0.23). Quote the numbers above, not the training script's.
 *
 * The session is created once and reused: loading the 144MB graph costs ~1s and
 * the nightly run classifies a few thousand postings.
 */

// The model was fine-tuned on adverts serialised in exactly this shape. The
// header is not decoration — it puts the title in front of the body, which is
// the strongest single feature. Reproduce it byte-for-byte or every posting is
// scored off-distribution.
export function serialiseAdvert(
  id: string,
  title: string,
  company: string,
  location: string,
  body: string,
): string {
  return (
    `ID: ${id}\nTITLE: ${title}\nCOMPANY: ${company}\nLOCATION: ${location}\n\n` +
    `FULL JOB ADVERT (verbatim, untruncated):\n${body}`
  );
}

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};

let ready: Promise<{
  tokenizer: Tokenizer;
  session: Session;
  sepId: number;
  Tensor: TensorCtor;
} | null> | null = null;

interface Tokenizer {
  (text: string, opts: Record<string, unknown>): {
    input_ids: { data: ArrayLike<number | bigint> };
    attention_mask: { data: ArrayLike<number | bigint> };
  };
}
type TensorCtor = new (type: string, data: BigInt64Array, dims: number[]) => unknown;

/** True when the model files are present. Ingest asserts this before doing any work. */
export function encoderAvailable(): boolean {
  return existsSync(join(ENCODER_DIR, "model.int8.onnx"));
}

async function init() {
  if (!encoderAvailable()) return null;
  // Imported lazily so the CLI's other commands don't pay onnxruntime's startup
  // cost, and so a missing optional dependency degrades to heuristics.
  const [{ AutoTokenizer, env }, ort] = await Promise.all([
    import("@huggingface/transformers"),
    import("onnxruntime-node"),
  ]);
  // transformers.js resolves a bare name against env.localModelPath and would
  // otherwise reach for the Hub. Point it at the parent and pass the leaf so the
  // packaged tokenizer is the only thing it can load.
  const dir = resolve(ENCODER_DIR);
  env.allowRemoteModels = false;
  env.localModelPath = dirname(dir);
  const tk = await AutoTokenizer.from_pretrained(basename(dir));
  const tokenizer = tk as unknown as Tokenizer;
  const sepId = (tk as unknown as { sep_token_id?: number }).sep_token_id;
  if (typeof sepId !== "number") throw new Error("tokenizer has no sep_token_id");
  const session = (await ort.InferenceSession.create(join(ENCODER_DIR, "model.int8.onnx"), {
    // One thread per posting: the nightly run is a queue of independent adverts,
    // so parallelism belongs at the posting level, not inside a single graph.
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  })) as unknown as Session;
  return { tokenizer, session, sepId, Tensor: ort.Tensor as unknown as TensorCtor };
}

/**
 * Score an already-serialised advert. Exported so the parity check can feed the
 * exact strings the model was trained on, isolating inference from serialisation.
 */
export async function scoreText(text: string): Promise<number> {
  ready ??= init();
  const m = await ready;
  if (!m) {
    throw new Error(
      `Classifier model not found at ${ENCODER_DIR}. Refusing to classify — ` +
        `falling back to title heuristics would silently rebuild the board on a ` +
        `much weaker rule. Set AIENGJOBS_ENCODER_DIR or restore the model files.`,
    );
  }
  {
    const enc = m.tokenizer(text, {
      truncation: true,
      max_length: ENCODER_WINDOW,
      return_tensors: "js",
    });
    const raw = Array.from(enc.input_ids.data, (v) => Number(v));
    // Python's tokenizer truncates the CONTENT and keeps the closing [SEP];
    // transformers.js truncates after adding specials and drops it, leaving a
    // stray content token in the final slot. The model was trained with [SEP]
    // there, so without this every advert over the window scores
    // off-distribution — measured up to 0.25 absolute probability drift.
    if (raw.length >= ENCODER_WINDOW && raw[raw.length - 1] !== m.sepId) {
      raw[raw.length - 1] = m.sepId;
    }
    const ids = BigInt64Array.from(raw, (v) => BigInt(v));
    const mask = BigInt64Array.from(Array.from(enc.attention_mask.data, (v) => BigInt(v)));
    const dims = [1, ids.length];
    const out = await m.session.run({
      input_ids: new m.Tensor("int64", ids, dims),
      attention_mask: new m.Tensor("int64", mask, dims),
    });
    const logits = Object.values(out)[0]?.data;
    if (!logits || logits.length < 2) {
      throw new Error(`classifier returned ${logits?.length ?? 0} logits, expected 2`);
    }
    // Two-class softmax; index 1 is IN.
    const [a, b] = [logits[0]!, logits[1]!];
    const max = Math.max(a, b);
    const ea = Math.exp(a - max);
    const eb = Math.exp(b - max);
    return eb / (ea + eb);
  }
}

/**
 * Probability that the posting is in scope.
 *
 * Throws rather than degrading. There is deliberately no heuristic fallback:
 * title regexes alone classify far worse than the model, and a silent downgrade
 * would rewrite the board with plausible-looking but much weaker decisions. A
 * missing or broken model must fail the run.
 */
export function encoderScore(
  id: string,
  title: string,
  company: string,
  location: string,
  body: string,
): Promise<number> {
  return scoreText(serialiseAdvert(id, title, company, location, body));
}

/** Convenience wrapper applying the calibrated operating point. */
export function inScope(p: number): boolean {
  return p >= ENCODER_THRESHOLD;
}
