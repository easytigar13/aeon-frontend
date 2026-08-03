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
      // Calls tsx's own entry point directly instead of going through `npx` --
      // pm2 on Windows can't execute the npx.cmd shim as a script (it tries to
      // parse the batch file as JavaScript and fails immediately).
      name: 'aeon-arb-keeper',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'index.ts',
      cwd: __dirname,
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 50,
      out_file: './pm2-out.log',
      error_file: './pm2-error.log',
    },
  ],
}
