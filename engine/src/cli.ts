import { initDb } from "./db/index.ts";
import { exportSnapshot } from "./export/exportSnapshot.ts";

const cmd = process.argv[2];

switch (cmd) {
  case "db:init":
    initDb();
    break;

  case "ingest":
    // TODO Phase 1: poll seed companies via connectors -> normalize -> classify
    // -> tag -> dedupe -> upsert -> expiry diff. Then run `export`.
    console.log(
      "[ingest] Phase 1 — ATS ingestion not yet implemented. See engine/src/connectors and engine/src/pipeline.",
    );
    break;

  case "export":
    exportSnapshot();
    break;

  default:
    console.log("Usage: tsx src/cli.ts <db:init | ingest | export>");
    process.exit(1);
}
