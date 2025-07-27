module.exports = {
  apps: [{
    name: 'hls4u-stream',
    script: 'server.js',
    cwd: '/home/hls4u-stream/htdocs/stream.hls4u.xyz',
    instances: 1, // Single process as designed
    exec_mode: 'fork',
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};
