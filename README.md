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
                              export snapshot.json ─▶ git push ─▶ GitHub Actions ─▶ Pages
```

## Develop

```bash
npm install                       # install all workspaces

npm run dev   -w @aiengjobs/site  # run the site locally (http://localhost:4321/aiengjobs)
npm run build -w @aiengjobs/site  # build static site to site/dist

npm run db:init   -w @aiengjobs/engine   # create + seed the SQLite schema
npm run ingest    -w @aiengjobs/engine   # poll ATS feeds (Phase 1)
npm run export    -w @aiengjobs/engine   # write site/src/data/snapshot.json from the DB
npm run typecheck -w @aiengjobs/engine
```

## Deploy

- **Site:** pushing to `main` (changes under `site/`, `shared/`, or lockfile) runs
  `.github/workflows/deploy.yml`, which builds Astro and publishes to GitHub Pages.
- **Engine:** runs on the droplet via cron; see the build plan for provisioning details.

## Status

Phase 0 (foundations) complete: monorepo scaffold, working static site with sample data,
engine skeleton with SQLite schema + exporter, Pages deploy workflow. Phase 1 (real ATS
ingestion) and Phase 2 (programmatic SEO, newsletter, Stripe) are next.
