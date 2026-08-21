import { initDb } from "./db/index.ts";
import { seed } from "./seed.ts";
import { ingest } from "./ingest.ts";
import { retag, reclassify } from "./retag.ts";
import { relocate } from "./relocate.ts";
import { exportSnapshot } from "./export/exportSnapshot.ts";
import { notify } from "./notify.ts";
import { fetchLogos } from "./logos.ts";

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case "db:init":
      initDb();
      break;
    case "seed":
      seed();
      break;
    case "ingest":
      await ingest();
      break;
    case "export":
      await exportSnapshot();
      break;
    case "retag":
      // LLM-free backfill of skills/filter rules onto existing rows — run once
      // after changing the taxonomy, tag evidence rules, or OUT heuristics.
      retag();
      break;
    case "relocate":
      // Fills country and region onto postings that have none, using the
      // current hint and division tables — run once after editing
      // pipeline/location.ts or pipeline/region.ts. Never overwrites, so the
      // values the retired LLM extractor supplied survive it.
      // --dry-run reports what it would fill and writes nothing.
      relocate({ dryRun: process.argv.includes("--dry-run") });
      break;
    case "reclassify":
      // LLM backfill: re-decides borderline-confidence live jobs under the
      // current extract.ts prompt — run once after a classification prompt change.
      await reclassify();
      break;
    case "refresh":
      // nightly: re-seed (picks up companies.csv additions), poll feeds, then
      // regenerate the site snapshot. seed() upserts, so it's safe to re-run.
      seed();
      await ingest();
      await exportSnapshot();
      break;
    case "logos":
      // Fetch each company's logo into site/public/logos/. Run occasionally —
      // logos are write-once per company, not part of the nightly refresh.
      await fetchLogos({ force: process.argv.includes("--force") });
      break;
    case "notify": {
      // Announce new/closed job URLs to IndexNow. Takes the pre-refresh
      // snapshot and the freshly-written one; the nightly script keeps a copy.
      const [prev, next] = process.argv.slice(3);
      if (!prev || !next) {
        console.error("Usage: tsx src/cli.ts notify <prev-snapshot> <new-snapshot>");
        process.exit(1);
      }
      await notify(prev, next);
      break;
    }
    default:
      console.log(
        "Usage: tsx src/cli.ts <db:init | seed | ingest | export | retag | relocate | reclassify | refresh | notify>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
