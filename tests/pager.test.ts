import { describe, expect, it } from "vitest";
import { adjacentPages, pageWindow, slash } from "../site/src/lib/pager.ts";

describe("pageWindow", () => {
  it("always shows the ends and the current page's neighbours", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 22)).toEqual([1, 2, "gap", 22]);
    expect(pageWindow(7, 22)).toEqual([1, "gap", 6, 7, 8, "gap", 22]);
    expect(pageWindow(22, 22)).toEqual([1, "gap", 21, 22]);
  });

  it("never marks a gap between adjacent numbers", () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("adjacentPages", () => {
  it("adds the trailing slash GitHub Pages serves", () => {
    expect(adjacentPages({ url: { prev: "/companies/acme", next: "/companies/acme/3" } })).toEqual({
      prev: "/companies/acme/",
      next: "/companies/acme/3/",
    });
    expect(adjacentPages({ url: {} })).toEqual({ prev: undefined, next: undefined });
    expect(slash("/ai-agent-jobs/")).toBe("/ai-agent-jobs/");
  });
});
