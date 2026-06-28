import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.ts";
import { upsertCompany, upsertSource } from "./db/repo.ts";
import { getConnector } from "./connectors/index.ts";
import { slugify } from "./util/id.ts";
import type { AtsProvider } from "@aiengjobs/shared";

const here = dirname(fileURLToPath(import.meta.url));
const CSV = process.env.SEED_CSV ?? join(here, "..", "seed", "companies.csv");

/** Load the curated company list (§6.3) into companies + sources. */
export function seed(): void {
  const text = readFileSync(CSV, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const db = openDb();
  let companies = 0;
  let skipped = 0;
  for (const line of lines) {
    const [name, provider, atsSlug, domain, stage] = line
      .split(",")
      .map((s) => s?.trim());
    if (!name || !provider || !atsSlug) {
      skipped++;
      continue;
    }
    const connector = getConnector(provider as AtsProvider);
    if (!connector) {
      console.warn(`  skip ${name}: no connector for "${provider}"`);
      skipped++;
      continue;
    }
    // The ATS token (passed to the connector) can carry case or delimiters that
    // aren't URL-safe — e.g. SmartRecruiters "Wise" or Workday "tenant:dc:site".
    // Keep it verbatim as the token, but derive a clean slug for ids/URLs.
    // slugify is idempotent for the already-clean lowercase slugs, so existing
    // companies' slugs/ids are unchanged.
    const cid = upsertCompany(db, {
      name,
      slug: slugify(atsSlug),
      domain: domain || undefined,
      atsProvider: provider as AtsProvider,
      atsToken: atsSlug,
      stage: stage || undefined,
    });
    upsertSource(db, cid, provider as AtsProvider, connector.endpoint(atsSlug));
    companies++;
  }
  db.close();
  console.log(`Seeded ${companies} companies (${skipped} skipped) from ${CSV}`);
}
