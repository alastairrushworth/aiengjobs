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
      // Inference-free backfill of skills, filter rules and pay currency onto
      // existing rows — run once after changing the taxonomy, tag evidence
      // rules, OUT heuristics, or the salary parser in pipeline/comp.ts.
      retag();
      break;
    case "relocate":
      // Fills country, region and city onto postings that have none, using the
      // current hint, division and canonicalization tables. Part of the nightly
      // refresh; by hand it's for --dry-run, which reports what it would fill
      // and writes nothing. Country and region are only ever filled, never
      // overwritten, so the values the retired LLM extractor supplied survive
      // it; a stored city is replaced only where the current rules reject it
      // or read past it (see relocateRow).
      relocate({ dryRun: process.argv.includes("--dry-run") });
      break;
    case "reclassify":
      // Re-decides every live posting with the local ONNX encoder — run once
      // after a classifier change. Rewrites the board in bulk; see the warning
      // on the function itself before pointing it at a database you care about.
      await reclassify();
      break;
    case "refresh":
      // nightly: re-seed (picks up companies.csv additions), poll feeds, then
      // regenerate the site snapshot. seed() upserts, so it's safe to re-run.
      //
      // relocate between the two because ingest skips content-unchanged
      // postings: without it a location rule fixed today reaches only the roles
      // first seen after today, and the ones already published — the ones the
      // fix was written for — keep the old answer until they close. As a
      // by-hand step it meant downloading the release database, running it and
      // re-uploading around the nightly run. It is idempotent and fills or
      // narrowly repairs only, so every night but the one after a rule change
      // it writes nothing.
      seed();
      await ingest();
      relocate();
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
