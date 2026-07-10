# WOW Artwork Engine — Build Plan

**Client:** WOW · **Build by:** DLLM Labs · **Delivery target:** August 14, 2026

> This file is the canonical reference for the build. The implementation in
> `server/`, `web/`, `migrations/`, `infra/`, and `scripts/spikes/` follows it.
> See `server/README.md` for how to run the current Milestone 0 + spikes scaffold.

---

## 1. What we are building

An automated system that does three things every week:

1. **Generates** original AI artwork for WOW's Spectaculars and EON network.
2. **Lets Scott pick** the best options in a dashboard.
3. **Ships the picks to Jeff** (the Projectionist), already sized and formatted to spec, ready to run.

WOW covers the AI generation costs directly. The build is one upfront, $450/mo to run.

---

## 2. Scope

**In scope (this build):**
- Spectacular artwork: full-motion, 1692 x 468 (WOW 1-8), including the 3D frame-break style.
- EON artwork: connected, cross-pod pieces that travel across the three pods, plus single-face pieces.
- Weekly generation on a schedule.
- Curation dashboard (review, pick, send).
- One-click handoff to Jeff with notification.

**Out of scope (future add-ons, quoted separately):**
- Remaining Spectacular sizes: WOW 9-18 (2124 x 648), WOW 19 vertical (528 x 1200).
- 405 Freeway boards (WOW does not run artwork there).
- New features beyond the above.

---

## 3. Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | PostgreSQL on AWS RDS |
| Object storage | AWS S3 |
| Compute | AWS EC2 + PM2 |
| CI/CD | GitHub + Actions |
| Still generation | Nano Banana Pro (Gemini image API) |
| Motion generation | Seedance 2.0 via **fal.ai** |
| Media processing | FFmpeg |
| Frontend | React + Vite + Tailwind |
| Email | AWS SES (or SMTP via nodemailer) |
| Delivery | **Google Drive** (primary), FTP fallback |
| Secrets | AWS Secrets Manager (or env, never committed) |

### Locked decisions (§10)

- **Repo:** separate `wow-artwork-engine` repo (this one) for the backend worker/API.
- **Options per week:** 3 per surface.
- **Handoff:** Google Drive (watched folder) + Jeff email notification. Email is
  sent via the **Gmail API + a Google service account** (domain-wide delegation)
  from a real `@wowmedia.com` address — same as the live Content Automation
  pipeline, no SMTP/SES/third party.
- **Brand guardrails:** loose — block nudity only (config-driven).
- **Motion model:** Seedance 2.0 via fal.ai. **Stills:** Nano Banana Pro (Gemini).
- **API accounts:** WOW/Shawn holds the fal + Gemini keys.
- **Infrastructure:** deploy into **WOW's existing AWS account** (Shawn-managed),
  NOT a new standalone stack. Backend worker + weekly scheduler run **in-process**
  with the API on the shared **EC2 + PM2** hosts; CI/CD is GitHub auto-deploy
  (`dev` → staging, `master` → production); state in the shared **Postgres**.
- **Dashboard:** **React + Vite + Tailwind embedded as a tab in the existing WOW
  dashboard repo `unstuckllc/wow-contract-query`** (served under `wowautomation.ai`).
  Built in `web/` here as a portable module + standalone dev shell.

---

## 4. Sign specs (seeded into the `specs` table)

| key | surface | width | height | ratio | format | max spot |
|---|---|---|---|---|---|---|
| `spectacular_wow1_8` | spectacular | 1692 | 468 | 3.6:1 | MP4 / JPEG / PNG | 60s |
| `eon_face` | eon | 256 | 384 | 2:3 | MP4 / JPEG / PNG | 60s |
| `eon_spine` | eon | 64 | 384 | 1:6 | MP4 / JPEG / PNG | 60s |
| `eon_master_3pod` | eon | 768 | 384 | 2:1 | MP4 | 60s |

All media: H.264 for video, 72 dpi, spot length 15 / 30 / 60s. The 3-pod master
slices into three `eon_face` columns (256 wide each).

---

## 5. Generation approach

Video models output standard ratios, not 1692 x 468 or 768 x 384 directly. The
pipeline always generates at the closest supported ratio at high resolution,
then FFmpeg conforms to the exact pixel spec.

- **Frame-break Spectacular:** generate the subject scene, then FFmpeg
  composites it onto the 1692 x 468 black canvas with the subject crossing the
  inner border. The black border is the style.
- **EON connected piece:** generate one wide 2:1 piece, then FFmpeg slices it
  into three 256-wide columns.
- **EON single-face:** generate 2:3 portrait, conform to 256 x 384.

---

## 6. Data model (Postgres)

See `migrations/001_init.sql`. Tables: `specs`, `generation_runs`, `artworks`,
`eon_sequences`, `selections`, `deliveries`, `users`.

---

## Milestones

- **M0 Foundations** (DONE): repo, schema + seed, Express skeleton,
  FFmpeg post-processing + EON slicer, the two spikes.
- **M1 Generation Engine** (DONE): `runWeek()` orchestrator (3 options/surface,
  guardrail-before-spend, generate → conform/composite → slice → thumbnail →
  store, writing `generation_runs`/`artworks`/`eon_sequences`), weekly
  scheduler, local/S3 asset store, and the `/runs` API. `npm run generate` runs
  a full week on fixtures at $0.
- **M2 Dashboard** (DONE): weekly review/pick surface — `/api/runs` +
  `/api/artworks` (select / approve / reject / media streaming), embedded as the
  "Artwork Engine" tab in `wow-contract-query`. Two-phase: review cheap Seedream
  **stills** first, then **animate approved** with Seedance.
- **M3 Handoff** (DONE): one-click ship of approved pieces to the watched Drive
  folder + a Jeff email via the **Gmail API service account** (offline-first,
  honest "not sent" fallback; `deliveries` tracked). "Review & send" dialog.
- **M4 QA & Delivery** — next: deploy into WOW's existing AWS (no new stack),
  first live run with keys, rotate the leaked SA key (DEL-143).

Target date: 2026-08-14.
