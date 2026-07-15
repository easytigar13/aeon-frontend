// pm2 config for running arb keeper #2 24/7 -- an independent copy of
// keeper/, its own process, own wallet, own config. Free to diverge from
// keeper/'s logic entirely; nothing here is shared at runtime.
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
      // Calls tsx's own entry point directly instead of going through `npx` --
      // pm2 on Windows can't execute the npx.cmd shim as a script (it tries to
      // parse the batch file as JavaScript and fails immediately).
      name: 'aeon-arb-keeper-2',
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
