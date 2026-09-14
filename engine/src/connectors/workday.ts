import type { Connector, RawPosting } from "./types.ts";
import { stripHtml } from "../util/html.ts";
import { fetchDetail, fetchRetry } from "../util/fetch.ts";
import { guardedPool } from "../util/concurrency.ts";
import { planDetailFetch } from "../util/enterprise.ts";

// Workday "CXS" career-site API. A Workday site is keyed by THREE parts — tenant,
// datacenter, and site path — so the seed slug encodes them as "tenant:dc:site"
// (e.g. "capitalone:wd12:Capital_One"). Enterprise Workday boards run to
// thousands of mostly non-engineering roles, so — unlike the other connectors,
// which return a company's whole board — we query the AI/ML slice server-side and
// keep only engineering-flavoured titles; the strict classifier does the rest.
// searchText semantics vary by tenant (some match title+description, some only
// title; multi-word can be AND-ish), so we UNION several single-term queries
// rather than rely on one — that's the only way to get consistent recall.
// Target this board's actual scope (LLM/GenAI/ML engineering), not generic bank
// data-science/risk roles — that keeps the fetch small and precision high.
const QUERIES = ["machine learning", "generative ai", "llm"];
const PAGE = 20; // Workday hard-caps the list page size at 20
// How deep to page each query. The listing is what tells us a stored role is
// still on the board, so it has to reach past everything we have ever ingested
// from it: at the old 80 (4 pages), Capital One's "machine learning" query alone
// ran to 444 hits and the roles past the window could never be confirmed
// either way. 20 pages is ~10s per query; a query with more hits than this
// marks the result partial (see PostingsResult).
const PER_QUERY_MAX = 400;
const MAX_DETAIL = 50; // cap on per-job detail fetches per run
const DETAIL_CONCURRENCY = 4;
const TECH_TITLE =
  /\b(engineer|engineering|developer|software|swe|machine learning|\bml\b|\bai\b|data|scien|research|quant|analytics|platform|infrastructure|architect|llm|nlp|intelligence|model|mlops|devops|sre)\b/i;

interface WdParts {
  tenant: string;
  dc: string;
  site: string;
  base: string;
}
function parseSlug(slug: string): WdParts {
  const [tenant, dc, site] = slug.split(":");
  if (!tenant || !dc || !site) {
    throw new Error(`workday slug must be "tenant:dc:site", got "${slug}"`);
  }
  return { tenant, dc, site, base: `https://${tenant}.${dc}.myworkdayjobs.com` };
}

interface WdListJob {
  title: string;
  externalPath: string;
  locationsText?: string;
  bulletFields?: string[]; // [reqId]
}
interface WdInfo {
  title?: string;
  jobDescription?: string; // HTML
  location?: string;
  startDate?: string; // ISO date
  timeType?: string;
  jobReqId?: string;
  externalUrl?: string;
}

export const workday: Connector = {
  provider: "workday",
  endpoint: (slug) => {
    const p = parseSlug(slug);
    return `${p.base}/wday/cxs/${p.tenant}/${p.site}/jobs`;
  },
  async fetchPostings(slug, ctx) {
    const p = parseSlug(slug);
    const jobsUrl = `${p.base}/wday/cxs/${p.tenant}/${p.site}/jobs`;

    // Union several single-term searches, de-duplicated by the stable externalPath.
    const byPath = new Map<string, WdListJob>();
    // A query with more hits than we page through leaves roles we cannot
    // vouch for either way, so the listing is reported as truncated.
    let truncated = false;
    for (const q of QUERIES) {
      for (let offset = 0; offset < PER_QUERY_MAX; offset += PAGE) {
        const res = await fetchRetry(jobsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText: q }),
        });
        if (!res.ok) throw new Error(`workday ${p.tenant} HTTP ${res.status}`);
        const data = (await res.json()) as { total?: number; jobPostings?: WdListJob[] };
        const batch = data.jobPostings ?? [];
        for (const j of batch) {
          // externalPath comes from the API response — only accept plain
          // absolute paths so a crafted value can't redirect the detail fetch.
          if (j.externalPath?.startsWith("/") && !j.externalPath.includes(".."))
            byPath.set(j.externalPath, j);
        }
        if (batch.length < PAGE) break;
        // A full final page: more hits than we page through, unless `total`
        // says otherwise (a tenant that omits it gets the cautious reading).
        if (offset + PAGE >= PER_QUERY_MAX && !(data.total !== undefined && data.total <= PER_QUERY_MAX)) {
          truncated = true;
        }
      }
    }

    // The list row's req id, which is also what the detail path stores as the
    // external id (see below), so the two sets key the same jobs.
    const idOf = (j: WdListJob) => j.bulletFields?.[0] ?? j.externalPath;
    // Keep engineering-flavoured titles only, then bound the detail-fetch count.
    const kept = [...byPath.values()].filter((j) => TECH_TITLE.test(j.title));
    const { targets, seen } = planDetailFetch(
      kept,
      (j) => ({ id: idOf(j), title: j.title.trim() }),
      MAX_DETAIL,
      ctx,
    );
    if (seen.length > 0) {
      console.warn(
        `[workday] ${p.tenant}: ${kept.length} matched, fetching detail for ${targets.length}, ${seen.length} marked seen`,
      );
    }
    if (truncated) {
      console.warn(`[workday] ${p.tenant}: a query ran past ${PER_QUERY_MAX} hits, listing is partial`);
    }

    const postings = await guardedPool(
      targets,
      DETAIL_CONCURRENCY,
      `workday ${p.tenant}`,
      async (j, attempt): Promise<RawPosting> => {
        // Detail carries the description, ISO start date and canonical URL;
        // degrade to the list row (title-only) if a single detail fetch fails.
        const info = await attempt(async () => {
          const dr = await fetchDetail(
            `${p.base}/wday/cxs/${p.tenant}/${p.site}${j.externalPath}`,
            { headers: { Accept: "application/json" } },
          );
          return ((await dr.json()) as { jobPostingInfo?: WdInfo }).jobPostingInfo;
        });
        const html = info?.jobDescription;
        const posted =
          info?.startDate && !Number.isNaN(Date.parse(info.startDate))
            ? new Date(info.startDate).toISOString()
            : undefined;
        return {
          externalId: j.bulletFields?.[0] ?? info?.jobReqId ?? j.externalPath,
          title: (info?.title ?? j.title).trim(),
          descriptionHtml: html || undefined,
          descriptionText: html ? stripHtml(html) : undefined,
          applyUrl: info?.externalUrl ?? `${p.base}/${p.site}${j.externalPath}`,
          locationRaw: info?.location ?? j.locationsText,
          employmentType: info?.timeType,
          postedAt: posted,
        };
      },
    );
    return { postings, partial: truncated, seen };
  },
};
