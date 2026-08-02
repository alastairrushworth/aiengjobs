import type { Connector, RawPosting } from "./types.ts";
import type { RemoteType, SalaryPeriod } from "@aiengjobs/shared";
import { decodeEntities, stripHtml } from "../util/html.ts";
import { fetchRetry } from "../util/fetch.ts";

// Personio publishes a company's whole board as one XML document — descriptions,
// structured pay and all — so unlike Workable/BambooHR there is no per-job
// detail fetch to make. There is also a search.json on the same host, but its
// `description` field is always empty, which is why this reads the XML.
//
// Boards live on two hosts. `.com` is current and `.de` is the original; most
// tenants answer on both, some only on one, so this falls back the way the
// Greenhouse connector falls back to the EU host.
const HOSTS = ["jobs.personio.com", "jobs.personio.de"];
const feedUrl = (slug: string, host: string) =>
  slug.includes(".") ? `https://${slug}/xml` : `https://${slug}.${host}/xml`;

/** The <position> blocks, still holding their <jobDescriptions>. */
function positions(xml: string): string[] {
  return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => m[1]);
}

/** Text of the first <tag> in `xml`, entity-decoded and trimmed.
 *
 *  Only ever called on a position body with <jobDescriptions> already stripped
 *  (see below) — the descriptions block carries its own <name> element per
 *  section, and reading fields before removing it returns the first section
 *  heading ("About the role") as the job title on every posting. */
function field(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return undefined;
  const v = decodeEntities(m[1]).trim();
  return v || undefined;
}

const DESCRIPTIONS = /<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/;

/** Section headings carry real meaning here ("About the role", "Requirements"),
 *  so keep them as headings rather than concatenating the bodies alone. */
function description(body: string): string | undefined {
  const block = body.match(DESCRIPTIONS)?.[1];
  if (!block) return undefined;
  const parts: string[] = [];
  for (const m of block.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)) {
    const heading = field(m[1].replace(/<value>[\s\S]*?<\/value>/, ""), "name");
    // The body is wrapped in CDATA — which by definition cannot contain "]]>",
    // so this cannot truncate early on the section's own markup.
    const value = m[1].match(/<value>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/value>/)?.[1];
    if (!value?.trim()) continue;
    parts.push(heading ? `<h3>${heading}</h3>\n${value}` : value);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function personioRemote(office?: string, workplace?: string): RemoteType | undefined {
  const s = `${workplace ?? ""} ${office ?? ""}`.toLowerCase();
  if (/\bhybrid\b/.test(s)) return "hybrid";
  if (/\bremote\b|\bhome office\b/.test(s)) return "remote";
  if (/\bon[- ]?site\b|\boffice\b/.test(workplace ?? "")) return "onsite";
  return undefined;
}

const PERIODS: Record<string, SalaryPeriod> = {
  yearly: "year",
  annually: "year",
  monthly: "month",
  weekly: "day", // no "week" in SalaryPeriod; the closest honest bucket is not
  daily: "day", // worth guessing at, so weekly pay is dropped below instead.
  hourly: "hour",
};

/** Personio's structured <salaryInformation>. Only used when it names a
 *  currency — an unlabelled number is not a salary (see parseSalaryText). */
function salary(body: string) {
  const block = body.match(/<salaryInformation>([\s\S]*?)<\/salaryInformation>/)?.[1];
  if (!block) return null;
  const currency = field(block, "currencyCode");
  const type = (field(block, "type") ?? "").toLowerCase();
  const period = PERIODS[type];
  // Drop rather than guess: an unlabelled currency, or a cadence we cannot map
  // (Personio's "weekly" has no SalaryPeriod), would misprice the role.
  if (!currency || !period || type === "weekly") return null;
  const num = (tag: string) => {
    const n = Number(field(block, tag));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const min = num("min");
  const max = num("max");
  if (min === undefined && max === undefined) return null;
  return { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period };
}

// Personio public job-board XML feed (no auth) — {slug}.jobs.personio.com/xml.
export const personio: Connector = {
  provider: "personio",
  endpoint: (slug) => feedUrl(slug, HOSTS[0]),
  async fetchPostings(slug) {
    // An unknown tenant does not 404 — Personio 307s it to its marketing site,
    // which answers 200 with HTML. Following that would parse as a board with
    // no positions, i.e. "this company closed every role", on every run.
    // `redirect: "manual"` makes an unknown tenant loud instead of silent.
    let xml: string | undefined;
    let lastStatus = 0;
    for (const host of HOSTS) {
      const res = await fetchRetry(feedUrl(slug, host), { redirect: "manual" });
      lastStatus = res.status;
      if (res.status >= 300 && res.status < 400) continue; // not on this host
      if (!res.ok) throw new Error(`personio ${slug} HTTP ${res.status}`);
      const body = await res.text();
      if (!body.includes("<workzag-jobs")) continue;
      xml = body;
      break;
      // A full host in the slug is only ever tried once — feedUrl ignores HOSTS
      // for it, so the second pass would refetch the same URL. Harmless, and it
      // keeps the slug grammar to one rule.
    }
    if (xml === undefined) {
      throw new Error(`personio ${slug}: no board on either host (last HTTP ${lastStatus})`);
    }

    const out: RawPosting[] = [];
    for (const body of positions(xml)) {
      // Strip the descriptions before reading flat fields — see field().
      const head = body.replace(DESCRIPTIONS, "");
      const id = field(head, "id");
      const title = field(head, "name");
      if (!id || !title) continue;

      const html = description(body);
      const office = field(head, "office");
      const sal = salary(head);
      out.push({
        externalId: id,
        title,
        descriptionHtml: html,
        descriptionText: html ? stripHtml(html) : undefined,
        // Personio has no per-job apply URL in the feed; the board's job page is
        // the canonical public link and is what its own listing links to.
        applyUrl: `https://${slug.includes(".") ? slug : `${slug}.${HOSTS[0]}`}/job/${id}`,
        locationRaw: office,
        remoteType: personioRemote(office, field(head, "workplaceType")),
        employmentType: field(head, "schedule") ?? field(head, "employmentType"),
        postedAt: field(head, "createdAt"),
        salaryMin: sal?.salaryMin,
        salaryMax: sal?.salaryMax,
        salaryCurrency: sal?.salaryCurrency,
        salaryPeriod: sal?.salaryPeriod,
      });
    }
    return out;
  },
};
