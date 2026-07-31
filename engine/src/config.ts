import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Title signals that strongly indicate an in-scope AI-engineering role.
// A match raises the prior to IN, but the encoder (which reads the description)
// can still veto it when confidently OUT — see the veto path in ingest.ts. That veto is what lets us keep broad signals like `agent` and the
// role/convention titles below without force-listing the odd non-eng posting
// (e.g. "Support Agent", a non-engineering MoTS).
export const IN_TITLE_PATTERNS: RegExp[] = [
  /\bai engineer\b/i,
  /\bgen.?ai\b/i,
  /\bgenerative ai\b/i,
  /\bllm\b/i,
  /\brag\b/i,
  /\bagent(s|ic)?\b/i,
  /\binference\b/i,
  /\bapplied ai\b/i,
  /\bforward.?deployed\b/i,
  /\bfine.?tun/i,
  /\beval(s|uation)?\b/i,
  /\bmodel serving\b/i,
  // Frontier-lab IC / research roles the bare keywords above miss. Safe to add
  // now that the model can veto a mis-match (above). Research scientists are IN
  // scope (AI/ML research); the model still filters non-IC "Research *Manager*".
  /\bresearch engineer\b/i,
  /\bresearch scientist\b/i,
  /\bmember of technical staff\b/i,
  /\bdeploy(ed|ment) engineer/i,
  /\bpost.?training\b/i,
  /\b(reinforcement learning|rlhf|dpo)\b/i,
];

// Hard-exclude signals (spec §4 OUT) even when "AI" appears somewhere.
export const OUT_TITLE_PATTERNS: RegExp[] = [
  /\bdata analyst\b/i,
  /\bbusiness intelligence\b/i,
  /\bsales\b/i,
  /\bmarketing\b/i,
  /\brecruiter\b/i,
  /\bdesigner\b/i,
  /\baccount executive\b/i,
  /\bproduct manager\b/i,
  /\boutcomes manager\b/i,
  // Catch-all postings, not a specific engineering role.
  /\b(open|spontaneous|general) application\b/i,
  /\btalent (pool|community|network)\b/i,
];

// Job families that are never AI engineering. Unlike OUT_TITLE_PATTERNS these are
// checked *after* IN_TITLE_PATTERNS (see classify.ts), so a title carrying a real
// AI signal always wins: "Technical Program Manager, Cloud Inference" and
// "Customer Support Engineer (Inference)" stay IN despite matching here.
//
// Every pattern below was mined from titles the LLM had already rejected and kept
// only where it was 100% OUT-pure against that labelled set — the whole point is
// to skip inference entirely, so a false positive here is a role silently lost. Prefer
// leaving a family out over guessing: `solutions architect/engineer` was dropped
// for exactly this reason (95.7% pure — it was killing infra-flavoured roles).
export const OFF_TOPIC_TITLE_PATTERNS: RegExp[] = [
  /\b(recruiting|recruitment|talent acquisition|people operations|hr business partner|onboarding specialist)\b/i,
  /\b(accountant|accounting|bookkeep|payroll|accounts payable|accounts receivable|controller|auditor|tax manager|fp&a|treasury)\b/i,
  /\b(counsel|paralegal|attorney|lawyer|compliance officer|legal (operations|manager|director))\b/i,
  /\b(nurse|nursing|physician|therapist|psychiatr|pharmac|dentist|caregiver|medical assistant|phlebotom|radiolog)\b/i,
  /\b(tutor|teacher|instructor|curriculum|professor|lecturer|trainer)\b/i,
  /\b(executive assistant|administrative assistant|office manager|receptionist|workplace experience|facilities)\b/i,
  /\b(customer success|customer support|support (agent|specialist|representative)|technical support|help desk|service desk)\b/i,
  /\b(technician|electrician|plumb|welder|machinist|crane operator|foreman|driver|warehouse|forklift|janitor|custodian)\b/i,
  /\b(supply chain|procurement|logistics|buyer|sourcing manager|inventory|fulfillment)\b/i,
  /\b(communications|public relations|copywriter|content (writer|manager|strategist)|social media|editor|journalist)\b/i,
  /\b(program manager|project manager|scrum master|delivery manager|chief of staff)\b/i,
  /\b(mechanical|electrical|civil|structural|chemical|manufacturing|industrial|aerospace) engineer\b/i,
  // Sales-adjacent titles the bare /sales/ above misses.
  /\bbusiness development\b/i,
  /\baccount manager\b/i,
  /\b(partnerships?|channel) (manager|lead|director)\b/i,
  // Non-English commercial/admin postings (fr/it/es/de/pt). These boards carry
  // whole localised sales and back-office ladders that never contain an AI role.
  // Note this also suppresses a genuinely French-language AI posting — revisit if
  // we ever want to list non-English roles.
  /\b(ingénieur|développeur|responsable|chargé|chargée|spécialiste|comptabilit|commercial(e|es)?|vendeur|stagiaire|alternance|conseiller|agente|commercio|venditore|contabil|ventas|comercial|desarrollador|vertrieb|kaufmann|kauffrau|mitarbeiter|buchhalt)\b/i,
];

