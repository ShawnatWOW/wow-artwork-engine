// PM2 process definition for WOW's existing EC2 app servers (staging + prod).
// The generation worker + weekly scheduler run IN-PROCESS with the API (single
// fork), matching the live WOW Content Automation deploy. fork mode is required
// so the in-process scheduler doesn't double-fire across cluster workers.
// Deploy: `pm2 startOrReload infra/pm2/ecosystem.config.cjs --env production`
module.exports = {
  apps: [
    {
      name: 'wow-artwork-engine',
      cwd: './server',
      script: 'src/index.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
      },
      // Production: enable the weekly scheduler; provide DATABASE_URL, storage,
      // and keys via the environment / Secrets Manager (never committed).
      env_production: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'true',
      },
      // Staging mirrors production but leaves the scheduler off so it never
      // auto-fires a run; trigger manually via POST /api/runs.
      env_staging: {
        NODE_ENV: 'production',
        SCHEDULER_ENABLED: 'false',
      },
      out_file: '/var/log/wow-artwork-engine/out.log',
      error_file: '/var/log/wow-artwork-engine/error.log',
      time: true,
    },
  ],
};
