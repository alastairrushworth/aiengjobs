import { readFileSync } from "node:fs";
import { fetchRetry } from "./util/fetch.ts";
import type { SiteSnapshot } from "@aiengjobs/shared";
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

function readSnapshot(path: string): SiteSnapshot | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SiteSnapshot;
  } catch {
    return null;
  }
}

const openSlugs = (s: SiteSnapshot | null): Set<string> =>
  new Set((s?.jobs ?? []).filter((j) => !j.isClosed).map((j) => j.slug));

export interface UrlDelta {
  added: string[];
  removed: string[];
}

/** Job URLs that appeared or disappeared between two snapshots. */
export function diffSnapshots(prevPath: string, nextPath: string): UrlDelta {
  const next = readSnapshot(nextPath);
  if (!next) throw new Error(`cannot read new snapshot at ${nextPath}`);
  const prev = readSnapshot(prevPath);

  const before = openSlugs(prev);
  const after = openSlugs(next);

  // No usable previous snapshot (first run on a fresh box) means everything
  // would look "new". Announcing 3,000 unchanged listings is noise, so treat it
  // as nothing to report and let the next run pick up the real delta.
  if (!prev) return { added: [], removed: [] };

  const added = [...after].filter((s) => !before.has(s)).map(jobUrl);
  const removed = [...before].filter((s) => !after.has(s)).map(jobUrl);
  return { added, removed };
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
 * (see scripts/refresh.sh), which hands over its pre-refresh copy.
 */
export async function notify(prevPath: string, nextPath: string): Promise<void> {
  const { added, removed } = diffSnapshots(prevPath, nextPath);
  if (added.length === 0 && removed.length === 0) {
    console.log("Notify: no job URLs changed.");
    return;
  }

  // Removals first: a dead listing in someone's search results is worse than a
  // new one arriving a minute late.
  const urls = [...removed, ...added].slice(0, MAX_URLS_PER_RUN);
  const capped = removed.length + added.length - urls.length;
  const ok = await submitIndexNow(urls);
  console.log(
    `Notify: ${added.length} new, ${removed.length} closed` +
      (capped > 0 ? `, ${capped} not announced (per-run cap)` : "") +
      ` — IndexNow ${ok ? "accepted" : "failed"}.`,
  );
}
