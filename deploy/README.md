# Droplet deployment

The ingestion engine runs on a small DigitalOcean droplet (`aiengjobs-engine`).
It polls ATS feeds nightly, regenerates `site/src/data/snapshot.json`, and pushes
it back — which triggers the GitHub Pages rebuild.

## One-time setup (as the `deploy` user)

```bash
# 1. Deploy key (write access) is added to the GitHub repo; repo cloned to:
#    /home/deploy/aiengjobs   (remote = git@github.com:..., core.sshCommand -> deploy key)
cd /home/deploy/aiengjobs
npm ci

# 2. Secrets — create /etc/aiengjobs.env (root-owned, 0640, group deploy):
#      AIENGJOBS_DB=/var/lib/aiengjobs/aiengjobs.db
#      OPENAI_API_KEY=sk-...        # GPT-5.4-nano classification/tagging
#      OPENAI_MODEL=gpt-5.4-nano

# 3. Initialise + seed the database:
AIENGJOBS_DB=/var/lib/aiengjobs/aiengjobs.db npm run -s db:init -w @aiengjobs/engine
AIENGJOBS_DB=/var/lib/aiengjobs/aiengjobs.db npm run -s seed   -w @aiengjobs/engine

# 4. Install the systemd timer:
sudo cp deploy/aiengjobs-refresh.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aiengjobs-refresh.timer
```

## Manual run

```bash
scripts/droplet-refresh.sh        # pull, ingest, export, commit+push if changed
systemctl start aiengjobs-refresh.service   # same, via systemd
journalctl -u aiengjobs-refresh.service -n 50
```

The OpenAI key is optional: without it the pipeline falls back to heuristic
classification/tagging (fewer ambiguous roles captured).
