# WOW Artwork Engine — Server

Node.js + Express backend: generation orchestration, media pipeline, API, and
the weekly scheduler. See `../WOW_Artwork_Engine_Build_Plan.md` for the full plan.

## Status: Milestone 1 (Generation Engine)

M1 wires the M0 primitives into a full weekly pipeline:

- **Run orchestrator** (`src/services/orchestrator.js`) — `runWeek()` fans out
  `optionsPerSurface` (locked: 3) options for every surface in the catalog,
  generates → conforms/composites → slices → thumbnails → stores each asset,
  and records `generation_runs` / `artworks` / `eon_sequences`. The **guardrail
  runs before the provider is ever called**, so a blocked prompt never spends a
  credit. Every dependency (repo, store, providers, guardrails) is injected, so
  the whole pipeline is unit-tested end-to-end on fixtures with no DB or AWS.
- **Generation catalog** (`src/services/generation/catalog.js`) — the surfaces
  a week produces + their exact specs and post-processing steps. Prompts come
  from `generation/prompts.js` (deterministic, guardrail-safe).
- **Asset store** (`src/services/storage/`) — `local` disk (default, $0) or
  `s3`, one interface, keyed `runs/<id>/<surface>/opt<n>/…`.
- **Weekly scheduler** (`src/services/scheduler.js`) — dependency-free cron
  matcher + in-process trigger, opt-in via `SCHEDULER_ENABLED`.
- **Run API** (`src/routes/runs.js`) — `POST /runs`, `GET /runs`,
  `GET /runs/:id` (run + artworks + EON sequences) — feeds the M2 dashboard.

Run one batch on fixtures (no DB, no cost):

```bash
npm run generate            # this week
npm run generate 2026-08-10 # a specific Monday
```

## Milestone 2 (Dashboard)

Weekly **review/pick** surface. The API is namespaced under `/api` so it drops
into the shared WOW dashboard (`unstuckllc/wow-contract-query`) behind its `/api`
proxy; the generation worker + scheduler run **in-process** with the API.

- `POST /api/runs` — trigger a run (202 + `runId`, generation continues async)
- `GET  /api/runs` · `GET /api/runs/:id` — run + artworks + EON sequences + selections
- `POST/DELETE /api/artworks/:id/select` — pick / un-pick a favorite (`selections`)
- `POST /api/artworks/:id/approve` · `/reject` — flip `artworks.status`
- `GET  /api/artworks/:id/media` · `/thumbnail` — stream from the asset store
  (local disk with HTTP range support, or S3)

The React + Vite + Tailwind dashboard lives in `web/` (built to embed as the
"Artwork Engine" tab in `wow-contract-query`). **No database required** — with
`DATABASE_URL` unset the whole app uses an in-memory repo, so it demos at $0:

```bash
# terminal 1 — API (in-memory repo when DATABASE_URL is unset)
npm start
# terminal 2 — dashboard (proxies /api + /health to :4000)
cd ../web && npm install && npm run dev   # http://localhost:5173
```

Click **Generate this week** to populate the grid, then pick / approve / reject.

## Milestone 0 (Foundations) + the two spikes

Implemented in the M0 scaffold:

- **Schema + migrations + seed** — all tables from Build Plan §6, `specs`
  seeded from §4. Forward-only runner in `src/db/migrate.js`.
- **Express skeleton** — `/health` (liveness) and `/ready` (DB readiness),
  config + Secrets Manager loading, structured logging.
- **FFmpeg post-processing** (`src/services/ffmpeg.js`) — conform to exact
  spec, H.264 encode, duration trim, thumbnails, frame-break composite.
  Pure arg-builders are unit-tested; conform/slice are tested end-to-end.
- **EON slicer** (`src/services/eonSlicer.js`) — a wrapped master → each pod's
  spine (64×384) + face (256×384). A pod slab is spine + face = 320 wide, so the
  3-pod master is 960×384 and a standalone pod is its own 320×384 master
  (4K-class in production: 5× those figures). Layout-driven, so the same cut
  serves the connected set and a single pillar.
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
│   ├── db/            # pool, migration runner, repo (pg) + memoryRepo (tests/demo)
│   ├── routes/        # health, runs (trigger/list/inspect)
│   └── services/
│       ├── orchestrator.js     # runWeek() — the M1 generation engine
│       ├── scheduler.js        # dependency-free cron + weekly trigger
│       ├── dates.js            # week_of / cron date helpers
│       ├── ffmpeg.js           # conform / encode / thumbnail / frame-break
│       ├── eonSlicer.js        # 768→3×256
│       ├── guardrails.js       # loose brand safety (no nudity)
│       ├── email.js            # Jeff notification
│       ├── generation/         # catalog + prompts + interface + fixture/fal/nanobanana
│       ├── storage/            # asset store: local (default) + s3
│       └── delivery/           # drive (primary) + ftp (fallback)
└── test/              # ffmpeg, eonSlicer, guardrails, catalog, prompts,
                       # storage, scheduler, orchestrator (e2e on fixtures)
```
