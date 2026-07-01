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

  // How many options per surface Scott reviews each week (locked: 3).
  optionsPerSurface: num(process.env.OPTIONS_PER_SURFACE, 3),

  // fixture | live  — see .env.example. `live` requires explicit opt-in so a
  // stray run can never spend generation credits by accident.
  generationMode: process.env.GENERATION_MODE || 'fixture',

  // Motion: Seedance 2.0 via fal.ai (locked). Stills: Nano Banana Pro (Gemini).
  fal: {
    key: process.env.FAL_KEY,
    // fal model slug for Seedance 2.0 motion. Override if fal renames it.
    seedanceModel: process.env.FAL_SEEDANCE_MODEL || 'fal-ai/bytedance/seedance/v2/text-to-video',
    queueBase: process.env.FAL_QUEUE_BASE || 'https://queue.fal.run',
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

  // Handoff (locked: Google Drive). FTP kept as an optional fallback.
  delivery: {
    method: process.env.DELIVERY_METHOD || 'drive',
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
  },
};

export default config;
