import snapshot from "../data/snapshot.json";
import type { SiteSnapshot, Job } from "@aiengjobs/shared";

// The single place the untyped snapshot JSON crosses into typed code, with a
// cheap shape assertion so a malformed nightly export fails the build loudly
// instead of type-lying its way through every page.
const data = snapshot as unknown as SiteSnapshot;
if (!data || !Array.isArray(data.jobs) || !Array.isArray(data.companies) || !data.generatedAt) {
  throw new Error("snapshot.json has an unexpected shape — refusing to build");
}

// Staleness guard: if the nightly refresh dies, every freshness signal decays
// together ("Updated" date, sitemap lastmod, JobPosting validThrough, "posted
// Xd ago") and ghost jobs accumulate on a "no ghost jobs" board. Warn early,
// fail loudly once the snapshot is clearly dead. Deliberate rebuilds of an old
// snapshot can set ALLOW_STALE_SNAPSHOT=1.
const snapshotAgeDays = (Date.now() - Date.parse(data.generatedAt)) / 86_400_000;
if (snapshotAgeDays > 5 && !process.env.ALLOW_STALE_SNAPSHOT) {
  throw new Error(
    `snapshot.json is ${Math.floor(snapshotAgeDays)} days old — the nightly refresh ` +
      `loop is probably broken. Fix the droplet job (or set ALLOW_STALE_SNAPSHOT=1 ` +
      `to build anyway).`,
  );
}
if (snapshotAgeDays > 2) {
  console.warn(
    `[data] snapshot.json is ${snapshotAgeDays.toFixed(1)} days old — check the nightly refresh loop.`,
  );
}

export const generatedAt: string = data.generatedAt;
export const fxRates: Record<string, number> = data.fxRates ?? {};
export const companies = data.companies;

const postedTs = (j: Job): number => (j.postedAt ? Date.parse(j.postedAt) || 0 : 0);

/** Open roles, newest first (roles without a posted date sink to the bottom). */
export const openJobs: Job[] = data.jobs
  .filter((j) => !j.isClosed)
  .sort((a, b) => postedTs(b) - postedTs(a));

/** Recently-closed roles — rendered as noindexed tombstone pages, not listed. */
export const closedJobs: Job[] = data.jobs.filter((j) => j.isClosed);
