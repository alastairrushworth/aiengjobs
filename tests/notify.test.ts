import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../engine/src/notify.ts";

const dir = mkdtempSync(join(tmpdir(), "aiengjobs-notify-"));

function snapshot(name: string, jobs: { slug: string; isClosed?: boolean }[]): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ generatedAt: "2026-07-29T00:00:00Z", jobs, companies: [] }));
  return path;
}

describe("diffSnapshots", () => {
  it("reports newly-open and newly-gone job URLs", () => {
    const prev = snapshot("a.json", [{ slug: "acme-one" }, { slug: "acme-two" }]);
    const next = snapshot("b.json", [{ slug: "acme-two" }, { slug: "acme-three" }]);

    const { added, removed } = diffSnapshots(prev, next);
    expect(added).toEqual(["https://frontierroles.com/jobs/acme-three/"]);
    expect(removed).toEqual(["https://frontierroles.com/jobs/acme-one/"]);
  });

  it("treats a job that closed as removed, not merely absent", () => {
    const prev = snapshot("c.json", [{ slug: "acme-one" }]);
    const next = snapshot("d.json", [{ slug: "acme-one", isClosed: true }]);

    const { added, removed } = diffSnapshots(prev, next);
    expect(added).toEqual([]);
    expect(removed).toEqual(["https://frontierroles.com/jobs/acme-one/"]);
  });

  it("reports nothing when the board is unchanged", () => {
    const prev = snapshot("e.json", [{ slug: "acme-one" }, { slug: "acme-two" }]);
    const next = snapshot("f.json", [{ slug: "acme-two" }, { slug: "acme-one" }]);
    expect(diffSnapshots(prev, next)).toEqual({ added: [], removed: [] });
  });

  it("stays quiet when there is no usable previous snapshot", () => {
    // A fresh box would otherwise announce every listing as new.
    const next = snapshot("g.json", [{ slug: "acme-one" }, { slug: "acme-two" }]);
    expect(diffSnapshots(join(dir, "does-not-exist.json"), next)).toEqual({
      added: [],
      removed: [],
    });
  });

  it("fails loudly when the new snapshot is unreadable", () => {
    const prev = snapshot("h.json", [{ slug: "acme-one" }]);
    expect(() => diffSnapshots(prev, join(dir, "missing.json"))).toThrow(/cannot read/);
  });
});
