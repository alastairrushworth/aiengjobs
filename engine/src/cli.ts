import { initDb } from "./db/index.ts";
import { seed } from "./seed.ts";
import { ingest } from "./ingest.ts";
import { retag, reclassify } from "./retag.ts";
import { exportSnapshot } from "./export/exportSnapshot.ts";

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
    default:
      console.log(
        "Usage: tsx src/cli.ts <db:init | seed | ingest | export | retag | reclassify | refresh>",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
