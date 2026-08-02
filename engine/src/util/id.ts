import { createHash } from "node:crypto";

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function shortHash(s: string, len = 8): string {
  return createHash("sha1").update(s).digest("hex").slice(0, len);
}

export function companyId(slug: string): string {
  return `c_${slugify(slug)}`;
}

export function sourceId(cid: string, provider: string): string {
  return `${cid}_${provider}`;
}

/** Stable per-posting id, so re-ingesting the same role upserts in place. */
export function jobId(companySlug: string, externalId: string): string {
  return `j_${shortHash(`${companySlug}|${externalId}`, 16)}`;
}

const SLUG_MAX = 110;

/** URL slug for a posting. Unique per posting, and stable across re-ingests.
 *
 * The trailing hash is the only thing separating two requisitions that share a
 * company and a title, so it has to survive the length cap. Truncating the
 * *composed* string cut it off whenever company + title already filled the
 * budget: the second posting then collided on `jobs.slug UNIQUE`, `upsertJob`
 * threw, and `ingest` swallowed it into `postings_errored` — three roles a
 * night, silently, every night. Spend the budget on the title instead, which
 * can afford to lose its tail. */
export function jobSlug(
  companySlug: string,
  title: string,
  externalId: string,
): string {
  const hash = shortHash(externalId, 6);
  // Company slugs are short in practice; cap defensively so that even a
  // pathological one cannot squeeze the hash out.
  const co = trimDashes(slugify(companySlug).slice(0, SLUG_MAX - hash.length - 2));
  const room = SLUG_MAX - co.length - hash.length - 2;
  const t = trimDashes(slugify(title).slice(0, Math.max(room, 0)));
  return [co, t, hash].filter(Boolean).join("-");
}

const trimDashes = (s: string) => s.replace(/-+$/, "");
