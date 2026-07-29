import manifest from "../data/logos.json";

/**
 * Company logos fetched into site/public/logos/ by
 * `npm run logos -w @aiengjobs/engine`, which also writes the manifest this
 * reads. Roughly a sixth of companies have no usable logo — some publish only a
 * 16px favicon, some block bots outright — so every caller has to cope with a
 * miss (see components/CompanyLogo.astro, which falls back to a monogram).
 */
export interface LogoEntry {
  file: string;
  w: number;
  h: number;
}

const bySlug = manifest as Record<string, LogoEntry>;

/**
 * Below this we'll happily *show* a logo — a 48px mark renders 1:1 in the slot
 * the site gives it — but we won't assert it as the company's logo in
 * structured data. Google's Organization logo guidance asks for 112px, and a
 * blurry favicon is a worse thing to put in an index than no logo at all.
 */
const MARKUP_MIN_PX = 112;

/** The logo to render for a company, or null when we don't have one. */
export function logo(companySlug: string): LogoEntry | null {
  return bySlug[companySlug] ?? null;
}

/**
 * The logo to *claim* in JSON-LD, or null. Stricter than {@link logo}: only
 * vector marks and images big enough to be worth indexing qualify.
 */
export function markupLogo(companySlug: string): LogoEntry | null {
  const entry = bySlug[companySlug];
  if (!entry) return null;
  if (entry.file.endsWith(".svg")) return entry; // vector: renders at any size
  return Math.min(entry.w, entry.h) >= MARKUP_MIN_PX ? entry : null;
}

export const logoCount = Object.keys(bySlug).length;
