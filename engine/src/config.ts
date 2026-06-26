import type { ClusterId } from "@aiengjobs/shared/taxonomy";

// --- Scope configuration (spec §4) -----------------------------------------
// STRICT AI-engineering core. This is intentionally config-driven: to widen the
// board to adjacents (e.g. add "mlops", "core_ml") later, edit this one list —
// no pipeline code changes needed. See the "strict-core thinness" risk in the plan.
export const INCLUDED_CLUSTERS: ClusterId[] = [
  "llm",
  "rag",
  "agents",
  "evals",
  "inference",
  "finetuning",
];

// Title signals that strongly indicate an in-scope AI-engineering role.
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
];

// --- LLM configuration ------------------------------------------------------
// On-the-fly classification/tagging uses OpenAI GPT-5.4-nano (cheapest).
export const LLM_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-nano";
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// Confidence below this routes a job to the manual review queue rather than auto-listing.
export const REVIEW_CONFIDENCE_THRESHOLD = 0.6;
