import { openDb } from "./db/index.ts";
import { setJobSkills } from "./db/repo.ts";
import { ALL_SKILLS, tagHeuristic } from "./pipeline/tag.ts";
import { parseSalaryFromDescription } from "./pipeline/comp.ts";
import { classifyHeuristic } from "./pipeline/classify.ts";
import { encoderAvailable, encoderScore } from "./pipeline/encoder.ts";
import { ENCODER_DIR, ENCODER_THRESHOLD, ENCODER_VETO_CONFIDENCE } from "./config.ts";
import { mapPool } from "./util/concurrency.ts";

const RECLASSIFY_CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 4);

/**
 * One-off, inference-free backfill after a tagging/filter rule change. The nightly
 * ingest skips content-unchanged postings, so rule changes never reach
 * existing rows without this.
 *
 * - Re-derives every in-scope job's skills from its stored description text
 *   (tags are deterministic given the text, so recomputing is lossless).
 * - Repairs a pay currency the description parser now reads differently —
 *   see relabelPay for why that is narrower than it sounds.
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
      `SELECT id, title, description_text AS text, classification_confidence AS conf,
              country, salary_min AS salaryMin, salary_max AS salaryMax,
              salary_currency AS salaryCurrency
       FROM jobs WHERE classification = 'in'`,
    )
    .all() as unknown as {
    id: string;
    title: string;
    text: string | null;
    conf: number | null;
    country: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string | null;
  }[];

  const demote = db.prepare(`UPDATE jobs SET classification = 'out' WHERE id = ?`);
  const setCurrency = db.prepare(`UPDATE jobs SET salary_currency = ? WHERE id = ?`);
  let retagged = 0;
  let demoted = 0;
  let repriced = 0;
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
    const currency = relabelPay(j);
    if (currency) {
      setCurrency.run(currency, j.id);
      repriced++;
    }
    retagged++;
  }
  db.close();
  console.log(`Retag complete. retagged=${retagged} demoted=${demoted} repriced=${repriced}`);
}

/**
 * The currency a stored pay range should carry, or null to leave it alone.
 *
 * Narrow on purpose. Feed-supplied structured comp (Ashby, Workday) beats
 * anything read out of prose, and a stored row does not record which of the two
 * it came from — so the only rows this touches are ones where re-reading the
 * description reproduces **the same figures** under a different currency. That
 * is the signature of a description-derived range and nothing else: a feed's own
 * range would have to coincide digit-for-digit with the prose to be caught, in
 * which case relabelling it is right anyway.
 *
 * The defect it repairs: `detectCurrency` used to answer USD for any bare "$",
 * so 42 Canadian and 4 Singaporean roles were stored ~38% over their real value
 * — on the cards, in the /stats medians, and in the JobPosting baseSalary.
 * Because `ingest` skips content-unchanged postings, those rows would carry the
 * wrong currency until the employer next edited the advert.
 */
function relabelPay(j: {
  text: string | null;
  country: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}): string | null {
  if (!j.salaryCurrency || (j.salaryMin === null && j.salaryMax === null)) return null;
  const parsed = parseSalaryFromDescription(j.text, j.country);
  if (!parsed || parsed.salaryCurrency === j.salaryCurrency) return null;
  const sameFigures =
    (parsed.salaryMin ?? null) === j.salaryMin && (parsed.salaryMax ?? null) === j.salaryMax;
  return sameFigures ? (parsed.salaryCurrency ?? null) : null;
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
    throw new Error(
      `Classifier model not found at ${ENCODER_DIR}. Refusing to reclassify — ` +
        `a silent skip would leave the board looking re-scored when it was not.`,
    );
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

  // model_score is written unconditionally, and it is what makes this pass the
  // backfill for rows ingested before that column existed. Unlike
  // classification_confidence below it is never the heuristic's constant — it is
  // whatever the encoder just returned.
  const update = db.prepare(
    `UPDATE jobs SET classification = ?, classification_confidence = ?, model_score = ? WHERE id = ?`,
  );
  const counts = { in: 0, out: 0, promoted: 0, demoted: 0, failed: 0 };

  await mapPool(candidates, RECLASSIFY_CONCURRENCY, async (j) => {
    // Isolated per posting. Without this a single encoderScore throw rejected
    // Promise.all and aborted the pass mid-way, leaving the database PARTIALLY
    // reclassified — the one outcome the "run it by hand, against a copy"
    // warning above exists to avoid — and skipping the summary line, so there
    // was no record of how far it got.
    try {
      const p = await encoderScore(
        j.id,
        j.title,
        j.company,
        j.locationRaw ?? "",
        j.text ?? "",
      );
      // A heuristic IN title keeps its prior unless the model is confidently OUT,
      // mirroring ingest.ts — the two paths must not disagree on the same posting.
      const heuristic = classifyHeuristic(j.title);
      const heuristicIn = heuristic?.classification === "in";
      const isIn = heuristicIn ? 1 - p < ENCODER_VETO_CONFIDENCE : p >= ENCODER_THRESHOLD;
      // The *confidence* has to mirror ingest.ts too, and it used to not.
      //
      // When a heuristic IN survives the veto, ingest stores the heuristic's own
      // 0.85 — the model never overturned it, so the model's number is not what
      // the decision rests on. This stored the raw probability instead, which
      // for a survivor sits anywhere in (0.3, 0.7). retag then demotes anything
      // under ENCODER_THRESHOLD, so `reclassify && retag` silently dropped roles
      // that a plain ingest would have kept.
      const confidence = isIn && heuristicIn ? heuristic!.confidence : isIn ? p : 1 - p;
      update.run(isIn ? "in" : "out", confidence, p, j.id);
      setJobSkills(db, j.id, isIn ? tagHeuristic(j.text ?? "").skills : []);
      if (isIn) counts.in++;
      else counts.out++;
      if (isIn && j.was === "out") counts.promoted++;
      if (!isIn && j.was === "in") counts.demoted++;
    } catch (e) {
      counts.failed++;
      console.warn(`  ! ${j.id} (${j.title}): ${(e as Error).message}`);
    }
  });

  db.close();
  console.log(
    `Reclassify complete. in=${counts.in} out=${counts.out} ` +
      `(promoted=${counts.promoted} demoted=${counts.demoted} failed=${counts.failed})`,
  );
}
