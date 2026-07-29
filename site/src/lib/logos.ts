import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Company logos fetched into site/public/logos/ by `npm run logos -w
 * @aiengjobs/engine`. The files are the source of truth — a logo exists if we
 * have the bytes, which is also exactly the condition for claiming one in
 * JobPosting markup.
 *
 * Read once at build time. Roughly a quarter of companies have no usable logo
 * (some publish only a 16px favicon, some block bots outright), so every caller
 * has to cope with a miss — see components/CompanyLogo.astro.
 */
const LOGO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "logos");

const bySlug = new Map<string, string>();
try {
  for (const file of readdirSync(LOGO_DIR)) {
    const dot = file.lastIndexOf(".");
    if (dot > 0) bySlug.set(file.slice(0, dot), file);
  }
} catch {
  // No logos fetched yet — the site renders monograms throughout.
}

/** Filename for a company's logo ("openai.png"), or null if we don't have one. */
export function logoFile(companySlug: string): string | null {
  return bySlug.get(companySlug) ?? null;
}

export const logoCount = bySlug.size;
