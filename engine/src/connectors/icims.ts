import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT } from "../util/html.ts";
import { mapPool } from "../util/concurrency.ts";
import {
  AI_QUERIES,
  TECH_TITLE,
  parseJsonLdJobs,
  jsonLdText,
} from "../util/enterprise.ts";

// iCIMS career portals. iCIMS has no clean public JSON feed, so we scrape the
// portal's server-rendered search pages for job links (which the AI/ML keyword
// search already narrows), then read the schema.org JobPosting JSON-LD that
// iCIMS embeds on each detail page — a far stabler parse than its per-tenant
// markup. The seed slug is the portal subdomain (e.g. "uscareers-intuit"); pass
// a full host if the portal isn't on *.icims.com. The classifier does the rest.
const PAGES_PER_QUERY = 2; // iCIMS paginates via pr=0,1,...
const MAX_DETAIL = 50;
const DETAIL_CONCURRENCY = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostOf(slug: string): string {
  return slug.includes(".") ? slug : `${slug}.icims.com`;
}

async function ifetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
}

export const icims: Connector = {
  provider: "icims",
  endpoint: (slug) => `https://${hostOf(slug)}/jobs/search`,
  async fetchPostings(slug) {
    const host = hostOf(slug);
    const base = `https://${host}`;

    // Collect distinct job-detail paths across the union of keyword searches.
    const paths = new Set<string>();
    for (const q of AI_QUERIES) {
      for (let pr = 0; pr < PAGES_PER_QUERY; pr++) {
        const url = `${base}/jobs/search?ss=1&searchRelation=keyword_all&searchKeyword=${encodeURIComponent(q)}&pr=${pr}`;
        const res = await ifetch(url);
        if (!res.ok) {
          if (pr === 0) throw new Error(`icims ${host} HTTP ${res.status}`);
          break; // a later page 404-ing just means we ran past the results
        }
        const html = await res.text();
        const before = paths.size;
        // Job detail links look like /jobs/<reqId>/<title-slug>/job
        const re = /\/jobs\/(\d+)\/[A-Za-z0-9._~%-]+\/job/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html))) paths.add(m[0]);
        if (paths.size === before) break; // no new jobs on this page
        await sleep(150);
      }
    }

    const targets = [...paths].slice(0, MAX_DETAIL);
    if (paths.size > MAX_DETAIL) {
      console.warn(
        `[icims] ${host}: ${paths.size} matched, capping detail fetch at ${MAX_DETAIL}`,
      );
    }

    const mapped = await mapPool(
      targets,
      DETAIL_CONCURRENCY,
      async (path): Promise<RawPosting | null> => {
        const jobUrl = `${base}${path}`;
        let html: string;
        try {
          const dr = await ifetch(jobUrl);
          if (!dr.ok) return null;
          html = await dr.text();
        } catch {
          return null;
        }
        const job = parseJsonLdJobs(html)[0];
        if (!job?.title || !TECH_TITLE.test(job.title)) return null;
        const reqId = path.split("/")[2];
        return {
          externalId: job.identifier ?? reqId,
          title: job.title.trim(),
          descriptionHtml: job.descriptionHtml,
          descriptionText: jsonLdText(job.descriptionHtml),
          applyUrl: job.url ?? jobUrl,
          locationRaw: job.location,
          postedAt: job.datePosted,
        };
      },
    );

    return mapped.filter((p): p is RawPosting => p !== null);
  },
};
