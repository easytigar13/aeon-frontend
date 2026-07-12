'use client'
import { useReadContracts } from 'wagmi'
import { TOKENS, POOLS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

export type PriceMap = Record<string, number | null>

type Reserves = readonly [bigint, bigint, number]

// Anchors with an independently-known USD price, in priority order for
// deriving every OTHER token's price. USDG is a literal $1 peg -- a
// USDG-paired pool is the most direct/precise read, so it wins whenever a
// token has more than one priced pool (e.g. every Robinhood stock has both
// a /AEON and a /USDG pool). AEON and WETH themselves get bootstrapped from
// their own USDG pool below, same as every other token -- no separate
// hardcoded derivation for them anymore.
const ANCHOR_PRIORITY = ['USDG', 'AEON', 'WETH'] as const
type Anchor = (typeof ANCHOR_PRIORITY)[number]

// For every symbol in POOLS, find whichever pool pairs it directly with an
// anchor. Iterated in REVERSE priority order so a later (higher-priority)
// pass overwrites an earlier one -- e.g. a stock's /AEON route gets replaced
// by its /USDG route once that pass runs. Computed once at module scope
// since POOLS/TOKENS are both static -- this is what makes every token
// added from here on (a new launchpad token, a new Create Pool pair, a new
// stock) get priced automatically with zero code changes, instead of
// needing a hand-written derivation function per token like before.
const PRICE_ROUTES: Partial<Record<string, { pool: `0x${string}`; anchor: Anchor }>> = {}
for (const anchor of [...ANCHOR_PRIORITY].reverse()) {
  for (const p of POOLS) {
    if (p.token0 === anchor && p.token1 !== anchor) PRICE_ROUTES[p.token1] = { pool: p.address, anchor }
    else if (p.token1 === anchor && p.token0 !== anchor) PRICE_ROUTES[p.token0] = { pool: p.address, anchor }
  }
}

const PRICED_SYMBOLS = Object.keys(PRICE_ROUTES)

const PRICE_CONTRACTS = PRICED_SYMBOLS.flatMap(symbol => {
  const pool = PRICE_ROUTES[symbol]!.pool
  return [
    { address: pool, abi: PAIR_ABI, functionName: 'getReserves' } as const,
    { address: pool, abi: PAIR_ABI, functionName: 'token0' } as const,
  ]
})

export function usePrices(): PriceMap {
  const { data } = useReadContracts({ contracts: PRICE_CONTRACTS, query: { refetchInterval: 15000 } })

  const get = (i: number) => (data?.[i]?.status === 'success' ? data[i].result : undefined)

  const prices: PriceMap = { USDG: 1 }

  function resolve(symbol: string): number | null {
    if (symbol in prices) return prices[symbol]
    const route = PRICE_ROUTES[symbol]
    if (!route) return (prices[symbol] = null)

    const idx = PRICED_SYMBOLS.indexOf(symbol) * 2
    const reserves = get(idx) as Reserves | undefined
    const token0 = get(idx + 1) as string | undefined
    if (!reserves || !token0) return (prices[symbol] = null)

    const [r0, r1] = reserves
    if (r0 === 0n || r1 === 0n) return (prices[symbol] = null)

    const anchorPrice = route.anchor === 'USDG' ? 1 : resolve(route.anchor)
    if (anchorPrice === null) return (prices[symbol] = null)

    const tokenAddr = TOKENS[symbol as keyof typeof TOKENS]?.address
    const isTokenFirst = token0.toLowerCase() === tokenAddr?.toLowerCase()
    const rToken = Number(isTokenFirst ? r0 : r1)
    const rAnchor = Number(isTokenFirst ? r1 : r0)
    if (rToken === 0) return (prices[symbol] = null)

    const tokenDec = TOKENS[symbol as keyof typeof TOKENS]?.decimals ?? 18
    const anchorDec = TOKENS[route.anchor as keyof typeof TOKENS]?.decimals ?? 18

    const price = ((rAnchor / 10 ** anchorDec) * anchorPrice) / (rToken / 10 ** tokenDec)
    return (prices[symbol] = price)
  }

  for (const symbol of PRICED_SYMBOLS) resolve(symbol)
  // ETH is the native-gas sentinel, not its own pool -- always priced
  // identically to WETH.
  prices.ETH = prices.WETH ?? null

  return prices
}
