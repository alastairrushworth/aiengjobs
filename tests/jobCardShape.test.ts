import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARD_CLASS } from "../site/src/lib/jobCardShape.ts";

/**
 * A job card is built in two places — `JobCard.astro` on the server and
 * `makeCard()` in `JobFilters.astro` on the client — and they have to produce
 * the same thing. They already drifted once: the mark moved into its own
 * element and grew 20px → 44px on the server, and every card silently changed
 * shape the moment someone typed in the filter box.
 *
 * lib/jobCardShape.ts holds the class names and the mark size so those can't
 * diverge again. This checks the two files actually use it, and use the same
 * parts of it — so adding a class to one and not the other fails here instead
 * of in front of a user.
 *
 * What it catches: a class added, removed or renamed in one file only, and
 * either file going back to hardcoded strings.
 * What it does not: nesting. Both files carry their own tree, and the comments
 * in each point at the other.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const server = read("../site/src/components/JobCard.astro");
const client = read("../site/src/components/JobFilters.astro");

/** Every `C.<key>` / `CARD_CLASS.<key>` reference in a file. */
function referencedKeys(source: string): Set<string> {
  return new Set([...source.matchAll(/\b(?:C|CARD_CLASS)\.(\w+)/g)].map((m) => m[1]!));
}

describe("job card shape", () => {
  it("is referenced by both renderers, not hardcoded", () => {
    for (const [name, src] of [
      ["JobCard.astro", server],
      ["JobFilters.astro", client],
    ] as const) {
      expect(src, `${name} should import lib/jobCardShape`).toContain("jobCardShape");
    }
  });

  it("uses the same set of classes on the server and the client", () => {
    const onServer = referencedKeys(server);
    const onClient = referencedKeys(client);

    // Sorted arrays rather than set equality: a mismatch then names the class.
    expect([...onClient].sort(), "classes used by makeCard() but not JobCard.astro").toEqual(
      [...onServer].sort(),
    );
  });

  it("only names classes that exist in the shape", () => {
    const known = Object.keys(CARD_CLASS);
    for (const key of referencedKeys(server)) expect(known).toContain(key);
    for (const key of referencedKeys(client)) expect(known).toContain(key);
  });

  it("sizes the mark from one constant", () => {
    // The size reaches CSS through --logo-size and the img width/height attrs;
    // a literal in either file is how the 20-vs-44 split happened.
    expect(server).toContain("CARD_LOGO_PX");
    expect(client).toContain("CARD_LOGO_PX");
    expect(client).not.toMatch(/\bconst LOGO_PX\b/);
  });
});
