# aiengjobs

A niche job board for **AI engineers** (LLM apps, RAG, agents, evals, inference).
See [`spec.md`](./spec.md) for the full product & technical spec.

## Architecture

Two halves joined by a nightly data hand-off:

- **`site/`** — an [Astro](https://astro.build) static site deployed to **GitHub Pages**
  (`alastairrushworth.github.io/aiengjobs`). Pre-renders the job index, job detail pages,
  and (later) programmatic SEO pages. Reads `site/src/data/snapshot.json` at build time.
- **`engine/`** — a TypeScript ingestion engine that runs on a small **DigitalOcean droplet**.
  Polls public ATS feeds (Greenhouse / Lever / Ashby), classifies + tags into a **SQLite** DB,
  then exports `snapshot.json` and pushes it to the repo — which triggers the Pages rebuild.
- **`shared/`** — the data model (`types.ts`) and skill taxonomy (`taxonomy.ts`), shared by both.

On-the-fly classification/tagging uses **OpenAI GPT-5.4-nano** (cheapest), heuristic-first and
content-hash cached so the model only runs on new/changed postings.

```
ATS feeds ─▶ engine (droplet): normalize▸classify▸tag▸dedupe▸expiry ─▶ SQLite
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

npm run dev   -w @aiengjobs/site  # run the site locally (http://localhost:4321/aiengjobs)
npm run build -w @aiengjobs/site  # build static site to site/dist

npm run db:init   -w @aiengjobs/engine   # create + seed the SQLite schema
npm run ingest    -w @aiengjobs/engine   # poll ATS feeds (Phase 1)
npm run export    -w @aiengjobs/engine   # write site/src/data/snapshot.json from the DB
npm run typecheck -w @aiengjobs/engine
```

## Deploy

- **Site:** pushing to `main` runs `.github/workflows/deploy.yml`, which fetches the
  snapshot from the `snapshot` branch, builds Astro and publishes to GitHub Pages.
- **Engine:** runs on the droplet via a systemd timer (`deploy/`), which invokes
  `scripts/droplet-refresh.sh`.

> The `snapshot` branch must exist before CI can build. To seed it by hand:
>
> ```bash
> blob=$(git hash-object -w site/src/data/snapshot.json)
> tree=$(printf '100644 blob %s\tsnapshot.json\n' "$blob" | git mktree)
> git push --force origin "$(git commit-tree "$tree" -m snapshot):refs/heads/snapshot"
> ```

## Status

Phase 0 (foundations) complete: monorepo scaffold, working static site with sample data,
engine skeleton with SQLite schema + exporter, Pages deploy workflow. Phase 1 (real ATS
ingestion) and Phase 2 (programmatic SEO, newsletter, Stripe) are next.
