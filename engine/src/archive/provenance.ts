import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ENCODER_DIR, ENCODER_THRESHOLD } from "../config.ts";
import type { SourceResult } from "./export.ts";

/**
 * Which classifier decided scope on this run: the digest of the model weights
 * and the threshold applied to their score.
 *
 * Recorded per run because "in scope" is not a fixed property of a posting.
 * When the model is retrained, postings on either side of the change were
 * judged by different rules, and without this there is no way to know which
 * side a given night was on — a step in the count of AI roles in some future
 * chart would be indistinguishable from a step in the market.
 */
export function classifierIdentity(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(ENCODER_DIR, "manifest.json"), "utf8")) as Record<
      string,
      { sha256?: string }
    >;
    const digest = manifest["model.onnx"]?.sha256;
    return digest ? `onnx:${digest.slice(0, 16)}@${ENCODER_THRESHOLD}` : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sources the run never considered because they are paused. They are part of
 * the coverage record all the same: a paused employer's roles stay on the
 * board until they age out, and anyone reading the archive needs to know its
 * feed was not being read.
 */
export function listPausedSources(db: DatabaseSync): SourceResult[] {
  const rows = db
    .prepare(
      `SELECT s.id AS sid, c.id AS cid, c.slug, c.name, s.ats_provider AS provider
       FROM sources s JOIN companies c ON c.id = s.company_id
       WHERE s.status <> 'active'`,
    )
    .all() as { sid: string; cid: string; slug: string; name: string; provider: string }[];
  return rows.map((r) => ({
    sourceId: r.sid,
    companyId: r.cid,
    companySlug: r.slug,
    companyName: r.name,
    provider: r.provider,
    status: "paused" as const,
    fetched: 0,
  }));
}
