// Unified PM2 config -- launches ALL AEON bots from one place so they can be
// started, restarted, and monitored with a single command (locally or over SSH
// via Tailscale). Each app below reuses the exact launch method from that bot's
// own keeper/ecosystem.config.cjs etc., so nothing about how a bot runs changes
// -- this file only groups them.
//
// One-time setup on the PC:
//   npm install -g pm2
//   (each bot's deps already installed via its own `npm install`)
//
// Start / manage EVERYTHING:
//   pm2 start ecosystem.config.cjs      # bring all three up
//   pm2 restart ecosystem.config.cjs    # restart all three
//   pm2 status                          # see all at a glance
//   pm2 logs                            # tail all logs
//   pm2 save && pm2 startup             # survive PC reboots
//
// Manage ONE bot:
//   pm2 restart aeon-arb-keeper
//   pm2 restart aeon-epoch-keeper
//   pm2 logs aeon-arb-keeper-2
//
// Remote (from phone/laptop over Tailscale):
//   ssh <you>@<tailscale-hostname>
//   pm2 restart aeon-epoch-keeper
const path = require('path')

module.exports = {
  apps: [
    {
      // Mirajane -- primary arb keeper. Uses `node --import tsx` per its own
      // keeper/ecosystem.config.cjs.
      name: 'aeon-arb-keeper',
      script: './index.ts',
      interpreter: 'node',
      node_args: '--import tsx',
      cwd: path.join(__dirname, 'keeper'),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: path.join(__dirname, 'keeper', 'pm2-out.log'),
      error_file: path.join(__dirname, 'keeper', 'pm2-error.log'),
    },
    {
      // Keeper #2 -- independent copy, own wallet. Calls tsx's entry point
      // directly because pm2 on Windows can't execute the npx.cmd shim.
      name: 'aeon-arb-keeper-2',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'index.ts',
      cwd: path.join(__dirname, 'keeper2'),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: path.join(__dirname, 'keeper2', 'pm2-out.log'),
      error_file: path.join(__dirname, 'keeper2', 'pm2-error.log'),
    },
    {
      // Epoch-close keeper. Same Windows-safe tsx launch as keeper2.
      name: 'aeon-epoch-keeper',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'index.ts',
      cwd: path.join(__dirname, 'epoch-keeper'),
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: path.join(__dirname, 'epoch-keeper', 'pm2-out.log'),
      error_file: path.join(__dirname, 'epoch-keeper', 'pm2-error.log'),
    },
  ],
}
