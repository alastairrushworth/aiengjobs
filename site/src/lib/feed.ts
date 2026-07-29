import type { Job } from "@aiengjobs/shared";
import { formatSalary, remoteLabel } from "./format.ts";
import { fxRates } from "./data.ts";
import { url } from "./url.ts";

// Feeds are a discovery channel (aggregators, newsletter tooling, readers), so
// they carry a useful summary rather than the full description — the point is to
// get the click, and a 3,000-word body per item makes the feed enormous.
const MAX_ITEMS = 100;

/** Escape text for an XML text node or attribute value. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// RFC 822 date, which is what RSS 2.0 requires (not ISO 8601).
function rfc822(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toUTCString() : undefined;
}

function summary(job: Job): string {
  const bits = [
    job.companyName,
    job.locationRaw,
    remoteLabel(job.remoteType),
    formatSalary(job, fxRates),
    job.skills.length ? `Skills: ${job.skills.slice(0, 6).join(", ")}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

export interface FeedOptions {
  title: string;
  description: string;
  /** Site-relative path of the page this feed mirrors, e.g. "/ai-agent-jobs/". */
  pagePath: string;
  /** Site-relative path of the feed itself, e.g. "/ai-agent-jobs/rss.xml". */
  feedPath: string;
  jobs: Job[];
  site: URL | undefined;
  generatedAt: string;
}

export function buildRssFeed(opts: FeedOptions): Response {
  const abs = (p: string) => new URL(url(p), opts.site).href;
  const items = opts.jobs.slice(0, MAX_ITEMS).map((job) => {
    const link = abs(`/jobs/${job.slug}/`);
    const pubDate = rfc822(job.postedAt ?? job.ingestedAt);
    return [
      "    <item>",
      `      <title>${xmlEscape(`${job.title} — ${job.companyName}`)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      // Slugs are stable and unique, so the URL is a safe permalink guid —
      // readers use it to avoid re-notifying on every poll.
      `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
      `      <description>${xmlEscape(summary(job))}</description>`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : "",
      ...job.clusters.map((c) => `      <category>${xmlEscape(c)}</category>`),
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${xmlEscape(opts.title)}</title>\n` +
    `    <link>${xmlEscape(abs(opts.pagePath))}</link>\n` +
    `    <description>${xmlEscape(opts.description)}</description>\n` +
    `    <language>en</language>\n` +
    `    <lastBuildDate>${rfc822(opts.generatedAt) ?? ""}</lastBuildDate>\n` +
    `    <atom:link href="${xmlEscape(abs(opts.feedPath))}" rel="self" type="application/rss+xml" />\n` +
    items.join("\n") +
    `\n  </channel>\n</rss>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
