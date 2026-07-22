'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, TOKENS, CONTRACTS } from '@/config/contracts'
import { PAIR_ABI, VOTER_ABI, ERC20_ABI, MULTI_GAUGE_CONTROLLER_ABI } from '@/config/abis'
import type { PriceMap } from './usePrices'
import type { DiscoveredPool } from './useAllPools'

export interface PoolStat {
  address: string
  tvlUsd: number | null   // USD value of both reserves combined
  votesWei: bigint        // raw vote weight from Voter
  votesFormatted: string  // human-readable veAEON
}

// Static — defined once at module scope so useReadContracts gets a stable
// reference across renders instead of a fresh array every time (which
// wagmi treats as a config change and re-queries for).
const POOL_STAT_CONTRACTS = POOLS.flatMap(p => ([
  { address: p.address, abi: PAIR_ABI,  functionName: 'getReserves' } as const,
  { address: p.address, abi: PAIR_ABI,  functionName: 'token0' } as const,
  { address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'weights', args: [p.address] } as const,
]))

export function usePoolStats(prices: PriceMap): PoolStat[] {
  const { data } = useReadContracts({ contracts: POOL_STAT_CONTRACTS, query: { refetchInterval: 30000 } })

  return POOLS.map((pool, i) => {
    const base = i * 3
    const reserves = data?.[base]?.status === 'success'   ? data[base].result   as readonly [bigint, bigint, number] : undefined
    const token0   = data?.[base+1]?.status === 'success' ? data[base+1].result as string : undefined
    const votes    = data?.[base+2]?.status === 'success' ? data[base+2].result as bigint : 0n

    let tvlUsd: number | null = null

    if (reserves && token0) {
      const [r0, r1] = reserves
      const isToken0First = token0.toLowerCase() === (TOKENS[pool.token0 as keyof typeof TOKENS]?.address ?? '').toLowerCase()
      const rA = isToken0First ? r0 : r1
      const rB = isToken0First ? r1 : r0

      const priceA = prices[pool.token0] ?? null
      const priceB = prices[pool.token1] ?? null
      const decA = TOKENS[pool.token0 as keyof typeof TOKENS]?.decimals ?? 18
      const decB = TOKENS[pool.token1 as keyof typeof TOKENS]?.decimals ?? 18

      const valA = priceA !== null ? Number(formatUnits(rA, decA)) * priceA : null
      const valB = priceB !== null ? Number(formatUnits(rB, decB)) * priceB : null

      if (valA !== null && valB !== null) tvlUsd = valA + valB
      else if (valA !== null) tvlUsd = valA * 2   // estimate both sides
      else if (valB !== null) tvlUsd = valB * 2
    }

    return {
      address: pool.address,
      tvlUsd,
      votesWei: votes,
      votesFormatted: votes > 0n ? parseFloat(formatUnits(votes, 18)).toFixed(2) : '0',
    }
  })
}

// Dynamically-discovered pools (anyone's Create Pool, or a launchpad-created
// token) previously always showed tvlUsd: null -- "no indexing yet" was a
// deliberate scope cut, not a bug, but it reads as "this pool is empty/dead"
// even when it has real reserves (confirmed: a launched ACAT/WETH pool with
// real 0.001 WETH + 800M ACAT showed "$—" everywhere purely because nothing
// ever queried its reserves). Same reserves-based TVL derivation as
// usePoolStats above, just built from DiscoveredPool's own real addresses
// instead of a TOKENS symbol lookup (the non-WETH/AEON/etc side of a
// launchpad pool has no known price of its own, so this only ever prices
// off whichever side IS a known token -- same "valA*2 estimate" fallback
// already used for every static pool). Volume/fees/APR still aren't indexed
// for these (needs event-log scanning keyed off a known pool address ahead
// of time) -- that's the next gap if it's ever worth closing.
export function useDiscoveredPoolStats(discovered: DiscoveredPool[], prices: PriceMap): PoolStat[] {
  const contracts = discovered.flatMap(p => ([
    { address: p.address, abi: PAIR_ABI, functionName: 'getReserves' } as const,
  ]))
  const { data } = useReadContracts({ contracts, query: { enabled: discovered.length > 0, refetchInterval: 30000 } })

  return discovered.map((pool, i) => {
    const reserves = data?.[i]?.status === 'success' ? data[i].result as readonly [bigint, bigint, number] : undefined
    let tvlUsd: number | null = null

    if (reserves) {
      // token0Address/token1Address are already the real on-chain
      // token0()/token1() (see useAllPools) -- no reordering needed, unlike
      // usePoolStats above where the static TOKENS entry's declared order
      // has to be checked against the pool's actual on-chain order.
      const [rA, rB] = reserves

      const priceA = prices[pool.token0] ?? null
      const priceB = prices[pool.token1] ?? null
      const decA = TOKENS[pool.token0 as keyof typeof TOKENS]?.decimals ?? 18
      const decB = TOKENS[pool.token1 as keyof typeof TOKENS]?.decimals ?? 18

      const valA = priceA !== null ? Number(formatUnits(rA, decA)) * priceA : null
      const valB = priceB !== null ? Number(formatUnits(rB, decB)) * priceB : null

      if (valA !== null && valB !== null) tvlUsd = valA + valB
      else if (valA !== null) tvlUsd = valA * 2
      else if (valB !== null) tvlUsd = valB * 2
    }

    return { address: pool.address, tvlUsd, votesWei: 0n, votesFormatted: '0' }
  })
}

