'use client'
import { useReadContracts } from 'wagmi'
import { POOLS, CL_GAUGES, DLMM_GAUGES, CONTRACTS } from '@/config/contracts'
import { VOTER_ABI, GAUGE_ABI, CL_GAUGE_ABI, DLMM_GAUGE_ABI } from '@/config/abis'

const ZERO = '0x0000000000000000000000000000000000000000'

// Total claimable AEON emissions across a wallet's staked vAMM + CL + DLMM
// gauge positions. Every gauge pays rewards in AEON, so this collapses to a
// single AEON figure. earned() returns 0 (or reverts -> treated as 0) for
// gauges the wallet isn't staked in, so summing across all gauges is safe.
export function usePendingRewards(wallet?: `0x${string}`): { pendingAeon: number } {
  // 1. Resolve vAMM gauge addresses from the voter.
  const { data: vammGaugeData } = useReadContracts({
    contracts: POOLS.map(p => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges' as const, args: [p.address as `0x${string}`],
    })),
    query: { enabled: !!wallet, refetchInterval: 60000 },
  })
  const vammGauges = (vammGaugeData ?? [])
    .map(r => (r.status === 'success' ? (r.result as `0x${string}`) : null))
    .filter((g): g is `0x${string}` => !!g && g.toLowerCase() !== ZERO)

  // 2. earned(wallet) on every vAMM / CL / DLMM gauge (all batched via multicall).
  const { data: vammEarned } = useReadContracts({
    contracts: vammGauges.map(g => ({ address: g, abi: GAUGE_ABI, functionName: 'earned' as const, args: [wallet ?? ZERO] })),
    query: { enabled: !!wallet && vammGauges.length > 0, refetchInterval: 30000 },
  })
  const clGaugeList = Object.values(CL_GAUGES)
  const { data: clEarned } = useReadContracts({
    contracts: clGaugeList.map(g => ({ address: g, abi: CL_GAUGE_ABI, functionName: 'earned' as const, args: [wallet ?? ZERO] })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const dlmmGaugeList = Object.values(DLMM_GAUGES)
  const { data: dlmmEarned } = useReadContracts({
    contracts: dlmmGaugeList.map(g => ({ address: g, abi: DLMM_GAUGE_ABI, functionName: 'earned' as const, args: [wallet ?? ZERO] })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })

  const sumWei = (rows?: readonly { status: string; result?: unknown }[]) =>
    (rows ?? []).reduce((s, r) => s + (r.status === 'success' ? (r.result as bigint) : 0n), 0n)

  const totalWei = sumWei(vammEarned) + sumWei(clEarned) + sumWei(dlmmEarned)
  return { pendingAeon: Number(totalWei) / 1e18 }
}
