import { openDb } from "./db/index.ts";
import { setJobSkills } from "./db/repo.ts";
import { ALL_SKILLS, tagHeuristic } from "./pipeline/tag.ts";
import { classifyHeuristic } from "./pipeline/classify.ts";
import { encoderAvailable, encoderScore } from "./pipeline/encoder.ts";
import { ENCODER_THRESHOLD, ENCODER_VETO_CONFIDENCE } from "./config.ts";
import { mapPool } from "./util/concurrency.ts";

const RECLASSIFY_CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 4);

/**
 * One-off, inference-free backfill after a tagging/filter rule change. The nightly
 * ingest skips content-unchanged postings, so rule changes never reach
 * existing rows without this.
 *
 * - Re-derives every in-scope job's skills from its stored description text
 *   (tags are deterministic given the text, so recomputing is lossless).
 * - Applies the OUT title heuristics to stored in-scope jobs (catches rules
 *   added since a job was ingested).
 * - Applies the confidence floor to stored INs. Heuristic INs are pinned at
 *   0.85 and stay; anything below the floor was a model or default decision.
 *
 * Re-scoring postings with the encoder is `reclassify`, not this — retag never
 * runs inference.
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
    const belowFloor = (j.conf ?? 0) < ENCODER_THRESHOLD;
    if (heuristicOut || belowFloor) {
      demote.run(j.id);
      setJobSkills(db, j.id, []);
      demoted++;
      continue;
    }
    setJobSkills(db, j.id, tagHeuristic(j.text ?? "").skills);
    retagged++;
  }
  db.close();
  console.log(`Retag complete. retagged=${retagged} demoted=${demoted}`);
}

/**
 * Re-decides every live posting with the local encoder.
 *
 * NOT part of the nightly refresh, and deliberately not reachable from the
 * refresh workflow. `ingest` skips content-unchanged postings, so the board
 * only ever moves forward as adverts are added or edited; this rewrites every
 * stored classification in one go and will add and remove listings in bulk.
 *
 * Run it by hand, against a copy of the database, when you actually want that —
 * for example to apply a better classifier to the backlog the old one built at
 * 70.8% recall. Under the LLM it was restricted to a narrow confidence band
 * because each job cost an API call; that limit is gone, which makes it more
 * useful and more destructive at the same time.
 *
 * Titles the heuristic rules OUT are skipped (ingest never scores them either,
 * so re-deciding them here would apply a rule production does not).
 */
export async function reclassify(): Promise<void> {
  if (!encoderAvailable()) {
    console.log("Reclassify skipped: encoder model files not found.");
    return;
  }
  const db = openDb();
  const jobs = db
    .prepare(
      `SELECT j.id, j.title, j.description_text AS text, j.location_raw AS locationRaw,
              j.classification AS was, c.name AS company
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.is_closed = 0`,
    )
    .all() as unknown as {
    id: string;
    title: string;
    text: string | null;
    locationRaw: string | null;
    was: string;
    company: string;
  }[];

  const candidates = jobs.filter(
    (j) => classifyHeuristic(j.title)?.classification !== "out",
  );
  console.log(
    `Reclassify: scoring ${candidates.length}/${jobs.length} live postings ` +
      `(${jobs.length - candidates.length} ruled out by title heuristic).`,
  );

  const update = db.prepare(
    `UPDATE jobs SET classification = ?, classification_confidence = ? WHERE id = ?`,
  );
  const counts = { in: 0, out: 0, promoted: 0, demoted: 0, failed: 0 };

  await mapPool(candidates, RECLASSIFY_CONCURRENCY, async (j) => {
    const p = await encoderScore(
      j.id,
      j.title,
      j.company,
      j.locationRaw ?? "",
      j.text ?? "",
    );
    if (p === null) {
      counts.failed++;
      return;
    }
    // A heuristic IN title keeps its prior unless the model is confidently OUT,
    // mirroring ingest.ts — the two paths must not disagree on the same posting.
    const heuristicIn = classifyHeuristic(j.title)?.classification === "in";
    const isIn = heuristicIn ? 1 - p < ENCODER_VETO_CONFIDENCE : p >= ENCODER_THRESHOLD;
    update.run(isIn ? "in" : "out", isIn ? p : 1 - p, j.id);
    setJobSkills(db, j.id, isIn ? tagHeuristic(j.text ?? "").skills : []);
    if (isIn) counts.in++;
    else counts.out++;
    if (isIn && j.was === "out") counts.promoted++;
    if (!isIn && j.was === "in") counts.demoted++;
  });

  db.close();
  console.log(
    `Reclassify complete. in=${counts.in} out=${counts.out} ` +
      `(promoted=${counts.promoted} demoted=${counts.demoted} failed=${counts.failed})`,
  );
}
