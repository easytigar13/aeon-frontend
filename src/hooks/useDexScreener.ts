'use client'
import { useEffect, useState } from 'react'
import { POOLS, CL_POOLS, TOKENS } from '@/config/contracts'

// DexScreener actually indexes Robinhood Chain (unlike GeckoTerminal, which
// returns 404 for it — confirmed by hand). Covers vAMM + CL pools; DLMM
// pools aren't indexed there yet (confirmed: pairs come back null).
const COVERED_POOLS = [...POOLS, ...CL_POOLS]
const POOL_ADDRS = [...new Set(COVERED_POOLS.map(p => p.address))]

// lowercase token address -> our TokenKey, to map DexScreener's base/quote
// token addresses back to a key without trusting POOLS' declared token0/
// token1 order (that's a different, independently-unreliable ordering —
// see useVolume24h's on-chain-order fix. DexScreener tells us base/quote
// directly per pair, so use that instead of cross-referencing our config).
const KEY_BY_ADDR: Record<string, string> = {}
for (const [key, t] of Object.entries(TOKENS)) if (key !== 'ETH') KEY_BY_ADDR[t.address.toLowerCase()] = key

export interface DexScreenerPair {
  baseKey: string | null
  quoteKey: string | null
  priceUsdBase: number | null   // DexScreener's priceUsd is always the BASE token's USD price
  priceNative: number | null    // base price expressed in quote-token units
  liquidityUsd: number | null
  volume24h: number | null
  priceChange24hBase: number | null // % change is also base-token-specific
  txns24h: number | null
}

const SESSION_KEY = 'aeon_dexscreener_v2'
const TTL = 30_000

export function useDexScreenerPairs(): Record<string, DexScreenerPair> {
  const [data, setData] = useState<Record<string, DexScreenerPair>>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, DexScreenerPair> }
        if (Date.now() - ts < TTL) return data
      }
    } catch {}
    return {}
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${POOL_ADDRS.join(',')}`)
        if (!r.ok) return
        const j = await r.json()
        const result: Record<string, DexScreenerPair> = {}
        for (const p of j.pairs ?? []) {
          const addr = (p.pairAddress ?? '').toLowerCase()
          if (!addr) continue
          const txns = p.txns?.h24
          result[addr] = {
            baseKey:  KEY_BY_ADDR[(p.baseToken?.address ?? '').toLowerCase()] ?? null,
            quoteKey: KEY_BY_ADDR[(p.quoteToken?.address ?? '').toLowerCase()] ?? null,
            priceUsdBase: p.priceUsd ? parseFloat(p.priceUsd) : null,
            priceNative:  p.priceNative ? parseFloat(p.priceNative) : null,
            liquidityUsd: p.liquidity?.usd ?? null,
            volume24h: p.volume?.h24 ?? null,
            priceChange24hBase: typeof p.priceChange?.h24 === 'number' ? p.priceChange.h24 : null,
            txns24h: txns ? (txns.buys ?? 0) + (txns.sells ?? 0) : null,
          }
        }
        if (cancelled) return
        setData(result)
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now(), data: result })) } catch {}
      } catch {}
    }

    load()
    const id = setInterval(load, TTL)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return data
}

export interface TokenDexStats {
  priceUsd: number | null
  volume24h: number | null
  priceChange24h: number | null
}

// Aggregates DexScreener pair data down to one token. Price/change come from
// whichever pair containing it has the deepest liquidity (most reliable
// single quote) — correctly computed for whichever side (base or quote) the
// token is actually on, since DexScreener's priceUsd/priceChange are always
// base-token-specific. Volume sums across every pair containing it (each
// pair is a distinct real trading venue, so summing doesn't double-count).
export function dexTokenStats(pairs: Record<string, DexScreenerPair>, tokenKey: string): TokenDexStats {
  const key = tokenKey === 'ETH' ? 'WETH' : tokenKey
  let bestLiquidity = -1
  let priceUsd: number | null = null
  let priceChange24h: number | null = null
  let volume24h: number | null = null

  for (const pair of Object.values(pairs)) {
    const isBase  = pair.baseKey === key
    const isQuote = pair.quoteKey === key
    if (!isBase && !isQuote) continue

    if (pair.volume24h !== null) volume24h = (volume24h ?? 0) + pair.volume24h

    const liq = pair.liquidityUsd ?? 0
    if (liq > bestLiquidity) {
      bestLiquidity = liq
      if (isBase) {
        priceUsd = pair.priceUsdBase
        priceChange24h = pair.priceChange24hBase
      } else if (pair.priceUsdBase !== null && pair.priceNative) {
        // quote token's USD price = base's USD price / base's price-in-quote-units
        priceUsd = pair.priceUsdBase / pair.priceNative
        priceChange24h = null // base's % change doesn't cleanly translate to the quote side
      } else {
        priceUsd = null
        priceChange24h = null
      }
    }
  }

  return { priceUsd, volume24h, priceChange24h }
}
