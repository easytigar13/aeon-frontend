'use client'
import { useReadContracts } from 'wagmi'
import { DLMM_POOLS } from '@/config/contracts'
import { LB_PAIR_ABI } from '@/config/abis'

export const DLMM_BIN_SCAN_RADIUS = 60 // matches the widest range preset on /liquidity

export interface DlmmPosition {
  id: number
  balance: bigint
}

// Enumerates every bin (within DLMM_BIN_SCAN_RADIUS of the active bin) an
// address holds LB tokens in, for ONE pool. Call once per pool you care about
// (e.g. one component instance per DLMM_POOLS entry) rather than in a loop —
// the number of bins scanned is fixed per call, so this is a normal, stable
// hook call, just parameterized per pool.
export function useDlmmPositions(pool: typeof DLMM_POOLS[number], owner: `0x${string}` | undefined, activeId: number | undefined): { positions: DlmmPosition[]; refetch: () => void } {
  const ids = activeId !== undefined
    ? Array.from({ length: DLMM_BIN_SCAN_RADIUS * 2 + 1 }, (_, i) => activeId - DLMM_BIN_SCAN_RADIUS + i)
    : []

  const { data, refetch } = useReadContracts({
    contracts: ids.map(id => ({
      address: pool.address, abi: LB_PAIR_ABI, functionName: 'balanceOf' as const,
      args: owner ? [owner, BigInt(id)] as const : undefined,
    })),
    query: { enabled: !!owner && ids.length > 0, refetchInterval: 20000 },
  })

  const positions = ids
    .map((id, i) => {
      const r = data?.[i]
      const bal = r?.status === 'success' ? r.result as bigint : 0n
      return bal > 0n ? { id, balance: bal } : null
    })
    .filter((p): p is DlmmPosition => p !== null)

  return { positions, refetch }
}