// --- Published site ---------------------------------------------------------
// Must match site/astro.config.mjs (`site` + `base`). Used to turn job slugs
// into the absolute URLs we hand to search engines.
export const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://frontierroles.com";
// Empty now the site sits at its domain apex; kept so the URL builders below
// still compose if the board ever moves back under a path.
export const SITE_BASE = process.env.SITE_BASE ?? "";

// --- IndexNow ---------------------------------------------------------------
// Push notification of new/removed job URLs to Bing, Yandex, Naver and Seznam
// (Google does not participate — see the Indexing API for that side).
//
// The key is public by design: it only proves control of the host, and the
// matching file is served from site/public/<key>.txt — i.e. the domain root,
// which covers every URL we submit.
export const INDEXNOW_KEY =
  process.env.INDEXNOW_KEY ?? "baa66d54cf113d3258c04600e858975b";
export const INDEXNOW_ENDPOINT =
  process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";

// --- Classifier configuration -----------------------------------------------
// Classification runs locally: a fine-tuned ModernBERT encoder under ONNX
// Runtime (see pipeline/encoder.ts). No API key, no per-posting network call.
//
// Anchored to the repo root, NOT the working directory. `npm run -w
// @aiengjobs/engine` executes with cwd set to engine/, so a relative "ml/model"
// resolves to engine/ml/model and silently misses — which is exactly how a run
// once classified a whole ingest on title heuristics alone.
export const ENCODER_DIR =
  process.env.AIENGJOBS_ENCODER_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ml", "model");

// fp32, deliberately, despite int8 being a quarter the size. ONNX Runtime uses
// VPMADDUBSW for int8 matmuls on x86-64 AVX2/AVX512 without VNNI, which
// saturates: the same int8 graph that scores 0.9992 on an ARM Mac scored 0.6583
// on a GitHub runner, collapsing every decision toward 0.5. reduce_range=True
// mitigates it, but fp32 removes the failure mode rather than tuning it — and
// the 961MB droplet that forced quantisation is gone. Runners have 16GB.
export const ENCODER_FILE = process.env.AIENGJOBS_ENCODER_FILE ?? "model.onnx";

// Measured on the labelled corpus: 3072 tokens covers 99.2% of adverts whole,
// but 1024 scores identically on the held-out split (92.4% vs 91.9% F1) at a
// quarter the attention memory. The gain from a longer window is not worth
// quadrupling the footprint on a shared runner.
export const ENCODER_WINDOW = Number(process.env.AIENGJOBS_ENCODER_WINDOW ?? 1024);

// Chosen from the held-out precision/recall curve, which knees here. Measured
// through the Node runtime at 0.70: 94.6% precision / 86.9% recall (92.0%
// precision reweighted to the 13% production base rate). Pushing to 0.87 buys
// ~1pp more precision for 13 more missed roles out of 183 — a bad exchange.
// Raise it if the board should be stricter still.
export const ENCODER_THRESHOLD = Number(process.env.AIENGJOBS_ENCODER_THRESHOLD ?? 0.7);

// A heuristic IN title is only overturned when the model is at least this sure
// the role is OUT. Set conservatively so a stray "out" can't suppress a clear
// in-scope role; it exists to kill broad-keyword false-positives ("Support
// Agent" via /agent/), not to second-guess every title. See ingest.ts.
export const ENCODER_VETO_CONFIDENCE = 0.7;
