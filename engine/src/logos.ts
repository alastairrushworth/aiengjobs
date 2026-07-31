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
 * size. A 403 HTML block page served with a .png URL is the normal failure here
 * (openai.com does exactly that), so status codes and content types are not
 * trusted on their own.
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
// What we're willing to *download*. Held well above MAX_BYTES because shrinking
// a fat source is exactly normalize()'s job: gating the download at the storage
// limit threw away icons that would have normalized comfortably under it (IMC's
// 256x256 arrives at 299KB, Palantir's apple-touch-icon at 413KB). Still bounded
// — past this it isn't a favicon, it's someone's hero image.
const MAX_FETCH_BYTES = 4_000_000;

interface Probe {
  ext: string;
  width: number;
  height: number;
}

/** Identify format and dimensions from the header bytes alone. */
function probeImage(buf: Buffer): Probe | null {
  // PNG: 8-byte signature, then an IHDR chunk carrying width/height as u32be.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
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

/** Icon URLs declared by the page, best first, plus the conventional fallbacks. */
function candidates(html: string, base: URL): string[] {
  const out: { href: string; score: number }[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    if (!/\bicon\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)/i.exec(tag)?.[1];
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

async function tryFetchImage(url: string): Promise<{ buf: Buffer; probe: Probe } | null> {
  let res: Response;
  try {
    res = await fetchRetry(url, { redirect: "follow" }, { attempts: 2, timeoutMs: 12_000 });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_FETCH_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_FETCH_BYTES) return null;
  const probe = probeImage(buf);
  if (!probe) return null; // e.g. a 200-with-HTML block page
  if (Math.min(probe.width, probe.height) < MIN_PX) return null;
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
 * on company pages, so they're worth normalising — but not worth a native image
 * dependency on a 1GB droplet. Uses whatever the host already has and returns
 * the original untouched when there's nothing available, so the fetch works
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
        { redirect: "follow" },
        { attempts: 2, timeoutMs: 15_000 },
      ).catch(() => null);
      if (!res?.ok && !company.domain!.startsWith("www.")) {
        res =
          (await fetchRetry(
            `https://www.${company.domain}/`,
            { redirect: "follow" },
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

    for (const url of candidates(html, base)) {
      const raw = await tryFetchImage(url);
      if (!raw) continue;
      const got = { ...raw, ...normalize(raw.buf, raw.probe) };
      // The storage limit lands here, not on the download: normalize() has now
      // had its chance to shrink an oversized source. Anything still over it
      // couldn't be reduced — no image tool on this host, or already minimal —
      // so try the next candidate rather than serve a quarter-megabyte favicon.
      if (got.buf.length > MAX_BYTES) continue;
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
