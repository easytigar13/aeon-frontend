'use client'
import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, TOKENS } from '@/config/contracts'
import type { PriceMap } from './usePrices'

// Uniswap V2 Swap event (AeonPair is V2-style)
const SWAP_EVENT = {
  name: 'Swap',
  type: 'event',
  inputs: [
    { name: 'sender',     type: 'address', indexed: true  },
    { name: 'amount0In',  type: 'uint256', indexed: false },
    { name: 'amount1In',  type: 'uint256', indexed: false },
    { name: 'amount0Out', type: 'uint256', indexed: false },
    { name: 'amount1Out', type: 'uint256', indexed: false },
    { name: 'to',         type: 'address', indexed: true  },
  ],
} as const

const BLOCKS_24H = 43200n  // Avalanche ~2 s/block → 43 200 blocks per 24 h

// Build a map from pool address (lowercase) → { token0Key, token1Key }
// We need token0 ordering to interpret amount0 vs amount1.
// Since we don't cache token0 here, we compare pool.token0 address against TOKENS.
function buildPoolMeta() {
  const map = new Map<string, { t0Key: string; t1Key: string }>()
  for (const p of POOLS) {
    const addr = p.address.toLowerCase()
    if (!map.has(addr)) {
      map.set(addr, { t0Key: p.token0, t1Key: p.token1 })
    }
  }
  return map
}

export interface VolumeResult {
  total: number | null
  byPool: Record<string, number>  // pool address (lowercase) → USD volume
}

export function useVolume24h(prices: PriceMap): VolumeResult {
  const client = usePublicClient()
  const [result, setResult] = useState<VolumeResult>({ total: null, byPool: {} })

  useEffect(() => {
    if (!client) return
    let cancelled = false

    async function fetchVolume() {
      try {
        const currentBlock = await client!.getBlockNumber()
        const fromBlock = currentBlock > BLOCKS_24H ? currentBlock - BLOCKS_24H : 0n
        const addresses = [...new Set(POOLS.map(p => p.address))] as `0x${string}`[]
        const poolMeta = buildPoolMeta()

        let logs: any[] = []
        try {
          logs = await client!.getLogs({
            address: addresses,
            event: SWAP_EVENT as any,
            fromBlock,
            toBlock: currentBlock,
          })
        } catch {
          // Some RPC nodes cap the range; fall back to last 2 048 blocks (~1 h)
          const fallbackFrom = currentBlock > 2048n ? currentBlock - 2048n : 0n
          logs = await client!.getLogs({
            address: addresses,
            event: SWAP_EVENT as any,
            fromBlock: fallbackFrom,
            toBlock: currentBlock,
          })
        }

        if (cancelled) return

        let totalUsd = 0
        const byPool: Record<string, number> = {}

        for (const log of logs) {
          const poolAddr = log.address.toLowerCase()
          const meta = poolMeta.get(poolAddr)
          if (!meta) continue

          const { amount0In, amount1In } = log.args as {
            amount0In: bigint; amount1In: bigint
            amount0Out: bigint; amount1Out: bigint
          }

          const t0 = TOKENS[meta.t0Key as keyof typeof TOKENS]
          const t1 = TOKENS[meta.t1Key as keyof typeof TOKENS]
          const p0 = prices[meta.t0Key] ?? null
          const p1 = prices[meta.t1Key] ?? null

          let swapUsd = 0
          if (amount0In > 0n && p0 !== null && t0) {
            swapUsd = Number(formatUnits(amount0In, t0.decimals)) * p0
          } else if (amount1In > 0n && p1 !== null && t1) {
            swapUsd = Number(formatUnits(amount1In, t1.decimals)) * p1
          }

          if (swapUsd > 0) {
            totalUsd += swapUsd
            byPool[poolAddr] = (byPool[poolAddr] ?? 0) + swapUsd
          }
        }

        setResult({ total: totalUsd, byPool })
      } catch (e) {
        console.error('useVolume24h:', e)
      }
    }

    fetchVolume()
    const id = setInterval(fetchVolume, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [client, prices])

  return result
}
