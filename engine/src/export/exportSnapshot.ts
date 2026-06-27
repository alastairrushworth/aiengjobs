import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/index.ts";
import { stripHtml } from "../util/html.ts";
import { CLUSTER_BY_ID } from "@aiengjobs/shared/taxonomy";
import type { ClusterId } from "@aiengjobs/shared/taxonomy";
import type {
  SiteSnapshot,
  Job,
  Company,
  RemoteType,
  Seniority,
  SalaryPeriod,
  Classification,
} from "@aiengjobs/shared";

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

interface JobRow {
  id: string;
  slug: string;
  company_id: string;
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
  classification: string;
  classification_confidence: number | null;
  is_featured: number;
  is_direct: number;
  is_new: number;
  is_closed: number;
  posted_at: string | null;
  updated_at: string | null;
  ingested_at: string;
  expires_at: string | null;
  content_hash: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  ats_provider: string;
  ats_token: string | null;
  stage: string | null;
  size: string | null;
  logo_url: string | null;
  description: string | null;
}

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function exportSnapshot(): void {
  const db = openDb();
  const now = Date.now();

  const companyRows = db.prepare("SELECT * FROM companies").all() as unknown as CompanyRow[];
  const companies: Company[] = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    domain: c.domain ?? undefined,
    atsProvider: c.ats_provider as Company["atsProvider"],
    atsToken: c.ats_token ?? undefined,
    stage: c.stage ?? undefined,
    size: c.size ?? undefined,
    logoUrl: c.logo_url ?? undefined,
    description: c.description ?? undefined,
  }));

  const rows = db
    .prepare(
      `SELECT j.*, c.name AS company_name, c.slug AS company_slug
       FROM jobs j JOIN companies c ON c.id = j.company_id
       WHERE j.classification = 'in' AND j.is_closed = 0
       ORDER BY j.is_featured DESC, j.ingested_at DESC, j.id`,
    )
    .all() as unknown as JobRow[];

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
    return {
      id: r.id,
      slug: r.slug,
      companyId: r.company_id,
      companyName: r.company_name,
      companySlug: r.company_slug,
      title: r.title,
      normalizedTitle: r.normalized_title,
      descriptionText: displayText(r),
      applyUrl: r.apply_url,
      locationRaw: r.location_raw ?? undefined,
      country: r.country ?? undefined,
      region: r.region ?? undefined,
      city: r.city ?? undefined,
      remoteType: (r.remote_type as RemoteType) ?? undefined,
      seniority: (r.seniority as Seniority) ?? undefined,
      salaryMin: r.salary_min ?? undefined,
      salaryMax: r.salary_max ?? undefined,
      salaryCurrency: r.salary_currency ?? undefined,
      salaryPeriod: (r.salary_period as SalaryPeriod) ?? undefined,
      classification: r.classification as Classification,
      classificationConfidence: r.classification_confidence ?? undefined,
      skills: sk.names,
      clusters: [...sk.clusters],
      isFeatured: !!r.is_featured,
      isDirect: !!r.is_direct,
      isNew: Date.parse(r.ingested_at) > now - NEW_WINDOW_MS,
      isClosed: !!r.is_closed,
      postedAt: r.posted_at ?? undefined,
      updatedAt: r.updated_at ?? undefined,
      ingestedAt: r.ingested_at,
      expiresAt: r.expires_at ?? undefined,
      contentHash: r.content_hash ?? undefined,
    };
  });

  const clusterCounts = new Map<ClusterId, number>();
  const senCounts = new Map<Seniority, number>();
  const remoteCounts = new Map<RemoteType, number>();
  for (const j of jobs) {
    for (const c of j.clusters) clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1);
    if (j.seniority) senCounts.set(j.seniority, (senCounts.get(j.seniority) ?? 0) + 1);
    if (j.remoteType) remoteCounts.set(j.remoteType, (remoteCounts.get(j.remoteType) ?? 0) + 1);
  }

  const snapshot: SiteSnapshot = {
    generatedAt: new Date().toISOString(),
    jobs,
    companies,
    facets: {
      clusters: [...clusterCounts.entries()]
        .map(([id, count]) => ({ id, label: CLUSTER_BY_ID[id].label, count }))
        .sort((a, b) => b.count - a.count),
      seniority: [...senCounts.entries()].map(([id, count]) => ({ id, count })),
      remoteType: [...remoteCounts.entries()].map(([id, count]) => ({ id, count })),
    },
  };

  db.close();
  writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${jobs.length} jobs, ${companies.length} companies -> ${SNAPSHOT_OUT}`,
  );
}
