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
    }
  ]
};
