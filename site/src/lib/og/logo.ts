import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { logo } from "../logos.ts";

const LOGO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "public", "logos");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Company slug → data URI, memoized.
 *
 * A card is generated per *job*, and companies post many. Adobe alone would
 * re-read and re-base64 the same file dozens of times a build; the whole logo
 * directory is under 5MB, so holding the encoded form costs less than the
 * repeated work.
 */
const cache = new Map<string, string | null>();

/**
 * The company's logo as a data URI satori can place, or null when there isn't
 * one — about a fifth of roles, which fall back to the monogram tile.
 *
 * Inlined rather than referenced by URL because satori resolves image sources at
 * layout time: a site-relative path means nothing to it, and an absolute one
 * would make every card a network fetch against a site that isn't deployed yet.
 */
export function logoDataUri(companySlug: string): string | null {
  const hit = cache.get(companySlug);
  if (hit !== undefined) return hit;

  let uri: string | null = null;
  const entry = logo(companySlug);
  if (entry) {
    const mime = MIME[extname(entry.file).toLowerCase()];
    // An extension the manifest knows but this doesn't is a miss, not a crash:
    // the card still renders, with the monogram.
    if (mime) {
      try {
        uri = `data:${mime};base64,${readFileSync(join(LOGO_DIR, entry.file)).toString("base64")}`;
      } catch {
        uri = null;
      }
    }
  }

  cache.set(companySlug, uri);
  return uri;
}
