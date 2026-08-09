// Registry of arb-keeper instances shown on /bot. Single source of truth for
// both the API routes (which local status.json/trades.log to read, which
// Redis namespace to use) and the frontend (display names, tab order).
//
// Bot #1 ("Mirajane", keeper/) keeps botId=undefined so its Redis keys and
// default API behavior are byte-identical to before this registry existed --
// any already-configured deployment is unaffected.
//
// Bot #2 ("ERZA", slug 'aeon') is gone for good as of 2026-08-01. Two
// separate reasons, both fatal:
//
//   1. It shared Mirajane's wallet (copy-paste artifact from scaffolding),
//      so it was never an independent bot -- its "profit" was just spending
//      Mirajane's capital.
//   2. Its non-atomic cross-venue path (ENABLE_CROSS_VENUE=true,
//      ATOMIC_ONLY=false) executed leg 1 on-chain, reverted on leg 2, and
//      logged the whole attempt as status:'failed', profit:'0' -- with no
//      record that money had already left the wallet. 37 logged "failures"
//      were really 15 completed one-way buys totalling 50.15 USDG +
//      0.0235 WETH, leaving 13,710 VEX / 4,789 FRONG / 644 PONS /
//      697 CASHCAT stranded and never sold. See erza-postmortem/.
//
// Do NOT re-add a non-atomic bot here without fixing (2) first: a two-tx
// arb must record leg 1 settling as an open position, not as a no-op
// failure. Mirajane is safe only because ENABLE_CROSS_VENUE=false makes
// every trade a single atomic tx that cannot strand inventory.

export interface BotConfig {
  slug: string        // ?bot= query param value; '' (default/omitted) selects bot #1
  botId?: string       // Redis key suffix; undefined keeps bot #1's original unprefixed keys
  dir: string          // local folder name (relative to repo root) holding status.json/trades.log
  name: string          // display name
  subtitle: string
}

export const BOTS: BotConfig[] = [
  // "cross-venue" here means the ROUTE spans venues inside one atomic tx (AEON
  // CL/DLMM plus Uniswap V3/V4). It does NOT mean the non-atomic aggregator
  // path -- that runs on ENABLE_CROSS_VENUE, which is false for Mirajane and is
  // the exact mechanism that stranded ERZA's inventory. Keep the distinction in
  // the copy; conflating them is what made the old subtitle wrong.
  { slug: 'mirajane', botId: undefined, dir: 'keeper',  name: 'Mirajane', subtitle: 'Atomic cross-venue cycles — AEON pools + Uniswap V3/V4' },
  { slug: 'aeon', botId: 'aeon', dir: 'keeper2', name: 'Keeper2', subtitle: 'Atomic same-token cycles - AEON-listed pools' },
]

export const DEFAULT_BOT = BOTS[0]

export function getBotBySlug(slug: string | null | undefined): BotConfig {
  if (!slug) return DEFAULT_BOT
  return BOTS.find(b => b.slug === slug) ?? DEFAULT_BOT
}
