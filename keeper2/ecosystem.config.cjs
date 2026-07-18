// PM2 config for AEON-only keeper #2. It intentionally runs keeper/index.ts
// so both wallets receive the same safety fixes; KEEPER_ROLE and the separate
// env/status/log files enforce its independent AEON-only responsibility.
//
// Setup on the server (one time):
//   npm install -g pm2
//   cd keeper2 && npm install
//   cp .env.example .env   # fill in KEEPER_PRIVATE_KEY etc. -- use a
//                          # DIFFERENT wallet than keeper/'s, never reuse
//
// Start / manage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs aeon-arb-keeper-2
//   pm2 save && pm2 startup     # survive server reboots
//   pm2 stop aeon-arb-keeper-2
module.exports = {
  apps: [
    {
      name: 'aeon-arb-keeper-2',
      script: '../keeper/index.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      cwd: __dirname,
      env: {
        KEEPER_ENV_FILE: '../keeper2/.env',
        KEEPER_ROLE: 'aeon-only',
        BOT_ID: 'aeon',
        STATUS_FILE: '../keeper2/status.json',
        TRADES_LOG_FILE: '../keeper2/trades.log',
      },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: './pm2-out.log',
      error_file: './pm2-error.log',
    },
  ],
}
