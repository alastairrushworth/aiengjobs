import { initDb } from "./db/index.ts";
import { seed } from "./seed.ts";
import { ingest } from "./ingest.ts";
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
    case "refresh":
      // nightly: poll feeds, then regenerate the site snapshot
      await ingest();
      await exportSnapshot();
      break;
    default:
      console.log("Usage: tsx src/cli.ts <db:init | seed | ingest | export | refresh>");
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
