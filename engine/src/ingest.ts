import { openDb } from "./db/index.ts";
import {
  listPollTargets,
  getExistingJob,
  upsertJob,
  setJobSkills,
  markSeen,
  markSourcePolled,
  closeStaleJobs,
  pruneClosedJobs,
  dropOutOfScopeText,
} from "./db/repo.ts";
import { getConnector } from "./connectors/index.ts";
import type { RawPosting } from "./connectors/types.ts";
import { normalize } from "./pipeline/normalize.ts";
import { classifyHeuristic, type ClassifyResult } from "./pipeline/classify.ts";
import { tagHeuristic } from "./pipeline/tag.ts";
import { inferSeniority } from "./pipeline/seniority.ts";
import { parseLocation } from "./pipeline/location.ts";
import { parseSalaryFromDescription } from "./pipeline/comp.ts";
import { contentHash } from "./pipeline/hash.ts";
import { encoderAvailable, encoderScore } from "./pipeline/encoder.ts";
import { ENCODER_DIR, ENCODER_THRESHOLD, ENCODER_VETO_CONFIDENCE } from "./config.ts";
import { jobId, jobSlug } from "./util/id.ts";
import { mapPool } from "./util/concurrency.ts";

// `||` not `??`: an unset var is one thing, but an empty or malformed one
// (Number("") === 0, Number("abc") === NaN) must not silently become a zero
// delay — or, for CONCURRENCY below, a pool that processes nothing at all.
const SLEEP_MS = Number(process.env.INGEST_DELAY_MS) || 400; // polite to feeds (Lever crawl-delay)
// This does NOT parallelise classification: ORT serialises concurrent run()
// calls on the shared session, so raising it only queues adverts deeper in the
// runtime. Cores are put to work inside the graph instead (ENCODER_THREADS).
// 2 is enough to overlap the JS-side work — tokenising, hashing, the upsert —
// with the native inference of the advert in front of it, which is all the
// posting-level pool can buy here.
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY) || 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wall-clock ceiling on the polling loop, in milliseconds.
 *
 * The workflow kills the job at 300 minutes, and a killed run is not a slow
 * night — it is a lost one: the database is only persisted when the ingest step
 * exits 0. A run that overran therefore left the *next* run two nights of
 * changed adverts to process, which made it slower still. That is a feedback
 * loop into permanent failure, and the margin was thin (4h40m of the 5h budget
 * on 2026-08-01, with the seed list growing 744 → 853 sources in a day).
 *
 * So stop starting new sources at the budget, log what was skipped, and exit 0.
 * The sources already polled are committed, `closeStaleJobs` still runs against
 * them alone, and the skipped ones keep yesterday's roles — the same
 * degradation an unreachable feed already gets.
 *
 * 240 minutes rather than the 200 this used to be. The seed list has since
 * reached 1,373 sources and a full sweep no longer fits: the 2026-08-22 run
 * polled 979 in 3h27m and skipped 392. 240 leaves an hour of the workflow's
 * budget for export, the 205MB database upload and the snapshot push, which the
 * same run got through in about two minutes.
 *
 * The budget alone cannot close that gap and is not meant to — at the measured
 * ~4.9 sources/minute a full sweep wants ~280 minutes, past the workflow
 * timeout. What makes a partial sweep *safe* is `listPollTargets` rotating on
 * `last_polled_at`, so the sources this run drops are the ones the next run
 * starts with. Coverage of any single night is partial; coverage across two is
 * complete. Raise this, or split the sweep across runs, if that stops holding. */
const BUDGET_MS = Number(process.env.INGEST_BUDGET_MS) || 240 * 60_000;

// Apply links come from third-party feeds and end up as hrefs on the site —
// only plain web URLs are acceptable (a javascript: link would be an XSS).
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

/**
 * Per-source funnel. `invalid + unchanged + filtered + inferred` accounts for
 * every posting a feed returned, so it is obvious where the volume — and the
 * time — went. (`errored` overlaps rather than partitioning: a posting that
 * fails in the upsert has already been counted as filtered or inferred.)
 *
 * `inferred` is the one that costs: it is the number of encoder runs, which the
 * log used to leave implicit. "N postings, M in-scope" says nothing about how
 * many adverts the model actually read, and M understates it several-fold.
 */
