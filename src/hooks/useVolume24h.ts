'use client'
import { useEffect, useRef, useState } from 'react'
import { usePublicClient, useReadContracts } from 'wagmi'
import { decodeEventLog, formatUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI, LB_PAIR_ABI } from '@/config/abis'
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

// CL (Algebra Integral) pools' real Swap event — signed deltas, not
// separate in/out fields. Verified against a real on-chain log from our
// deployed AEON/ETH CL pool (topic0 matched exactly, not guessed):
//   event Swap(address indexed sender, address indexed recipient,
//              int256 amount0, int256 amount1, uint160 price,
//              uint128 liquidity, int24 tick)
// keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
const CL_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' as `0x${string}`
const CL_SWAP_ABI = [{
  name: 'Swap', type: 'event',
  inputs: [
    { name: 'sender',    type: 'address', indexed: true  },
    { name: 'recipient', type: 'address', indexed: true  },
    { name: 'amount0',   type: 'int256',  indexed: false },
    { name: 'amount1',   type: 'int256',  indexed: false },
    { name: 'price',     type: 'uint160', indexed: false },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'tick',      type: 'int24',   indexed: false },
  ],
}] as const

// DLMM (Trader Joe / LFJ Liquidity Book) pools' real Swap event — amounts
// packed into bytes32 (low 128 bits = X, high 128 bits = Y, per
// PackedUint128Math.decode() in the joe-v2 source). Also verified against a
// real on-chain log from our deployed AEON/ETH DLMM pool (topic0 matched):
//   event Swap(address indexed sender, address indexed to, uint24 id,
//              bytes32 amountsIn, bytes32 amountsOut,
//              uint24 volatilityAccumulator, bytes32 totalFees, bytes32 protocolFees)
// keccak256("Swap(address,address,uint24,bytes32,bytes32,uint24,bytes32,bytes32)")
const LB_SWAP_TOPIC = '0xad7d6f97abf51ce18e17a38f4d70e975be9c0708474987bb3e26ad21bd93ca70' as `0x${string}`
const LB_SWAP_ABI = [{
  name: 'Swap', type: 'event',
  inputs: [
    { name: 'sender',                 type: 'address', indexed: true  },
    { name: 'to',                     type: 'address', indexed: true  },
    { name: 'id',                     type: 'uint24',  indexed: false },
    { name: 'amountsIn',              type: 'bytes32', indexed: false },
    { name: 'amountsOut',             type: 'bytes32', indexed: false },
    { name: 'volatilityAccumulator',  type: 'uint24',  indexed: false },
    { name: 'totalFees',              type: 'bytes32', indexed: false },
    { name: 'protocolFees',           type: 'bytes32', indexed: false },
  ],
}] as const

function decodePacked128(z: bigint): { x: bigint; y: bigint } {
  const MASK_128 = (1n << 128n) - 1n
  return { x: z & MASK_128, y: z >> 128n }
}

// pool address (lowercase) → { t0Key, t1Key }
const POOL_META = new Map<string, { t0Key: string; t1Key: string }>()
for (const p of POOLS) {
  const addr = p.address.toLowerCase()
  if (!POOL_META.has(addr)) POOL_META.set(addr, { t0Key: p.token0, t1Key: p.token1 })
}
for (const p of [...CL_POOLS, ...DLMM_POOLS]) {
  const addr = p.address.toLowerCase()
  if (!POOL_META.has(addr)) POOL_META.set(addr, { t0Key: p.token0, t1Key: p.token1 })
}
const POOL_ADDRESSES = [...new Set(POOLS.map(p => p.address))] as `0x${string}`[]
const CL_ADDRESSES = [...new Set(CL_POOLS.map(p => p.address))] as `0x${string}`[]
const DLMM_ADDRESSES = [...new Set(DLMM_POOLS.map(p => p.address))] as `0x${string}`[]
const ALL_ADDRESSES = [...new Set([...POOL_ADDRESSES, ...CL_ADDRESSES, ...DLMM_ADDRESSES])] as `0x${string}`[]

// The factory sorts a pool's real on-chain token0/token1 by address, which
// does NOT always match the token0/token1 declared in POOLS above (e.g.
// AEON/USDG's real token0 is USDG, not AEON) — decoding amount0In/amount1In
// against the config's declared order instead of the real one silently
// mixes up both decimals and price, producing wildly wrong USD volume. Read
// the real on-chain token0() per pool so amounts are matched to the right
// token regardless of how POOLS happens to be ordered. CL pools expose the
// same token0()/token1() shape as vAMM; DLMM (LBPair) exposes
// getTokenX()/getTokenY() instead, no plain token0()/token1().
const POOL_TOKEN0_CONTRACTS = [...POOL_ADDRESSES, ...CL_ADDRESSES].map(addr => ({ address: addr, abi: PAIR_ABI, functionName: 'token0' } as const))
const DLMM_TOKENX_CONTRACTS = DLMM_ADDRESSES.map(addr => ({ address: addr, abi: LB_PAIR_ABI, functionName: 'getTokenX' } as const))

