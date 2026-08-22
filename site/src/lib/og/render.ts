import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * 1200×630 is what every unfurl wants: it is Open Graph's recommended size, it
 * is the minimum LinkedIn will render as a large card rather than a thumbnail,
 * and it is the 1.91:1 X reads for `summary_large_image`. Changing it changes
 * how the card crops on all three.
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * Inter, in the three weights the card uses.
 *
 * The site itself sets no webfont — it asks for `ui-sans-serif, system-ui` and
 * takes whatever the reader has. A generated image cannot do that; the glyphs
 * have to come from somewhere, and they have to be the same glyphs on a Mac
 * laptop and an Ubuntu runner or the card silently reflows between a local
 * preview and what actually ships. Inter is the closest widely-available face
 * to what system-ui resolves to on the platforms most of the board's readers
 * use, and the latin subset is ~31KB a weight.
 */
const WEIGHTS = [400, 600, 800] as const;

type FontSpec = {
  name: string;
  data: Buffer;
  weight: (typeof WEIGHTS)[number];
  style: "normal";
};

let cachedFonts: FontSpec[] | null = null;

/** Read once per build, not once per card — this runs thousands of times. */
function fonts(): FontSpec[] {
  cachedFonts ??= WEIGHTS.map((weight) => ({
    name: "Inter",
    data: readFileSync(
      require.resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`),
    ),
    weight,
    style: "normal" as const,
  }));
  return cachedFonts;
}

/**
 * A satori element tree.
 *
 * satori's own signature asks for a React node, and this site has no React in
 * it. The runtime only ever reads `type` and `props`, which is exactly this
 * shape, so the tree is built as plain objects and cast at the one call below.
 */
export interface El {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: El | string | (El | string | false | null)[];
    [key: string]: unknown;
  };
}

/**
 * Lay out an element tree with satori and rasterize it with resvg.
 *
 * Returns a Uint8Array rather than resvg's Buffer so the result can be handed
 * straight to `new Response(...)` — Astro types a route's body as the DOM's
 * BodyInit, which Node's Buffer is not a member of even though it is one at
 * runtime.
 */
export async function renderCard(el: El): Promise<Uint8Array<ArrayBuffer>> {
  const svg = await satori(el as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts(),
  });

  const rendered = new Resvg(svg, {
    // satori has already resolved every glyph to a `<path>`, so resvg needs no
    // font at all here. Left at its default it builds a font database from the
    // system on every construction, which measured ~107ms per card against
    // ~11ms with it off — over a full build, minutes spent enumerating fonts
    // that nothing then looks up.
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();

  // Uint8Array.from, not `new Uint8Array(rendered)`: the latter keeps resvg's
  // ArrayBufferLike, and Response's BodyInit will only take a view over a plain
  // ArrayBuffer.
  return Uint8Array.from(rendered);
}
