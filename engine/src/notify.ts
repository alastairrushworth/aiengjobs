import { readFileSync } from "node:fs";
import { fetchRetry } from "./util/fetch.ts";
import type { SiteSnapshot } from "@aiengjobs/shared";
import { indexableSlugs } from "@aiengjobs/shared/indexable";
import { submitIndexing } from "./googleIndexing.ts";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  SITE_BASE,
  SITE_ORIGIN,
} from "./config.ts";

// IndexNow accepts up to 10,000 URLs per request.
const MAX_URLS_PER_REQUEST = 10_000;

/**
 * Cap on how many URLs one run will announce. A retag/reclassify pass can churn
 * thousands of listings at once, and firehosing that at the endpoint looks like
 * spam rather than news — the sitemap still carries the full picture.
 */
const MAX_URLS_PER_RUN = 2_000;

const jobUrl = (slug: string): string =>
  `${SITE_ORIGIN}${SITE_BASE}/jobs/${slug}/`;

/**
 * Read a snapshot, distinguishing "not there" from "there but broken".
 *
 * Both used to return null, and for the *previous* snapshot null means "nothing
 * to compare against, announce nothing" — which is right on a first run and
 * wrong on a corrupt file. A truncated prev-snapshot.json therefore produced a
 * run that logged "no job URLs changed" and exited 0, indistinguishable from a
 * quiet night, while every new role went unannounced.
 */
function readSnapshot(path: string): SiteSnapshot | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    // An empty or missing file is the documented first-run case (refresh.sh
    // writes an empty one when there is no published branch to diff against).
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`  ! could not read snapshot at ${path}: ${(e as Error).message}`);
    }
    return null;
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as SiteSnapshot;
  } catch (e) {
    console.warn(
      `  ! snapshot at ${path} is present but unreadable (${(e as Error).message}) — ` +
        `treating it as absent, so nothing will be announced this run.`,
    );
    return null;
  }
}

const openSlugs = (s: SiteSnapshot | null): Set<string> =>
  new Set((s?.jobs ?? []).filter((j) => !j.isClosed).map((j) => j.slug));

export interface UrlDelta {
  added: string[];
  removed: string[];
}

/**
 * Slugs that appeared or disappeared between two snapshots, under whichever
 * definition of "present" the caller cares about.
 *
 * No usable previous snapshot (first run on a fresh box) means everything would
 * look "new". Announcing 3,000 unchanged listings is noise, so treat it as
 * nothing to report and let the next run pick up the real delta.
 */
function delta(
  prev: SiteSnapshot | null,
  next: SiteSnapshot,
  present: (s: SiteSnapshot) => Set<string>,
): UrlDelta {
  if (!prev) return { added: [], removed: [] };
  const before = present(prev);
  const after = present(next);
  return {
    added: [...after].filter((s) => !before.has(s)).map(jobUrl),
    removed: [...before].filter((s) => !after.has(s)).map(jobUrl),
  };
}

/** Job URLs that opened or closed between two snapshots. */
export function diffSnapshots(prevPath: string, nextPath: string): UrlDelta {
  const next = readSnapshot(nextPath);
  if (!next) throw new Error(`cannot read new snapshot at ${nextPath}`);
  return delta(readSnapshot(prevPath), next, openSlugs);
}

/**
 * Announce changed URLs to the IndexNow participants (Bing, Yandex, Naver,
 * Seznam). Both sides of the delta matter: a new role should be findable within
 * minutes, and a closed one should stop being served just as fast.
 *
 * Best-effort by design — the caller treats failure as non-fatal, because a
 * missed notification costs freshness while a failed refresh costs the board.
 */
export async function submitIndexNow(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return true;
  if (!INDEXNOW_KEY) {
    console.warn("  ! IndexNow: no key configured, skipping");
    return false;
  }

  const host = new URL(SITE_ORIGIN).host;
  const keyLocation = `${SITE_ORIGIN}${SITE_BASE}/${INDEXNOW_KEY}.txt`;

  for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
    const batch = urls.slice(i, i + MAX_URLS_PER_REQUEST);
    // fetchRetry for the timeout: this runs after the snapshot is published, and
    // a hung POST here used to be one of the ways a run could sit until the job
    // timeout killed it.
    const res = await fetchRetry(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation, urlList: batch }),
    });
    // 200 = accepted, 202 = accepted but key validation pending. Anything else
    // is worth surfacing (403 = key file not reachable, 422 = URL/host mismatch).
    if (res.status !== 200 && res.status !== 202) {
      console.warn(
        `  ! IndexNow: HTTP ${res.status} for ${batch.length} URLs — ${await res.text().catch(() => "")}`,
      );
      return false;
    }
  }
  return true;
}

/**
 * Diff two snapshots and announce what changed. Wired into the nightly refresh
 * (see scripts/publish.sh), which hands over its pre-refresh copy.
 *
 * Two announcements, on two different deltas, because the two APIs are asking
 * different questions. IndexNow wants "this URL changed", so it takes the
 * open/closed delta. Google's Indexing API is licensed only for pages carrying
 * JobPosting markup, so it takes the delta of pages that actually carry it —
 * which additionally catches a role ageing out or losing to a duplicate, both
 * of which strip the markup while leaving the role open at the ATS.
 */
export async function notify(prevPath: string, nextPath: string): Promise<void> {
  const next = readSnapshot(nextPath);
  if (!next) throw new Error(`cannot read new snapshot at ${nextPath}`);
  const prev = readSnapshot(prevPath);

  const { added, removed } = delta(prev, next, openSlugs);
  if (added.length === 0 && removed.length === 0) {
    console.log("Notify: no job URLs changed.");
  } else {
    // Removals first: a dead listing in someone's search results is worse than
    // a new one arriving a minute late.
    const urls = [...removed, ...added].slice(0, MAX_URLS_PER_RUN);
    const capped = removed.length + added.length - urls.length;
    const ok = await submitIndexNow(urls);
    console.log(
      `Notify: ${added.length} new, ${removed.length} closed` +
        (capped > 0 ? `, ${capped} not announced (per-run cap)` : "") +
        ` — IndexNow ${ok ? "accepted" : "failed"}.`,
    );
  }

  const indexable = delta(prev, next, indexableSlugs);
  const google = await submitIndexing(indexable.added, indexable.removed);
  console.log(
    `Notify: ${indexable.added.length} gained JobPosting markup, ${indexable.removed.length} lost it` +
      ` — Indexing API accepted ${google.updated} updated, ${google.deleted} deleted` +
      (google.failed > 0 ? `, ${google.failed} rejected` : "") +
      (google.skipped > 0 ? `, ${google.skipped} skipped` : "") +
      (google.stopped ? ` (stopped: ${google.stopped})` : "") +
      ".",
  );
}
