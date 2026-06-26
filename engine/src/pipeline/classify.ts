import { IN_TITLE_PATTERNS, OUT_TITLE_PATTERNS } from "../config.ts";
import type { Classification } from "@aiengjobs/shared";

export interface ClassifyResult {
  classification: Classification;
  confidence: number;
}

/**
 * Heuristic-first IN/OUT classification (spec §6.4). Returns null when the title
 * is ambiguous, signalling the caller to fall back to the LLM classifier.
 */
export function classifyHeuristic(title: string): ClassifyResult | null {
  if (OUT_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "out", confidence: 0.9 };
  }
  if (IN_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "in", confidence: 0.85 };
  }
  return null;
}

// TODO Phase 1: classifyWithLLM(title, descriptionText) — OpenAI GPT-5.4-nano,
// cached by content hash, returns a model confidence. Below
// REVIEW_CONFIDENCE_THRESHOLD -> manual review queue rather than auto-list.
