import ledger from "../data/daily-picks.json";
import type { Job } from "@aiengjobs/shared";
import { openJobs } from "./data.ts";

/**
 * One night's five, as the engine recorded them.
 *
 * Written by engine/src/export/dailyPicks.ts and committed to main by
 * scripts/publish.sh — this file only reads. The ledger is history, not derived
 * data: re-deriving which five were strongest on a past night from a later
 * snapshot gives different answers as roles close, and the feed would then
 * announce replacements days after the fact.
 */
export interface DailyPick {
  /** UTC date of the ingest run the picks came from. */
  date: string;
  /** When the choice was made — the feed's pubDate for all five. */
  pickedAt: string;
  slugs: string[];
}

// Same cheap shape assertion data.ts makes about the snapshot, for the same
// reason: a malformed file should fail the build rather than type-lie its way
// into a feed.
const raw = ledger as unknown as { picks?: unknown };
if (!raw || !Array.isArray(raw.picks)) {
  throw new Error("daily-picks.json has an unexpected shape — refusing to build");
}

/** Every recorded pick, newest night first. */
export const dailyPicks: DailyPick[] = (raw.picks as DailyPick[])
  .filter((p) => p && typeof p.date === "string" && Array.isArray(p.slugs))
  .sort((a, b) => b.date.localeCompare(a.date));

/** Every slug the daily feed has ever announced. */
export function dailyPickSlugs(): Set<string> {
  return new Set(dailyPicks.flatMap((p) => p.slugs));
}

export interface DailyFeedItem {
  job: Job;
  /** RFC-822-able timestamp: when the board picked it, not when the ATS posted it. */
  pickedAt: string;
}

/**
 * The feed's items: every recorded pick that is still an open role, newest night
 * first and in pick order within a night.
 *
 * Closed roles are dropped. A subscriber that already saw an item has it — the
 * guid is the permalink, so nothing re-announces — but one connecting today
 * would otherwise have a dead requisition posted to their timeline as news.
 * The ledger itself keeps the full record either way; this is a view of it.
 */
export const dailyFeedItems: DailyFeedItem[] = (() => {
  const bySlug = new Map(openJobs.map((j) => [j.slug, j]));
  const items: DailyFeedItem[] = [];
  for (const pick of dailyPicks) {
    for (const slug of pick.slugs) {
      const job = bySlug.get(slug);
      if (job) items.push({ job, pickedAt: pick.pickedAt });
    }
  }
  return items;
})();
