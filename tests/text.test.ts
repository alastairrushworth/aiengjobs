import { describe, expect, it } from "vitest";
import { decodeEntities, stripHtml } from "../shared/text.ts";

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities", () => {
    expect(decodeEntities("A&mdash;B&#39;C&#x2019;D")).toBe("A—B'C’D");
  });

  it("folds non-breaking spaces", () => {
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeEntities("&notarealentity;")).toBe("&notarealentity;");
  });

  it("leaves out-of-range code points alone rather than throwing", () => {
    // fromCodePoint throws above 0x10FFFF. An advert carrying one of these
    // must not be able to take down the ingest or the snapshot export.
    expect(decodeEntities("&#x110000;")).toBe("&#x110000;");
    expect(decodeEntities("&#1114112;")).toBe("&#1114112;");
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
    expect(stripHtml("<p>Great role &#x110000; apply now</p>")).toBe(
      "Great role &#x110000; apply now",
    );
  });

  it("still decodes the largest valid code point", () => {
    expect(decodeEntities("&#x10FFFF;")).toBe(String.fromCodePoint(0x10ffff));
  });
});

describe("stripHtml", () => {
  it("preserves paragraph and list structure", () => {
    expect(
      stripHtml("<p>Hello&nbsp;world &amp; more</p><ul><li>one</li><li>two</li></ul>"),
    ).toBe("Hello world & more\n\n• one\n• two");
  });

  it("cannot resurrect tags from encoded entities", () => {
    // Entities decode AFTER tag stripping, so this must come out as inert text.
    const out = stripHtml("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toBe("<script>alert(1)</script>");
    // …and a real script tag is removed entirely.
    expect(stripHtml("<script>alert(1)</script>")).toBe("alert(1)");
  });

  it("collapses whitespace but keeps newlines", () => {
    expect(stripHtml("<p>a   b</p><p>c</p>")).toBe("a b\n\nc");
  });
});
