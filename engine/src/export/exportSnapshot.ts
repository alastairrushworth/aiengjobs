import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/index.ts";
import { canonicalCity } from "@aiengjobs/shared/city";
import { stripHtml } from "../util/html.ts";
import { fetchFxRates } from "../util/fx.ts";
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

// Display text for the snapshot. Re-derive from the stored HTML so list items and
// paragraph breaks come through (stripHtml emits "• " bullets + newlines); fall
// back to the stored plain text. Full text, no truncation — the site renders it.
function displayText(row: JobRow): string | undefined {
  if (row.description_html) return stripHtml(row.description_html);
  return row.description_text ?? undefined;
}

// The exporter writes the snapshot the Astro site reads at build time. On the
// droplet this commits into the repo working tree before `git push`.
export const SNAPSHOT_OUT =
  process.env.SNAPSHOT_OUT ??
  join(here, "..", "..", "..", "site", "src", "data", "snapshot.json");

// A few hundred bytes of run summary that IS committed to main, alongside the
// ~22MB snapshot that isn't (see scripts/droplet-refresh.sh). It gives the Pages
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
  is_closed: number;
  posted_at: string | null;
  updated_at: string | null;
  ingested_at: string;
  expires_at: string | null;
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

  // Public fields only — internal provenance (ats_provider, ats_token) stays
  // out of the published snapshot.
  const companyRows = db
    .prepare(
      "SELECT id, name, slug, domain, stage, size, logo_url, description FROM companies",
    )
    .all() as unknown as CompanyRow[];
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

  const closedCutoff = new Date(
    Date.now() - CLOSED_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const rows = db
    .prepare(
      `SELECT j.*, c.name AS company_name, c.slug AS company_slug
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.classification = 'in'
         AND (j.is_closed = 0 OR (j.is_closed = 1 AND j.last_seen_at >= ?))
       ORDER BY j.is_featured DESC, j.ingested_at DESC, j.id`,
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
      salaryMin: r.salary_min ?? undefined,
      salaryMax: r.salary_max ?? undefined,
      salaryCurrency: r.salary_currency ?? undefined,
      salaryPeriod: (r.salary_period as SalaryPeriod) ?? undefined,
      skills: sk.names,
      clusters: [...sk.clusters],
      ...(closed ? { isClosed: true } : {}),
      postedAt: r.posted_at ?? undefined,
      updatedAt: r.updated_at ?? undefined,
      ingestedAt: r.ingested_at,
      expiresAt: r.expires_at ?? undefined,
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
