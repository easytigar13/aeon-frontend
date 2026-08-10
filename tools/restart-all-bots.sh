#!/usr/bin/env bash
# Restart every AEON bot managed by the LOCAL pm2 daemon, then print status.
#
# The bots run as pm2 processes on their own host(s), so run this ON the host
# where the bots live -- pm2 only sees its own machine's daemon. If the bots are
# spread across servers, run it on each. Apps that this pm2 daemon doesn't know
# about are skipped (not errored), so it's safe to run anywhere.
#
#   keeper/        -> aeon-arb-keeper     (Mirajane, trades)
#   keeper2/       -> erza-arb-keeper     (Keeper2, trades)
#   keeper3/       -> arb-detector        (read-only detector, never trades)
#   epoch-keeper/  -> aeon-epoch-keeper   (protocol epoch maintenance)
set -uo pipefail

BOTS=(aeon-arb-keeper erza-arb-keeper arb-detector aeon-epoch-keeper)

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found on PATH. Install it (npm i -g pm2) or run this on the bot host." >&2
  exit 127
fi

restarted=0
skipped=0
for name in "${BOTS[@]}"; do
  if pm2 describe "$name" >/dev/null 2>&1; then
    echo "restarting $name ..."
    if pm2 restart "$name" --update-env >/dev/null; then
      restarted=$((restarted + 1))
    else
      echo "  ! failed to restart $name" >&2
    fi
  else
    echo "skipping $name (not managed by this pm2 daemon)"
    skipped=$((skipped + 1))
  fi
done

echo ""
echo "restarted $restarted bot(s) on this host ($skipped not present here)."
echo ""
pm2 status
