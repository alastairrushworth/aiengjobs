import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db/index.ts";
import { upsertCompany, upsertSource, retireSourcesExcept } from "./db/repo.ts";
import { getConnector } from "./connectors/index.ts";
import { slugify } from "./util/id.ts";
import type { AtsProvider } from "@aiengjobs/shared";

const here = dirname(fileURLToPath(import.meta.url));
const CSV = process.env.SEED_CSV ?? join(here, "..", "seed", "companies.csv");

/** Load the curated company list (§6.3) into companies + sources. */
/** One CSV row, honouring double-quoted fields.
 *
 *  `line.split(",")` was fine for today's file (no quoted fields in 968 lines),
 *  but a company legitimately named `"Scale AI, Inc"` would split into six
 *  columns, fail the name/provider/slug check, and be silently counted as
 *  skipped — a seed row that vanishes without saying why. */
export function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"'; // escaped quote inside a quoted field
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(field.trim());
      field = "";
    } else field += c;
  }
  out.push(field.trim());
  return out;
}

export function seed(): void {
  const text = readFileSync(CSV, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const db = openDb();
  const seeded: string[] = [];
  const paused: string[] = [];
  let companies = 0;
  let skipped = 0;
  for (const line of lines) {
    const [name, provider, atsSlug, domain, stage, flag] = splitCsvRow(line);
    if (!name || !provider || !atsSlug) {
      skipped++;
      continue;
    }
    // Optional 6th column. `paused` keeps the company and its jobs but stops the
    // nightly run polling a board we already know is broken — see the
    // "PAUSED FEEDS" note in companies.csv. Anything else in this column is a
    // typo, and a typo that silently meant "poll it anyway" would be invisible.
    const status = flag === "paused" ? "paused" : "active";
    if (flag && flag !== "paused") {
      console.warn(`  ! ${name}: unknown flag "${flag}" in column 6, treating as active`);
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
    seeded.push(
      upsertSource(db, cid, provider as AtsProvider, connector.endpoint(atsSlug), status),
    );
    if (status === "paused") paused.push(`${name} (${provider}:${atsSlug})`);
    companies++;
  }

  // Poll targets come from the database, not from this file, so deleting a row
  // here used to do nothing at all: the source stayed 'active' and the nightly
  // run kept polling a board that had 404'd for months. Retire whatever the CSV
  // no longer lists, so this file is genuinely the source of truth.
  //
  // Guarded, because retirement is sticky and the blast radius is the whole
  // board: a truncated or half-written CSV would otherwise retire everything in
  // one run. Nothing legitimate removes half the company list at once.
  const retired = retireSourcesExcept(db, seeded, 0.5);
  if (retired === null) {
    console.warn(
      `  ! refusing to retire sources: ${CSV} lists ${companies} companies, ` +
        `less than half of what is currently active. Fix the file, or retire by hand.`,
    );
  } else if (retired > 0) {
    console.log(`Retired ${retired} sources no longer listed, and closed their open jobs`);
  }

  // Printed every run rather than logged once at pause time: a paused feed is a
  // TODO with no owner, and the only thing stopping it from becoming permanent
  // is that it is impossible to run the seed without seeing it.
  if (paused.length > 0) {
    console.log(`\nPaused, NOT polled until the flag is removed (${paused.length}):`);
    for (const p of paused) console.log(`  · ${p}`);
  }

  db.close();
  console.log(
    `Seeded ${companies} companies (${skipped} skipped, ${paused.length} paused) from ${CSV}`,
  );
}
