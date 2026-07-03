'use client'
import { useEffect, useRef, useState } from 'react'
import { usePublicClient, useReadContracts } from 'wagmi'
import { decodeEventLog, formatUnits } from 'viem'
import { POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'
import type { PriceMap } from './usePrices'

// AeonPoolRH.sol's real Swap event — UniswapV2-canonical ordering, 'to' is
// LAST and indexed (not right after sender like the old Solidly/Velodrome
// pools this hook was originally written against). Getting this wrong means
// getLogs() filters for a topic0 that never matches any real log — silently
// zero volume forever, no error. Verified against src/robinhood/AeonPoolRH.sol:
//   event Swap(address indexed sender, uint256 amount0In, uint256 amount1In,
//              uint256 amount0Out, uint256 amount1Out, address indexed to)
// keccak256("Swap(address,uint256,uint256,uint256,uint256,address)")
const SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' as `0x${string}`

const SWAP_ABI = [{
  name: 'Swap', type: 'event',
  inputs: [
    { name: 'sender',     type: 'address', indexed: true  },
    { name: 'amount0In',  type: 'uint256', indexed: false },
    { name: 'amount1In',  type: 'uint256', indexed: false },
    { name: 'amount0Out', type: 'uint256', indexed: false },
    { name: 'amount1Out', type: 'uint256', indexed: false },
    { name: 'to',         type: 'address', indexed: true  },
  ],
}] as const

// pool address (lowercase) → { t0Key, t1Key }
const POOL_META = new Map<string, { t0Key: string; t1Key: string }>()
for (const p of POOLS) {
  const addr = p.address.toLowerCase()
  if (!POOL_META.has(addr)) POOL_META.set(addr, { t0Key: p.token0, t1Key: p.token1 })
}
const POOL_ADDRESSES = [...new Set(POOLS.map(p => p.address))] as `0x${string}`[]

// The factory sorts a pool's real on-chain token0/token1 by address, which
// does NOT always match the token0/token1 declared in POOLS above (e.g.
// AEON/USDG's real token0 is USDG, not AEON) — decoding amount0In/amount1In
// against the config's declared order instead of the real one silently
// mixes up both decimals and price, producing wildly wrong USD volume. Read
// the real on-chain token0() per pool so amounts are matched to the right
// token regardless of how POOLS happens to be ordered.
const POOL_TOKEN0_CONTRACTS = POOL_ADDRESSES.map(addr => ({ address: addr, abi: PAIR_ABI, functionName: 'token0' } as const))

// Robinhood Chain's real block time is ~0.2s (measured), nowhere near the
// ~2s Ethereum-derived guess a fixed 43200-block range assumes — that guess
// covered barely 2.4 real hours, not 24, and silently missed real swaps
// that happened a few hours ago (confirmed: DexScreener showed real 24h
// volume while this undercounted to $0). Measure the actual block time
// each poll and convert 24h into the right block count instead of guessing.
const SAMPLE_BLOCKS = 2000n
const FALLBACK_BLOCKS_24H = 43200n // used only if the timestamp measurement itself fails

async function blocksFor24h(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<bigint> {
  try {
    const latest = await client.getBlockNumber()
    if (latest <= SAMPLE_BLOCKS) return latest
    const [latestBlock, oldBlock] = await Promise.all([
      client.getBlock({ blockNumber: latest }),
      client.getBlock({ blockNumber: latest - SAMPLE_BLOCKS }),
    ])
    const dtSeconds = Number(latestBlock.timestamp - oldBlock.timestamp)
    if (dtSeconds <= 0) return FALLBACK_BLOCKS_24H
    const secondsPerBlock = dtSeconds / Number(SAMPLE_BLOCKS)
    const blocks = BigInt(Math.ceil(86400 / secondsPerBlock))
    return blocks < latest ? blocks : latest
  } catch {
    return FALLBACK_BLOCKS_24H
  }
}

export interface VolumeResult {
  total: number | null
  byPool: Record<string, number>
  // token key -> chronological execution prices in USD, derived from real
  // Swap events on that token's direct USDG-paired vAMM pool (USDG ~= $1).
  // No third-party indexer involved — this is the same log fetch above,
  // just also read for its price info. Empty until a real trade happens.
  priceHistory: Record<string, number[]>
}

export function useVolume24h(prices: PriceMap): VolumeResult {
  const client     = usePublicClient()
  const pricesRef  = useRef(prices)
  pricesRef.current = prices  // always fresh without triggering effect re-runs

  // real on-chain token0 per pool (lowercase pool address → lowercase token0 address)
  const { data: token0Data } = useReadContracts({ contracts: POOL_TOKEN0_CONTRACTS, query: { staleTime: Infinity } })
  const onChainToken0Ref = useRef<Map<string, string>>(new Map())
  const token0Map = new Map<string, string>()
  POOL_ADDRESSES.forEach((addr, i) => {
    const r = token0Data?.[i]
    if (r?.status === 'success') token0Map.set(addr.toLowerCase(), (r.result as string).toLowerCase())
  })
  onChainToken0Ref.current = token0Map

  const [result, setResult] = useState<VolumeResult>({ total: null, byPool: {}, priceHistory: {} })

  useEffect(() => {
    if (!client) return
    let cancelled = false

    async function fetchVolume() {
      let logs: any[] = []
      let succeeded  = false

      try {
        const currentBlock = await client!.getBlockNumber()
        const primaryRange = await blocksFor24h(client!)
        // Try the measured 24h range first; degrade to smaller windows only
        // if the RPC itself rejects the range (e.g. a provider-side cap) —
        // never silently accept a narrower window when the wide one just
        // returned zero results, since "no real trades" and "range too
        // small to see them" look identical otherwise.
        const candidateRanges = [...new Set([primaryRange, 43200n, 10000n, 2048n, 512n])]

        for (const range of candidateRanges) {
          const fromBlock = currentBlock > range ? currentBlock - range : 0n
          try {
            logs = await (client as any).getLogs({
              address: POOL_ADDRESSES,
              topics:  [SWAP_TOPIC],
              fromBlock,
              toBlock: currentBlock,
            })
            succeeded = true
            break
          } catch {
            // try next smaller range
          }
        }
      } catch (e) {
        console.warn('useVolume24h: getBlockNumber failed', e)
      }

      if (!succeeded || cancelled) return

      const p = pricesRef.current
      let totalUsd = 0
      const byPool: Record<string, number> = {}
      const priceHistory: Record<string, number[]> = {}

      for (const log of logs) {
        const poolAddr = log.address.toLowerCase()
        const meta = POOL_META.get(poolAddr)
        if (!meta) continue

        // amount0In/amount1In are keyed to the pool's REAL on-chain token0 —
        // resolve which config token key (t0Key/t1Key) that actually is
        // before decoding decimals/price. Skip if we haven't resolved it yet
        // rather than guessing (guessing is how the decimals/price mismatch
        // bug happened in the first place).
        const onChainToken0 = onChainToken0Ref.current.get(poolAddr)
        if (!onChainToken0) continue
        const t0Addr = TOKENS[meta.t0Key as keyof typeof TOKENS]?.address?.toLowerCase()
        const configMatchesChain = onChainToken0 === t0Addr
        const key0 = configMatchesChain ? meta.t0Key : meta.t1Key
        const key1 = configMatchesChain ? meta.t1Key : meta.t0Key

        let args: any
        try {
          const decoded = decodeEventLog({ abi: SWAP_ABI, data: log.data, topics: log.topics })
          args = decoded.args
        } catch { continue }

        const { amount0In, amount1In, amount0Out, amount1Out } = args as
          { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint }
        const t0 = TOKENS[key0 as keyof typeof TOKENS]
        const t1 = TOKENS[key1 as keyof typeof TOKENS]
        const p0 = p[key0] ?? null
        const p1 = p[key1] ?? null

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

        // Execution price from a real trade, only when one side is USDG
        // (~$1) — no oracle needed, the trade itself prices the other side.
        if (t0 && t1 && (key0 === 'USDG' || key1 === 'USDG')) {
          if (amount0In > 0n && amount1Out > 0n) {
            const amtIn  = Number(formatUnits(amount0In,  t0.decimals))
            const amtOut = Number(formatUnits(amount1Out, t1.decimals))
            if (amtIn > 0 && amtOut > 0) {
              const usdPrice = key1 === 'USDG' ? amtOut / amtIn : amtIn / amtOut
              const tokenKey = key1 === 'USDG' ? key0 : key1
              ;(priceHistory[tokenKey] ??= []).push(usdPrice)
            }
          } else if (amount1In > 0n && amount0Out > 0n) {
            const amtIn  = Number(formatUnits(amount1In,  t1.decimals))
            const amtOut = Number(formatUnits(amount0Out, t0.decimals))
            if (amtIn > 0 && amtOut > 0) {
              const usdPrice = key0 === 'USDG' ? amtOut / amtIn : amtIn / amtOut
              const tokenKey = key0 === 'USDG' ? key1 : key0
              ;(priceHistory[tokenKey] ??= []).push(usdPrice)
            }
          }
        }
      }

      priceHistory['ETH'] = priceHistory['WETH'] ?? []

      setResult({ total: totalUsd, byPool, priceHistory })
    }

    fetchVolume()
    const id = setInterval(fetchVolume, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [client])  // prices excluded — accessed via ref to avoid infinite loop

  return result
}
