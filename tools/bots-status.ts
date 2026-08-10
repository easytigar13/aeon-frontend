// Operator CLI: print an online/offline table for every registered arb bot.
//
// Reads the SAME Upstash status store the website's /api/bot/status route reads,
// through the shared botStore + BOTS registry (src/config/bots.ts is the single
// source of truth), so this can never drift from what the dashboard shows.
//
// Requires KV_REST_API_URL and KV_REST_API_TOKEN in the environment -- these are
// the read side of the store. No private keys are ever touched: the status
// payload holds only public data (addresses, balances, profit numbers).
//
// Scope note: only the trading bots that push heartbeats (Mirajane, Keeper2)
// live in the status store. The read-only detector (keeper3 / arb-detector) and
// the epoch-keeper do NOT report here -- check those with `pm2 status`.

import { BOTS } from '../src/config/bots'
import { readBotStatus, isBotStoreConfigured } from '../src/lib/botStore'

// A bot counts as "online" when its last heartbeat is newer than this. The
// keeper pushes status every ~15s (REDIS_STATUS_SYNC_INTERVAL_MS), so a 90s
// window tolerates a couple of missed syncs without flapping between states.
const ONLINE_WINDOW_MS = 90_000

function ageMs(iso?: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Date.now() - t
}

function fmtAge(ms: number | null): string {
  if (ms === null) return 'n/a'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}

interface Row {
  name: string
  online: boolean
  age: number | null
  status: any | null
  error: string | null
}

async function main() {
  if (!isBotStoreConfigured()) {
    console.error('KV_REST_API_URL / KV_REST_API_TOKEN are not set -- cannot read the bot status store.')
    console.error('Set them (read access is enough) and re-run, e.g.:')
    console.error('  KV_REST_API_URL=... KV_REST_API_TOKEN=... npm run bots:status')
    process.exit(2)
  }

  const rows: Row[] = await Promise.all(BOTS.map(async (bot): Promise<Row> => {
    try {
      const status = await readBotStatus(bot.botId)
      const age = ageMs(status?.updatedAt)
      const online = age !== null && age <= ONLINE_WINDOW_MS
      return { name: bot.name, online, age, status, error: null }
    } catch (err: any) {
      return { name: bot.name, online: false, age: null, status: null, error: err?.message ?? String(err) }
    }
  }))

  console.log('')
  console.log('AEON arb bots — live status')
  console.log('='.repeat(72))
  for (const r of rows) {
    const dot = r.error ? '⚠ ' : r.online ? '🟢' : '🔴'
    const state = r.error ? 'ERROR' : r.online ? 'ONLINE' : 'OFFLINE'
    console.log(`${dot} ${r.name.padEnd(10)} ${state.padEnd(8)} last heartbeat: ${fmtAge(r.age)}`)
    if (r.error) {
      console.log(`   store read failed: ${r.error}`)
    } else if (r.status) {
      const s = r.status
      if (s.keeperAddress) console.log(`   wallet:  ${s.keeperAddress}${s.dryRun ? '  (DRY RUN)' : ''}`)
      if (s.cumulativeProfit !== undefined) console.log(`   profit:  ${s.cumulativeProfit}`)
      if (s.totalArbsExecuted !== undefined) console.log(`   trades:  ${s.totalArbsExecuted} executed / ${s.totalArbsFailed ?? '?'} failed`)
      if (s.pausedUntil) console.log(`   paused until: ${s.pausedUntil}`)
    } else {
      console.log('   no status in store yet (bot has never pushed a heartbeat)')
    }
  }
  console.log('='.repeat(72))
  const onlineCount = rows.filter(r => r.online).length
  console.log(`${onlineCount}/${rows.length} registered bots online`)
  console.log('Detector (arb-detector) and epoch-keeper do not report here — use `pm2 status`.')
  console.log('')

  // Non-zero exit when anything registered is down, so this is cron/CI friendly.
  process.exit(rows.every(r => r.online) ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
