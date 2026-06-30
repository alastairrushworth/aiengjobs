import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT } from "../util/html.ts";
import {
  AI_QUERIES,
  TECH_TITLE,
  parseJsonLdJobs,
  jsonLdText,
} from "../util/enterprise.ts";

// SAP SuccessFactors career sites. SuccessFactors exposes no single public JSON
// feed across tenants (OData jobRequisition is usually auth-gated), so — like
// the iCIMS connector — we drive the public Career Site Builder search and read
// the schema.org JobPosting JSON-LD it renders. The seed slug encodes the
// career host and the SF company id as "host:company" (e.g.
// "career2.successfactors.eu:reckittb01"). EXPERIMENTAL: SF markup varies by
// tenant generation (CSB vs legacy careersection); validate each company on a
// live ingest run. The classifier does the rest.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseSlug(slug: string): { host: string; company: string } {
  const [host, company] = slug.split(":");
  if (!host || !company) {
    throw new Error(`successfactors slug must be "host:company", got "${slug}"`);
  }
  return { host, company };
}

// Career Site Builder search first, then the legacy careersection search; both
// render JobPosting JSON-LD when results exist.
function searchUrls(host: string, company: string, q: string): string[] {
  const kw = encodeURIComponent(q);
  const co = encodeURIComponent(company);
  return [
    `https://${host}/search/?q=${kw}&company=${co}`,
    `https://${host}/careersection/2/jobsearch.ftl?company=${co}&searchText=${kw}`,
  ];
}

export const successfactors: Connector = {
  provider: "successfactors",
  endpoint: (slug) => {
    const { host, company } = parseSlug(slug);
    return `https://${host}/search/?company=${encodeURIComponent(company)}`;
  },
  async fetchPostings(slug) {
    const { host, company } = parseSlug(slug);

    const byKey = new Map<string, RawPosting>();
    let anyOk = false;
    for (const q of AI_QUERIES) {
      for (const url of searchUrls(host, company, q)) {
        let html: string;
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
          });
          if (!res.ok) continue; // try the next URL shape
          anyOk = true;
          html = await res.text();
        } catch {
          continue;
        }
        for (const job of parseJsonLdJobs(html)) {
          if (!job.title || !TECH_TITLE.test(job.title)) continue;
          const key = job.url ?? job.identifier ?? job.title;
          if (byKey.has(key)) continue;
          byKey.set(key, {
            externalId: job.identifier ?? key,
            title: job.title.trim(),
            descriptionHtml: job.descriptionHtml,
            descriptionText: jsonLdText(job.descriptionHtml),
            applyUrl: job.url ?? url,
            locationRaw: job.location,
            postedAt: job.datePosted,
          });
        }
        if (byKey.size) break; // got results from this URL shape; skip the fallback
      }
      await sleep(150);
    }

    // Distinguish "site unreachable" (throw, so we don't wrongly expire jobs)
    // from "reachable but no matching roles" (legitimately empty).
    if (!anyOk) throw new Error(`successfactors ${host} unreachable`);
    return [...byKey.values()];
  },
};
