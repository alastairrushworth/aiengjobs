import { formatSalary, postedAgo, remoteLabel, roleType, seniorityLabel } from "./format.ts";
import { logo } from "./logos.ts";
import { openJobs, fxRates, generatedAt } from "./data.ts";
import type { JobEntry } from "./jobEntry.ts";
import type { Job } from "@aiengjobs/shared";

/** Compact per-job record for the client-side filter/render — see lib/jobEntry.
 *  Served as /jobs-data.json (and one per landing) and fetched on first
 *  interaction, so listing HTML doesn't grow linearly with the job count. */

const DAY_MS = 86_400_000;
/** Stands in for "we don't know when this was posted", so an undated role falls
 *  outside every freshness window instead of into the freshest one. openJobs
 *  already excludes undated roles, so nothing hits this today. */
const UNDATED_AGE = 9999;

/**
 * @param jobs Roles the payload covers, already in the order the client should
 *   treat as "newest first". Defaults to the whole board (the homepage); each
 *   landing passes its own slice so its filter never has to scope client-side.
 */
export function buildJobsPayload(jobs: Job[] = openJobs): JobEntry[] {
  const genMs = Date.parse(generatedAt);
  const ageDays = (postedAt?: string): number => {
    const posted = postedAt ? Date.parse(postedAt) : NaN;
    if (!Number.isFinite(posted)) return UNDATED_AGE;
    return Math.max(0, Math.floor((genMs - posted) / DAY_MS));
  };

  return jobs.map((j) => ({
    slug: j.slug,
    t: j.title,
    c: j.companyName,
    l: j.locationRaw ?? "",
    s: formatSalary(j, fxRates) ?? "",
    p: postedAgo(j.postedAt, generatedAt) ?? "",
    ag: ageDays(j.postedAt),
    r: remoteLabel(j.remoteType) ?? "",
    rm: j.remoteType ?? "",
    sl: seniorityLabel(j.seniority) ?? "",
    sn: j.seniority ?? "",
    ro: roleType(j),
    co: j.country ?? "",
    ci: j.city ?? "",
    sk: j.skills,
    lg: logo(j.companySlug)?.file ?? "",
  }));
}
