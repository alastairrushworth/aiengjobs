import type { Job } from "@aiengjobs/shared";
import { formatSalary, remoteLabel } from "./format.ts";
import { fxRates } from "./data.ts";
import { ogImagePath } from "./og/policy.ts";
import { url } from "./url.ts";

// Feeds are a discovery channel (aggregators, newsletter tooling, readers), so
// they carry a useful summary rather than the full description — the point is to
// get the click, and a 3,000-word body per item makes the feed enormous.
const MAX_ITEMS = 100;

/**
 * Characters XML 1.0 forbids outright, even escaped: the C0 controls other than
 * tab, newline and carriage return, plus unpaired surrogates.
 *
 * Escaping is not enough for these — `&#1;` is just as illegal as a raw 0x01 —
 * and one of them anywhere in the document makes the *whole feed* unparseable,
 * not just its item. Titles, company names and locations all come from
 * third-party ATS payloads, so "nothing has ever sent one" is a property of this
 * month's data rather than of the format.
 */
const XML_ILLEGAL = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]" +
    "|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])" +
    "|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]",
  "g",
);

/** Escape text for an XML text node or attribute value. */
export function xmlEscape(s: string): string {
  return s
    .replace(XML_ILLEGAL, "")
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
  /**
   * Override an item's pubDate. Defaults to the ATS's posted date, which is what
   * a "newest roles" feed means — but a feed of *picks* is dated by when the
   * board picked, not by when the employer filed the requisition.
   */
  pubDateFor?: (job: Job) => string | undefined;
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
  // ogImagePath has already applied the base prefix, so it must not go through
  // `abs` — under a non-root base that would prefix it twice.
  const absPrefixed = (p: string) => new URL(p, opts.site).href;
  const items = opts.jobs.slice(0, MAX_ITEMS).map((job) => {
    const link = abs(`/jobs/${job.slug}/`);
    const pubDate = rfc822(
      opts.pubDateFor ? opts.pubDateFor(job) : (job.postedAt ?? job.ingestedAt),
    );
    const card = absPrefixed(ogImagePath(job));
    return [
      "    <item>",
      `      <title>${xmlEscape(`${job.title} — ${job.companyName}`)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      // Slugs are stable and unique, so the URL is a safe permalink guid —
      // readers use it to avoid re-notifying on every poll.
      `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
      `      <description>${xmlEscape(summary(job))}</description>`,
      // The role's share card, for the half of the world that composes a post
      // from the feed rather than waiting for the platform to unfurl the link.
      // RSS-to-social tools read one or the other, and which one is not
      // something this end gets to know — so say it both ways.
      //
      // No <enclosure>, which some of those tools also read: RSS 2.0 makes its
      // `length` attribute required, and the feed is built without rendering
      // the images, so the only length available here would be a lie. Media RSS
      // asks for no such thing and every one of these tools understands it.
      `      <media:content url="${xmlEscape(card)}" medium="image" type="image/png" width="1200" height="630" />`,
      `      <media:thumbnail url="${xmlEscape(card)}" width="1200" height="630" />`,
      pubDate ? `      <pubDate>${pubDate}</pubDate>` : "",
      ...job.clusters.map((c) => `      <category>${xmlEscape(c)}</category>`),
      "    </item>",
    ]
      .filter(Boolean)
      .join("\n");
  });

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" ` +
    `xmlns:media="http://search.yahoo.com/mrss/">\n` +
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
