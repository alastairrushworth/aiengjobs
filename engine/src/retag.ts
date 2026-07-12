import { openDb } from "./db/index.ts";
import { setJobSkills } from "./db/repo.ts";
import { ALL_SKILLS, combineSkills } from "./pipeline/tag.ts";
import { classifyHeuristic } from "./pipeline/classify.ts";
import { extractListing } from "./pipeline/extract.ts";
import { llmEnabled } from "./pipeline/llm.ts";
import { LLM_IN_CONFIDENCE_FLOOR } from "./config.ts";
import { mapPool } from "./util/concurrency.ts";

const RECLASSIFY_CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 8);

/**
 * One-off, LLM-free backfill after a tagging/filter rule change. The nightly
 * ingest skips content-unchanged postings, so rule changes never reach
 * existing rows without this.
 *
 * - Re-derives every in-scope job's skills from its stored description text
 *   (tags are deterministic given the text: LLM-proposed skills are evidence-
 *   gated by the same matchers, so recomputing without the LLM is lossless).
 * - Applies the OUT title heuristics to stored in-scope jobs (catches rules
 *   added since a job was ingested).
 * - Applies the confidence floor to previously LLM-decided INs. Heuristic INs
 *   are pinned at 0.85 and stay; anything below the floor was LLM/default.
 *
 * Reclassifying borderline INs under the new prompt still needs the LLM and
 * is NOT done here — that only affects new/changed postings via ingest.
 */
export function retag(): void {
  const db = openDb();

  // Drop skills removed from the taxonomy (e.g. Latency/Throughput/
  // Observability); the FK cascade clears their job_skills rows everywhere.
  const stale = db
    .prepare(
      `DELETE FROM skills WHERE name NOT IN (${ALL_SKILLS.map(() => "?").join(",")})
       RETURNING name`,
    )
    .all(...ALL_SKILLS) as unknown as { name: string }[];
  if (stale.length > 0) {
    console.log(`Removed stale skills: ${stale.map((s) => s.name).join(", ")}`);
  }

  const jobs = db
    .prepare(
      `SELECT id, title, description_text AS text, classification_confidence AS conf
       FROM jobs WHERE classification = 'in'`,
    )
    .all() as unknown as { id: string; title: string; text: string | null; conf: number | null }[];

  const demote = db.prepare(`UPDATE jobs SET classification = 'out' WHERE id = ?`);
  let retagged = 0;
  let demoted = 0;
  for (const j of jobs) {
    const heuristicOut = classifyHeuristic(j.title)?.classification === "out";
    const belowFloor = (j.conf ?? 0) < LLM_IN_CONFIDENCE_FLOOR;
    if (heuristicOut || belowFloor) {
      demote.run(j.id);
      setJobSkills(db, j.id, []);
      demoted++;
      continue;
    }
    setJobSkills(db, j.id, combineSkills(j.text ?? "").skills);
    retagged++;
  }
  db.close();
  console.log(`Retag complete. retagged=${retagged} demoted=${demoted}`);
}

// Jobs decided by the LLM (not a heuristic IN title) sit in this band when
// their prior classification was a coin-flip; the tightened extract.ts prompt
// (models-consumed-vs-built rule) can only change their outcome by re-asking.
const RECLASSIFY_MIN_CONFIDENCE = 0.6;
const RECLASSIFY_MAX_CONFIDENCE = 0.85;

/**
 * Re-decides borderline live IN jobs (confidence in
 * [RECLASSIFY_MIN_CONFIDENCE, RECLASSIFY_MAX_CONFIDENCE)) through the current
 * extract.ts prompt. One-off, costs one LLM call per job — run after a prompt
 * change to fix classification (not just tags) on already-ingested jobs.
 * Skips jobs whose title heuristic pins them IN (nothing to re-decide).
 */
export async function reclassify(): Promise<void> {
  if (!llmEnabled()) {
    console.log("Reclassify skipped: no OPENAI_API_KEY configured.");
    return;
  }
  const db = openDb();
  const jobs = db
    .prepare(
      `SELECT id, title, description_text AS text, location_raw AS locationRaw
       FROM jobs
       WHERE classification = 'in' AND is_closed = 0
         AND classification_confidence >= ? AND classification_confidence < ?`,
    )
    .all(RECLASSIFY_MIN_CONFIDENCE, RECLASSIFY_MAX_CONFIDENCE) as unknown as {
    id: string;
    title: string;
    text: string | null;
    locationRaw: string | null;
  }[];

  const candidates = jobs.filter(
    (j) => classifyHeuristic(j.title)?.classification !== "in",
  );
  console.log(
    `Reclassify: ${candidates.length}/${jobs.length} borderline jobs need an LLM call (rest pinned IN by title).`,
  );

  const update = db.prepare(
    `UPDATE jobs SET classification = ?, classification_confidence = ? WHERE id = ?`,
  );
  let keptIn = 0;
  let movedOut = 0;
  let failed = 0;

  await mapPool(candidates, RECLASSIFY_CONCURRENCY, async (j) => {
    const ex = await extractListing(j.title, j.text ?? "", j.locationRaw ?? undefined);
    if (!ex) {
      failed++;
      return;
    }
    const stillIn = ex.inScope && ex.confidence >= LLM_IN_CONFIDENCE_FLOOR;
    update.run(stillIn ? "in" : "out", ex.confidence, j.id);
    if (stillIn) {
      setJobSkills(db, j.id, combineSkills(j.text ?? "", ex.skills).skills);
      keptIn++;
    } else {
      setJobSkills(db, j.id, []);
      movedOut++;
    }
  });

  db.close();
  console.log(
    `Reclassify complete. kept_in=${keptIn} moved_out=${movedOut} failed=${failed}`,
  );
}
