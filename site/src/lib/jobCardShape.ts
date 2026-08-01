/**
 * The job card's shape, in one place.
 *
 * A card is built twice: `components/JobCard.astro` renders the server-side
 * ones, and the filter script in `components/JobFilters.astro` builds every
 * card that appears after someone types. The client can't reuse the Astro
 * component (no DOM at build time, no Astro at runtime) and it deliberately
 * builds nodes with createElement/textContent, because job data is untrusted
 * feed content and `innerHTML` would hand it an injection point.
 *
 * So the two will always be separate code. What they must not do is disagree:
 * a rename or a resize in one shows up as cards visibly changing shape the
 * moment the list re-renders. That happened — the mark moved into its own
 * element and grew 20px → 44px on the server while the client kept building
 * the old structure. These constants are what stops it happening silently, and
 * `tests/jobCardShape.test.ts` fails if one file learns a class the other
 * hasn't.
 *
 * Nesting still lives in both files. The constants can't enforce it; the test
 * catches the classes, and the two markup blocks are commented to point at
 * each other.
 */

/** Card mark size, in px. Spans the title and company lines it sits beside. */
export const CARD_LOGO_PX = 44;

export const CARD_CLASS = {
  link: "job-card",
  top: "top",
  head: "head",
  headText: "head-text",
  title: "title",
  company: "company",
  salary: "salary",
  meta: "meta",
  badge: "badge",
  badgePosted: "badge posted",
  badgeSkill: "badge skill",
} as const;
