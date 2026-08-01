import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fetchRetry } from "./util/fetch.ts";
import { mapPool } from "./util/concurrency.ts";
import type { SiteSnapshot } from "@aiengjobs/shared";

/**
 * Fetch each seeded company's logo once and store it under site/public/logos/.
 *
 * Why store rather than hotlink: the logo ends up in JobPosting's
 * hiringOrganization.logo, so it has to be a stable, crawlable image we serve.
 * Third-party logo APIs are out (Clearbit is gone, Google's favicon service
 * isn't ours to serve), and hotlinking a company's own asset breaks the moment
 * they reorganise their site — leaving broken markup in Google's index.
 *
 * Nothing is recorded unless the bytes actually decode as an image of a usable
 * size. A 403 HTML block page served with a .png URL is the normal failure here,
 * so status codes and content types are not trusted on their own.
 *
 * What remains unreachable, after all of the above, is a site behind a bot
 * challenge that needs JavaScript to clear — doordash.com and gartner.com serve
 * no bytes at all to an HTTP client, favicon included. Those companies render as
 * a monogram, which is what the fallback is for; don't add a headless browser.
 *
 * Run occasionally — logos are write-once per company, unlike the nightly job
 * refresh. `npm run logos -w @aiengjobs/engine`.
 */

// Resolved from the module, not cwd — npm workspace scripts run from engine/.
const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const SNAPSHOT = join(REPO, "site", "src", "data", "snapshot.json");
const OUT_DIR = join(REPO, "site", "public", "logos");
const MANIFEST = join(REPO, "site", "src", "data", "logos.json");
const CONCURRENCY = Number(process.env.LOGO_CONCURRENCY ?? 8);
// Plenty of sites top out at a 48px .ico — that's still a real brand mark and
// renders 1:1 in the ~44px slot the site gives it, so take it. Whether it's
// good enough to *claim* in structured data is a separate call the site makes
// from the recorded dimensions (see LOGO_MARKUP_MIN_PX in site/src/lib/logos).
const MIN_PX = 48;
// The slot is square and the image is object-fit: contain, so a 3:1 wordmark
// renders as a thin illegible strip with empty plate above and below it. Real
// favicons are square; anything this far from it is the company's horizontal
// logo picked up by mistake, and a monogram beats it.
const MAX_ASPECT = 1.6;
// What we're willing to *store*, checked after normalize() has had its go.
const MAX_BYTES = 300_000;
/**
 * Browser headers, for this module only — ingestion keeps identifying itself as
 * aiengjobs-bot (see util/html.ts) and nothing here changes that.
 *
 * A favicon is the one asset every visitor's browser fetches, and the robots.txt
 * of the sites this rescues allows it (openai.com is `Allow: /`). What blocks us
 * is a CDN's shape-of-the-request heuristic, not a stated policy: these WAFs 403
 * any User-Agent carrying a bot token, including the honest Mozilla-prefixed
 * form `Mozilla/5.0 (compatible; aiengjobs-bot/0.1; …)`. Sending what a browser
 * sends recovers openai, servicenow, mastercard, nasdaq and nine others.
 *
 * Cheap to justify because of how little this does: one pass over ~60 sites,
 * only for companies with no logo yet, fetching one public image each.
 */
