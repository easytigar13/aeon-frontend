#!/usr/bin/env bash
# Launcher for bots-status.ts. Kept as a wrapper so `npm run bots:status` works
# without adding tsx to the frontend's dependencies (which would churn the
# Vercel lockfile). Prefers a tsx already installed for the keepers; otherwise
# falls back to `npx tsx`.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"
script="$here/bots-status.ts"

for tsx in \
  "$root/keeper2/node_modules/.bin/tsx" \
  "$root/keeper/node_modules/.bin/tsx" \
  "$root/node_modules/.bin/tsx"; do
  if [ -x "$tsx" ]; then exec "$tsx" "$script" "$@"; fi
done

if command -v tsx >/dev/null 2>&1; then exec tsx "$script" "$@"; fi
exec npx --yes tsx "$script" "$@"