interface Tally {
  fetched: number;
  invalid: number; // no usable title/apply URL — dropped before classification
  unchanged: number; // content hash matched a stored job, so never reclassified
  filtered: number; // title heuristic said OUT, so inference was skipped
  inferred: number; // encoder ran on the advert
  listed: number; // classified in-scope
  written: number; // upserted (in or out)
  errored: number;
  fetchMs: number;
  workMs: number;
}

const newTally = (): Tally => ({
  fetched: 0,
  invalid: 0,
  unchanged: 0,
  filtered: 0,
  inferred: 0,
  listed: 0,
  written: 0,
  errored: 0,
  fetchMs: 0,
  workMs: 0,
});

/**
 * One line per source: the whole funnel, plus where its wall clock went. The
 * funnel fields are always present so the ~740 lines stay a scannable column of
 * the same shape; the two fault counters appear only when non-zero, so a source
 * that starts erroring stands out instead of blending into a wall of `=0`.
 */
function describe(t: Tally): string {
  const parts = [
    `fetched=${t.fetched}`,
    `unchanged=${t.unchanged}`,
    `filtered=${t.filtered}`,
    `inferred=${t.inferred}`,
    `in-scope=${t.listed}`,
  ];
  if (t.invalid) parts.push(`invalid=${t.invalid}`);
  if (t.errored) parts.push(`errored=${t.errored}`);
  parts.push(`fetch=${dur(t.fetchMs)}`, `process=${dur(t.workMs)}`);
  return parts.join(" ");
}

