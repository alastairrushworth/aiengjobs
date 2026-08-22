import { countryName } from "../format.ts";

/**
 * Text fitting for the share card.
 *
 * satori can wrap and clip text itself, but not *report* what it did — and the
 * card has two places where the layout depends on knowing: the title picks its
 * size from how many lines it will take, and the skill chips have to stop
 * before they collide with the salary. Both decisions are made here, in plain
 * functions, so they can be tested against the real corpus rather than eyeballed
 * on a handful of renders.
 *
 * Everything below works in estimated widths. Inter's advance widths vary by
 * glyph and satori measures them exactly; these estimates only have to be
 * conservative enough that nothing overflows, which they are — they run wide.
 */

/** Card width less its horizontal padding: the usable line length, in px. */
export const CONTENT_WIDTH = 1088;

/**
 * Mean advance width as a fraction of font size, for mixed-case English at
 * Inter's heavier weights. Job titles run wide ("Machine Learning Engineer" is
 * mostly wide lowercase), so this errs high deliberately: overestimating costs
 * a font step, underestimating costs a clipped word.
 */
const CHAR_RATIO = 0.55;

/** Estimated rendered width of a string, in px. */
export function estWidth(text: string, fontSize: number, ratio = CHAR_RATIO): number {
  return text.length * fontSize * ratio;
}

/** How many characters of `fontSize` text fit on one full-width line. */
function charsPerLine(fontSize: number, width = CONTENT_WIDTH): number {
  return Math.floor(width / (fontSize * CHAR_RATIO));
}

/**
 * Lines a string takes when wrapped at whole words.
 *
 * Word-aware rather than a division, because job titles are full of long
 * unbreakable runs — "Senior Lead AI Engineer (Gen AI Platform Services:
 * Distributed Systems)" wraps very differently from 71 average characters.
 */
export function wrapLines(text: string, fontSize: number, width = CONTENT_WIDTH): string[] {
  const budget = charsPerLine(fontSize, width);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= budget || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The title sizes to try, largest first. */
const TITLE_SIZES = [58, 50, 44] as const;

/**
 * Three lines of the smallest step is the most the card can give the title
 * without pushing the company row off the bottom.
 */
const TITLE_MAX_LINES = 3;

export interface FittedTitle {
  text: string;
  fontSize: number;
  lines: number;
}

/**
 * Pick a font size for the title, shrinking it a step at a time until it fits in
 * three lines, and truncating on a word boundary if even the smallest step
 * won't.
 *
 * Truncation is a real loss but a contained one: the unfurl renders `og:title`
 * as its own text directly beside the image, and that carries the full role
 * name. The image can afford to be the readable version.
 */
export function fitTitle(raw: string): FittedTitle {
  const text = raw.trim().replace(/\s+/g, " ");

  for (const fontSize of TITLE_SIZES) {
    const lines = wrapLines(text, fontSize);
    if (lines.length <= TITLE_MAX_LINES) {
      return { text, fontSize, lines: lines.length };
    }
  }

  // Too long at every step: keep the first three lines' worth of whole words.
  const fontSize = TITLE_SIZES[TITLE_SIZES.length - 1];
  const kept = wrapLines(text, fontSize).slice(0, TITLE_MAX_LINES).join(" ");
  // Drop one more word to leave room for the ellipsis rather than pushing the
  // line over its budget with it.
  const trimmed = kept.replace(/\s+\S*$/, "");
  return {
    text: `${trimmed || kept}…`,
    fontSize,
    lines: TITLE_MAX_LINES,
  };
}

/** Chip metrics — must match the styles the card actually applies. */
const CHIP_FONT_SIZE = 19;
const CHIP_PADDING_X = 14;
const CHIP_GAP = 10;

/** Estimated rendered width of one skill chip, in px. */
export function chipWidth(skill: string): number {
  return estWidth(skill, CHIP_FONT_SIZE, 0.6) + CHIP_PADDING_X * 2 + 2;
}

/**
 * As many skills as fit in `available` px, in order, up to `max`.
 *
 * Greedy and order-preserving rather than best-fit: the skills arrive ranked by
 * how central they are to the role, so dropping one to squeeze in a shorter one
 * behind it would misrepresent the job to save 30px.
 */
export function fitChips(skills: string[], available: number, max = 4): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const skill of skills.slice(0, max)) {
    const width = chipWidth(skill) + (kept.length ? CHIP_GAP : 0);
    if (used + width > available) break;
    kept.push(skill);
    used += width;
  }
  return kept;
}

/**
 * Shorten a location to something that reads on one line.
 *
 * `locationRaw` arrives exactly as the ATS wrote it, which includes things like
 * "USA:TX:Plano / W Plano Pkwy - Adm & Dat:2900 W Plano Pkwy". Prefer the
 * structured fields the pipeline derived, and only fall back to the raw string
 * when there are none.
 */
export function shortLocation(job: {
  city?: string;
  region?: string;
  country?: string;
  locationRaw?: string;
}): string | null {
  if (job.city) return job.region ? `${job.city}, ${job.region}` : job.city;
  if (job.region) return job.region;
  // `country` is an ISO code. Unresolved it renders as "IE", which reads as an
  // abbreviation nobody outside the pipeline knows rather than as a place.
  if (job.country) return countryName(job.country) ?? job.country;
  const raw = job.locationRaw?.trim();
  if (!raw) return null;
  // One segment of a delimited path is the best guess at a place name.
  const first = raw.split(/[:|/]/)[0].trim();
  return first.length > 44 ? `${first.slice(0, 43).trimEnd()}…` : first || null;
}

/**
 * Split "$180k–$360k/yr" into its amount and its period.
 *
 * The card sets the two at different sizes and colours — the number is the
 * thing worth reading across a timeline, "/yr" is only there so the number
 * means something — and formatSalary returns them as one string.
 */
export function splitPay(pay: string): { amount: string; period: string | null } {
  const m = pay.match(/^(.*?)(\/[a-z]+)$/i);
  return m ? { amount: m[1], period: m[2] } : { amount: pay, period: null };
}
