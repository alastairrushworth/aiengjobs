import { CLUSTERS, CLUSTER_OF_SKILL } from "@aiengjobs/shared/taxonomy";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";

export interface TagResult {
  skills: string[];
  clusters: ClusterId[];
}

/**
 * Heuristic skill extraction: literal taxonomy-term matches in title + description.
 * Cheap first pass; the LLM tagger (Phase 1) catches nuance literal matching misses.
 */
export function tagHeuristic(text: string): TagResult {
  const hay = text.toLowerCase();
  const skills: string[] = [];
  for (const cluster of CLUSTERS) {
    for (const skill of cluster.skills) {
      if (hay.includes(skill.toLowerCase())) skills.push(skill);
    }
  }
  const clusters = [
    ...new Set(skills.map((s) => CLUSTER_OF_SKILL[s.toLowerCase()])),
  ];
  return { skills, clusters };
}

// TODO Phase 1: tagWithLLM(title, descriptionText) — OpenAI GPT-5.4-nano,
// cached by content hash, constrained to the taxonomy in shared/taxonomy.ts.
