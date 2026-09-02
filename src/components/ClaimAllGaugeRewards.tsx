'use client'

import { useState } from 'react'
import { Coins, Loader2, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CL_GAUGES, DLMM_GAUGES, LEGACY_GAUGES, CONTRACTS } from '@/config/contracts'
import { VOTER_ABI, GAUGE_ABI, CL_GAUGE_ABI, DLMM_GAUGE_ABI } from '@/config/abis'

const ZERO = '0x0000000000000000000000000000000000000000'

export function ClaimAllGaugeRewards() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [claiming, setClaiming] = useState(false)
  const [claimStatus, setClaimStatus] = useState<string>('')
  const [success, setSuccess] = useState(false)

  // 1. vAMM gauges
  const { data: vammGaugeData } = useReadContracts({
    contracts: POOLS.map(p => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges' as const, args: [p.address as `0x${string}`],
    })),
    query: { enabled: !!address },
  })
  const vammGauges = (vammGaugeData ?? [])
    .map(r => (r.status === 'success' ? (r.result as `0x${string}`) : null))
    .filter((g): g is `0x${string}` => !!g && g.toLowerCase() !== ZERO)

  // 2. Query earned(address) on all gauges
  const legacyGauges = LEGACY_GAUGES.map(g => g.gauge)
  const clGauges = Object.values(CL_GAUGES)
  const dlmmGauges = Object.values(DLMM_GAUGES)

  const { data: vammEarned, refetch: refetchVamm } = useReadContracts({
    contracts: vammGauges.map(g => ({ address: g, abi: GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] })),
    query: { enabled: !!address && vammGauges.length > 0 },
  })

  const { data: legacyEarned, refetch: refetchLegacy } = useReadContracts({
    contracts: legacyGauges.map(g => ({ address: g, abi: GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] })),
    query: { enabled: !!address },
  })

  const { data: clEarned, refetch: refetchCl } = useReadContracts({
    contracts: clGauges.map(g => ({ address: g, abi: CL_GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] })),
    query: { enabled: !!address },
  })

  const { data: dlmmEarned, refetch: refetchDlmm } = useReadContracts({
    contracts: dlmmGauges.map(g => ({ address: g, abi: DLMM_GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] })),
    query: { enabled: !!address },
  })

  // Collect gauges with earned > 0
  const claimableTargets: { address: `0x${string}`; abi: any; earnedWei: bigint }[] = []

  vammGauges.forEach((g, i) => {
    const r = vammEarned?.[i]
    if (r && r.status === 'success' && (r.result as bigint) > 0n) {
      claimableTargets.push({ address: g, abi: GAUGE_ABI, earnedWei: r.result as bigint })
    }
  })

  legacyGauges.forEach((g, i) => {
    const r = legacyEarned?.[i]
    if (r && r.status === 'success' && (r.result as bigint) > 0n) {
      claimableTargets.push({ address: g as `0x${string}`, abi: GAUGE_ABI, earnedWei: r.result as bigint })
    }
  })

  clGauges.forEach((g, i) => {
    const r = clEarned?.[i]
    if (r && r.status === 'success' && (r.result as bigint) > 0n) {
      claimableTargets.push({ address: g as `0x${string}`, abi: CL_GAUGE_ABI, earnedWei: r.result as bigint })
    }
  })

  dlmmGauges.forEach((g, i) => {
    const r = dlmmEarned?.[i]
    if (r && r.status === 'success' && (r.result as bigint) > 0n) {
      claimableTargets.push({ address: g as `0x${string}`, abi: DLMM_GAUGE_ABI, earnedWei: r.result as bigint })
    }
  })

  const totalClaimableWei = claimableTargets.reduce((s, t) => s + t.earnedWei, 0n)
  const totalClaimableAeon = parseFloat(formatUnits(totalClaimableWei, 18))

  async function handleClaimAll() {
    if (!address || claimableTargets.length === 0 || claiming) return
    setClaiming(true)
    setSuccess(false)
    setClaimStatus(`Claiming rewards from ${claimableTargets.length} gauge(s)...`)

    try {
      for (let i = 0; i < claimableTargets.length; i++) {
        const t = claimableTargets[i]
        setClaimStatus(`Claiming ${i + 1}/${claimableTargets.length} (${t.address.slice(0, 6)}...)...`)
        const hash = await writeContractAsync({
          address: t.address,
          abi: t.abi,
          functionName: 'getReward',
          args: [address],
        })
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash })
        }
      }

      setClaimStatus('All gauge rewards claimed successfully!')
      setSuccess(true)
      refetchVamm()
      refetchLegacy()
      refetchCl()
      refetchDlmm()
    } catch (e: any) {
      setClaimStatus(`Claim failed: ${e?.shortMessage || e?.message || String(e)}`)
    } finally {
      setClaiming(false)
    }
  }

  if (!address || totalClaimableAeon <= 0) return null

  return (
    <div className="card p-4 bg-gradient-to-r from-aeon-400/10 via-violet-500/10 to-emerald-500/10 border border-aeon-400/30 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-aeon-400/20 border border-aeon-400/40 flex items-center justify-center text-aeon-400 shrink-0">
          <Coins size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-lg text-text-primary">
              {totalClaimableAeon.toFixed(4)} AEON
            </span>
            <span className="text-2xs font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              {claimableTargets.length} Active Gauges
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Unclaimed AEON emissions ready in your staked gauges
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        {claimStatus && (
          <span className="text-2xs font-mono text-text-muted truncate max-w-[200px]">
            {claimStatus}
          </span>
        )}
        <button
          onClick={handleClaimAll}
          disabled={claiming}
          className="btn-primary w-full sm:w-auto text-sm py-2.5 px-5 flex items-center justify-center gap-2 shrink-0"
        >
          {claiming ? (
            <Loader2 size={16} className="animate-spin" />
          ) : success ? (
            <CheckCircle2 size={16} className="text-emerald-400" />
          ) : (
            <Coins size={16} />
          )}
          {claiming ? 'Claiming All...' : success ? 'Claimed!' : 'Claim All Rewards'}
        </button>
      </div>
    </div>
  )
}
