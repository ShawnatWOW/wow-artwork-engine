# WOW Artwork Engine — Server

Node.js + Express backend: generation orchestration, media pipeline, API, and
the weekly scheduler. See `../WOW_Artwork_Engine_Build_Plan.md` for the full plan.

## Status: Milestone 0 (Foundations) + the two spikes

Implemented in this scaffold:

- **Schema + migrations + seed** — all tables from Build Plan §6, `specs`
  seeded from §4. Forward-only runner in `src/db/migrate.js`.
- **Express skeleton** — `/health` (liveness) and `/ready` (DB readiness),
  config + Secrets Manager loading, structured logging.
- **FFmpeg post-processing** (`src/services/ffmpeg.js`) — conform to exact
  spec, H.264 encode, duration trim, thumbnails, frame-break composite.
  Pure arg-builders are unit-tested; conform/slice are tested end-to-end.
- **EON slicer** (`src/services/eonSlicer.js`) — 768×384 master → three
  aligned 256×384 faces.
- **Generation interface** (`src/services/generation/`) — Seedance 2.0 via
  **fal.ai** (motion) and Nano Banana Pro (stills) behind one interface. A
  **fixture** provider synthesizes media locally so the whole pipeline runs
  **without spending any generation credits**. Live mode requires explicit
  opt-in (`GENERATION_MODE=live`) plus configured keys.
- **Brand guardrails** (`src/services/guardrails.js`) — loose, config-driven;
  blocks nudity only.
- **Delivery** (`src/services/delivery/`) — Google Drive (primary) with an FTP
  fallback, plus a Jeff notification email (`src/services/email.js`).
- **Spikes** — `scripts/spikes/frame_break.js` and
  `scripts/spikes/eon_3pod.js`, both runnable on fixtures.

## Locked decisions

| Decision | Value |
|---|---|
| Repo | separate `wow-artwork-engine` |
| Options/week | 3 per surface |
| Handoff | Google Drive + Jeff email |
| Guardrails | loose — no nudity |
| Motion / stills | Seedance 2.0 (fal.ai) / Nano Banana Pro (Gemini) |

## Prerequisites

- Node.js ≥ 20
- FFmpeg + ffprobe on `PATH` (`ffmpeg -version`)
- PostgreSQL (local or RDS) for the migration/readiness steps

## Setup

```bash
cd server
npm install
cp ../.env.example ../.env   # fill in DATABASE_URL etc. (.env is gitignored)
```

## Run

```bash
# migrations + specs seed
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wow_artwork \
PGSSLMODE=disable npm run migrate

# the API (serves /health, /ready)
npm start            # or: npm run dev   (node --watch)

# tests (pure builders + real ffmpeg conform/slice round-trips)
npm test

# the two spikes — fixtures only, no API cost. Output in scripts/spikes/out/
npm run spike:frame-break
npm run spike:eon
```

## Safety: no accidental spend

`GENERATION_MODE` defaults to `fixture`. The orchestrator and spikes never call
a paid API in that mode. Switching to `live` throws unless both `FAL_KEY`
(Seedance motion) and `GEMINI_API_KEY` (Nano Banana stills) are set.

## Layout

```
server/
├── src/
│   ├── config/        # config, logger, Secrets Manager loader
│   ├── db/            # pool, migration runner
│   ├── routes/        # health (more in M1–M3)
│   └── services/
│       ├── ffmpeg.js          # conform / encode / thumbnail / frame-break
│       ├── eonSlicer.js       # 768→3×256
│       ├── guardrails.js      # loose brand safety (no nudity)
│       ├── email.js           # Jeff notification
│       ├── generation/        # interface + fixture + fal (Seedance) + nanobanana
│       └── delivery/          # drive (primary) + ftp (fallback)
└── test/              # ffmpeg + eonSlicer + guardrails tests
```
