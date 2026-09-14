import { describe, expect, it } from "vitest";
import { planDetailFetch } from "../engine/src/util/enterprise.ts";

const rows = (ids: string[]) => ids.map((id) => ({ id }));
const idOf = (r: { id: string }) => r.id;
const keyOf = (r: { id: string }) => ({ id: r.id });

describe("planDetailFetch", () => {
  it("with no context fetches the first `cap` rows and reports the rest as seen", () => {
    const { targets, seen } = planDetailFetch(rows(["a", "b", "c", "d"]), keyOf, 2, undefined);
    expect(targets.map(idOf)).toEqual(["a", "b"]);
    expect(seen).toEqual(["c", "d"]);
  });

  it("spends the budget on unknown ids first, whatever their list rank", () => {
    const known = new Set(["a", "b", "c"]);
    const { targets, seen } = planDetailFetch(
      rows(["a", "b", "c", "new1", "new2"]),
      keyOf,
      2,
      { isKnown: (id) => known.has(id) },
    );
    expect(targets.map(idOf)).toEqual(["new1", "new2"]);
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });

  it("fills spare budget with known rows in a window that advances daily", () => {
    const known = new Set(["k1", "k2", "k3", "k4", "k5"]);
    const ctx = { isKnown: (id: string) => known.has(id) };
    const list = rows(["k3", "k1", "new", "k5", "k2", "k4"]);
    const day0 = planDetailFetch(list, keyOf, 3, ctx, 0);
    const day1 = planDetailFetch(list, keyOf, 3, ctx, 1);
    // The new role always leads; two known rows follow from a moving window.
    expect(day0.targets.map(idOf)).toEqual(["new", "k1", "k2"]);
    expect(day1.targets.map(idOf)).toEqual(["new", "k4", "k5"]);
    expect(day0.seen.sort()).toEqual(["k3", "k4", "k5"]);
    expect(day1.seen.sort()).toEqual(["k1", "k2", "k3"]);
  });

  it("marks nothing seen when everything fits under the cap", () => {
    const { targets, seen } = planDetailFetch(rows(["a", "b"]), keyOf, 50, {
      isKnown: () => true,
    });
    expect(targets).toHaveLength(2);
    expect(seen).toEqual([]);
  });

  it("copes with an empty list", () => {
    expect(planDetailFetch([], keyOf, 50, { isKnown: () => true })).toEqual({
      targets: [],
      seen: [],
    });
  });
});
