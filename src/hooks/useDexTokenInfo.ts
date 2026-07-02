'use client'
import { useState, useEffect } from 'react'
import { TOKENS } from '@/config/contracts'

export type DexTokenInfo = {
  imageUrl: string | null
  sparkline: number[]
  priceChange24h: number | null
}

// Native ETH has no real contract; skip it and copy from WETH after fetching
const TOKEN_ENTRIES = Object.entries(TOKENS).filter(([k]) => k !== 'ETH')

const SESSION_KEY = 'aeon_dex_token_info_v2'
const TTL = 5 * 60 * 1000

export function useDexTokenInfo(): Record<string, DexTokenInfo> {
  const [info, setInfo] = useState<Record<string, DexTokenInfo>>({})

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, DexTokenInfo> }
        if (Date.now() - ts < TTL) { setInfo(data); return }
      }
    } catch {}

    async function load() {
      const addrs = TOKEN_ENTRIES.map(([, t]) => t.address.toLowerCase())

      // One request: token metadata + top pools (included)
      let tokenJson: any = { data: [], included: [] }
      try {
        const r = await fetch(
          `https://api.geckoterminal.com/api/v2/networks/robinhood-chain/tokens/multi/${addrs.join(',')}?include=top_pools`,
          { headers: { Accept: 'application/json;version=20230302' } }
        )
        if (r.ok) tokenJson = await r.json()
      } catch {}

      // address → image URL
      const imageByAddr: Record<string, string | null> = {}
      for (const t of tokenJson.data ?? []) {
        const addr = (t.attributes?.address ?? '').toLowerCase()
        if (addr) imageByAddr[addr] = t.attributes?.image_url ?? null
      }

      // poolId → { poolAddress, baseTokenAddress }
      const poolAddrById: Record<string, string> = {}
      const baseByPoolId: Record<string, string> = {}
      for (const inc of tokenJson.included ?? []) {
        if (inc.type === 'pool') {
          poolAddrById[inc.id] = inc.attributes?.address ?? ''
          const baseId: string = inc.relationships?.base_token?.data?.id ?? ''
          baseByPoolId[inc.id] = baseId.replace(/^robinhood-chain_/, '').toLowerCase()
        }
      }

      // tokenAddress → top pool + role (base or quote)
      const topPoolByAddr: Record<string, { poolAddr: string; role: 'base' | 'quote' }> = {}
      for (const t of tokenJson.data ?? []) {
        const addr = (t.attributes?.address ?? '').toLowerCase()
        const topId = t.relationships?.top_pools?.data?.[0]?.id
        if (topId && poolAddrById[topId]) {
          const isBase = baseByPoolId[topId] === addr
          topPoolByAddr[addr] = { poolAddr: poolAddrById[topId], role: isBase ? 'base' : 'quote' }
        }
      }

      // Fetch 24h hourly OHLCV per token in parallel
      const result: Record<string, DexTokenInfo> = {}

      await Promise.all(
        TOKEN_ENTRIES.map(async ([key, t]) => {
          const addr = t.address.toLowerCase()
          const imageUrl = imageByAddr[addr] ?? null
          const pool = topPoolByAddr[addr]
          let sparkline: number[] = []
          let priceChange24h: number | null = null

          if (pool) {
            try {
              const r = await fetch(
                `https://api.geckoterminal.com/api/v2/networks/robinhood-chain/pools/${pool.poolAddr}/ohlcv/hour?limit=24&token=${pool.role}`,
                { headers: { Accept: 'application/json;version=20230302' } }
              )
              if (r.ok) {
                const j = await r.json()
                const ohlcv: number[][] = j.data?.attributes?.ohlcv_list ?? []
                sparkline = ohlcv.map(c => c[4]).filter(Boolean)
                if (sparkline.length >= 2) {
                  const first = sparkline[0]
                  const last = sparkline[sparkline.length - 1]
                  priceChange24h = first > 0 ? ((last - first) / first) * 100 : null
                }
              }
            } catch {}
          }

          result[key] = { imageUrl, sparkline, priceChange24h }
        })
      )

      // Native ETH: mirror WETH chart data
      result['ETH'] = result['WETH'] ?? { imageUrl: null, sparkline: [], priceChange24h: null }

      setInfo(result)
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now(), data: result }))
      } catch {}
    }

    load().catch(console.error)
  }, [])

  return info
}