// CL and DLMM pools ARE now vote-directed, but through the
// MultiGaugeController (epoch-scoped `weights[epoch][pool]`), NOT the legacy
// AeonVoter that vAMM pools use. This reads the controller's current-epoch
// weight for a list of pools so the "Votes" column shows the real veAEON
// backing a CL/DLMM gauge instead of a hardcoded 0. currentEpoch() must be
// read first, so the per-pool weight reads are gated on it.
function useControllerWeights(pools: readonly { address: `0x${string}` }[]): Record<string, bigint> {
  const { data: epoch } = useReadContract({
    address: CONTRACTS.MultiGaugeController,
    abi: MULTI_GAUGE_CONTROLLER_ABI,
    functionName: 'currentEpoch',
    query: { refetchInterval: 30000 },
  })
  const { data } = useReadContracts({
    contracts: pools.map(p => ({
      address: CONTRACTS.MultiGaugeController,
      abi: MULTI_GAUGE_CONTROLLER_ABI,
      functionName: 'weights' as const,
      args: [epoch as bigint, p.address] as const,
    })),
    query: { enabled: epoch !== undefined && pools.length > 0, refetchInterval: 30000 },
  })
  const out: Record<string, bigint> = {}
  pools.forEach((p, i) => {
    out[p.address.toLowerCase()] = data?.[i]?.status === 'success' ? (data[i].result as bigint) : 0n
  })
  return out
}

// CL pools don't have vAMM-style getReserves() — every deposited token just
// sits in the pool contract regardless of tick range, so token0/token1
// balanceOf(pool) gives an exact TVL directly.
const CL_POOL_STAT_CONTRACTS = CL_POOLS.flatMap(p => ([
  { address: p.address, abi: PAIR_ABI, functionName: 'token0' } as const,
  { address: TOKENS[p.token0 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
  { address: TOKENS[p.token1 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
]))

export function useClPoolStats(prices: PriceMap): PoolStat[] {
  const { data } = useReadContracts({ contracts: CL_POOL_STAT_CONTRACTS, query: { refetchInterval: 30000 } })
  const weights = useControllerWeights(CL_POOLS)

  return CL_POOLS.map((pool, i) => {
    const base = i * 3
    const onChainToken0 = data?.[base]?.status === 'success' ? data[base].result as string : undefined
    const balA = data?.[base + 1]?.status === 'success' ? data[base + 1].result as bigint : undefined
    const balB = data?.[base + 2]?.status === 'success' ? data[base + 2].result as bigint : undefined

    let tvlUsd: number | null = null
    if (onChainToken0 && balA !== undefined && balB !== undefined) {
      const priceA = prices[pool.token0] ?? null
      const priceB = prices[pool.token1] ?? null
      const decA = TOKENS[pool.token0 as keyof typeof TOKENS]?.decimals ?? 18
      const decB = TOKENS[pool.token1 as keyof typeof TOKENS]?.decimals ?? 18

      const valA = priceA !== null ? Number(formatUnits(balA, decA)) * priceA : null
      const valB = priceB !== null ? Number(formatUnits(balB, decB)) * priceB : null

      if (valA !== null && valB !== null) tvlUsd = valA + valB
      else if (valA !== null) tvlUsd = valA * 2
      else if (valB !== null) tvlUsd = valB * 2
    }

    const votes = weights[pool.address.toLowerCase()] ?? 0n
    return { address: pool.address, tvlUsd, votesWei: votes, votesFormatted: votes > 0n ? parseFloat(formatUnits(votes, 18)).toFixed(2) : '0' }
  })
}

// DLMM pairs also just hold both tokens directly (spread across bins), and
// token0/token1 in DLMM_POOLS already match on-chain tokenX/tokenY exactly
// (Liquidity Book doesn't sort by address), so no ordering flip is needed.
const DLMM_POOL_STAT_CONTRACTS = DLMM_POOLS.flatMap(p => ([
  { address: TOKENS[p.token0 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
  { address: TOKENS[p.token1 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
]))

export function useDlmmPoolStats(prices: PriceMap): PoolStat[] {
  const { data } = useReadContracts({ contracts: DLMM_POOL_STAT_CONTRACTS, query: { refetchInterval: 30000 } })
  const weights = useControllerWeights(DLMM_POOLS)

  return DLMM_POOLS.map((pool, i) => {
    const base = i * 2
    const balX = data?.[base]?.status === 'success' ? data[base].result as bigint : undefined
    const balY = data?.[base + 1]?.status === 'success' ? data[base + 1].result as bigint : undefined

    let tvlUsd: number | null = null
    if (balX !== undefined && balY !== undefined) {
      const priceX = prices[pool.token0] ?? null
      const priceY = prices[pool.token1] ?? null
      const decX = TOKENS[pool.token0 as keyof typeof TOKENS]?.decimals ?? 18
      const decY = TOKENS[pool.token1 as keyof typeof TOKENS]?.decimals ?? 18

      const valX = priceX !== null ? Number(formatUnits(balX, decX)) * priceX : null
      const valY = priceY !== null ? Number(formatUnits(balY, decY)) * priceY : null

      if (valX !== null && valY !== null) tvlUsd = valX + valY
      else if (valX !== null) tvlUsd = valX * 2
      else if (valY !== null) tvlUsd = valY * 2
    }

    const votes = weights[pool.address.toLowerCase()] ?? 0n
    return { address: pool.address, tvlUsd, votesWei: votes, votesFormatted: votes > 0n ? parseFloat(formatUnits(votes, 18)).toFixed(2) : '0' }
  })
}

export function useTotalTVL(stats: PoolStat[]): number {
  // Sum unique pool TVLs (de-dup by address since some pools appear multiple times)
  const seen = new Set<string>()
  let total = 0
  for (const s of stats) {
    if (!seen.has(s.address) && s.tvlUsd !== null) {
      total += s.tvlUsd
      seen.add(s.address)
    }
  }
  return total
}