const LOGO_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_HEADERS = {
  "User-Agent": LOGO_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
const IMAGE_HEADERS = {
  "User-Agent": LOGO_UA,
  Accept: "image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};
// What we're willing to *download*. Held well above MAX_BYTES because shrinking
// a fat source is exactly normalize()'s job: gating the download at the storage
// limit threw away icons that would have normalized comfortably under it (IMC's
// 256x256 arrives at 299KB, Palantir's apple-touch-icon at 413KB). Still bounded
// — past this it isn't a favicon, it's someone's hero image.
const MAX_FETCH_BYTES = 4_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// An upper bound on plausibility, not on taste: real masters do reach a few
// thousand pixels (one arrives at 4110 square). Past this, the number came from
// a misread header rather than an image, and normalize() would hand sips a file
// it can't make sense of.
const MAX_PX = 8192;

interface Probe {
  ext: string;
  width: number;
  height: number;
}

/** Identify format and dimensions from the header bytes alone. */
export function probeImage(buf: Buffer): Probe | null {
  // PNG: 8-byte signature, then an IHDR chunk carrying width/height as u32be.
  // All eight bytes get checked, not just the \x89PNG magic. The \r\n\x1a\n tail
  // exists precisely to catch mangled transfers, and comcast.com serves a
  // favicon with the \r stripped: matching on the first four bytes accepted it,
  // then read the dimensions one byte off and believed the icon was 46080px
  // square. Everything downstream — the size gate, the aspect gate, sips — was
  // working from that number, and a corrupt file landed in site/public/logos.
  if (buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { ext: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF87a / GIF89a: dimensions are u16le at offset 6.
  if (buf.length > 10 && buf.subarray(0, 3).toString("latin1") === "GIF") {
    return { ext: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // RIFF....WEBP — VP8 / VP8L / VP8X each store size differently.
  if (
    buf.length > 30 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    const kind = buf.subarray(12, 16).toString("latin1");
    if (kind === "VP8X") {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { ext: "webp", width: w, height: h };
    }
    if (kind === "VP8 ") {
      return {
        ext: "webp",
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
      };
    }
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { ext: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  // JPEG: walk the segment chain to a start-of-frame marker.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) break;
      const marker = buf[o + 1];
      const len = buf.readUInt16BE(o + 2);
      // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved among them.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { ext: "jpg", height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
  }
  // ICO: a directory of images; take the largest entry (0 encodes 256).
  if (buf.length > 22 && buf.readUInt32LE(0) === 0x00010000) {
    const count = buf.readUInt16LE(4);
    let best = 0;
    for (let i = 0; i < count && 6 + i * 16 + 1 < buf.length; i++) {
      const w = buf[6 + i * 16] || 256;
      if (w > best) best = w;
    }
    return { ext: "ico", width: best, height: best };
  }
  // SVG: vector, so any rendered size is fine — but the *proportions* still
  // matter. This used to report a flat 512x512, which made a wide wordmark
  // indistinguishable from a square mark; the aspect gate in tryFetchImage
  // needs real numbers to reject one (fiserv.com's logo.svg is 283x110).
  const head = buf.subarray(0, 400).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) {
    const markup = buf.subarray(0, 2000).toString("utf8");
    if (/<svg[\s>]/i.test(markup)) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(markup);
      if (vb) return { ext: "svg", width: Number(vb[1]), height: Number(vb[2]) };
      const w = /\bwidth\s*=\s*["']([\d.]+)/i.exec(markup);
      const h = /\bheight\s*=\s*["']([\d.]+)/i.exec(markup);
      if (w && h) return { ext: "svg", width: Number(w[1]), height: Number(h[1]) };
      // Neither declared: scalable and unmeasurable, so treat it as fine.
      return { ext: "svg", width: 512, height: 512 };
    }
  }
  return null;
}

/**
 * Read an HTML attribute, quoted or not.
 *
 * Unquoted values are legal HTML and some minifiers emit them —
 * deepmind.google ships `<link href=https://…/icon.png rel=apple-touch-icon>`.
 * A quotes-only href pattern reads that as absent and silently drops the site's
 * only declared icon.
 */
function attr(tag: string, name: string): string | undefined {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  if (quoted) return quoted[1];
  return new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i").exec(tag)?.[1];
}

/** Where a page's web app manifest might live: declared first, then the usual names. */
export function manifestUrls(html: string, base: URL): string[] {
  const hrefs: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!(attr(tag, "rel") ?? "").toLowerCase().includes("manifest")) continue;
    const href = attr(tag, "href");
    if (href) hrefs.push(href);
  }
  hrefs.push("/site.webmanifest", "/manifest.json");
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of hrefs) {
    try {
      const abs = new URL(href, base).href;
      if (!/^https?:/.test(abs) || seen.has(abs)) continue;
      seen.add(abs);
      urls.push(abs);
    } catch {
      /* malformed href — skip it */
    }
  }
  return urls.slice(0, 3);
}

/**
 * Icons listed in the web app manifest, largest first.
 *
 * A site that declares only a 32px favicon in its markup often still ships
 * 192/512px icons here for Android home screens — fundingcircle.com's only
 * usable mark is its manifest's 512px PNG. Worth the extra request, but only
 * once everything the page declares directly has already failed, which is why
 * this is a separate step from candidates() rather than folded into it.
 */
async function manifestIcons(urls: string[]): Promise<string[]> {
  const out: { src: string; px: number }[] = [];
  for (const url of urls) {
    const res = await fetchRetry(
      url,
      { redirect: "follow", headers: { ...IMAGE_HEADERS, Accept: "application/manifest+json,application/json,*/*" } },
      { attempts: 1, timeoutMs: 10_000 },
    ).catch(() => null);
    if (!res?.ok) continue;
    let icons: unknown;
    try {
      icons = (JSON.parse(await res.text()) as { icons?: unknown })?.icons;
    } catch {
      continue; // not JSON — some sites serve an HTML 404 body with a 200
    }
    if (!Array.isArray(icons)) continue;
    for (const icon of icons as { src?: unknown; sizes?: unknown }[]) {
      if (typeof icon?.src !== "string") continue;
      // "48x48 96x96 192x192" is legal; rank on the largest declared.
      const px = Math.max(
        0,
        ...String(icon.sizes ?? "")
          .split(/\s+/)
          .map((s) => Number.parseInt(s, 10) || 0),
      );
      try {
        out.push({ src: new URL(icon.src, url).href, px });
      } catch {
        /* malformed src — skip it */
      }
    }
    if (out.length) break;
  }
  return out.sort((a, b) => b.px - a.px).map((i) => i.src);
}

/** Icon URLs declared by the page, best first, plus the conventional fallbacks. */
export function candidates(html: string, base: URL): string[] {
  const out: { href: string; score: number }[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    if (!/\bicon\b/.test(rel)) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    const px = sizes ? Number(sizes) : 0;
    // Prefer a declared apple-touch-icon (usually 180px+ and a real brand mark)
    // over a bare favicon, and bigger over smaller.
    let score = px;
    if (rel.includes("apple-touch-icon")) score += 400;
    if (/\.svg(\?|$)/i.test(href)) score += 300; // vector: scales to anything
    if (/\.ico(\?|$)/i.test(href)) score -= 200; // usually a 16/32px tab icon
    out.push({ href, score });
  }
  const declared = out
    .sort((a, b) => b.score - a.score)
    .map((c) => c.href)
    .slice(0, 6);

  const guesses = [
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/favicon.svg",
    "/icon.svg",
    "/favicon-192x192.png",
    "/favicon-196x196.png",
    "/favicon-96x96.png",
    "/apple-icon-180x180.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
    // Deliberately not /mstile-150x150.png. It looks tempting — square by spec,
    // routinely larger than its name — but a Windows tile is drawn as a white
    // silhouette meant to sit on the accent colour from browserconfig.xml, so on
    // our light plate it renders as an empty box. cmegroup.com's is 270px of
    // pure white. Blank is worse than the monogram it would displace.
    "/favicon.png",
    "/favicon.ico",
  ];

  // Plenty of sites file their icons in a directory and declare only the .ico
  // from it — supabase.com points at /favicon/favicon.ico while the 512px
  // vector sits beside it as /favicon/favicon.svg. Root-relative guesses never
  // reach those, so re-try the conventional names in whatever directory the
  // page's own icon links point at. Deliberately no logo.svg/logo.png here:
  // those are usually the wide wordmark, not the square mark this slot wants.
  const siblingNames = [
    "favicon.svg",
    "icon.svg",
    "apple-touch-icon.png",
    "favicon-196x196.png",
    "favicon-192x192.png",
    "android-chrome-192x192.png",
  ];
  const siblings: string[] = [];
  for (const href of declared) {
    try {
      const abs = new URL(href, base).href;
      const dir = abs.slice(0, abs.lastIndexOf("/") + 1);
      if (dir === new URL("/", base).href) continue; // root: the guesses cover it
      for (const name of siblingNames) siblings.push(dir + name);
    } catch {
      /* malformed href — skip it */
    }
  }

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of [...declared, ...guesses, ...siblings]) {
    try {
      // A data: URI is already the image — sourcegraph.com inlines its 128px
      // PNG this way and declares nothing else. Passed through verbatim for
      // tryFetchImage to decode; new URL() would re-encode the payload.
      if (/^data:image\//i.test(href.trim())) {
        const raw = href.trim();
        if (seen.has(raw)) continue;
        seen.add(raw);
        urls.push(raw);
        continue;
      }
      const abs = new URL(href, base).href;
      if (!/^https?:/.test(abs) || seen.has(abs)) continue;
      seen.add(abs);
      urls.push(abs);
    } catch {
      /* malformed href in someone's markup — skip it */
    }
  }
  // Bounded so one page's link soup can't turn into dozens of requests.
  return urls.slice(0, 28);
}

/** Decode a `data:image/…;base64,…` icon declared inline in the markup. */
function decodeDataUri(url: string): Buffer | null {
  const m = /^data:image\/[a-z.+-]+;base64,([\s\S]+)$/i.exec(url.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    return buf.length > 0 && buf.length <= MAX_FETCH_BYTES ? buf : null;
  } catch {
    return null;
  }
}

async function tryFetchImage(url: string): Promise<{ buf: Buffer; probe: Probe } | null> {
  let buf: Buffer;
  const inline = decodeDataUri(url);
  if (inline) {
    buf = inline;
  } else {
    let res: Response;
    try {
      res = await fetchRetry(
        url,
        { redirect: "follow", headers: IMAGE_HEADERS },
        { attempts: 2, timeoutMs: 12_000 },
      );
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_FETCH_BYTES) return null;
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_FETCH_BYTES) return null;
  }
  const probe = probeImage(buf);
  if (!probe) return null; // e.g. a 200-with-HTML block page
  // MIN_PX is about resolution, which a vector doesn't have — an SVG with a
  // 24x24 viewBox renders as crisply at 256px as one drawn at 512. Gating it on
  // the viewBox threw away perfectly good marks (autodesk.com declares a 32x32
  // viewBox and nothing else). The aspect check below still applies: those are
  // proportions, and a wide wordmark stays wrong at every size.
  if (!(probe.width > 0) || !(probe.height > 0)) return null;
  if (Math.max(probe.width, probe.height) > MAX_PX) return null;
  if (probe.ext !== "svg" && Math.min(probe.width, probe.height) < MIN_PX) return null;
  if (Math.max(probe.width, probe.height) / Math.min(probe.width, probe.height) > MAX_ASPECT) {
    return null; // a wordmark, not a square mark
  }
  return { buf, probe };
}

/**
 * Re-encode to a web-appropriate PNG when the source is oversized or an .ico.
 *
 * Favicons are often shipped as multi-resolution .ico (a 256px Discord icon is
 * 279KB) or as absurd masters (one logo arrives at 4110x4110). Both get served
 * on company pages, so they're worth normalising — but not worth adding a native
 * image dependency for. Uses whatever the host already has and returns the
 * original untouched when there's nothing available, so the fetch works
 * everywhere and merely produces heavier files on a bare box.
 */
const MAX_LOGO_PX = 256;
const NORMALIZE_OVER_BYTES = 60_000;

function normalize(buf: Buffer, probe: Probe): { buf: Buffer; probe: Probe } {
  if (probe.ext === "svg") return { buf, probe }; // vector: already small, scales
  const oversized = probe.width > MAX_LOGO_PX || buf.length > NORMALIZE_OVER_BYTES;
  if (probe.ext === "png" && !oversized) return { buf, probe };

  const tmp = join(tmpdir(), `aiengjobs-logo-${process.pid}-${randomUUID()}`);
  const src = `${tmp}.${probe.ext}`;
  const dst = `${tmp}.png`;
  try {
    writeFileSync(src, buf);
    const args = ["-s", "format", "png"];
    // Downscale only. --resampleHeightWidthMax also scales *up*, which turned a
    // 64px .ico into a 256px PNG bigger than the original.
    if (probe.width > MAX_LOGO_PX) {
      args.push("--resampleHeightWidthMax", String(MAX_LOGO_PX));
    }
    const r = spawnSync("sips", [...args, src, "--out", dst], { stdio: "ignore" });
    if (r.status !== 0) return { buf, probe };
    const out = readFileSync(dst);
    const outProbe = probeImage(out);
    if (!outProbe) return { buf, probe };
    // Take it if it saves bytes, or if it gets us off .ico — that format is a
    // Windows icon container, not something to hand Google as a logo. Guard
    // against a re-encode that balloons.
    const worthIt = out.length < buf.length || (probe.ext !== "png" && out.length < 120_000);
    return worthIt ? { buf: out, probe: outProbe } : { buf, probe };
  } catch {
    return { buf, probe };
  } finally {
    rmSync(src, { force: true });
    rmSync(dst, { force: true });
  }
}

export interface LogoResult {
  slug: string;
  status: "written" | "skipped" | "failed";
  detail: string;
  file?: string;
  width?: number;
  height?: number;
}

function existingManifest(): Record<string, { file: string; w: number; h: number }> {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return {};
  }
}

export async function fetchLogos(opts: { force?: boolean } = {}): Promise<void> {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as SiteSnapshot;
  // Only companies with roles on the board — the seed list carries more.
  const live = new Set(snapshot.jobs.filter((j) => !j.isClosed).map((j) => j.companySlug));
  const companies = snapshot.companies
    .filter((c) => c.domain && live.has(c.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  mkdirSync(OUT_DIR, { recursive: true });
  const existing = new Map<string, string>();
  for (const f of readdirSync(OUT_DIR)) {
    const dot = f.lastIndexOf(".");
    if (dot > 0) existing.set(f.slice(0, dot), f);
  }

  console.log(
    `Fetching logos for ${companies.length} companies with open roles ` +
      `(${existing.size} already stored, concurrency ${CONCURRENCY})`,
  );

  const results = await mapPool(companies, CONCURRENCY, async (company): Promise<LogoResult> => {
    const slug = company.slug;
    if (existing.has(slug) && !opts.force) {
      return { slug, status: "skipped", detail: "already stored" };
    }
    const base = new URL(`https://${company.domain}/`);
    let html = "";
    try {
      // A few apexes refuse us but the www host answers fine.
      let res = await fetchRetry(
        base.href,
        { redirect: "follow", headers: PAGE_HEADERS },
        { attempts: 2, timeoutMs: 15_000 },
      ).catch(() => null);
      if (!res?.ok && !company.domain!.startsWith("www.")) {
        res =
          (await fetchRetry(
            `https://www.${company.domain}/`,
            { redirect: "follow", headers: PAGE_HEADERS },
            { attempts: 1, timeoutMs: 12_000 },
          ).catch(() => null)) ?? res;
      }
      if (!res) throw new Error("unreachable");
      // Resolve icon hrefs against the *final* URL — plenty of these redirect
      // to a www or regional host, and a relative href follows the redirect.
      if (res.ok) {
        html = await res.text();
        if (res.url) {
          try {
            base.href = new URL(res.url).href;
          } catch {
            /* keep the original base */
          }
        }
      }
    } catch {
      /* homepage unreachable — the conventional paths may still work */
    }

    const store = async (url: string): Promise<LogoResult | null> => {
      const raw = await tryFetchImage(url);
      if (!raw) return null;
      const got = { ...raw, ...normalize(raw.buf, raw.probe) };
      // The storage limit lands here, not on the download: normalize() has now
      // had its chance to shrink an oversized source. Anything still over it
      // couldn't be reduced — no image tool on this host, or already minimal —
      // so try the next candidate rather than serve a quarter-megabyte favicon.
      if (got.buf.length > MAX_BYTES) return null;
      // Replace any previous extension for this slug so we never leave two.
      const prev = existing.get(slug);
      if (prev && prev !== `${slug}.${got.probe.ext}`) {
        rmSync(join(OUT_DIR, prev), { force: true });
      }
      writeFileSync(join(OUT_DIR, `${slug}.${got.probe.ext}`), got.buf);
      return {
        slug,
        status: "written",
        detail: `${got.probe.width}x${got.probe.height} ${got.probe.ext} ${Math.round(got.buf.length / 1024)}KB`,
        file: `${slug}.${got.probe.ext}`,
        width: got.probe.width,
        height: got.probe.height,
      };
    };

    for (const url of candidates(html, base)) {
      const done = await store(url);
      if (done) return done;
    }
    // Last resort, and one extra request only for a site that has already given
    // us nothing usable: the icons a site ships for Android home screens.
    for (const url of await manifestIcons(manifestUrls(html, base))) {
      const done = await store(url);
      if (done) return done;
    }
    return { slug, status: "failed", detail: `no usable icon at ${company.domain}` };
  });

  const by = (s: LogoResult["status"]) => results.filter((r) => r.status === s);

  // Manifest, so the site doesn't have to re-open every image at build time to
  // learn its size — and so it can decide separately whether a logo is big
  // enough to claim in structured data. Rebuilt from the directory, not just
  // this run's results, so a skipped (already-stored) logo survives.
  const manifest: Record<string, { file: string; w: number; h: number }> = {};
  for (const r of results) {
    if (r.file && r.width && r.height) manifest[r.slug] = { file: r.file, w: r.width, h: r.height };
  }
  const prior = existingManifest();
  for (const [slug, entry] of Object.entries(prior)) {
    if (!manifest[slug] && readdirSync(OUT_DIR).includes(entry.file)) manifest[slug] = entry;
  }
  writeFileSync(
    MANIFEST,
    `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`,
    "utf8",
  );

  console.log(
    `\nwritten ${by("written").length}  skipped ${by("skipped").length}  failed ${by("failed").length}` +
      `  -> ${Object.keys(manifest).length} in logos.json`,
  );
  for (const r of by("failed")) console.log(`  no logo: ${r.slug} — ${r.detail}`);
}
