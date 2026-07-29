import {
  IN_TITLE_PATTERNS,
  OFF_TOPIC_TITLE_PATTERNS,
  OUT_TITLE_PATTERNS,
} from "../config.ts";
import type { Classification } from "@aiengjobs/shared";

export interface ClassifyResult {
  classification: Classification;
  confidence: number;
  via: "heuristic" | "llm" | "default";
}

/**
 * Heuristic-first IN/OUT classification (§6.4). Returns null when the title is
 * ambiguous, signalling the caller to fall back to the LLM extractor (which also
 * classifies).
 *
 * Only a confident OUT lets the caller skip the LLM entirely (the posting is
 * discarded, so there's nothing to extract). An IN result is just a prior: the
 * caller still runs the LLM for skills/comp/location, and a confident LLM OUT
 * vetoes this IN — see ingest.ts.
 */
export function classifyHeuristic(title: string): ClassifyResult | null {
  if (OUT_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "out", confidence: 0.9, via: "heuristic" };
  }
  if (IN_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "in", confidence: 0.85, via: "heuristic" };
  }
  // Reached only when the title carries no AI signal at all, so an off-topic job
  // family here is safe to rule out without paying for an LLM call. Ordering is
  // the whole guard: run this before the IN check and titles like "Technical
  // Program Manager, Cloud Inference" get discarded.
  if (OFF_TOPIC_TITLE_PATTERNS.some((re) => re.test(title))) {
    return { classification: "out", confidence: 0.85, via: "heuristic" };
  }
  return null;
}
