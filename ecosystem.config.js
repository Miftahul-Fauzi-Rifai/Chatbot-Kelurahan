module.exports = {
  apps: [{
    name: 'chatbot-kelurahan',
    script: 'server.js',
    
    // Cluster mode - run multiple instances for better performance
    instances: 2,
    exec_mode: 'cluster',
    
    // Auto-restart on crash
    autorestart: true,
    watch: false,
    
    // Memory limit - restart if exceeds 500MB
    max_memory_restart: '500M',
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000
  }]
};
