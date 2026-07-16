// pm2 config for the epoch-close keeper -- see index.ts header for what it does.
//
// Setup on the server (one time):
//   npm install -g pm2
//   cd epoch-keeper && npm install
//   cp .env.example .env   # fill in DEPLOYER_PK
//
// Start / manage:
//   pm2 start ecosystem.config.cjs
//   pm2 logs aeon-epoch-keeper
//   pm2 save && pm2 startup     # survive server reboots
module.exports = {
  apps: [
    {
      name: 'aeon-epoch-keeper',
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
