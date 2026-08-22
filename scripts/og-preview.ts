/**
 * Render share cards for a handful of real roles, so the layout can be looked at
 * without waiting on a full site build.
 *
 *   npx tsx scripts/og-preview.ts [outDir]
 *
 * With no arguments it picks a deliberately awkward spread — the longest title
 * on the board, a role with no salary, one with no logo, one with neither —
 * because those are the cards that break, and the happy path never does. Pass
 * job slugs to render specific roles instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Job, SiteSnapshot } from "@aiengjobs/shared";
import { jobCard } from "../site/src/lib/og/card.ts";
import { logoDataUri } from "../site/src/lib/og/logo.ts";
import { renderCard } from "../site/src/lib/og/render.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Read rather than import: scripts/ is CommonJS (the root package has no
// "type": "module"), so a JSON import attribute does not survive the transform.
const { jobs, fxRates } = JSON.parse(
  readFileSync(join(repoRoot, "site/src/data/snapshot.json"), "utf8"),
) as SiteSnapshot;

const open = jobs.filter((j) => !j.isClosed);
const priced = (j: Job) => Boolean(j.salaryMin ?? j.salaryMax);
const hasLogo = (j: Job) => logoDataUri(j.companySlug) !== null;

const args = process.argv.slice(2);
const outDir = args.find((a) => a.includes("/")) ?? "og-preview";
const wanted = args.filter((a) => !a.includes("/"));

const sample: Job[] = wanted.length
  ? wanted.map((slug) => {
      const job = open.find((j) => j.slug === slug);
      if (!job) throw new Error(`no open job with slug "${slug}"`);
      return job;
    })
  : [
      open.filter((j) => priced(j) && hasLogo(j)).sort((a, b) => a.title.length - b.title.length)[0],
      open.filter((j) => priced(j) && hasLogo(j)).sort((a, b) => b.title.length - a.title.length)[0],
      open.find((j) => !priced(j) && !hasLogo(j) && j.remoteType === "remote" && j.skills.length <= 1),
      open.find((j) => !priced(j) && hasLogo(j) && j.skills.length >= 4),
      open.find((j) => priced(j) && !hasLogo(j)),
      // Longest company name that still has pay — the company row is the other
      // place text can run off the edge.
      open.filter((j) => priced(j)).sort((a, b) => b.companyName.length - a.companyName.length)[0],
    ].filter((j): j is Job => Boolean(j));

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const job of sample) {
    const png = await renderCard(
      jobCard({ job, logoUri: logoDataUri(job.companySlug), fxRates }),
    );
    const file = join(outDir, `${job.slug}.png`);
    writeFileSync(file, png);
    console.log(
      `${file}  ${(png.length / 1024).toFixed(1)}KB  ${job.title} — ${job.companyName}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
