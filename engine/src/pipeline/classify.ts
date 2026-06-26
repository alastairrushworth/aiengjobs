import { IN_TITLE_PATTERNS, OUT_TITLE_PATTERNS } from "../config.ts";
import { llmJSON } from "./llm.ts";
import type { Classification } from "@aiengjobs/shared";

export interface ClassifyResult {
  classification: Classification;
  confidence: number;
  via: "heuristic" | "llm" | "default";
}

/**
 * Heuristic-first IN/OUT classification (§6.4). Returns null when the title is
 * ambiguous, signalling the caller to fall back to the LLM classifier.
 */
export function classifyHeuristic(title: string): ClassifyResult | null {
  if (OUT_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "out", confidence: 0.9, via: "heuristic" };
  }
  if (IN_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "in", confidence: 0.85, via: "heuristic" };
  }
  return null;
}

/** Full classification: heuristic, then GPT-5.4-nano for ambiguous titles. */
export async function classifyJob(
  title: string,
  descriptionText = "",
): Promise<ClassifyResult> {
  const h = classifyHeuristic(title);
  if (h) return h;

  const out = await llmJSON(
    'You classify job postings for a STRICT AI-engineering job board. IN scope: roles building LLM applications, RAG/retrieval, AI agents, evals/quality, inference/serving, or fine-tuning. OUT of scope: data analyst/BI, pure data/research scientist, sales/marketing/PM, generic software roles with only a token "AI a plus", and non-engineering AI-tool-user roles. Respond with JSON: {"in": boolean, "confidence": number between 0 and 1}.',
    `Title: ${title}\n\nDescription:\n${descriptionText.slice(0, 2500)}`,
  );
  if (out && typeof out.in === "boolean") {
    const c = typeof out.confidence === "number" ? out.confidence : 0.6;
    return {
      classification: out.in ? "in" : "out",
      confidence: Math.max(0, Math.min(1, c)),
      via: "llm",
    };
  }

  // No LLM available / call failed → conservative: exclude the ambiguous to keep the board credible.
  return { classification: "out", confidence: 0.3, via: "default" };
}
