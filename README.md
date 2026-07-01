# WOW Artwork Engine

Automated weekly AI artwork generation, curation, and handoff for WOW's
billboard network — Spectaculars and the EON pods. Built by DLLM Labs.

Every week the engine **generates** original artwork, lets a reviewer **pick**
the best options in a dashboard, and **ships** the picks to a watched Google
Drive folder with an email notification, already sized to spec and ready to run.

See [`WOW_Artwork_Engine_Build_Plan.md`](./WOW_Artwork_Engine_Build_Plan.md)
for the full plan and [`server/README.md`](./server/README.md) for how to run
the current scaffold.

## Stack

Node.js + Express · PostgreSQL (RDS) · S3 · FFmpeg on EC2 · React + Vite +
Tailwind · GitHub Actions + PM2. Motion: Seedance 2.0 via fal.ai. Stills: Nano
Banana Pro (Gemini). Handoff: Google Drive (FTP fallback).

## Layout

```
server/        Express app, generation orchestration, media pipeline, API
web/           React + Vite + Tailwind dashboard
migrations/    SQL schema + specs seed
scripts/spikes/ frame-break + EON 3-pod prototypes (run on fixtures)
infra/         PM2, GitHub Actions, Terraform skeleton
```

## Quick start

```bash
cd server && npm install
cp ../.env.example ../.env        # fill in; .env is gitignored
npm run migrate                   # needs DATABASE_URL
npm test                          # 18 tests (real ffmpeg round-trips)
npm run spike:frame-break         # fixtures only — no API cost
npm run spike:eon
```

## Locked decisions

| Decision | Value |
|---|---|
| Options/week | 3 per surface |
| Handoff | Google Drive + Jeff email |
| Guardrails | loose — block nudity only |
| Motion / stills | Seedance 2.0 (fal.ai) / Nano Banana Pro (Gemini) |

Generation defaults to **fixture mode** — the full pipeline runs locally with
zero spend. Live mode requires `GENERATION_MODE=live` plus `FAL_KEY` and
`GEMINI_API_KEY`.
