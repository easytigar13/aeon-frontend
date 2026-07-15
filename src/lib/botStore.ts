// Shared Upstash Redis REST client for the arb bot's live status + trade
// history. Used by BOTH sides of a split deployment: the bot itself
// (keeper/index.ts, a standalone Node process on its own machine, imports
// this via a relative path) and the website's API routes (deployed on
// Vercel, imports via the "@/" alias). Local files (keeper/status.json,
// keeper/trades.log) stay authoritative on the machine the bot runs on --
// this is what lets a DIFFERENT machine (Vercel's serverless functions have
// no access to that machine's disk) see the same live data.
//
// Reads KV_REST_API_URL / KV_REST_API_TOKEN lazily (inside each call, not
// at module load) so it works regardless of import order relative to
// dotenv.config() in the keeper process. Falls back to inert no-ops if
// they're not set, so neither side breaks before the store is wired up.

function getConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  return url && token ? { url, token } : null
}

export function isBotStoreConfigured(): boolean {
  return getConfig() !== null
}

// botId distinguishes multiple bot instances sharing one Redis store (e.g.
// keeper/ vs keeper2/). Omitted/empty keeps the ORIGINAL unprefixed keys --
// existing bot #1 deployments (already-live data, already-configured env)
// are completely unaffected. Only a bot that explicitly passes its own id
// (see keeper2/index.ts's BOT_ID) gets a separate namespace.
function statusKey(botId?: string): string { return botId ? `aeon:bot:status:${botId}` : 'aeon:bot:status' }
function tradesKey(botId?: string): string { return botId ? `aeon:bot:trades:${botId}` : 'aeon:bot:trades' }
const MAX_TRADES_IN_STORE = 1000   // caps Redis storage -- the LOCAL trades.log stays the unbounded source of truth

async function upstash(command: (string | number)[]): Promise<any> {
  const config = getConfig()
  if (!config) return null
  const path = command.map(c => encodeURIComponent(String(c))).join('/')
  // cache: 'no-store' is required here -- Next.js's App Router extends
  // fetch() with its own Data Cache and caches GET responses by default.
  // Without this, the very first (empty) read gets cached and every
  // subsequent request -- on the bot's own keeper process too, since this
  // module is shared -- would keep seeing that same stale result forever.
  const res = await fetch(`${config.url}/${path}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `Upstash error (${res.status})`)
  return body?.result
}

export async function writeBotStatus(status: unknown, botId?: string): Promise<void> {
  await upstash(['set', statusKey(botId), JSON.stringify(status)])
}

export async function readBotStatus(botId?: string): Promise<any | null> {
  const raw = await upstash(['get', statusKey(botId)])
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// Trades are LPUSHed (newest at the head), so lrange 0..N is always
// newest-first without needing to reverse on read.
export async function appendTrade(trade: unknown, botId?: string): Promise<void> {
  if (!getConfig()) return
  await upstash(['lpush', tradesKey(botId), JSON.stringify(trade)])
  await upstash(['ltrim', tradesKey(botId), 0, MAX_TRADES_IN_STORE - 1])
}

export async function readAllTrades(botId?: string): Promise<any[]> {
  const raw = await upstash(['lrange', tradesKey(botId), 0, MAX_TRADES_IN_STORE - 1]) as string[] | null
  if (!raw) return []
  return raw.map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}
