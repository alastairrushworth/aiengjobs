import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/index.ts";
import { canonicalCity } from "@aiengjobs/shared/city";
import { stripHtml } from "../util/html.ts";
import { fetchFxRates } from "../util/fx.ts";
import { writeDailyPicks } from "./dailyPicks.ts";
import type {
  SiteSnapshot,
  Job,
  Company,
  RemoteType,
  Seniority,
  SalaryPeriod,
} from "@aiengjobs/shared";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";

const here = dirname(fileURLToPath(import.meta.url));

/** Pay bounds in the right order, dropping a range that cannot be one.
 *
 *  A single figure stays a single figure (min with no max is how "from $X" is
 *  represented). A pair is swapped rather than discarded — the two numbers are
 *  real, only their order is wrong — and equal bounds collapse to one, matching
 *  what parseSalaryText already does. */
export function orderedPay(
  min: number | null,
  max: number | null,
): { salaryMin?: number; salaryMax?: number } {
  if (min != null && max != null) {
    if (min === max) return { salaryMin: min };
    return min <= max
      ? { salaryMin: min, salaryMax: max }
      : { salaryMin: max, salaryMax: min };
  }
  return { salaryMin: min ?? undefined, salaryMax: max ?? undefined };
}

/** Display text for the snapshot. Re-derive from the stored HTML so list items
 *  and paragraph breaks come through (stripHtml emits "• " bullets + newlines);
 *  fall back to the stored plain text. Full text, no truncation — the site
 *  renders it. */
function displayText(row: JobRow): string | undefined {
  if (row.description_html) return stripHtml(row.description_html);
  return row.description_text ?? undefined;
}

// The exporter writes the snapshot the Astro site reads at build time. The
// nightly job force-pushes it to the detached `snapshot` branch from there.
export const SNAPSHOT_OUT =
  process.env.SNAPSHOT_OUT ??
  join(here, "..", "..", "..", "site", "src", "data", "snapshot.json");

// A few hundred bytes of run summary that IS committed to main, alongside the
// ~32MB snapshot that isn't (see scripts/refresh.sh). It gives the Pages
// build something to trigger on and leaves a readable history of nightly runs.
export const SNAPSHOT_META_OUT =
  process.env.SNAPSHOT_META_OUT ??
  join(here, "..", "..", "..", "site", "src", "data", "snapshot.meta.json");

// Roles that vanished from their feed stay in the snapshot for this long so the
// site can render a "role closed" tombstone instead of 404ing shared links.
const CLOSED_RETENTION_DAYS = 30;

interface JobRow {
  id: string;
  slug: string;
  company_name: string;
  company_slug: string;
  title: string;
  normalized_title: string;
  description_html: string | null;
  description_text: string | null;
  apply_url: string;
  location_raw: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  remote_type: string | null;
  seniority: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  model_score: number | null;
  is_closed: number;
  posted_at: string | null;
  updated_at: string | null;
  ingested_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  stage: string | null;
  size: string | null;
  logo_url: string | null;
  description: string | null;
}

