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

// Try progressively smaller block ranges until one succeeds
const RANGES = [43200n, 10000n, 2048n, 512n]

export interface VolumeResult {
  total: number | null
  byPool: Record<string, number>
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

  const [result, setResult] = useState<VolumeResult>({ total: null, byPool: {} })

  useEffect(() => {
    if (!client) return
    let cancelled = false

    async function fetchVolume() {
      let logs: any[] = []
      let succeeded  = false

      try {
        const currentBlock = await client!.getBlockNumber()

        for (const range of RANGES) {
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

        const { amount0In, amount1In } = args as { amount0In: bigint; amount1In: bigint }
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
      }

      setResult({ total: totalUsd, byPool })
    }

    fetchVolume()
    const id = setInterval(fetchVolume, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [client])  // prices excluded — accessed via ref to avoid infinite loop

  return result
}
