import { formatSalary, postedAgo, remoteLabel, seniorityLabel } from "./format.ts";
import { logo } from "./logos.ts";
import { openJobs, fxRates, generatedAt } from "./data.ts";
import type { JobEntry } from "./jobEntry.ts";
import type { Job } from "@aiengjobs/shared";

/** Compact per-job record for the client-side filter/render — see lib/jobEntry.
 *  Served as /jobs-data.json (and one per landing) and fetched on first
 *  interaction, so listing HTML doesn't grow linearly with the job count. */

/**
 * @param jobs Roles the payload covers, already in the order the client should
 *   treat as "newest first". Defaults to the whole board (the homepage); each
 *   landing passes its own slice so its filter never has to scope client-side.
 */
export function buildJobsPayload(jobs: Job[] = openJobs): JobEntry[] {
  return jobs.map((j) => ({
    slug: j.slug,
    t: j.title,
    c: j.companyName,
    l: j.locationRaw ?? "",
    s: formatSalary(j, fxRates) ?? "",
    p: postedAgo(j.postedAt, generatedAt) ?? "",
    r: remoteLabel(j.remoteType) ?? "",
    rm: j.remoteType ?? "",
    sl: seniorityLabel(j.seniority) ?? "",
    sn: j.seniority ?? "",
    co: j.country ?? "",
    ci: j.city ?? "",
    sk: j.skills,
    lg: logo(j.companySlug)?.file ?? "",
  }));
}
