import { describe, expect, it } from "vitest";
import { probeImage, candidates, manifestUrls } from "../engine/src/logos.ts";

/** A minimal but structurally valid PNG header: signature + IHDR dimensions. */
function png(width: number, height: number, signature?: Buffer): Buffer {
  const buf = Buffer.alloc(32);
  (signature ?? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).copy(buf, 0);
  buf.write("IHDR", 12, "latin1");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

// comcast.com serves a favicon with the \r stripped out of the 8-byte
// signature. Matching on only the leading \x89PNG accepted it, then read the
// dimensions one byte off and reported a 46080px-square icon — which sailed
// through the size and aspect gates and got written to site/public/logos as a
// file no decoder can open.
describe("probeImage", () => {
  it("reads dimensions from a well-formed PNG", () => {
    expect(probeImage(png(180, 180))).toEqual({ ext: "png", width: 180, height: 180 });
  });

  it("rejects a PNG whose signature has been mangled in transfer", () => {
    const mangled = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(probeImage(png(180, 180, mangled))).toBeNull();
  });

  // An SVG's proportions decide whether it belongs in a square slot; its
  // viewBox numbers do not, since it renders crisply at any size.
  it("reports an SVG's true proportions rather than a fixed size", () => {
    const wordmark = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 283 110">');
    expect(probeImage(wordmark)).toEqual({ ext: "svg", width: 283, height: 110 });
  });
});

describe("candidates", () => {
  const base = new URL("https://example.com/");

  // Unquoted attribute values are legal HTML and minifiers emit them.
  // deepmind.google declares its only icon that way, and a quotes-only href
  // pattern read it as absent.
  it("finds icons declared with unquoted attributes", () => {
    const html = "<link href=https://cdn.example.com/icon.png rel=apple-touch-icon>";
    expect(candidates(html, base)).toContain("https://cdn.example.com/icon.png");
  });

  // sourcegraph.com inlines its 128px PNG and declares nothing else. The URI has
  // to survive intact — running it through new URL() re-encodes the payload.
  it("passes a data: URI through verbatim for the decoder", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    const found = candidates(`<link rel="icon" href="${uri}">`, base);
    expect(found).toContain(uri);
  });

  // A Windows tile is a white silhouette meant to sit on browserconfig.xml's
  // accent colour, so on the site's light plate it renders as an empty box.
  it("never guesses at the Windows tile", () => {
    expect(candidates("", base).join(" ")).not.toContain("mstile");
  });

  it("prefers an apple-touch-icon over a bare .ico", () => {
    const html =
      '<link rel="shortcut icon" href="/favicon.ico">' +
      '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png">';
    const found = candidates(html, base);
    expect(found.indexOf("https://example.com/touch.png")).toBeLessThan(
      found.indexOf("https://example.com/favicon.ico"),
    );
  });
});

// Kept out of candidates() so that stays a pure, offline function: reading a
// manifest costs a request, and it is only ever worth making once everything
// the page declares directly has failed.
describe("manifestUrls", () => {
  const base = new URL("https://example.com/");

  it("puts the page's own declaration ahead of the conventional names", () => {
    const found = manifestUrls('<link rel="manifest" href="/assets/app.webmanifest">', base);
    expect(found[0]).toBe("https://example.com/assets/app.webmanifest");
    expect(found).toContain("https://example.com/site.webmanifest");
  });

  it("falls back to the conventional names when none is declared", () => {
    expect(manifestUrls("", base)).toEqual([
      "https://example.com/site.webmanifest",
      "https://example.com/manifest.json",
    ]);
  });
});
