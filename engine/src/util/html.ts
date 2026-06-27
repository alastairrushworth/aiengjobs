export const USER_AGENT =
  "aiengjobs-bot/0.1 (+https://alastairrushworth.com/aiengjobs)";

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode HTML entities (Greenhouse returns entity-encoded content). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

// Strip tags to plain text while PRESERVING paragraph/list structure as newlines,
// so descriptions render as readable paragraphs rather than one run-on block.
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n") // line breaks
    .replace(/<\s*li[^>]*>/gi, "\n• ") // bullet for each list item
    .replace(/<\/\s*(p|div|ul|ol|h[1-6]|tr|section|article)\s*>/gi, "\n\n") // block boundaries
    .replace(/<[^>]+>/g, " ") // drop remaining tags
    .replace(/[ \t\f\v]+/g, " ") // collapse spaces but keep newlines
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n") // cap blank runs
    .trim();
}
