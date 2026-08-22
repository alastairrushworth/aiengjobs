# aiengjobs

A niche job board for **AI engineers** (LLM apps, RAG, agents, evals, inference).
See [`spec.md`](./spec.md) for the full product & technical spec.

## Architecture

Two halves joined by a nightly data hand-off:

- **`site/`** — an [Astro](https://astro.build) static site deployed to **GitHub Pages**
  at [frontierroles.com](https://frontierroles.com). Pre-renders the job index, job detail pages,
  and (later) programmatic SEO pages. Reads `site/src/data/snapshot.json` at build time.
- **`engine/`** — a TypeScript ingestion engine that runs nightly on a **GitHub Actions**
  runner. Polls 14 public ATS feeds (Greenhouse, Lever, Ashby, Workable, Recruitee,
  Teamtailor, SmartRecruiters, Workday, Oracle, Eightfold, iCIMS, SuccessFactors,
  BambooHR, Personio), classifies + tags into a **SQLite** DB, then exports
  `snapshot.json` and publishes it on the detached `snapshot` branch — after which the
  refresh workflow invokes the Pages deploy directly.

  A full sweep of the seed list no longer fits in one run, so the poll order rotates on
  `sources.last_polled_at`: whatever a run drops when it exhausts its time budget is what
  the next run starts with. Coverage of any single night is partial by design; coverage
  across two is complete.
- **`shared/`** — the data model (`types.ts`) and skill taxonomy (`taxonomy.ts`), shared by both.
- **`mcp/`** — a Model Context Protocol server (Cloudflare Worker) exposing the board as
  tools to AI assistants. Reads the published `mcp-index.json`; see [`/mcp`](https://frontierroles.com/mcp/).
- **`ml/`** — the labelled corpus and training script for the classifier (see `ml/README.md`).

Classification runs **locally**: a ModernBERT-base encoder fine-tuned on 4,898 hand-labelled
adverts, shipped as fp32 and executed under ONNX Runtime in-process. No API key, no
per-posting network call. It is heuristic-first (a third of postings are ruled out on title
alone) and content-hash cached, so the model only runs on new or changed postings.

```
ATS feeds ─▶ engine (Actions): normalize▸classify▸tag▸dedupe▸expiry ─▶ SQLite
                                              │
                     export ─┬─ snapshot.json ────▶ `snapshot` branch (force-pushed, no history)
                             ├─ snapshot.meta.json ▶ main ─▶ GitHub Actions ─▶ Pages
                             └─ diff vs. previous ──▶ IndexNow (Bing/Yandex/Naver/Seznam)
```

The ~32MB snapshot is **not** in main's history — committing it nightly grew the
repo by GBs a year and made refreshing more often expensive. It's published on a
detached, single-commit `snapshot` branch; main only carries the few-hundred-byte
`snapshot.meta.json`, which is what triggers the Pages build.

## Develop

```bash
npm install                       # install all workspaces
npm run snapshot:fetch            # pull site/src/data/snapshot.json (gitignored)

npm run dev   -w @aiengjobs/site  # run the site locally (http://localhost:4321/)
npm run build -w @aiengjobs/site  # build static site to site/dist

npm run db:init   -w @aiengjobs/engine   # create the SQLite schema
npm run seed      -w @aiengjobs/engine   # load engine/seed/companies.csv
npm run ingest    -w @aiengjobs/engine   # poll ATS feeds
npm run export    -w @aiengjobs/engine   # write site/src/data/snapshot.json from the DB

npm run og:preview                       # render share cards for a few awkward roles
npm run typecheck                        # engine + site + mcp, then tests/ and shared/
npm test                                 # vitest
```

Node 24+ (the engine uses `node:sqlite`, unflagged only from 23.4). CI installs with
`npm ci`.

## Deploy

- **Site:** pushing to `main` runs `.github/workflows/deploy.yml`, which fetches the
  snapshot from the `snapshot` branch, builds Astro and publishes to GitHub Pages.
- **Engine:** runs nightly on a GitHub Actions runner via
  `.github/workflows/refresh.yml`, in two phases — `scripts/refresh.sh` ingests, the
  workflow then persists the database, and only then does `scripts/publish.sh` publish
  the snapshot. That ordering matters: publishing first meant any late failure discarded
  the night's ingest. The SQLite database is not in the repo — it is carried between runs
  as a gzipped release asset on the `db-latest` tag, with `actions/cache` as a fast path.
- **MCP server:** `.github/workflows/deploy-mcp.yml` deploys the Cloudflare Worker.

> The `snapshot` branch must exist before CI can build. To seed it by hand:
>
> ```bash
> blob=$(git hash-object -w site/src/data/snapshot.json)
> tree=$(printf '100644 blob %s\tsnapshot.json\n' "$blob" | git mktree)
> git push --force origin "$(git commit-tree "$tree" -m snapshot):refs/heads/snapshot"
> ```

## Status

Live at [frontierroles.com](https://frontierroles.com), refreshed nightly: ~1,375 seeded
sources, ~2,800 listed roles, a fine-tuned ONNX classifier, programmatic landing pages for
clusters and cities, RSS feeds, and an MCP server. No newsletter and no payments.

### Feeds and share cards

- `/rss.xml` and `/<topic>/rss.xml` — everything new, per landing page.
- `/daily/rss.xml` — the five strongest new roles a night, ranked by the classifier's
  own `modelScore`. Chosen once at export time and written to
  `site/src/data/daily-picks.json`, which is committed: the picks are history, and
  re-deriving them from a later snapshot gives different answers as roles close.
- Job links unfurl with a generated 1200×630 card carrying the role, employer, location
  and pay. Built at build time by satori + resvg (`site/src/lib/og/`) for roles seen in
  the last 30 days; older ones fall back to a card for their cluster. Every feed item
  also carries the card as `<media:content>`, for posting tools that compose from the
  feed rather than waiting for a platform to unfurl.

### Dependency notes

Two dependencies are deliberately held back, both on an external blocker rather than a
preference:

- **TypeScript 6, not 7.** `astro check` needs TypeScript's programmatic compiler API,
  which the native compiler in 7.x does not expose yet
  ([withastro/roadmap#1321](https://github.com/withastro/roadmap/discussions/1321)).
  Engine and MCP would compile fine on 7; splitting the repo across two majors to get
  there buys nothing and invites version skew.
- **zod 3, not 4.** `@modelcontextprotocol/sdk` types its tool schemas against zod 3's
  `ZodType`, so a zod 4 schema is not assignable and `mcp` stops compiling.

`@types/node` stays on 24 to match the runtime `engines` asks for: types for a newer Node
than CI runs would let code compile against APIs that are not there. `onnxruntime-node` is
pinned exactly (not `^`) — see the CUDA-download note in `.npmrc`/`refresh.yml`. Everything
else tracks latest.

`npm audit` reports four advisories with no fix available, all of them unreachable here:
`adm-zip` is how `onnxruntime-node` unpacks its native binaries at install time, and the
vulnerable `sharp` is `@huggingface/transformers`'s image pipeline, which this engine never
enters — it imports `AutoTokenizer` and nothing else. Neither sees third-party feed data.
