# WOW Artwork Engine — Status Update

**Last updated:** 2026-07-10 · **Delivery target:** 2026-08-14 · **Spent so far:** $0

---

## 🔒 MUST-DO BEFORE LAUNCH (blocking)

- [ ] **Rotate the leaked Google service-account key.** The file
  `google-drive-server-account.json` is committed in the `wow-contract-query` repo — a live
  credential in source control. **Shawn:** find which Google Cloud project owns that service
  account (needs digging), create a new key + delete the old one, then scrub it from git
  history. Full steps in [KEYS.md](KEYS.md) → "Rotate the compromised key." Tracked in Linear.
  *The project must not go live until this is done.*

---

## What this project is (in one line)

A weekly "art studio" for WOW's billboards: every week it **makes** fresh artwork →
someone **picks** the good ones on a screen → it **sends** the picks to Jeff, already
sized and ready to run.

The work is split into four stages (M1–M4).

---

## Progress

| Stage | What it means (plain terms) | Status |
|---|---|---|
| **M1 — The art machine** | Makes a full week of artwork automatically: 3 options per billboard type, each sized exactly to spec. | ✅ **Done & tested** |
| **M2 — The review screen** | A web page to watch the week's options and click Pick / Approve / Reject. | ✅ **Done & tested** |
| **M3 — Send to Jeff** | Auto-deliver approved art to Google Drive + email Jeff, ready to run. | 🔜 Next |
| **M4 — Final testing + go live** | Real AI keys, first real run, launch. | 🔜 After M3 |

---

## What's working right now

- The art machine produces a complete week: **3 Spectacular options, 3 connected EON
  options, 3 single EON options** — 15 finished pieces — all sized to spec.
- **Right now it uses free stand-in "placeholder" art**, so the whole pipeline runs and
  can be tested **without spending anything**. When the real AI keys are added, the same
  machine makes real art — nothing else changes.
- The review screen was tested end-to-end: it generated the week, played every piece,
  and correctly saved picks and approvals.
- A safety rule is built in: **the system checks each idea before it ever spends money**,
  so a blocked request can't run up a bill.

## How it fits WOW's existing setup (per your instruction)

- Built to plug into **your existing WOW system** (the same setup as the Broken News
  project, at **wowautomation.ai**) — **not** a separate new system.
- The review screen is built to appear as a **new tab** in your existing WOW dashboard.
- It reuses your existing servers and database rather than standing up new ones.
- Everything is **tracked in Linear**: one project ("WOW Artwork Engine") with a task for
  each stage (M0–M4).

---

## Done ✅

1. **Saved & backed up.** Both stages are pushed to GitHub and opened as a pull request
   for review: **https://github.com/ShawnatWOW/wow-artwork-engine/pull/1**.
2. **Access confirmed.** GitHub and AWS are already connected on this machine — including
   the live dashboard repo (`wow-contract-query`). So I can do the dashboard tab myself;
   no access step needed from you.

## What I need from you

1. **A "go" to add the review screen into your live dashboard** (`wow-contract-query`,
   the `dev` branch). I can do it now — just confirm you want it and I'll open a PR there.
2. **The keys — but only when we start delivery + going live.** Full plain-language list
   with where to get each: see [KEYS.md](KEYS.md). Nothing is needed today; the system
   runs at $0 until then.

---

## Money & safety

- **$0 spent.** Nothing has touched a paid AI service; everything runs on free placeholder
  media by default.
- No real art gets generated — and no bill is possible — until the keys are added **and**
  live mode is explicitly turned on.

---

<details>
<summary>Under the hood (for the technically curious)</summary>

- Backend: Node + Express, generation worker + weekly scheduler in-process, PostgreSQL,
  local/S3 asset store. Review API under `/api` (`/runs`, `/artworks/...`).
- Dashboard: React + Vite + Tailwind in `web/`, built to embed as a tab in
  `unstuckllc/wow-contract-query`.
- Runs with no database (in-memory fallback) so it demos at $0. 37/37 tests pass; M1 + M2
  committed on branch `m1-generation-engine` (not yet pushed).
- Deploy model matches WOW Content Automation: EC2 + PM2, GitHub `dev`→staging /
  `master`→production. Handoff email will use the Gmail API service account.
- See `WOW_Artwork_Engine_Build_Plan.md` and `server/README.md` for detail.

</details>