/** Compact duration: 840ms / 3.2s / 6m14s / 3h46m. */
function dur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}m`;
}

// Connectors use undefined for "absent"; the description parser uses null.
interface PayFields {
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: string | null;
}

/**
 * Pay fields, but only when the currency is known. Each source is taken as a
 * unit rather than field-by-field, so a range can't be paired with a currency
 * parsed from a different source.
 */
function pay(
  raw: PayFields,
  fromDescription?: PayFields | null,
): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
} {
  for (const src of [raw, fromDescription]) {
    if (!src) continue;
    const min = src.salaryMin;
    const max = src.salaryMax;
    if ((min || max) && src.salaryCurrency) {
      return {
        salaryMin: min ?? undefined,
        salaryMax: max ?? undefined,
        salaryCurrency: src.salaryCurrency,
        salaryPeriod: src.salaryPeriod ?? undefined,
      };
    }
  }
  return {};
}

/** Poll every seeded source, classify/tag, upsert, then expire vanished jobs (§6.4–6.5). */
export async function ingest(): Promise<void> {
  const db = openDb();
  const targets = listPollTargets(db);
  if (targets.length === 0) {
    console.log("No companies seeded. Run `npm run seed -w @aiengjobs/engine` first.");
    db.close();
    return;
  }
  // Assert before touching a single feed. A missing model used to degrade to
  // title heuristics, which quietly reclassified everything it touched on a far
  // weaker rule; failing here costs a run, failing silently costs the board.
  if (!encoderAvailable()) {
    db.close();
    throw new Error(
      `Classifier model not found at ${ENCODER_DIR}. Ingest aborted before any ` +
        `posting was written. Restore the model files or set AIENGJOBS_ENCODER_DIR.`,
    );
  }
  console.log(`Ingest: ${targets.length} sources. Classifier: local ONNX encoder.`);

  const runStart = new Date().toISOString();
  const runStartedMs = Date.now();
  const polledSourceIds: string[] = [];
  // Keyed by sourceId so the closure counts can be joined back on by name.
  const tallies = new Map<string, { name: string; tally: Tally }>();
  // Feed failures are logged as they happen, but a run prints thousands of
  // lines over several hours — a board that has been dead for a fortnight looks
  // identical to a blip unless the failures are gathered back up at the end.
  const feedFailures: string[] = [];
  let failed = 0;

  let skippedForBudget = 0;
  for (const t of targets) {
    // Budget check before the fetch, never mid-source: a half-polled source
    // would look complete to closeStaleJobs.
    if (Date.now() - runStartedMs > BUDGET_MS) {
      skippedForBudget++;
      continue;
    }

    const connector = getConnector(t.atsProvider);
    if (!connector) {
      // seed.ts warns for the same condition; without this a typo'd provider in
      // companies.csv is dropped from every run with no trace at all.
      console.warn(`  ! ${t.name}: unknown ATS provider "${t.atsProvider}", skipping`);
      continue;
    }

    // Stamped before the fetch, so a source that throws still rotates to the
    // back of the queue. See markSourcePolled.
    //
    // The wall clock rather than runStart, so sources stay ordered *within* a
    // run too: a night that gets a third of the way through the backlog leaves
    // the next one resuming from where it stopped, instead of all 979 tying on
    // one timestamp and falling back to id order.
    markSourcePolled(db, t.sourceId, new Date().toISOString());

    const tally = newTally();
    const fetchStart = Date.now();
    let postings: RawPosting[];
    let partial = false;
    try {
      const result = await connector.fetchPostings(t.atsToken);
      postings = Array.isArray(result) ? result : result.postings;
      partial = Array.isArray(result) ? false : result.partial === true;
    } catch (e) {
      failed++;
      const line = `${t.name} (${t.atsProvider}:${t.atsToken}): ${(e as Error).message}`;
      feedFailures.push(line);
      console.warn(`  ! ${line}`);
      await sleep(SLEEP_MS);
      continue;
    }
    tally.fetchMs = Date.now() - fetchStart;
    // Only a feed that returned the WHOLE board counts as polled.
    //
    // A 200 with an empty array is indistinguishable from a renamed board, an
    // expired token, or a response shape that changed under us — and marking it
    // polled would let closeStaleJobs close every open role at this company on
    // that evidence. A genuinely empty board just keeps yesterday's roles until
    // they age out.
    //
    // A capped return (the enterprise connectors' MAX_DETAIL) is the same
    // problem wearing a different hat: the roles past the cap are live, they're
    // just unseen, and closing them made those boards flap open and closed from
    // one night to the next.
    if (partial) {
      console.warn(`  ! ${t.name} (${t.atsProvider}:${t.atsToken}): capped result, not closing its roles`);
    } else if (postings.length > 0) {
      polledSourceIds.push(t.sourceId);
    } else {
      console.warn(`  ! ${t.name} (${t.atsProvider}:${t.atsToken}): returned 0 postings, not closing its roles`);
    }
    tallies.set(t.sourceId, { name: t.name, tally });
    tally.fetched = postings.length;

    const workStart = Date.now();
    // Each posting is isolated: one bad payload logs and skips rather than
    // killing the run (which would also skip closeStaleJobs and leave the
    // board full of ghost jobs).
    await mapPool(postings, CONCURRENCY, async (raw) => {
      try {
        if (!raw.applyUrl || !raw.title || !isHttpUrl(raw.applyUrl)) {
          tally.invalid++;
          return;
        }
        const id = jobId(t.slug, raw.externalId);
        const hash = contentHash([
          raw.title,
          raw.descriptionText ?? raw.descriptionHtml,
          raw.locationRaw,
          raw.salaryMin,
          raw.salaryMax,
        ]);

        const existing = getExistingJob(db, id);
        if (existing && existing.contentHash === hash && existing.isClosed === 0) {
          markSeen(db, id, runStart); // unchanged → skip reprocessing (skips inference)
          tally.unchanged++;
          return;
        }

        const norm = normalize(raw, t.slug);
        const text = norm.descriptionText ?? "";
        const loc = parseLocation(norm.locationRaw, raw.remoteType, raw.remoteHint);
        const heuristicClass = classifyHeuristic(norm.title);

        // Local encoder decides scope. Skip it for titles the heuristic already
        // rules OUT — those are discarded regardless, and skipping is a third of
        // the nightly volume.
        //
        // There is no heuristic fallback below. encoderScore throws if the model
        // is missing or inference fails, which fails the run — deliberately.
        let cls: ClassifyResult;
        // The model's own p(in scope), kept whichever way the decision goes.
        // cls.confidence cannot stand in for it: on the heuristic-IN path below
        // the title prior wins and reports its pinned constant, so the number
        // the model actually produced is otherwise computed and discarded.
        // Stays undefined only where inference is skipped altogether.
        let modelScore: number | undefined;
        if (heuristicClass?.classification === "out") {
          tally.filtered++;
          cls = heuristicClass;
        } else {
          // raw, not norm, deliberately: these are the model's inputs, and
          // trainInferenceParity.test.ts pins them to what the corpus was built
          // from. Decoding here would silently move the decision boundary for
          // any advert carrying an entity.
          const p = await encoderScore(id, raw.title, t.name, raw.locationRaw ?? "", text);
          modelScore = p;
          tally.inferred++;
          if (heuristicClass?.classification === "in") {
            // Title looks IN. The model read the description, so let it veto an
            // over-broad title match (e.g. "Support Agent" caught by /agent/)
            // when it is confidently OUT; otherwise keep the heuristic prior.
            cls =
              1 - p >= ENCODER_VETO_CONFIDENCE
                ? { classification: "out", confidence: 1 - p, via: "model" }
                : heuristicClass;
          } else {
            // Ambiguous title → the model decides outright at the calibrated
            // operating point. Confidence is reported as distance from the
            // decision, so a 0.99 IN and a 0.01 OUT are both high-confidence.
            const isIn = p >= ENCODER_THRESHOLD;
            cls = { classification: isIn ? "in" : "out", confidence: isIn ? p : 1 - p, via: "model" };
          }
        }

        const skills =
          cls.classification === "in" ? tagHeuristic(text).skills : [];

        // Everything below the classification comes from the feed payload and
        // the heuristics derived from it. The LLM used to backfill country,
        // city, remoteType and seniority where the payload was silent; the
        // encoder classifies only, so those gaps now stay empty. Measured on
        // 3,703 live IN jobs, that costs 3.8% of country, 5.3% of city and
        // 26.2% of seniority values. remoteType is unaffected — parseLocation
        // always returns one when locationRaw is non-empty, which is always.
        upsertJob(db, {
          id,
          companyId: t.companyId,
          sourceId: t.sourceId,
          externalId: raw.externalId,
          // norm.*, not raw.*. normalize() decodes HTML entities so that
          // "R&amp;D Engineer" is stored once as "R&D Engineer" — its docstring
          // promises exactly that — but the decoded title and location were
          // computed and then thrown away here, and only the values derived
          // from them (normalizedTitle, dedupKey) were kept.
          slug: jobSlug(t.slug, norm.title, raw.externalId),
          title: norm.title,
          normalizedTitle: norm.normalizedTitle,
          descriptionHtml: raw.descriptionHtml,
          descriptionText: norm.descriptionText,
          applyUrl: raw.applyUrl,
          locationRaw: norm.locationRaw,
          country: loc.country ?? undefined,
          region: loc.region ?? undefined,
          city: loc.city ?? undefined,
          remoteType: loc.remoteType ?? undefined,
          seniority: inferSeniority(norm.title) ?? undefined,
          // An unlabelled number isn't a salary: the site would render it as
          // USD, and feeds that omit the currency are usually the non-USD ones
          // (a Graphcore posting shipped a bare 260400-352200, which is PLN —
          // ~$70k shown as $260k). Drop the pay rather than guess at it.
          // …and when the feed is silent, fall back to the description itself.
          // US pay-transparency law puts an explicit range in the body of a lot
          // of Workday/Greenhouse posts, and missing it renders "Not published"
          // on a page that visibly publishes one. The country goes in because a
          // bare "$" in a Canadian advert is CAD, not USD.
          ...pay(raw, parseSalaryFromDescription(text, loc.country)),
          classification: cls.classification,
          classificationConfidence: cls.confidence,
          modelScore,
          isDirect: 0,
          postedAt: raw.postedAt,
          updatedAt: raw.updatedAt,
          ingestedAt: runStart,
          contentHash: hash,
          dedupKey: norm.dedupKey,
          lastSeenAt: runStart,
        });
        setJobSkills(db, id, skills);
        tally.written++;
        if (cls.classification === "in") tally.listed++;
      } catch (e) {
        tally.errored++;
        console.warn(
          `  ! ${t.name}: posting "${raw.title ?? raw.externalId}" failed: ${(e as Error).message}`,
        );
      }
    });
    tally.workMs = Date.now() - workStart;
    console.log(`  ✓ ${t.name}: ${describe(tally)}`);
    await sleep(SLEEP_MS);
  }

  const closedBySource = closeStaleJobs(db, runStart, polledSourceIds);
  // Roles closed long enough ago that no snapshot still carries them. Nothing
  // else deletes rows, and each one holds the full advert twice — see
  // pruneClosedJobs for what that was costing the release asset.
  const pruned = pruneClosedJobs(db);
  // The other half of that bill, and the larger one: adverts the classifier
  // ruled out are open at their ATS for months, so pruning never reaches them,
  // and nothing has ever read their description. See dropOutOfScopeText.
  const emptied = dropOutOfScopeText(db);
  // One VACUUM for both. It rewrites the whole file, so it is much too
  // expensive to run twice, and without it SQLite keeps the freed pages for
  // reuse and the file never shrinks.
  if (pruned > 0 || emptied > 0) db.exec("VACUUM");
  db.close();

  const all = [...tallies.values()];
  const sum = (pick: (t: Tally) => number) =>
    all.reduce((n, { tally }) => n + pick(tally), 0);
  const closed = [...closedBySource.values()].reduce((n, c) => n + c, 0);

  // Gathered back up before the totals line, so a fortnight-dead board reads as
  // a dead board rather than as one more warning lost in four hours of log.
  if (feedFailures.length > 0) {
    console.log(`\nFeeds that returned nothing (${feedFailures.length}/${targets.length}):`);
    for (const f of feedFailures) console.log(`  ! ${f}`);
  }

  // `processed` is kept under its old name so runs stay comparable with older
  // logs; `filtered` + `inferred` are the new breakdown of what it cost.
  console.log(
    `\nIngest complete. fetched=${sum((t) => t.fetched)} unchanged=${sum((t) => t.unchanged)}` +
      ` invalid=${sum((t) => t.invalid)} filtered=${sum((t) => t.filtered)}` +
      ` inferred=${sum((t) => t.inferred)} processed=${sum((t) => t.written)}` +
      ` in-scope=${sum((t) => t.listed)} closed=${closed} feeds_polled=${all.length}` +
      ` feeds_failed=${failed} postings_errored=${sum((t) => t.errored)}` +
      (skippedForBudget > 0 ? ` feeds_skipped_for_budget=${skippedForBudget}` : "") +
      (pruned > 0 ? ` pruned=${pruned}` : "") +
      (emptied > 0 ? ` text_dropped=${emptied}` : "") +
      ` elapsed=${dur(Date.now() - runStartedMs)}`,
  );

  // Loud, because partial coverage that goes unnoticed looks exactly like a
  // quiet hiring week. Still exit 0 — see BUDGET_MS.
  if (skippedForBudget > 0) {
    console.warn(
      `\n::warning::ingest budget (${dur(BUDGET_MS)}) exhausted — ${skippedForBudget} of ${targets.length} source(s) not polled this run.` +
        ` Their roles are untouched, not closed, and they sort to the front of the next run (see listPollTargets).` +
        ` Raise INGEST_BUDGET_MS or trim companies.csv if a full sweep stops fitting in two nights.`,
    );
  }

  // Inference dominates the run — it is the only per-posting step that costs
  // seconds — so name the sources that spent the time. Without this the only
  // way to find them is to diff timestamps across a few thousand log lines.
  const slowest = all
    .map(({ name, tally }) => ({ name, tally, ms: tally.fetchMs + tally.workMs }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 10);
  if (slowest.length > 0 && slowest[0]!.ms >= 1000) {
    console.log(`\nSlowest sources (of ${all.length} polled):`);
    for (const { name, tally, ms } of slowest) {
      console.log(
        `  ${dur(ms).padStart(7)}  ${name} — ${tally.inferred} inferred, ${tally.fetched} fetched`,
      );
    }
  }

  // A source closing most of its board is usually a broken feed, not a hiring
  // freeze, and it is invisible in a single run-wide total.
  if (closedBySource.size > 0) {
    const top = [...closedBySource]
      .map(([sourceId, n]) => ({ name: tallies.get(sourceId)?.name ?? sourceId, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
    console.log(`\nClosures: ${closed} across ${closedBySource.size} sources:`);
    for (const { name, n } of top) console.log(`  ${String(n).padStart(5)}  ${name}`);
  }
}
