module.exports = {
  apps: [
    {
      name: 'civiclink-api',
      script: './dist/server.js',
      cwd: '/home/leenterminal/web/civic.leenterminal.com/public_html/Civiclink-backend',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'civiclink-worker',
      script: './dist/worker.js',
      cwd: '/home/leenterminal/web/civic.leenterminal.com/public_html/Civiclink-backend',
      node_args: '--env-file=.env',
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};
