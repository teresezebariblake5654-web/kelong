/**
 * PM2 process file for workstation API.
 *
 * Start:
 *   pm2 start ecosystem.config.cjs --env production
 * Reload:
 *   pm2 reload workstation-api
 *
 * Log rotation (install once on the server):
 *   pm2 install pm2-logrotate
 *   pm2 set pm2-logrotate:max_size 20M
 *   pm2 set pm2-logrotate:retain 14
 *   pm2 set pm2-logrotate:compress true
 *
 * Do NOT run a second process named workstation-backend.
 */

const maxMemory = process.env.PM2_MAX_MEMORY_RESTART || '600M';

module.exports = {
  apps: [
    {
      name: 'workstation-api',
      script: 'dist/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: maxMemory,
      restart_delay: 3000,
      time: true,
      out_file: 'logs/workstation-api.out.log',
      error_file: 'logs/workstation-api.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
        HOST: '0.0.0.0',
        PORT: 3001,
        RATE_LIMIT_ENABLED: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3001,
        RATE_LIMIT_ENABLED: 'true',
        COOKIE_SECURE: 'true',
      },
    },
  ],
};
