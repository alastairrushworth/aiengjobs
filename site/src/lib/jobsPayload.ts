import {
  formatSalary,
  isNewJob,
  remoteLabel,
  roleType,
  salaryRank,
  seniorityLabel,
} from "./format.ts";
import { openJobs, fxRates, generatedAt } from "./data.ts";

/** Compact per-job record for the homepage's client-side filter/sort/render.
 *  Served as /jobs-data.json (fetched on first interaction) so the landing
 *  HTML doesn't grow linearly with the job count. */
export interface JobPayloadEntry {
  slug: string;
  t: string; // title
  c: string; // company name
  l: string; // raw location
  s: string; // formatted salary ("" when unpublished)
  sr: number; // salary sort rank (annualized USD, 0 = unranked)
  n: 0 | 1; // new-this-week badge (cards carry no posted-date stamp — see JobCard)
  r: string; // remote label
  sl: string; // seniority label
  sn: string; // seniority id (filter value)
  ro: string; // role-type family (filter value)
  co: string; // country code (filter value)
  sk: string[]; // skills
}

export function buildJobsPayload(): JobPayloadEntry[] {
  return openJobs.map((j) => ({
    slug: j.slug,
    t: j.title,
    c: j.companyName,
    l: j.locationRaw ?? "",
    s: formatSalary(j, fxRates) ?? "",
    sr: salaryRank(j, fxRates),
    n: isNewJob(j.postedAt, generatedAt) ? 1 : 0,
    r: remoteLabel(j.remoteType) ?? "",
    sl: seniorityLabel(j.seniority) ?? "",
    sn: j.seniority ?? "",
    ro: roleType(j),
    co: j.country ?? "",
    sk: j.skills,
  }));
}
