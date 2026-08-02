import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType } from "@aiengjobs/shared";
import { stripHtml } from "../util/html.ts";
import { fetchRetry } from "../util/fetch.ts";
import { mapPool } from "../util/concurrency.ts";
import { parseSalaryText } from "../pipeline/comp.ts";

// BambooHR's hosted careers page is backed by an unauthenticated JSON API on
// the tenant subdomain — `/careers/list` for the board, `/careers/{id}/detail`
// for the posting. It is not a documented product API, but it is what the
// public careers page itself calls, so it is as stable as that page.
//
// Why bother with a twelfth connector: BambooHR is where small UK — especially
// Scottish and Irish — engineering companies live. They are too small for
// Greenhouse's pricing and too early for Workday, so a board of 20-200 people
// on BambooHR is the norm rather than the exception, and none of them were
// reachable before.
const DETAIL_CONCURRENCY = 4;

interface BhListJob {
  id: string | number;
  jobOpeningName?: string;
  departmentLabel?: string;
  employmentStatusLabel?: string;
  // Populated when the role has a real office (onsite/hybrid).
  location?: { city?: string | null; state?: string | null; addressCountry?: string | null };
  // Populated instead when the role is remote — the region it is remote within.
  atsLocation?: {
    country?: string | null;
    state?: string | null;
    province?: string | null;
    city?: string | null;
  };
  isRemote?: boolean | null;
  locationType?: string | number | null;
}

interface BhDetail {
  jobOpeningName?: string;
  jobOpeningStatus?: string; // "Open" | ...
  jobOpeningShareUrl?: string;
  description?: string; // HTML
  compensation?: string | null; // free text: "£70,000 - £90,000", "Competitive"
  datePosted?: string; // "YYYY-MM-DD"
  locationType?: string | number | null;
  employmentStatusLabel?: string;
}

// locationType is an unlabelled enum in the feed: 0 = office, 1 = remote,
// 2 = hybrid. Confirmed against boards of each kind — an onsite role carries a
// street address in `location`, a remote one carries only a region in
// `atsLocation`, and a hybrid one carries an office but is tagged 2.
function bambooRemote(locationType?: string | number | null, isRemote?: boolean | null) {
  switch (String(locationType ?? "")) {
    case "1":
      return "remote" satisfies RemoteType;
    case "2":
      return "hybrid" satisfies RemoteType;
    case "0":
      return "onsite" satisfies RemoteType;
    default:
      return isRemote ? ("remote" satisfies RemoteType) : undefined;
  }
}

/** Whichever of the two location objects the tenant filled in, as one string. */
function bambooLocation(j: BhListJob): string | undefined {
  const ats = j.atsLocation;
  const loc = j.location;
  const parts = [
    ats?.city ?? loc?.city,
    ats?.state ?? ats?.province ?? loc?.state,
    ats?.country ?? loc?.addressCountry,
  ].filter((p): p is string => Boolean(p && p.trim()));
  const joined = [...new Set(parts)].join(", ");
  return joined || undefined;
}

// A date-only "2026-01-05" parses as UTC midnight, which is what we want —
// but guard it, because an unparseable value must not become Invalid Date.
function bambooDate(s?: string): string | undefined {
  if (!s) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

// BambooHR public careers API (no auth) — board lives at {slug}.bamboohr.com.
export const bamboohr: Connector = {
  provider: "bamboohr",
  endpoint: (slug) => `https://${slug}.bamboohr.com/careers/list`,
  async fetchPostings(slug) {
    // A tenant that does not exist does not 404 — BambooHR 302s the request to
    // its marketing site, which then answers 200 with HTML. `redirect: "manual"`
    // keeps that from being parsed as an empty board, which would otherwise
    // read as "this company closed all its roles" on every single run.
    const res = await fetchRetry(bamboohr.endpoint(slug), { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`bamboohr ${slug} redirected (HTTP ${res.status}) — unknown tenant`);
    }
    if (!res.ok) throw new Error(`bamboohr ${slug} HTTP ${res.status}`);
    const data = (await res.json()) as { result?: BhListJob[] };
    const jobs = (data.result ?? []).filter((j) => j.id != null && j.jobOpeningName);

    const postings = await mapPool(jobs, DETAIL_CONCURRENCY, async (j): Promise<RawPosting | null> => {
      const id = String(j.id);
      // Detail carries the description, posting date and pay; degrade to the
      // list row rather than lose the posting if one detail fetch fails.
      let d: BhDetail | undefined;
      try {
        const dr = await fetchRetry(`https://${slug}.bamboohr.com/careers/${id}/detail`);
        if (dr.ok) {
          d = ((await dr.json()) as { result?: { jobOpening?: BhDetail } }).result?.jobOpening;
        }
      } catch {
        d = undefined;
      }
      // Only the detail knows whether a listed role is still open. Absent a
      // detail we keep the posting: the list itself only carries open roles.
      if (d?.jobOpeningStatus && d.jobOpeningStatus !== "Open") return null;

      const html = d?.description;
      const sal = parseSalaryText(d?.compensation);
      return {
        externalId: id,
        title: (d?.jobOpeningName ?? j.jobOpeningName ?? "").trim(),
        descriptionHtml: html || undefined,
        descriptionText: html ? stripHtml(html) : undefined,
        applyUrl: d?.jobOpeningShareUrl ?? `https://${slug}.bamboohr.com/careers/${id}`,
        locationRaw: bambooLocation(j),
        remoteType: bambooRemote(d?.locationType ?? j.locationType, j.isRemote),
        remoteHint: j.isRemote ?? undefined,
        employmentType: d?.employmentStatusLabel ?? j.employmentStatusLabel,
        postedAt: bambooDate(d?.datePosted),
        salaryMin: sal?.salaryMin,
        salaryMax: sal?.salaryMax,
        salaryCurrency: sal?.salaryCurrency,
        salaryPeriod: sal?.salaryPeriod,
      };
    });

    return postings.filter((p): p is RawPosting => p !== null && p.title.length > 0);
  },
};
