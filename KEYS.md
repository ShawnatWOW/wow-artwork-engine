# Keys & Credentials Checklist

Everything the WOW Artwork Engine needs to go from **free placeholder mode** to
**real art + delivery**. **None of these are needed today** — the system runs at $0
without them. Grab them when we start M3 (delivery) and M4 (first live run).

> **Security:** never paste these into chat or commit them. They go in the local
> `.env` file (which is git-ignored) or, in production, **AWS Secrets Manager** /
> **GitHub → Settings → Secrets → Actions**.

---

## A. AI art generators — needed for the first *real* run (M4)

| # | What to get | Powers | Where / how to get it | Env variable |
|---|---|---|---|---|
| 1 | **fal.ai API key** | Motion video (Seedance 2.0) | Sign in at **fal.ai** → **Settings → API Keys** → create a key. (WOW/Shawn owns the account.) | `FAL_KEY` |
| 2 | **Seedance 2.0 model id** *(not secret — just confirm)* | Tells us the exact model to call | **fal.ai** model catalog → open **Seedance 2.0** (text-to-video) → copy the model slug. Confirms/replaces our default `fal-ai/bytedance/seedance/v2/text-to-video`. | `FAL_SEEDANCE_MODEL` |
| 3 | **Google Gemini API key** | Still images (Nano Banana Pro) | **Google AI Studio** (aistudio.google.com) → **Get API key** → create in a Google Cloud project. | `GEMINI_API_KEY` |

## B. Delivery to Jeff — needed for M3 (handoff)

| # | What to get | Powers | Where / how to get it | Env variable |
|---|---|---|---|---|
| 4 | **Google service-account key (JSON)** | Login for Drive + Gmail below | **Google Cloud Console** → **IAM → Service Accounts** → create one → **Keys → Add key → JSON** → download. Enable the **Drive API** and **Gmail API** on the project. | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| 5 | **Drive folder ID** | Where finished art lands | Open the target **Google Drive folder** → the ID is the code in its URL (`drive.google.com/drive/folders/<THIS_PART>`). Then **Share** that folder with the service account's email (Editor). | `GOOGLE_DRIVE_FOLDER_ID` |
| 6 | **Gmail "send as WOW" permission** | Emails Jeff from a real @wowmedia.com address (no SMTP) | **Google Workspace Admin** → **Security → API controls → Domain-wide delegation** → authorize the service account's **client ID** for scope `https://www.googleapis.com/auth/gmail.send`. Pick the sender address (e.g. `artwork@wowmedia.com`). | `MAIL_FROM`, `JEFF_EMAIL` (defaults to jeff@wowmedia.com) |
| — | *(Optional fallback)* **WOW FTP login** | Backup delivery if Drive is down | From WOW's existing spec sheet (host `039cae0.netsolhost.com`, user `wowmedianet`). | `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` |

## C. Infrastructure — needed to deploy (M4)

| # | What to get | Powers | Where / how to get it | Env / location |
|---|---|---|---|---|
| 7 | **Postgres connection string** | Saves runs, picks, deliveries | From WOW's existing **RDS** database (reuse the one Content Automation uses, or a database on it). Format: `postgres://user:pass@host:5432/dbname`. | `DATABASE_URL` |
| 8 | **EC2 deploy secrets** (host, user, SSH key) | Auto-deploy to the shared servers | From WOW's existing **EC2** hosts (staging + production). Add in **GitHub → repo Settings → Secrets → Actions**. | `EC2_HOST_STAGING`, `EC2_HOST_PROD`, `EC2_USER`, `EC2_SSH_KEY` |
| — | *(Optional)* **S3 bucket name** | Store art in S3 instead of on the server disk | An existing WOW **S3** bucket (the `wowfix` AWS profile already has a deploy user). | `STORAGE_DRIVER=s3`, `S3_BUCKET` |

---

## Already connected on this machine (nothing needed from you)

- **GitHub** — authorized as `ShawnatWOW` (push, PRs, Actions). Both repos reachable:
  `ShawnatWOW/wow-artwork-engine` (this backend) and `ShawnatWOW/wow-contract-query`
  (the dashboard, default branch `dev`).
- **AWS** — reachable via the `wowfix` CLI profile (IAM user `wow-contract-query-deployer`,
  account `355026323876`). Good enough to deploy; may need broader IAM permissions to
  read RDS/Secrets Manager — we'll widen it only if a step needs it.
