import type { APIRoute } from "astro";
import { buildRssFeed } from "../../lib/feed.ts";
import { dailyFeedItems } from "../../lib/dailyPicks.ts";
import { generatedAt } from "../../lib/data.ts";

/**
 * The day's five: /daily/rss.xml.
 *
 * The other feeds carry everything new, 50–160 roles on a typical night, which
 * is the right shape for a reader and the wrong shape for a timeline. This one
 * carries the five the engine ranked highest by the classifier's own p(in
 * scope), and nothing else — the point is that a subscriber can post all of it.
 *
 * Which five is not decided here. It is decided once, at export time, and
 * written to daily-picks.json; see engine/src/export/dailyPicks.ts for why that
 * has to be a record rather than a query.
 */

// Built once, not searched per item.
const pickedAt = new Map(dailyFeedItems.map((i) => [i.job.slug, i.pickedAt]));

export const GET: APIRoute = ({ site }) =>
  buildRssFeed({
    title: "frontierroles.com — the day's five best new AI roles",
    description:
      "Five new AI engineering roles a day, ranked by the board's own classifier. First-party ATS listings, picked once a night and never revised.",
    pagePath: "/",
    feedPath: "/daily/rss.xml",
    jobs: dailyFeedItems.map((i) => i.job),
    // The night the board picked the role, not the day the employer filed the
    // requisition. Those differ by weeks on a lot of ATS payloads, and a poster
    // that orders by pubDate — most of them do — would put a three-week-old
    // posted date below everything it has already sent and never reach it.
    pubDateFor: (job) => pickedAt.get(job.slug),
    site,
    generatedAt,
  });
