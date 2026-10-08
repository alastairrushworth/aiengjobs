import { boardHiring, companyBySlug, fxRates, generatedAt, openJobs, openJobsByCompany } from "./data.ts";
import { summarizeCompanyHiring, type CompanyHiringSummary } from "./companyHiring.ts";

/**
 * lib/companyHiring bound to the live board, computed once per employer.
 *
 * The company page asks once; the job pages ask once per role, and OpenAI has
 * 140 of them — so the summary is cached rather than recomputed for every page
 * of the same employer.
 */
const cache = new Map<string, CompanyHiringSummary>();

/** Open postings per employer before duplicates fold — the unit the engine's openPostings counts in. */
const postingsByCompany = new Map<string, number>();
for (const j of openJobs) {
  postingsByCompany.set(j.companySlug, (postingsByCompany.get(j.companySlug) ?? 0) + 1);
}

export function companyHiring(companySlug: string): CompanyHiringSummary {
  let summary = cache.get(companySlug);
  if (!summary) {
    summary = summarizeCompanyHiring(
      openJobsByCompany.get(companySlug) ?? [],
      companyBySlug.get(companySlug),
      boardHiring,
      generatedAt,
      fxRates,
      postingsByCompany.get(companySlug) ?? 0,
    );
    cache.set(companySlug, summary);
  }
  return summary;
}
