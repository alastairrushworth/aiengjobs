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

/**
 * Every tag the block rules do not name becomes a space, and most of what is
 * left is inline — </a>, </b>, </strong>. Immediately before punctuation that
 * left a visible gap, on 2,918 of the 4,915 descriptions the board carried.
 */
describe("stripHtml spacing around punctuation", () => {
  it("closes the gap an inline tag leaves before a full stop", () => {
    expect(stripHtml("<p>Learn more at the <b>careers site</b>.</p>")).toBe(
      "Learn more at the careers site.",
    );
  });

  it("does the same for the other closing marks", () => {
    expect(stripHtml("<p>Ask <a href='#'>us</a>, or <a href='#'>them</a>!</p>")).toBe(
      "Ask us, or them!",
    );
    expect(stripHtml("<p>Requirements<b></b>: three</p>")).toBe("Requirements: three");
    expect(stripHtml("<p>(see <i>notes</i>)</p>")).toBe("(see notes)");
  });

  it("leaves ordinary spacing alone", () => {
    expect(stripHtml("<p>Build agents. Ship fast.</p>")).toBe("Build agents. Ship fast.");
  });

  it("still keeps list and paragraph structure", () => {
    // </p> is a paragraph boundary, so the blank line is meant to be there.
    expect(stripHtml("<p>We use:</p><ul><li><b>RAG</b>.</li><li>Evals.</li></ul>")).toBe(
      "We use:\n\n• RAG.\n• Evals.",
    );
  });
});