export async function exportSnapshot(): Promise<void> {
  const db = openDb();
  const closedCutoff = new Date(
    Date.now() - CLOSED_RETENTION_DAYS * 86_400_000,
  ).toISOString();

  // Public fields only — internal provenance (ats_provider, ats_token) stays
  // out of the published snapshot.
  //
  // And only companies with a role in it. The seed list is far larger than the
  // board: 1,395 companies shipped in the 2026-08-22 snapshot against 699 that
  // any job referenced, so half the rows were dead weight in a file that moves
  // over the wire on every build. They are also the one genuinely proprietary
  // thing here — the list of which employers were worth wiring an ATS connector
  // to — and publishing the misses hands that over for nothing in return.
  const companyRows = db
    .prepare(
      `SELECT id, name, slug, domain, stage, size, logo_url, description
       FROM companies
       WHERE id IN (
         SELECT DISTINCT company_id FROM jobs
         WHERE classification = 'in'
           AND (is_closed = 0 OR (is_closed = 1 AND last_seen_at >= ?))
       )`,
    )
    .all(closedCutoff) as unknown as CompanyRow[];
  const companies: Company[] = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    domain: c.domain ?? undefined,
    stage: c.stage ?? undefined,
    size: c.size ?? undefined,
    logoUrl: c.logo_url ?? undefined,
    description: c.description ?? undefined,
  }));

  const rows = db
    .prepare(
      `SELECT j.*, c.name AS company_name, c.slug AS company_slug
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.classification = 'in'
         AND (j.is_closed = 0 OR (j.is_closed = 1 AND j.last_seen_at >= ?))
       ORDER BY j.ingested_at DESC, j.id`,
    )
    .all(closedCutoff) as unknown as JobRow[];

  const skillRows = db
    .prepare(
      `SELECT js.job_id AS job_id, s.name AS name, s.cluster AS cluster
       FROM job_skills js JOIN skills s ON s.id = js.skill_id`,
    )
    .all() as unknown as { job_id: string; name: string; cluster: ClusterId }[];

  const skillsByJob = new Map<string, { names: string[]; clusters: Set<ClusterId> }>();
  for (const r of skillRows) {
    let e = skillsByJob.get(r.job_id);
    if (!e) {
      e = { names: [], clusters: new Set() };
      skillsByJob.set(r.job_id, e);
    }
    e.names.push(r.name);
    e.clusters.add(r.cluster);
  }

  const jobs: Job[] = rows.map((r) => {
    const sk = skillsByJob.get(r.id) ?? { names: [], clusters: new Set<ClusterId>() };
    const closed = !!r.is_closed;
    return {
      slug: r.slug,
      companyName: r.company_name,
      companySlug: r.company_slug,
      title: r.title,
      normalizedTitle: r.normalized_title,
      // Tombstones drop the description — the page shows a "role closed"
      // banner + facts, and the text is the snapshot's dominant weight.
      descriptionText: closed ? undefined : displayText(r),
      applyUrl: r.apply_url,
      locationRaw: r.location_raw ?? undefined,
      country: r.country ?? undefined,
      region: r.region ?? undefined,
      // Canonicalized here as well as at ingest, so rows written before the
      // rules existed (or by an older engine) are cleaned without a migration.
      // canonicalCity is idempotent, so double-applying is free.
      city: canonicalCity(r.city) ?? undefined,
      remoteType: (r.remote_type as RemoteType) ?? undefined,
      seniority: (r.seniority as Seniority) ?? undefined,
      // Ordered here rather than trusted from the row. One Adobe posting
      // carries min 161700 / max 23415, which rendered as "$162k–$23k/yr" and
      // put an invalid MonetaryAmount (minValue > maxValue) into the page's
      // JobPosting JSON-LD, where Google flags it. Rows like this predate the
      // current parser and nothing re-derives compensation, so normalise on the
      // way out — it is the one place every consumer goes through.
      ...orderedPay(r.salary_min, r.salary_max),
      salaryCurrency: r.salary_currency ?? undefined,
      salaryPeriod: (r.salary_period as SalaryPeriod) ?? undefined,
      // The one classification number that leaves the engine. It is what
      // /daily/rss.xml ranks on, and the reason it is this column and not
      // classification_confidence is in shared/types.ts. Null on rows written
      // before the column existed, and omitted rather than defaulted — a
      // stand-in value here is an invented ranking.
      modelScore: r.model_score ?? undefined,
      skills: sk.names,
      clusters: [...sk.clusters],
      ...(closed ? { isClosed: true } : {}),
      postedAt: r.posted_at ?? undefined,
      updatedAt: r.updated_at ?? undefined,
      ingestedAt: r.ingested_at,
    };
  });

  // Live currency conversion rates, pulled fresh each run (falls back to static
  // approximations if the feed is unreachable).
  const fxRates = await fetchFxRates();

  const snapshot: SiteSnapshot = {
    generatedAt: new Date().toISOString(),
    fxRates,
    jobs,
    companies,
  };

  db.close();
  // Compact JSON — no whitespace, since this file moves over the wire on every
  // build and gets republished nightly.
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot) + "\n", "utf8");

  // After the snapshot is on disk: the picks are derived from it, and a fault
  // in choosing them must not cost the export. writeDailyPicks swallows its own
  // errors for the same reason.
  writeDailyPicks(snapshot);

  const openCount = jobs.filter((j) => !j.isClosed).length;
  writeFileSync(
    SNAPSHOT_META_OUT,
    JSON.stringify(
      {
        generatedAt: snapshot.generatedAt,
        openJobs: openCount,
        closedJobs: jobs.length - openCount,
        companies: companies.length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(
    `Wrote ${openCount} open + ${jobs.length - openCount} closed jobs, ${companies.length} companies -> ${SNAPSHOT_OUT}`,
  );
}
