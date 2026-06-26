import { createHash } from "node:crypto";

/** Stable content hash for change detection (§6.5): skip reprocessing unchanged postings. */
export function contentHash(parts: (string | number | undefined | null)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => p ?? "").join(""))
    .digest("hex");
}
