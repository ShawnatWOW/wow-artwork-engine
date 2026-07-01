// PM2 process definition for the EC2 app server.
// Deploy: `pm2 start infra/pm2/ecosystem.config.cjs --env production`
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
      env_production: {
        NODE_ENV: 'production',
      },
      out_file: '/var/log/wow-artwork-engine/out.log',
      error_file: '/var/log/wow-artwork-engine/error.log',
      time: true,
    },
  ],
};
