// Registry of arb-keeper instances shown on /bot. Single source of truth for
// both the API routes (which local status.json/trades.log to read, which
// Redis namespace to use) and the frontend (display names, tab order).
//
// Bot #1 ("Mirajane", keeper/) keeps botId=undefined so its Redis keys and
// default API behavior are byte-identical to before this registry existed --
// any already-configured deployment is unaffected. Bot #2 ("AEON", keeper2/)
// is a fully independent second instance -- own wallet, own local files, own
// Redis namespace (see src/lib/botStore.ts) -- added 2026-07-15.

export interface BotConfig {
  slug: string        // ?bot= query param value; '' (default/omitted) selects bot #1
  botId?: string       // Redis key suffix; undefined keeps bot #1's original unprefixed keys
  dir: string          // local folder name (relative to repo root) holding status.json/trades.log
  name: string          // display name
  subtitle: string
}

export const BOTS: BotConfig[] = [
  { slug: 'mirajane', botId: undefined, dir: 'keeper',  name: 'Mirajane', subtitle: 'Bot #1 — broad-scope arb + cross-venue' },
  { slug: 'aeon',      botId: 'aeon',    dir: 'keeper2', name: 'AEON',     subtitle: 'Bot #2 — AEON pools only, tuned for speed' },
]

export const DEFAULT_BOT = BOTS[0]

export function getBotBySlug(slug: string | null | undefined): BotConfig {
  if (!slug) return DEFAULT_BOT
  return BOTS.find(b => b.slug === slug) ?? DEFAULT_BOT
}
