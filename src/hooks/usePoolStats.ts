'use client'
import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, TOKENS, CONTRACTS } from '@/config/contracts'
import { PAIR_ABI, VOTER_ABI, ERC20_ABI } from '@/config/abis'
import type { PriceMap } from './usePrices'

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

// CL pools don't have vAMM-style getReserves() — every deposited token just
// sits in the pool contract regardless of tick range, so token0/token1
// balanceOf(pool) gives an exact TVL directly (no gauge/vote weight yet;
// CL pools aren't wired into AeonVoterV2).
const CL_POOL_STAT_CONTRACTS = CL_POOLS.flatMap(p => ([
  { address: p.address, abi: PAIR_ABI, functionName: 'token0' } as const,
  { address: TOKENS[p.token0 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
  { address: TOKENS[p.token1 as keyof typeof TOKENS]?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [p.address] } as const,
]))

export function useClPoolStats(prices: PriceMap): PoolStat[] {
  const { data } = useReadContracts({ contracts: CL_POOL_STAT_CONTRACTS, query: { refetchInterval: 30000 } })

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

    return { address: pool.address, tvlUsd, votesWei: 0n, votesFormatted: '0' }
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

    return { address: pool.address, tvlUsd, votesWei: 0n, votesFormatted: '0' }
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