// Robinhood Chain's real block time is ~0.2s (measured), nowhere near the
// ~2s Ethereum-derived guess a fixed 43200-block range assumes — that guess
// covered barely 2.4 real hours, not 24, and silently missed real swaps
// that happened a few hours ago (confirmed: DexScreener showed real 24h
// volume while this undercounted to $0). Measure the actual block time
// each poll and convert 24h into the right block count instead of guessing.
const SAMPLE_BLOCKS = 2000n
const FALLBACK_BLOCKS_24H = 43200n // used only if the timestamp measurement itself fails

// Shared by both the 24h and 7d windows -- same block-time measurement,
// just a different target duration in seconds.
async function blocksForDuration(client: NonNullable<ReturnType<typeof usePublicClient>>, seconds: number, fallback: bigint): Promise<bigint> {
  try {
    const latest = await client.getBlockNumber()
    if (latest <= SAMPLE_BLOCKS) return latest
    const [latestBlock, oldBlock] = await Promise.all([
      client.getBlock({ blockNumber: latest }),
      client.getBlock({ blockNumber: latest - SAMPLE_BLOCKS }),
    ])
    const dtSeconds = Number(latestBlock.timestamp - oldBlock.timestamp)
    if (dtSeconds <= 0) return fallback
    const secondsPerBlock = dtSeconds / Number(SAMPLE_BLOCKS)
    const blocks = BigInt(Math.ceil(seconds / secondsPerBlock))
    return blocks < latest ? blocks : latest
  } catch {
    return fallback
  }
}

const FALLBACK_BLOCKS_7D = FALLBACK_BLOCKS_24H * 7n

