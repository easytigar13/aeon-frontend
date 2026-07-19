// PM2 config for ERZA. She runs keeper2/index.ts and is therefore fully
// isolated from Mirajane's keeper/index.ts process and strategy.
//
// Setup on the server (one time):
//   npm install -g pm2
//   cd keeper2 && npm install
//   cp .env.example .env   # fill in KEEPER_PRIVATE_KEY etc. -- use a
//                          # DIFFERENT wallet than keeper/'s, never reuse
//
// Start / manage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs erza-arb-keeper
//   pm2 save && pm2 startup     # survive server reboots
//   pm2 stop erza-arb-keeper
module.exports = {
  apps: [
    {
      name: 'erza-arb-keeper',
      script: './index.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      cwd: __dirname,
      env: {
        KEEPER_ENV_FILE: '../keeper2/.env',
        KEEPER_ROLE: 'external-first',
        BASE_TOKEN: 'WETH',
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
