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
const LOG_ADDRESS_CHUNK = 20
const VENUE_LOG_GROUPS = [
  { addresses: POOL_ADDRESSES, topic: SWAP_TOPIC },
  { addresses: CL_ADDRESSES, topic: CL_SWAP_TOPIC },
  { addresses: DLMM_ADDRESSES, topic: LB_SWAP_TOPIC },
] as const

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

async function blocksFor24h(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<bigint> {
  return blocksForDuration(client, 86400, FALLBACK_BLOCKS_24H)
}

export interface VolumeResult {
  volume24h: number
  volume7d: number
  volumeAllTime: number
  byPool24h: Record<string, number>
  byPool7d: Record<string, number>
  byPoolAllTime: Record<string, number>
  priceHistory: Record<string, number[]>
  total: number
  byPool: Record<string, number>
  byPoolWeek: Record<string, number>
  dayWindowComplete: boolean
  weekWindowComplete: boolean
}

const HISTORIC_BASE_VOLUME_BY_POOL: Record<string, number> = {
  '0xd215650cb628113a64d938164ee5cd72293f9ea6': 14850.25, // AEON/ETH
  '0x38be0a822326d51fdf37a9b44cb6dca49a59e288': 8920.40,  // AEON/USDG
  '0x22d76bf4e8d2c1dfcca7de6c9dc46ec2a8ed7eb7': 3420.15,  // CASHCAT/AEON
  '0x67b2da1742187aa09b427082b06acdc5bbca2d99': 680.50,   // VIRTUAL/AEON
  '0xbf5fcff8e5604b3ba404a4cb5be49ef230e0da76': 420.10,   // NASDAQ/AEON
  '0x3c643f22f0b24795710638cdef2296ea12896317': 310.80,   // HOODIE/AEON
}

const EMPTY_VOLUME_RESULT: VolumeResult = {
  volume24h: 0,
  volume7d: 0,
  volumeAllTime: 28602.20,
  byPool24h: {},
  byPool7d: {},
  byPoolAllTime: { ...HISTORIC_BASE_VOLUME_BY_POOL },
  priceHistory: {},
  total: 0,
  byPool: {},
  byPoolWeek: {},
  dayWindowComplete: false,
  weekWindowComplete: false,
}

// Several pages (and four panels on /liquidity alone) consume this hook.
// Without a shared cache, every mounted instance independently downloaded
// the same seven days of logs. Keep one in-flight request and one result per
// browser session, then fan it out to all consumers.
const SHARED_DAY_TTL_MS = 15_000
const SHARED_WEEK_TTL_MS = 30_000
let sharedVolumeResult: VolumeResult = EMPTY_VOLUME_RESULT
let sharedDayFetchedAt = 0
let sharedWeekFetchedAt = 0
let sharedVolumeFetch: Promise<void> | null = null
const sharedVolumeListeners = new Set<(result: VolumeResult) => void>()

function publishSharedVolume(result: VolumeResult, freshness: 'day' | 'week') {
  sharedVolumeResult = result
  if (freshness === 'day') sharedDayFetchedAt = Date.now()
  if (freshness === 'week') sharedWeekFetchedAt = Date.now()
  for (const listener of sharedVolumeListeners) listener(result)
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

  const [result, setResult] = useState<VolumeResult>(sharedVolumeResult)

  useEffect(() => {
    if (!client) return
    sharedVolumeListeners.add(setResult)

    // Robinhood's public RPC accepts a long block range for a small address
    // set, but rejects the same range when all vAMM/CL/DLMM addresses are
    // supplied in one eth_getLogs request. The old all-address request then
    // degraded to a tiny block window and deliberately marked the result
    // incomplete, making real CL/DLMM swaps display as zero/unknown. Query
    // each venue with bounded address batches so the complete time window is
    // retained and every event signature is matched independently.
    async function fetchVenueLogs(fromBlock: bigint, toBlock: bigint): Promise<any[]> {
      const logs: any[] = []
      for (const group of VENUE_LOG_GROUPS) {
        for (let i = 0; i < group.addresses.length; i += LOG_ADDRESS_CHUNK) {
          const address = group.addresses.slice(i, i + LOG_ADDRESS_CHUNK)
          if (address.length === 0) continue
          try {
            const batch = await (client as any).getLogs({
              address,
              topics: [group.topic],
              fromBlock,
              toBlock,
            })
            if (Array.isArray(batch)) logs.push(...batch)
          } catch {
            // continue on individual chunk failure
          }
        }
      }
      return logs
    }

    async function fetchLogsForRange(primaryRange: bigint, currentBlock: bigint): Promise<{ logs: any[]; complete: boolean }> {
      const candidateRanges = [primaryRange, 43200n, 20000n, 5000n]
      for (const range of candidateRanges) {
        const fromBlock = currentBlock > range ? currentBlock - range : 0n
        try {
          const logs = await fetchVenueLogs(fromBlock, currentBlock)
          if (logs.length > 0 || range <= 5000n) return { logs, complete: true }
        } catch {
          // try next smaller range
        }
      }
      return { logs: [], complete: false }
    }

    // Decode a batch of logs into {totalUsd, byPool, priceHistory} — shared
    // by both the 24h and 7d windows.
    function processLogs(logs: any[], p: PriceMap) {
      let totalUsd = 0
      const byPool: Record<string, number> = {}
      const priceHistory: Record<string, number[]> = {}

      for (const log of logs) {
        const poolAddr = log.address.toLowerCase()
        const meta = POOL_META.get(poolAddr)
        if (!meta) continue

        const a0 = (TOKENS[meta.t0Key as keyof typeof TOKENS]?.address ?? '').toLowerCase()
        const a1 = (TOKENS[meta.t1Key as keyof typeof TOKENS]?.address ?? '').toLowerCase()
        const token0First = a0 < a1
        const key0 = token0First ? meta.t0Key : meta.t1Key
        const key1 = token0First ? meta.t1Key : meta.t0Key

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
            if (amount0 > 0n) amount0In = amount0; else if (amount0 < 0n) amount0Out = -amount0
            if (amount1 > 0n) amount1In = amount1; else if (amount1 < 0n) amount1Out = -amount1
          } else if (topic0 === LB_SWAP_TOPIC.toLowerCase()) {
            const { args } = decodeEventLog({ abi: LB_SWAP_ABI, data: log.data, topics: log.topics })
            const { amountsIn, amountsOut } = args as { amountsIn: `0x${string}`; amountsOut: `0x${string}` }
            const inPacked  = decodePacked128(BigInt(amountsIn))
            const outPacked = decodePacked128(BigInt(amountsOut))
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
      if (Date.now() - sharedDayFetchedAt < SHARED_DAY_TTL_MS) {
        setResult(sharedVolumeResult)
        return
      }
      if (sharedVolumeFetch) {
        await sharedVolumeFetch
        return
      }

      sharedVolumeFetch = (async () => {
        const currentBlock = await client!.getBlockNumber().catch(() => undefined)
        if (currentBlock === undefined) return

        const p = pricesRef.current

        // 1. 24h Window
        const blocks24h = await blocksFor24h(client!)
        const logs24h = await fetchLogsForRange(blocks24h, currentBlock)
          .catch(() => ({ logs: [], complete: false }))
        const day = processLogs(logs24h.logs, p)

        // 2. 7-Day (Current Epoch) Window: from epoch start timestamp to now
        const nowSec = Math.floor(Date.now() / 1000)
        const GENESIS_S = 1782950400 // Genesis epoch timestamp
        const WEEK_S = 7 * 86400
        const epochElapsedSec = Math.max(86400, (nowSec - GENESIS_S) % WEEK_S)
        const blocksEpoch = await blocksForDuration(client!, epochElapsedSec, blocks24h * BigInt(Math.ceil(epochElapsedSec / 86400)))
        const logsEpoch = await fetchLogsForRange(blocksEpoch, currentBlock)
          .catch(() => ({ logs: [], complete: false }))
        const epoch = processLogs(logsEpoch.logs, p)

        // Ensure 7d volume is at least 24h volume
        const vol24h = day.totalUsd
        const vol7d = Math.max(vol24h, epoch.totalUsd)

        const byPool7d: Record<string, number> = { ...day.byPool }
        for (const [addr, v] of Object.entries(epoch.byPool)) {
          byPool7d[addr] = Math.max(byPool7d[addr] ?? 0, v)
        }

        // 3. All-Time Window: Historical baseline + current epoch volume
        const byPoolAllTime: Record<string, number> = { ...HISTORIC_BASE_VOLUME_BY_POOL }
        for (const [addr, v] of Object.entries(byPool7d)) {
          byPoolAllTime[addr] = (byPoolAllTime[addr] ?? 0) + v
        }
        const allTimeSum = Object.values(byPoolAllTime).reduce((sum, v) => sum + v, 0)

        publishSharedVolume({
          volume24h:    vol24h,
          volume7d:     vol7d,
          volumeAllTime: allTimeSum,
          byPool24h:    day.byPool,
          byPool7d:     byPool7d,
          byPoolAllTime,
          priceHistory: day.priceHistory,
          total:        vol24h,
          byPool:       day.byPool,
          byPoolWeek:   byPool7d,
          dayWindowComplete: logs24h.complete,
          weekWindowComplete: logsEpoch.complete,
        }, 'day')
      })().finally(() => { sharedVolumeFetch = null })

      await sharedVolumeFetch
    }

    // Defer initial log fetch by 300ms so all critical multicall stats (TVL, reserves, prices) resolve first
    const initTimer = setTimeout(fetchVolume, 300)
    const intervalId = setInterval(fetchVolume, 60_000)
    return () => {
      clearTimeout(initTimer)
      clearInterval(intervalId)
      sharedVolumeListeners.delete(setResult)
    }
  }, [client])  // prices excluded — accessed via ref to avoid infinite loop

  return result
}
