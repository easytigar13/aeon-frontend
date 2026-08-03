// pm2 config for running the arb keeper 24/7 on your own server.
//
// Setup on the server (one time):
//   npm install -g pm2
//   cd keeper && npm install
//   cp .env.example .env   # fill in KEEPER_PRIVATE_KEY etc.
//
// Start / manage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs aeon-arb-keeper
//   pm2 save && pm2 startup     # survive server reboots
//   pm2 stop aeon-arb-keeper
module.exports = {
  apps: [
    {
      // Load tsx inside PM2's managed Node process. Pointing PM2 at tsx's CLI
      // creates a child worker that can survive restarts and keep running stale
      // trading logic beside the replacement process.
      name: 'aeon-arb-keeper',
      script: './index.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: './pm2-out.log',
      error_file: './pm2-error.log',
    },
  ],
}
