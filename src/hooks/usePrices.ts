'use client'
import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { TOKENS, POOLS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'
import { MIN_VISIBLE_POOL_TVL_USD } from '@/lib/poolVisibility'

export type PriceMap = Record<string, number | null>

type Reserves = readonly [bigint, bigint, number]

// USDG is the independent $1 anchor. AEON is bootstrapped from AEON/USDG,
// then WETH from the deepest of WETH/USDG and WETH/AEON. Other tokens use
// whichever USDG/AEON/WETH pool has the greatest priced anchor reserve.
// This matters because a dust USDG pool can have a wildly distorted ratio;
// preferring it merely because it is USDG-paired used to inflate protocol
// TVL and historical volume by orders of magnitude.
const ANCHOR_PRIORITY = ['USDG', 'AEON', 'WETH'] as const
type Anchor = (typeof ANCHOR_PRIORITY)[number]

interface PriceRoute { pool: `0x${string}`; anchor: Anchor }

const PRICE_ROUTES: Partial<Record<string, PriceRoute[]>> = {}
for (const anchor of ANCHOR_PRIORITY) {
  for (const p of POOLS) {
    let symbol: string | null = null
    if (p.token0 === anchor && p.token1 !== anchor) symbol = p.token1
    else if (p.token1 === anchor && p.token0 !== anchor) symbol = p.token0
    if (!symbol) continue
    const routes = (PRICE_ROUTES[symbol] ??= [])
    if (!routes.some(route => route.pool.toLowerCase() === p.address.toLowerCase() && route.anchor === anchor)) {
      routes.push({ pool: p.address, anchor })
    }
  }
}

const PRICED_SYMBOLS = Object.keys(PRICE_ROUTES)
const PRICE_ROUTE_ENTRIES = PRICED_SYMBOLS.flatMap(symbol =>
  (PRICE_ROUTES[symbol] ?? []).map(route => ({ symbol, ...route })),
)
const PRICE_ROUTE_INDEX = new Map(
  PRICE_ROUTE_ENTRIES.map((route, index) => [`${route.symbol}:${route.pool.toLowerCase()}:${route.anchor}`, index]),
)

const PRICE_CONTRACTS = PRICE_ROUTE_ENTRIES.flatMap(route => ([
  { address: route.pool, abi: PAIR_ABI, functionName: 'getReserves' } as const,
  { address: route.pool, abi: PAIR_ABI, functionName: 'token0' } as const,
]))

export function usePrices(): PriceMap {
  const { data } = useReadContracts({ contracts: PRICE_CONTRACTS, query: { refetchInterval: 15000 } })

  const get = (i: number) => (data?.[i]?.status === 'success' ? data[i].result : undefined)

  const prices: PriceMap = { USDG: 1 }

  function pickPrice(symbol: string, allowedAnchors: ReadonlySet<string>): number | null {
    const token = TOKENS[symbol as keyof typeof TOKENS]
    if (!token) return null

    let best: { price: number; anchorLiquidityUsd: number } | null = null
    for (const route of PRICE_ROUTES[symbol] ?? []) {
      if (!allowedAnchors.has(route.anchor)) continue
      const anchorPrice = prices[route.anchor] ?? null
      const anchor = TOKENS[route.anchor as keyof typeof TOKENS]
      if (anchorPrice === null || !anchor || !Number.isFinite(anchorPrice) || anchorPrice <= 0) continue

      const routeIndex = PRICE_ROUTE_INDEX.get(`${symbol}:${route.pool.toLowerCase()}:${route.anchor}`)
      if (routeIndex === undefined) continue
      const reserves = get(routeIndex * 2) as Reserves | undefined
      const token0 = get(routeIndex * 2 + 1) as string | undefined
      if (!reserves || !token0 || reserves[0] === 0n || reserves[1] === 0n) continue

      const tokenFirst = token0.toLowerCase() === token.address.toLowerCase()
      const tokenAmount = Number(formatUnits(tokenFirst ? reserves[0] : reserves[1], token.decimals))
      const anchorAmount = Number(formatUnits(tokenFirst ? reserves[1] : reserves[0], anchor.decimals))
      const anchorLiquidityUsd = anchorAmount * anchorPrice
      const price = anchorLiquidityUsd / tokenAmount
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(anchorLiquidityUsd)) continue
      if (anchorLiquidityUsd < MIN_VISIBLE_POOL_TVL_USD / 2) continue

      if (!best || anchorLiquidityUsd > best.anchorLiquidityUsd) {
        best = { price, anchorLiquidityUsd }
      }
    }
    return best?.price ?? null
  }

  const usdOnly = new Set<string>(['USDG'])
  prices.AEON = pickPrice('AEON', usdOnly)
  prices.WETH = pickPrice('WETH', new Set(['USDG', ...(prices.AEON !== null ? ['AEON'] : [])]))
  if (prices.AEON === null && prices.WETH !== null) prices.AEON = pickPrice('AEON', new Set(['USDG', 'WETH']))
  if (prices.WETH === null && prices.AEON !== null) prices.WETH = pickPrice('WETH', new Set(['USDG', 'AEON']))

  const liquidAnchors = new Set<string>([
    'USDG',
    ...(prices.AEON !== null ? ['AEON'] : []),
    ...(prices.WETH !== null ? ['WETH'] : []),
  ])
  for (const symbol of PRICED_SYMBOLS) {
    if (symbol === 'USDG' || symbol === 'AEON' || symbol === 'WETH') continue
    prices[symbol] = pickPrice(symbol, liquidAnchors)
  }
  // ETH is the native-gas sentinel, not its own pool -- always priced
  // identically to WETH.
  prices.ETH = prices.WETH ?? null

  return prices
}
