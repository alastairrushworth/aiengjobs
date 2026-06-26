import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  description?: string; // HTML
  descriptionPlain?: string;
  categories?: { location?: string; commitment?: string; allLocations?: string[] };
  createdAt?: number; // epoch ms
  workplaceType?: string; // unspecified | on-site | remote | hybrid
}

function leverRemote(wt?: string): RemoteType | undefined {
  switch ((wt ?? "").toLowerCase()) {
    case "remote":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "on-site":
    case "onsite":
      return "onsite";
    default:
      return undefined;
  }
}

// Lever public postings API (spec §6.1). On error Lever returns an object, not
// an array — treat that as "no board" rather than failing the run.
export const lever: Connector = {
  provider: "lever",
  endpoint: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  async fetchPostings(slug) {
    const res = await fetch(lever.endpoint(slug), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`lever ${slug} HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return (data as LeverPosting[])
      .map((j): RawPosting => {
        const html = j.description;
        return {
          externalId: j.id,
          title: j.text.trim(),
          descriptionHtml: html,
          descriptionText: j.descriptionPlain ?? (html ? stripHtml(html) : undefined),
          applyUrl: j.applyUrl ?? j.hostedUrl ?? "",
          locationRaw: j.categories?.location,
          employmentType: j.categories?.commitment,
          postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
          remoteType: leverRemote(j.workplaceType),
        };
      })
      .filter((p) => p.applyUrl.length > 0);
  },
};
