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

export function jobSlug(
  companySlug: string,
  title: string,
  externalId: string,
): string {
  return `${slugify(companySlug)}-${slugify(title)}-${shortHash(externalId, 6)}`.slice(
    0,
    110,
  );
}
