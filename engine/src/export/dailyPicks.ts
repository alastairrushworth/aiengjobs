import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job, SiteSnapshot } from "@aiengjobs/shared";
import {
  canonicalByDupKey,
  duplicateOfIn,
  listedJobs,
} from "@aiengjobs/shared/indexable";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The ledger of what /daily/rss.xml has announced, one entry per nightly run.
 *
 * Small enough to live in git alongside snapshot.meta.json, which publish.sh
 * already commits to main — and it has to, because this is *history*, not
 * derived data. Re-deriving yesterday's five from today's snapshot gives a
 * different answer the moment one of them closes: a sixth role slides into the
 * gap and gets announced days after the fact, to subscribers who were never
 * offered the role it replaced. Writing the picks down once makes them final.
 */
export const DAILY_PICKS_OUT =
  process.env.DAILY_PICKS_OUT ??
  join(here, "..", "..", "..", "site", "src", "data", "daily-picks.json");

/** How many roles a single night's pick carries. */
export const DAILY_PICK_SIZE = 5;

/**
 * Nights of history kept in the file, and so in the feed.
 *
 * A feed holding only tonight's five loses them for good to any subscriber that
 * misses a poll — and the poster is a hosted service on someone else's
 * schedule. Thirty nights is ~150 items, comfortably inside what the existing
 * feeds already emit, and it bounds a file that would otherwise grow forever.
 */
export const DAILY_PICKS_RETAINED_DAYS = 30;

export interface DailyPick {
  /** UTC date of the ingest run these came from, YYYY-MM-DD. */
  date: string;
  /** When the pick was made — the feed's pubDate for all five. */
  pickedAt: string;
  slugs: string[];
}

export interface DailyPicksFile {
  picks: DailyPick[];
}

const EMPTY: DailyPicksFile = { picks: [] };

/** Roles that arrived in the most recent ingest run and could be picked. */
function newestArrivals(snapshot: SiteSnapshot): Job[] {
  const open = snapshot.jobs.filter((j) => !j.isClosed);
  if (open.length === 0) return [];

  // ingest.ts stamps every job it writes in a run with one `runStart`, so the
  // maximum is that run's exact marker and equality against it selects the
  // night's arrivals with no date-window fuzz. Taken over every open role
  // rather than over the eligible ones below: if tonight's batch turns out to
  // have nothing pickable in it, the honest answer is "no picks tonight", not
  // "reach back to an older batch" — those roles were already offered.
  let latest = "";
  for (const j of open) if (j.ingestedAt > latest) latest = j.ingestedAt;

  // listedJobs applies the board's own listing rules (inside the age window, a
  // usable posted date, newest first); canonical filtering drops the five-way
  // requisitions that would otherwise fill every slot with one job.
  const listed = listedJobs(snapshot);
  const canonical = canonicalByDupKey(listed);
  return listed.filter(
    (j) => j.ingestedAt === latest && duplicateOfIn(canonical, j) === null,
  );
}

/**
 * The strongest new roles from the most recent run, or null when that run
 * brought nothing pickable.
 *
 * Ranks on `modelScore` — the encoder's own p(in scope) — and *only* on roles
 * that have one. `classificationConfidence` is not a substitute: for a title the
 * heuristic recognised it is a pinned constant, so ordering by it would rank the
 * roles too ambiguous to match a title pattern above the unmistakable ones. See
 * the field's note in shared/types.ts.
 *
 * Rows written before model_score existed carry no score and are skipped rather
 * than defaulted — a default is a fabricated ranking. The column fills in from
 * the first run after it ships, and only that run's arrivals are ever eligible,
 * so this self-corrects within a night.
 */
export function choosePicks(
  snapshot: SiteSnapshot,
  size = DAILY_PICK_SIZE,
): DailyPick | null {
  const arrivals = newestArrivals(snapshot);
  if (arrivals.length === 0) return null;

  const scored = arrivals.filter((j) => typeof j.modelScore === "number");
  if (scored.length === 0) return null;

  const slugs = scored
    // Slug is the final tie-break so the order is total: two roles can share a
    // score and a posted date, and an unstable sort would then reorder the
    // ledger between runs of the same data.
    .sort(
      (a, b) =>
        b.modelScore! - a.modelScore! ||
        Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? "") ||
        a.slug.localeCompare(b.slug),
    )
    .slice(0, size)
    .map((j) => j.slug);

  return {
    date: arrivals[0].ingestedAt.slice(0, 10),
    pickedAt: snapshot.generatedAt,
    slugs,
  };
}

/**
 * Read the ledger, distinguishing "not there" from "there but broken" — the same
 * distinction notify.ts draws about snapshots, for the same reason.
 *
 * Returns null for a file that exists and will not parse. The caller leaves such
 * a file alone: overwriting it would drop the record of what has already been
 * announced, and the next run would re-announce a month of roles to every
 * subscriber.
 */
export function readDailyPicks(path = DAILY_PICKS_OUT): DailyPicksFile | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw e;
  }
  if (!text.trim()) return EMPTY;
  try {
    const parsed = JSON.parse(text) as DailyPicksFile;
    if (!parsed || !Array.isArray(parsed.picks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Fold tonight's pick into the ledger. Pure — see writeDailyPicks for the I/O. */
export function mergePick(
  existing: DailyPicksFile,
  pick: DailyPick | null,
  retain = DAILY_PICKS_RETAINED_DAYS,
): DailyPicksFile {
  const picks = [...existing.picks];
  // A date already in the ledger is left exactly as it was. Two exports in one
  // UTC day (a re-run, a manual export) must not restate the day's five: the
  // second run would pick from the same arrivals but a changed board, and
  // anything that dropped out would have been announced and then withdrawn.
  if (pick && !picks.some((p) => p.date === pick.date)) picks.push(pick);
  picks.sort((a, b) => a.date.localeCompare(b.date));
  return { picks: picks.slice(-retain) };
}

/**
 * Choose tonight's five and append them to the ledger.
 *
 * Never throws: this is the last thing a successful export does, and a fault
 * here must not cost the night's snapshot or, through refresh.sh's exit code,
 * the night's database. The proportionate failure is one missing day in one
 * feed, said loudly.
 */
export function writeDailyPicks(
  snapshot: SiteSnapshot,
  path = DAILY_PICKS_OUT,
): void {
  try {
    const existing = readDailyPicks(path);
    if (existing === null) {
      console.error(
        `  ! ${path} exists but will not parse — leaving it untouched and ` +
          `skipping tonight's pick. Overwriting it would re-announce every ` +
          `role still in the window. Fix the file to resume /daily/rss.xml.`,
      );
      return;
    }

    const pick = choosePicks(snapshot);
    const alreadyRecorded =
      pick !== null && existing.picks.some((p) => p.date === pick.date);
    const merged = mergePick(existing, pick);
    writeFileSync(path, JSON.stringify(merged, null, 2) + "\n", "utf8");

    if (!pick) {
      console.log("Daily picks: nothing new to pick from this run");
    } else if (alreadyRecorded) {
      console.log(`Daily picks: ${pick.date} already recorded, left as it was`);
    } else {
      console.log(
        `Daily picks: ${pick.date} -> ${pick.slugs.length} roles (${merged.picks.length} days retained)`,
      );
    }
  } catch (e) {
    console.error(`  ! could not update ${path}: ${(e as Error).message}`);
  }
}
