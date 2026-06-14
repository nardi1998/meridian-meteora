const path = require("path");
const repoRoot = __dirname;

module.exports = {
  apps: [
    {
      name: "meridian",
      // Always start via `npm run pm2:start` (not "pm2 start index.js" from another directory)
      script: path.join(repoRoot, "index.js"),
      cwd: repoRoot,
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
      max_restarts: 10,
      min_uptime: "10s",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
