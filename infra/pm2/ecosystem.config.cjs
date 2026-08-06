// PM2 process definition for WOW's existing EC2 app servers (staging + prod).
// The generation worker + weekly scheduler run IN-PROCESS with the API (single
// fork), matching the live WOW Content Automation deploy. fork mode is required
// so the in-process scheduler doesn't double-fire across cluster workers.
// Deploy: `pm2 startOrReload infra/pm2/ecosystem.config.cjs --env production`
module.exports = {
  apps: [
    {
      // 'artwork-engine' — MUST match the app name wow-contract-query's
      // production deploy manages (it git-clones this repo and runs
      // `pm2 restart artwork-engine`). The old 'wow-artwork-engine' name here
      // created a SECOND app that fought over port 4000 (2026-08-05).
      name: 'artwork-engine',
      cwd: './server',
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
      },
      // SCHEDULER_ENABLED deliberately does NOT live here: PM2 env overrides
      // server/.env (dotenv never clobbers existing vars), and the deployed
      // env file is the single source of truth — it keeps the weekly scheduler
      // OFF until launch sign-off (generation is human-triggered). Flipping it
      // to 'true' here once armed a Monday auto-run in LIVE mode unnoticed
      // (caught during the 2026-08-05 bootstrap deploy).
      env_production: {
        NODE_ENV: 'production',
      },
      env_staging: {
        NODE_ENV: 'production',
      },
      // Under the app dir (writable by the deploy user). /var/log/... needed
      // root to create and broke `pm2 startOrReload` with "Could not create
      // folder" on a fresh box.
      out_file: '/home/ubuntu/artwork-engine/logs/out.log',
      error_file: '/home/ubuntu/artwork-engine/logs/error.log',
      time: true,
    },
  ],
};
