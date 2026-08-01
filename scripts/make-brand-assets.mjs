#!/usr/bin/env node
/**
 * Regenerates every brand asset in site/public/ from the mark defined here.
 *
 *   node scripts/make-brand-assets.mjs
 *
 * The mark ("Crossing"): an open ring with a solid dot that has passed through
 * the gap — a boundary and something already beyond it. Two elements, no
 * dashes, no second dot, so it survives 16px and one-colour reproduction.
 *
 * Geometry lives in MARK below and is shared by all four outputs, which is the
 * point of this script: the favicon, the touch icon and the social card can't
 * drift apart, because they're rendered from the same numbers.
 */
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "public");

// --- the mark -------------------------------------------------------------

/**
 * Drawn in a 32×32 box. The content spans x 1.6→30.4 and y 4.55→27.45, so it
 * is optically centred and fills the square about as far as a round mark can
 * without its cap ends clipping.
 */
const MARK = {
  /** Open ring: 256° of arc, leaving a 104° gap facing the dot. */
  arc: "M19.207 8.12 A10 10 0 1 0 19.207 23.88",
  arcWidth: 2.9,
  dot: { cx: 26, cy: 16, r: 4.4 },
};

const INK = "#e7e9ee";
const ACCENT = "#7c5cff";
const GREEN = "#38d39f";
const MUTED = "#9aa1b1";
const BG = "#0b0c10";

/** The ring, at whatever tone the context calls for. */
const arcEl = (stroke, opacity = 1) =>
  `<path d="${MARK.arc}" fill="none" stroke="${stroke}" stroke-width="${MARK.arcWidth}" ` +
  `stroke-linecap="round"${opacity === 1 ? "" : ` opacity="${opacity}"`}/>`;

const dotEl = (fill) =>
  `<circle cx="${MARK.dot.cx}" cy="${MARK.dot.cy}" r="${MARK.dot.r}" fill="${fill}"/>`;

const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";

// --- text measuring -------------------------------------------------------

/**
 * Renders a string alone on a transparent canvas and trims it, which is the
 * only reliable way to get a text advance out of librsvg. Used to centre the
 * lockup and to size the topic chips — guessing at advances puts things a few
 * pixels off centre, which is visible on a 1200px card.
 */
async function measureText(text, { size, weight = 400 }) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="${size * 3}">` +
    `<text x="20" y="${size * 1.6}" font-family="${SANS}" font-size="${size}" ` +
    `font-weight="${weight}" fill="#fff">${text}</text></svg>`;
  const { info } = await sharp(Buffer.from(svg))
    .trim({ threshold: 1 })
    .toBuffer({ resolveWithObject: true });
  return info.width;
}

// --- 1. favicon.svg -------------------------------------------------------

/**
 * Transparent, so the mark sits directly on whatever chrome the browser has.
 * The ring is a mid tone that stays legible on both a light and a dark tab
 * bar; where prefers-color-scheme is honoured it sharpens to a better one.
 * The dot never changes — #7c5cff carries on both grounds.
 */
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="frontierroles.com">
  <style>
    .ring { stroke: #757b90; }
    @media (prefers-color-scheme: dark) { .ring { stroke: #aab0c2; } }
    @media (prefers-color-scheme: light) { .ring { stroke: #5f6479; } }
  </style>
  <path class="ring" d="${MARK.arc}" fill="none" stroke-width="${MARK.arcWidth}" stroke-linecap="round"/>
  ${dotEl(ACCENT)}
</svg>
`;

// --- 2. favicon-32.png ----------------------------------------------------

const favicon32Svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
  arcEl("#8f95a8") +
  dotEl(ACCENT) +
  `</svg>`;

// --- 3. apple-touch-icon.png ---------------------------------------------

/**
 * Full-bleed and opaque: iOS composites transparency onto black and applies
 * its own squircle mask, so a transparent icon with a dark mark disappears.
 * The mark is inset to 62% to survive that mask.
 */
const S = 180;
const inset = S * 0.19;
const scale = (S - inset * 2) / 32;
const appleSvg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">` +
  `<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#171a2e"/><stop offset="1" stop-color="${BG}"/>` +
  `</linearGradient></defs>` +
  `<rect width="${S}" height="${S}" fill="url(#tile)"/>` +
  `<g transform="translate(${inset} ${inset}) scale(${scale})">` +
  arcEl("#aab0c2") +
  dotEl(ACCENT) +
  `</g></svg>`;

