// pm2 config for the arb DETECTOR (read-only, no keys, never trades).
// Runs 24/7 and logs profitable WETH->token->WETH cycles when they appear.
// Uses keeper2's tsx binary as a stable transpiler; viem resolves from the
// repo-root node_modules. Independent of ERZA/Mirajane/the protocol.
const path = require('path')
module.exports = {
  apps: [
    {
      name: 'arb-detector',
      script: path.resolve(__dirname, '../keeper2/node_modules/tsx/dist/cli.mjs'),
      args: 'index.ts',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: './pm2-out.log',
      error_file: './pm2-err.log',
    },
  ],
}
