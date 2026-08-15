import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { upsertCompany, upsertSource, listPollTargets } from "../engine/src/db/repo.ts";

const SCHEMA = readFileSync("engine/src/db/schema.sql", "utf8");

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

const seedOne = (db: DatabaseSync, name: string, status?: "active" | "paused") => {
  const cid = upsertCompany(db, {
    name,
    slug: name.toLowerCase(),
    atsProvider: "greenhouse",
    atsToken: name.toLowerCase(),
  });
  return upsertSource(db, cid, "greenhouse", `https://example.test/${name}`, status);
};

describe("paused sources", () => {
  it("keeps a paused source out of the poll set", () => {
    // The whole point of the flag: the nightly run must not spend a retry
    // budget on a board we already know is broken.
    const db = makeDb();
    seedOne(db, "live");
    seedOne(db, "broken", "paused");
    expect(listPollTargets(db).map((t) => t.name)).toEqual(["live"]);
  });

  it("keeps the company itself, so its page and open jobs survive", () => {
    const db = makeDb();
    seedOne(db, "broken", "paused");
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM companies`)
      .get() as unknown as { n: number };
    expect(n).toBe(1);
  });

  it("re-activates on the next seed once the flag is removed", () => {
    // Toggling has to work in both directions, or unpausing would need a
    // hand-written UPDATE against the carried-over database.
    const db = makeDb();
    seedOne(db, "broken", "paused");
    expect(listPollTargets(db)).toHaveLength(0);
    seedOne(db, "broken");
    expect(listPollTargets(db)).toHaveLength(1);
  });

  it("defaults to active when no status is given", () => {
    const db = makeDb();
    seedOne(db, "plain");
    expect(listPollTargets(db)).toHaveLength(1);
  });
});
