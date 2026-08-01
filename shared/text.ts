// HTML entity decoding + tag stripping, shared by the engine (ingest) and the
// site (render). Single source of truth so the two sides can't drift.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

/** Decode HTML entities (&nbsp;, &amp;, &#39;, …) and fold non-breaking spaces. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        // Finite isn't enough: fromCodePoint throws a RangeError above the
        // Unicode maximum, and an advert is untrusted input. Leave anything
        // out of range as the literal entity rather than killing the parse.
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : m;
      }
      return NAMED_ENTITIES[e] ?? m;
    })
    .replace(/\u00a0/g, " ");
}

// Strip tags to plain text while PRESERVING paragraph/list structure as newlines,
// so descriptions render as readable paragraphs rather than one run-on block.
export function stripHtml(html: string): string {
  const stripped = html
    .replace(/<\s*br\s*\/?>/gi, "\n") // line breaks
    .replace(/<\s*li[^>]*>/gi, "\n• ") // bullet for each list item
    .replace(/<\/\s*(p|div|ul|ol|h[1-6]|tr|section|article)\s*>/gi, "\n\n") // block boundaries
    .replace(/<[^>]+>/g, " "); // drop remaining tags
  // Decode entities AFTER tag removal (so a decoded "<" can't resurrect a tag),
  // fold non-breaking spaces, then collapse the whitespace they introduce.
  return decodeEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ") // collapse spaces but keep newlines
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n") // cap blank runs
    .trim();
}