// --- 4. og-default.png ----------------------------------------------------

const W = 1200;
const H = 630;
const CHIPS = ["RAG", "Agents", "Evals", "Inference", "LLM apps"];

async function ogSvg() {
  // Lockup: the mark sits left of the wordmark, and the pair is centred as a
  // unit — so the wordmark itself is deliberately off-centre.
  const wmSize = 46;
  const wmWidth = await measureText("frontierroles.com", { size: wmSize, weight: 700 });
  const markW = 44;
  const gap = 14;
  const lockupW = markW + gap + wmWidth;
  const lockupX = (W - lockupW) / 2;
  const lockupY = 128;
  const markScale = markW / 32;

  const chipSize = 26;
  const chipPadX = 20;
  const chipGap = 14;
  const chipH = 52;
  const chipWidths = await Promise.all(
    CHIPS.map(async (c) => (await measureText(c, { size: chipSize })) + chipPadX * 2),
  );
  const chipsW = chipWidths.reduce((a, b) => a + b, 0) + chipGap * (CHIPS.length - 1);
  let chipX = (W - chipsW) / 2;
  const chipY = 462;
  const chips = CHIPS.map((label, i) => {
    const w = chipWidths[i];
    const el =
      `<rect x="${chipX}" y="${chipY}" width="${w}" height="${chipH}" rx="10" ` +
      `fill="#1b1e27" stroke="#272b36"/>` +
      `<text x="${chipX + w / 2}" y="${chipY + chipH / 2 + chipSize * 0.36}" ` +
      `font-family="${SANS}" font-size="${chipSize}" fill="${INK}" text-anchor="middle">${label}</text>`;
    chipX += w + chipGap;
    return el;
  }).join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs><radialGradient id="bg" gradientUnits="userSpaceOnUse" cx="600" cy="-60" r="900">` +
    `<stop offset="0" stop-color="#16131f"/><stop offset="0.6" stop-color="${BG}"/>` +
    `</radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
    `<g transform="translate(${lockupX} ${lockupY - markW / 2}) scale(${markScale})">` +
    arcEl(MUTED, 0.9) +
    dotEl(ACCENT) +
    `</g>` +
    `<text x="${lockupX + markW + gap}" y="${lockupY + wmSize * 0.36}" font-family="${SANS}" ` +
    `font-size="${wmSize}" font-weight="700" fill="${INK}">frontierroles` +
    `<tspan fill="${ACCENT}">.</tspan>com</text>` +
    `<text x="600" y="255" font-family="${SANS}" font-size="86" font-weight="700" ` +
    `fill="${INK}" text-anchor="middle">The job board for</text>` +
    `<text x="600" y="345" font-family="${SANS}" font-size="86" font-weight="700" ` +
    `fill="${INK}" text-anchor="middle">AI engineers</text>` +
    // One <text> with a tspan rather than two positioned runs: it lets the
    // renderer keep the space between them, and centres the whole line as a
    // unit. "Salary-transparent" takes the green the site uses for salary
    // figures — it's the differentiator, so it's the only coloured phrase.
    `<text x="600" y="410" font-family="${SANS}" font-size="30" fill="${MUTED}" ` +
    `text-anchor="middle"><tspan font-weight="700" fill="${GREEN}">Salary-transparent</tspan>` +
    ` first-party roles · no ghost jobs</text>` +
    chips +
    `</svg>`
  );
}

// --- run ------------------------------------------------------------------

/**
 * `opaque` flattens the alpha channel away. The favicon keeps transparency so
 * it sits on the browser's own chrome; the touch icon and the social card must
 * not, because iOS composites transparency onto black and some social scrapers
 * mishandle alpha in OG images.
 */
const png = (svg, file, { opaque = false } = {}) => {
  const img = sharp(Buffer.from(svg));
  return (opaque ? img.flatten({ background: BG }) : img).png().toFile(join(PUBLIC, file));
};

await writeFile(join(PUBLIC, "favicon.svg"), faviconSvg);
await png(favicon32Svg, "favicon-32.png");
await png(appleSvg, "apple-touch-icon.png", { opaque: true });
await png(await ogSvg(), "og-default.png", { opaque: true });

console.log("Wrote favicon.svg, favicon-32.png, apple-touch-icon.png, og-default.png");
