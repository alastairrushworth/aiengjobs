import type { Job } from "@aiengjobs/shared";
import { MAX_JOB_AGE_DAYS } from "@aiengjobs/shared/indexable";

/**
 * When a role stopped being listed, and whether that is recent enough for its
 * URL to still serve a tombstone.
 *
 * A role leaves the board one of three ways — it closes, it is delisted, or it
 * passes MAX_JOB_AGE_DAYS — and the tombstone window is measured from whichever
 * came FIRST. Measuring from the closure alone brought dead URLs back to life:
 * a role that aged out in October had its page 404 a week later, then closed at
 * the employer in mid-November and was handed a fresh week-long tombstone,
 * because its `closedAt` was new. On 2026-11-20 that was 129 of the 369 closed
 * tombstones and 9 of the 28 delisted ones — pages nobody holds a recent link
 * to, at URLs Googlebot had already been told were gone (it fetched
 * /jobs/openai-industrial-compute-7c82af/ as a 404 between the two states).
 * A URL that answers 404, then 200, then 404 again teaches a crawler nothing.
 *
 * Pure — handed its dates, like lib/cityPlaces — so the rule is testable
 * without a snapshot; lib/data binds it to one.
 */

const DAY_MS = 86_400_000;

const ms = (iso: string | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/**
 * The moment the role left the listings: the earlier of its exit (closed or
 * delisted) and the day it aged out. NaN when neither date is known.
 */
export function leftBoardAt(job: Pick<Job, "postedAt">, exitIso: string | undefined): number {
  const exit = ms(exitIso);
  const posted = ms(job.postedAt);
  const agedOut = Number.isFinite(posted) ? posted + MAX_JOB_AGE_DAYS * DAY_MS : NaN;
  if (!Number.isFinite(exit)) return agedOut;
  if (!Number.isFinite(agedOut)) return exit;
  return Math.min(exit, agedOut);
}

/**
 * Does a role that closed or was delisted still earn a tombstone page?
 *
 * The exit date is absent on snapshots older than the field; an exit of
 * unknown age is treated as recent, so an old snapshot builds what it used to.
 */
export function inTombstoneWindow(
  job: Pick<Job, "postedAt">,
  exitIso: string | undefined,
  generatedAt: string,
  windowDays: number,
): boolean {
  if (!Number.isFinite(ms(exitIso))) return true;
  return (Date.parse(generatedAt) - leftBoardAt(job, exitIso)) / DAY_MS <= windowDays;
}
