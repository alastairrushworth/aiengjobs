import {
  formatSalary,
  postedAgo,
  remoteLabel,
  roleType,
  salaryRank,
  seniorityLabel,
} from "./format.ts";
import { logo } from "./logos.ts";
import { openJobs, fxRates, generatedAt } from "./data.ts";
import type { Job } from "@aiengjobs/shared";

/** Compact per-job record for the client-side filter/sort/render.
 *  Served as /jobs-data.json (and one per landing) and fetched on first
 *  interaction, so listing HTML doesn't grow linearly with the job count. */
export interface JobPayloadEntry {
  slug: string;
  t: string; // title
  c: string; // company name
  l: string; // raw location
  s: string; // formatted salary ("" when unpublished)
  sr: number; // salary sort rank (annualized USD, 0 = unranked)
  p: string; // relative posted stamp, "today" / "3d ago" ("" when undated)
  r: string; // remote label
  sl: string; // seniority label
  sn: string; // seniority id (filter value)
  ro: string; // role-type family (filter value)
  co: string; // country code (filter value)
  sk: string[]; // skills
  // Logo filename ("" when we have none — the card falls back to a monogram).
  // Repeated per job rather than shipped as a company→file map: ~300 distinct
  // values across the payload compress to almost nothing, and it keeps the
  // client renderer a straight field read.
  lg: string;
}

/**
 * @param jobs Roles the payload covers, already in the order the client should
 *   treat as "newest first". Defaults to the whole board (the homepage); each
 *   landing passes its own slice so its filter never has to scope client-side.
 */
export function buildJobsPayload(jobs: Job[] = openJobs): JobPayloadEntry[] {
  return jobs.map((j) => ({
    slug: j.slug,
    t: j.title,
    c: j.companyName,
    l: j.locationRaw ?? "",
    s: formatSalary(j, fxRates) ?? "",
    sr: salaryRank(j, fxRates),
    p: postedAgo(j.postedAt, generatedAt) ?? "",
    r: remoteLabel(j.remoteType) ?? "",
    sl: seniorityLabel(j.seniority) ?? "",
    sn: j.seniority ?? "",
    ro: roleType(j),
    co: j.country ?? "",
    sk: j.skills,
    lg: logo(j.companySlug)?.file ?? "",
  }));
}
