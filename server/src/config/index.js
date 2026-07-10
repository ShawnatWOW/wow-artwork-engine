// Centralised, validated config. Reads from process.env (after secrets are
// loaded). Importing this module also loads a local .env when dotenv is
// available, so individual scripts can `import config` without ceremony.
try {
  const { config: dotenvConfig } = await import('dotenv');
  dotenvConfig();
} catch {
  // dotenv optional (e.g. before npm install or in CI with real env vars).
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d = false) =>
  v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4000),
  logLevel: process.env.LOG_LEVEL || 'info',

  db: {
    url: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
  },

  aws: {
    region: process.env.AWS_REGION || 'us-west-2',
    s3Bucket: process.env.S3_BUCKET,
  },

  // Asset store for generated media. `local` (default) keeps everything on
  // disk so the fixture pipeline runs at $0 without touching AWS; `s3` uploads
  // to the configured bucket for production.
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || 'var/storage',
    s3Bucket: process.env.S3_BUCKET,
  },

  // How many options per surface Scott reviews each week (locked: 3).
  optionsPerSurface: num(process.env.OPTIONS_PER_SURFACE, 3),

  // Generation defaults. Short durations keep fixture runs fast; a live run
  // conforms to the spot length (15/30/60s) downstream.
  generation: {
    durationS: num(process.env.GEN_DURATION_S, 6),
    fps: num(process.env.GEN_FPS, 30),
  },

  // fixture | live  — see .env.example. `live` requires explicit opt-in so a
  // stray run can never spend generation credits by accident.
  generationMode: process.env.GENERATION_MODE || 'fixture',

  // Both models run on fal.ai: Seedance 2.0 (motion, image-to-video) + Seedream
  // (stills — its output URL feeds Seedance as the first frame). Slugs verified
  // against the live wow-contract-query integration + fal docs (2026-07).
  fal: {
    key: process.env.FAL_KEY,
    // Seedance app id (no "fal-ai/" prefix — matches Content Automation). `fast`
    // is the cheap 720p tier; drop `/fast` for Standard (up to 1080p).
    seedanceModel: process.env.FAL_SEEDANCE_MODEL || 'bytedance/seedance-2.0/fast/image-to-video',
    seedreamModel: process.env.FAL_SEEDREAM_MODEL || 'fal-ai/bytedance/seedream/v4/text-to-image',
    queueBase: process.env.FAL_QUEUE_BASE || 'https://queue.fal.run',
    resolution: process.env.FAL_RESOLUTION || '720p',
    generateAudio: process.env.FAL_GENERATE_AUDIO === '1', // artwork is silent by default
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },

  // Brand guardrails (locked: loose — block nudity only). Config-driven so
  // more rules can be added later without code changes.
  guardrails: {
    blockNudity: bool(process.env.GUARDRAILS_BLOCK_NUDITY, true),
    // Optional comma-separated extra terms to deny in prompts.
    extraDenyTerms: (process.env.GUARDRAILS_EXTRA_DENY_TERMS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  // Handoff (locked: Google Drive). FTP kept as an optional fallback. When
  // Drive/Gmail aren't configured the handoff runs OFFLINE — files copied to a
  // local folder and the email written as a .eml — and is reported as NOT sent.
  delivery: {
    method: process.env.DELIVERY_METHOD || 'drive',
    localDir: process.env.HANDOFF_LOCAL_DIR || 'var/handoff',
  },

  // Jeff notification via the Gmail API + a Google service account with
  // domain-wide delegation — sends AS a real @wowmedia.com person, no SMTP.
  publish: {
    // Reuses the same service-account key as Drive.
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    senders: (process.env.PUBLISH_SENDERS || 'scott@wowmedia.com,shawn@wowmedia.com')
      .split(',').map((s) => s.trim()).filter(Boolean),
    from: process.env.PUBLISH_FROM || 'scott@wowmedia.com',
    to: process.env.PUBLISH_TO || process.env.JEFF_EMAIL || 'jeff@wowmedia.com',
    domain: process.env.PUBLISH_DOMAIN || 'wowmedia.com',
  },
  drive: {
    // ID of the watched Drive folder picks are dropped into.
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    // Service-account JSON (string) OR an OAuth refresh token — either path
    // yields an access token. See services/delivery/drive.js.
    serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  },
  ftp: {
    host: process.env.FTP_HOST,
    port: num(process.env.FTP_PORT, 21),
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    secure: bool(process.env.FTP_SECURE),
    remoteDir: process.env.FTP_REMOTE_DIR || '/incoming',
  },

  mail: {
    from: process.env.MAIL_FROM,
    jeffEmail: process.env.JEFF_EMAIL || 'jeff@wowmedia.com',
    smtp: {
      host: process.env.SMTP_HOST,
      port: num(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
    },
  },

  ffmpeg: {
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  },

  scheduler: {
    weeklyCron: process.env.WEEKLY_RUN_CRON || '0 9 * * 1',
    // In-process scheduler is opt-in so dev/test/CI never auto-fire a run.
    // Enable in production (PM2) to fire the weekly batch automatically.
    enabled: bool(process.env.SCHEDULER_ENABLED, false),
  },
};

export default config;
