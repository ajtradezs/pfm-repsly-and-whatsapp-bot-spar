module.exports = {
  apps: [
    {
      name: 'pfm-repsly-bot',
      script: 'src/index.js',
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true
    },
    {
      name: 'pfm-dashboard',
      script: 'src/api.js',
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '5s',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: 3001
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/dashboard-error.log',
      out_file: 'logs/dashboard-out.log',
      merge_logs: true
    }
  ]
};
