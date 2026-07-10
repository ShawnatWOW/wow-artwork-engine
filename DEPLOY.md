# Deploy — Artwork Engine → WOW's existing AWS

The engine deploys the **same way as `wow-contract-query`**: GitHub Actions ships the code
to the existing EC2 over SSH and runs it under PM2. The engine runs as its **own PM2 app**
(`artwork-engine`, port 4000) on the same box; the dashboard tab proxies to it at
`http://localhost:4000` — nothing new is exposed publicly.

> **Why this can't be one-click from a laptop:** the `wow-contract-query-deployer` IAM user is
> **S3-only** (no EC2/SSM), and the EC2 host + SSH key live in GitHub Actions secrets (write-only).
> So the deploy must run through GitHub Actions, exactly like wow-contract-query.

## One-time setup (Shawn)

1. **Repo secrets** — GitHub → `ShawnatWOW/wow-artwork-engine` → Settings → Secrets → Actions.
   Use the **same values** already on `wow-contract-query`:
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
   - `EC2_HOST` (staging), `PROD_EC2_HOST` (production)
   - `EC2_SSH_KEY`
2. **Engine config in S3** — upload an env file to
   `s3://wow-server--use2-az1--x-s3/wow-artwork-engine.env` with:
   ```
   NODE_ENV=production
   PORT=4000
   GENERATION_MODE=fixture        # flip to `live` for the first real run
   FAL_KEY=...                     # Seedream + Seedance (fal.ai)
   DATABASE_URL=postgres://...     # shared RDS (omit to run in-memory for a first smoke)
   STORAGE_DRIVER=local            # or s3 + S3_BUCKET
   # handoff (optional until M3 goes live):
   GOOGLE_DRIVE_FOLDER_ID=...
   GOOGLE_SERVICE_ACCOUNT_JSON=...
   PUBLISH_FROM=scott@wowmedia.com
   ```
3. In `wow-contract-query`'s env (its S3 `.env`), ensure `ARTWORK_ENGINE_API_BASE=http://localhost:4000`
   (that's the default, so usually nothing to add).

## Deploy

- Push/merge to **`dev`** → deploys to **staging**; **`master`** → **production**.
- The workflow installs Node 20 + **ffmpeg** on the box, `npm ci`, migrates (if `DATABASE_URL`),
  and `pm2 startOrReload`s the `artwork-engine` app.
- First deploy keeps `GENERATION_MODE=fixture` ($0) — verify the tab loads, then flip the S3 env
  to `live` and redeploy for the first real run.

## Notes
- Branch convention: this repo currently uses `main`; deploys trigger on `dev`/`master`. Rename/rebase
  to `dev` (staging) and `master` (production) to match the WOW convention.
- FFmpeg is required by the media pipeline (wow-contract-query doesn't need it) — the deploy script
  installs it if missing.
