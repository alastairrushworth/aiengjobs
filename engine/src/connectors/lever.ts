import type { Connector } from "./types.ts";

// Lever public postings API (spec §6.1). Honour robots Crawl-delay (1 req/sec/host).
// GET https://api.lever.co/v0/postings/{slug}?mode=json
export const lever: Connector = {
  provider: "lever",
  endpoint: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  async fetchPostings(slug) {
    // TODO Phase 1: fetch; map each posting -> RawPosting
    //   { externalId: id, title: text, descriptionHtml: descriptionPlain/description,
    //     applyUrl: hostedUrl, locationRaw: categories.location, updatedAt: createdAt }
    void slug;
    return [];
  },
};
