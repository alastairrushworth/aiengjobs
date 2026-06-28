import type { Connector, RawPosting } from "./types.ts";
import { USER_AGENT, stripHtml } from "../util/html.ts";
import { mapPool } from "../util/concurrency.ts";

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
const PER_QUERY_MAX = 80; // cap on how deep we page each query (≈4 pages)
const MAX_DETAIL = 50; // cap on per-job detail fetches per run
const DETAIL_CONCURRENCY = 4;
const TECH_TITLE =
  /\b(engineer|engineering|developer|software|swe|machine learning|\bml\b|\bai\b|data|scien|research|quant|analytics|platform|infrastructure|architect|llm|nlp|intelligence|model|mlops|devops|sre)\b/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function wdFetch(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (res.status !== 429 || i >= attempts - 1) return res;
    await sleep(500 * 2 ** i); // 500ms, 1s, 2s
  }
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
  async fetchPostings(slug) {
    const p = parseSlug(slug);
    const jobsUrl = `${p.base}/wday/cxs/${p.tenant}/${p.site}/jobs`;

    // Union several single-term searches, de-duplicated by the stable externalPath.
    const byPath = new Map<string, WdListJob>();
    for (const q of QUERIES) {
      for (let offset = 0; offset < PER_QUERY_MAX; offset += PAGE) {
        const res = await wdFetch(jobsUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appliedFacets: {}, limit: PAGE, offset, searchText: q }),
        });
        if (!res.ok) throw new Error(`workday ${p.tenant} HTTP ${res.status}`);
        const data = (await res.json()) as { total?: number; jobPostings?: WdListJob[] };
        const batch = data.jobPostings ?? [];
        for (const j of batch) if (j.externalPath) byPath.set(j.externalPath, j);
        if (batch.length < PAGE) break;
      }
    }

    // Keep engineering-flavoured titles only, then bound the detail-fetch count.
    const kept = [...byPath.values()].filter((j) => TECH_TITLE.test(j.title));
    if (kept.length > MAX_DETAIL) {
      console.warn(
        `[workday] ${p.tenant}: ${kept.length} matched, capping detail fetch at ${MAX_DETAIL}`,
      );
    }
    const targets = kept.slice(0, MAX_DETAIL);

    return mapPool(targets, DETAIL_CONCURRENCY, async (j): Promise<RawPosting> => {
      // Detail carries the description, ISO start date and canonical URL; degrade
      // to the list row (title-only) if a single detail fetch fails.
      let info: WdInfo | undefined;
      try {
        const dr = await wdFetch(`${p.base}/wday/cxs/${p.tenant}/${p.site}${j.externalPath}`);
        if (dr.ok) info = ((await dr.json()) as { jobPostingInfo?: WdInfo }).jobPostingInfo;
      } catch {
        info = undefined;
      }
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
    });
  },
};
