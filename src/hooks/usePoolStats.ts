'use client'
import { useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, TOKENS, CONTRACTS } from '@/config/contracts'
import { PAIR_ABI, VOTER_ABI } from '@/config/abis'
import type { PriceMap } from './usePrices'

export interface PoolStat {
  address: string
  tvlUsd: number | null   // USD value of both reserves combined
  votesWei: bigint        // raw vote weight from Voter
  votesFormatted: string  // human-readable veAEON
}

export function usePoolStats(prices: PriceMap): PoolStat[] {
  const contracts: any[] = POOLS.flatMap(p => ([
    { address: p.address, abi: PAIR_ABI,  functionName: 'getReserves' },
    { address: p.address, abi: PAIR_ABI,  functionName: 'token0' },
    { address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'weights', args: [p.address] },
  ]))

  const { data } = useReadContracts({ contracts, query: { refetchInterval: 30000 } })

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