async function blocksFor24h(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<bigint> {
  return blocksForDuration(client, 86400, FALLBACK_BLOCKS_24H)
}

async function blocksFor7d(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<bigint> {
  return blocksForDuration(client, 604800, FALLBACK_BLOCKS_7D)
}

export interface VolumeResult {
  total: number | null
  byPool: Record<string, number>
  // Same real on-chain volume, just summed over a full trailing week instead
  // of 24h -- used for APR so a pool with real-but-sporadic trading (nothing
  // in the exact last 24h, but real swaps 2-3 days ago) doesn't show a
  // misleading "—%" just because nothing happened to trade very recently.
  byPoolWeek: Record<string, number>
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

  // real on-chain token0 per pool (lowercase pool address → lowercase token0 address).
  // DLMM (LBPair) has no plain token0()/token1() — getTokenX() fills the same
  // "token0-equivalent" role, matched against decodePacked128's `x` component.
  const { data: token0Data } = useReadContracts({ contracts: POOL_TOKEN0_CONTRACTS, query: { staleTime: Infinity } })
  const { data: tokenXData } = useReadContracts({ contracts: DLMM_TOKENX_CONTRACTS, query: { staleTime: Infinity } })
  const onChainToken0Ref = useRef<Map<string, string>>(new Map())
  const token0Map = new Map<string, string>()
  ;[...POOL_ADDRESSES, ...CL_ADDRESSES].forEach((addr, i) => {
    const r = token0Data?.[i]
    if (r?.status === 'success') token0Map.set(addr.toLowerCase(), (r.result as string).toLowerCase())
  })
  DLMM_ADDRESSES.forEach((addr, i) => {
    const r = tokenXData?.[i]
    if (r?.status === 'success') token0Map.set(addr.toLowerCase(), (r.result as string).toLowerCase())
  })
  onChainToken0Ref.current = token0Map

  const [result, setResult] = useState<VolumeResult>({ total: null, byPool: {}, byPoolWeek: {}, priceHistory: {} })

  useEffect(() => {
    if (!client) return
    let cancelled = false

    // Shared candidate-range search: try the measured window first, degrade
    // to smaller windows only if the RPC itself rejects the range (e.g. a
    // provider-side cap) — never silently accept a narrower window when the
    // wide one just returned zero results, since "no real trades" and
    // "range too small to see them" look identical otherwise.
    async function fetchLogsForRange(primaryRange: bigint, currentBlock: bigint): Promise<any[]> {
      const candidateRanges = [...new Set([primaryRange, 43200n, 10000n, 2048n, 512n])]
      for (const range of candidateRanges) {
        const fromBlock = currentBlock > range ? currentBlock - range : 0n
        try {
          return await (client as any).getLogs({
            address: ALL_ADDRESSES,
            topics:  [[SWAP_TOPIC, CL_SWAP_TOPIC, LB_SWAP_TOPIC]], // OR match on topic0
            fromBlock,
            toBlock: currentBlock,
          })
        } catch {
          // try next smaller range
        }
      }
      throw new Error('all candidate ranges failed')
    }

    // Decode a batch of logs into {totalUsd, byPool, priceHistory} — shared
    // by both the 24h and 7d windows, since the decode logic doesn't care
    // how wide the range was.
    function processLogs(logs: any[], p: PriceMap) {
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

        // Normalize whichever event type this is into the same
        // {amount0In, amount1In, amount0Out, amount1Out} shape (all relative
        // to the pool's REAL on-chain token0/tokenX) so the USD-volume and
        // priceHistory logic below runs unchanged regardless of pool type.
        let amount0In = 0n, amount1In = 0n, amount0Out = 0n, amount1Out = 0n
        const topic0 = (log.topics?.[0] ?? '').toLowerCase()

        try {
          if (topic0 === SWAP_TOPIC.toLowerCase()) {
            const { args } = decodeEventLog({ abi: SWAP_ABI, data: log.data, topics: log.topics })
            ;({ amount0In, amount1In, amount0Out, amount1Out } = args as
              { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint })
          } else if (topic0 === CL_SWAP_TOPIC.toLowerCase()) {
            const { args } = decodeEventLog({ abi: CL_SWAP_ABI, data: log.data, topics: log.topics })
            const { amount0, amount1 } = args as { amount0: bigint; amount1: bigint }
            // Algebra: positive = paid INTO the pool, negative = paid OUT of the pool.
            if (amount0 > 0n) amount0In = amount0; else if (amount0 < 0n) amount0Out = -amount0
            if (amount1 > 0n) amount1In = amount1; else if (amount1 < 0n) amount1Out = -amount1
          } else if (topic0 === LB_SWAP_TOPIC.toLowerCase()) {
            const { args } = decodeEventLog({ abi: LB_SWAP_ABI, data: log.data, topics: log.topics })
            const { amountsIn, amountsOut } = args as { amountsIn: `0x${string}`; amountsOut: `0x${string}` }
            const inPacked  = decodePacked128(BigInt(amountsIn))
            const outPacked = decodePacked128(BigInt(amountsOut))
            // x = tokenX (our "token0-equivalent" per onChainToken0Ref), y = tokenY.
            amount0In = inPacked.x; amount1In = inPacked.y
            amount0Out = outPacked.x; amount1Out = outPacked.y
          } else {
            continue
          }
        } catch { continue }

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

        // Execution price from a real trade, priced off whichever side
        // already has a KNOWN price (from usePrices() — AEON, WETH/ETH,
        // USDG, anything resolved) rather than only when one side is
        // literally USDG. A USDG-only check meant any token without a
        // *direct* USDG pool (VIRTUAL, ROBINFUN, CASHCAT — only ever paired
        // against AEON) could never get a chart no matter how much it
        // actually traded, even though the same p0/p1 map above already
        // knows AEON's price and could price the other side just fine.
        if (t0 && t1) {
          if (amount0In > 0n && amount1Out > 0n) {
            const amtIn  = Number(formatUnits(amount0In,  t0.decimals))
            const amtOut = Number(formatUnits(amount1Out, t1.decimals))
            if (amtIn > 0 && amtOut > 0) {
              if (p0 !== null) (priceHistory[key1] ??= []).push((amtIn * p0) / amtOut)
              else if (p1 !== null) (priceHistory[key0] ??= []).push((amtOut * p1) / amtIn)
            }
          } else if (amount1In > 0n && amount0Out > 0n) {
            const amtIn  = Number(formatUnits(amount1In,  t1.decimals))
            const amtOut = Number(formatUnits(amount0Out, t0.decimals))
            if (amtIn > 0 && amtOut > 0) {
              if (p1 !== null) (priceHistory[key0] ??= []).push((amtIn * p1) / amtOut)
              else if (p0 !== null) (priceHistory[key1] ??= []).push((amtOut * p0) / amtIn)
            }
          }
        }
      }

      priceHistory['ETH'] = priceHistory['WETH'] ?? []

      return { totalUsd, byPool, priceHistory }
    }

    async function fetchVolume() {
      const currentBlock = await client!.getBlockNumber().catch(() => undefined)
      if (currentBlock === undefined || cancelled) return

      const [range24h, range7d] = await Promise.all([blocksFor24h(client!), blocksFor7d(client!)])

      const [logs24h, logs7d] = await Promise.all([
        fetchLogsForRange(range24h, currentBlock).catch(e => { console.warn('useVolume24h: 24h getLogs failed', e); return null }),
        fetchLogsForRange(range7d,  currentBlock).catch(e => { console.warn('useVolume24h: 7d getLogs failed', e);  return null }),
      ])

      if (cancelled) return

      const p = pricesRef.current
      const day  = logs24h ? processLogs(logs24h, p) : null
      const week = logs7d  ? processLogs(logs7d,  p) : null

      if (!day && !week) return

      setResult({
        total:      day?.totalUsd ?? null,
        byPool:     day?.byPool ?? {},
        byPoolWeek: week?.byPool ?? {},
        priceHistory: day?.priceHistory ?? week?.priceHistory ?? {},
      })
    }

    fetchVolume()
    const id = setInterval(fetchVolume, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [client])  // prices excluded — accessed via ref to avoid infinite loop

  return result
}
