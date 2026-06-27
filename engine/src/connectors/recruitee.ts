import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { USER_AGENT, stripHtml } from "../util/html.ts";

interface RecruiteeOffer {
  id: number;
  title: string;
  status?: string;
  description?: string; // HTML
  requirements?: string; // HTML
  careers_url?: string;
  careers_apply_url?: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  employment_type_code?: string;
  created_at?: string; // "2025-12-16 22:33:14 UTC"
  published_at?: string; // same format
  updated_at?: string; // same format
}

function recruiteeRemote(o: RecruiteeOffer): RemoteType | undefined {
  if (o.remote) return "remote";
  if (o.hybrid) return "hybrid";
  if (o.on_site) return "onsite";
  return undefined;
}

// Recruitee returns "2025-12-16 22:33:14 UTC" rather than ISO 8601.
function recruiteeDate(s?: string): string | undefined {
  if (!s) return undefined;
  const d = new Date(s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

// Recruitee public offers API (no auth) — board lives at {slug}.recruitee.com.
export const recruitee: Connector = {
  provider: "recruitee",
  endpoint: (slug) => `https://${slug}.recruitee.com/api/offers/`,
  async fetchPostings(slug) {
    const res = await fetch(recruitee.endpoint(slug), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`recruitee ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { offers?: RecruiteeOffer[] };

    return (data.offers ?? [])
      .filter((o) => (o.status ?? "published") === "published")
      .map((o): RawPosting => {
        const html = [o.description, o.requirements].filter(Boolean).join("\n");
        return {
          externalId: String(o.id),
          title: o.title.trim(),
          descriptionHtml: html || undefined,
          descriptionText: html ? stripHtml(html) : undefined,
          applyUrl: o.careers_apply_url ?? o.careers_url ?? "",
          locationRaw: o.location ?? [o.city, o.country].filter(Boolean).join(", "),
          remoteType: recruiteeRemote(o),
          remoteHint: o.remote,
          employmentType: o.employment_type_code,
          postedAt: recruiteeDate(o.published_at ?? o.created_at),
          updatedAt: recruiteeDate(o.updated_at),
        };
      })
      .filter((p) => p.applyUrl.length > 0);
  },
};
