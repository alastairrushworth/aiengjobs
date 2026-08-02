# aiengjobs

A niche job board for **AI engineers** (LLM apps, RAG, agents, evals, inference).
See [`spec.md`](./spec.md) for the full product & technical spec.

## Architecture

Two halves joined by a nightly data hand-off:

- **`site/`** — an [Astro](https://astro.build) static site deployed to **GitHub Pages**
  at [frontierroles.com](https://frontierroles.com). Pre-renders the job index, job detail pages,
  and (later) programmatic SEO pages. Reads `site/src/data/snapshot.json` at build time.
- **`engine/`** — a TypeScript ingestion engine that runs nightly on a **GitHub Actions**
  runner. Polls 12 public ATS feeds (Greenhouse, Lever, Ashby, Workday, SmartRecruiters,
  Recruitee, Personio, Teamtailor, Oracle, iCIMS, Eightfold, SuccessFactors), classifies +
  tags into a **SQLite** DB, then exports `snapshot.json` and publishes it on the detached
  `snapshot` branch — after which the refresh workflow invokes the Pages deploy directly.
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

The ~22MB snapshot is **not** in main's history — committing it nightly grew the
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

npm run typecheck                        # engine tsc + astro check + mcp tsc
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

Live at [frontierroles.com](https://frontierroles.com), refreshed nightly: ~850 seeded
sources, ~2,000 open roles, a fine-tuned ONNX classifier, programmatic landing pages for
clusters and cities, RSS feeds, and an MCP server. No newsletter and no payments.
