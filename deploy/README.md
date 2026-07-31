# Droplet deployment (superseded)

> **This is retained for reference only.** The nightly refresh now runs on a
> GitHub Actions runner — see `.github/workflows/refresh.yml`. Standard runners
> are free on public repositories and provide 4 vCPU / 16GB, against the
> droplet's 1 vCPU / 1GB. These files go away once the droplet is destroyed.

The ingestion engine ran on a small DigitalOcean droplet (`aiengjobs-engine`).
It polled ATS feeds nightly, regenerated `site/src/data/snapshot.json`, and
pushed it back — which triggered the GitHub Pages rebuild.

## One-time setup (as the `deploy` user)

```bash
# 1. Deploy key (write access) is added to the GitHub repo; repo cloned to:
#    /home/deploy/aiengjobs   (remote = git@github.com:..., core.sshCommand -> deploy key)
cd /home/deploy/aiengjobs
npm ci

# 2. Secrets — create /etc/aiengjobs.env (root-owned, 0640, group deploy):
#      AIENGJOBS_DB=/var/lib/aiengjobs/aiengjobs.db

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

Classification is local (`engine/src/pipeline/encoder.ts`); there is no API key.
Without the model files under `ml/model/` the pipeline falls back to heuristic
classification, capturing fewer ambiguous roles.
