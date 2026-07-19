'use client'
import { useEffect, useState } from 'react'
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits } from 'viem'
import { LEGACY_GAUGES } from '@/config/contracts'
import { TokenIcon } from '@/components/TokenIcon'
import { Loader2, AlertTriangle } from 'lucide-react'

const ZERO = '0x0000000000000000000000000000000000000000' as const

// Standard AeonGauge interface (confirmed on the deployed old gauges):
// withdraw(uint256) pulls your LP back; getReward(address) claims any rewards.
const LEGACY_GAUGE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'earned',    type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'withdraw',  type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'getReward', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'account', type: 'address' }], outputs: [] },
] as const

export function LegacyPositions() {
  const { address } = useAccount()
  const [acting, setActing] = useState<string | null>(null) // `${gauge}:${action}`

  const { data, refetch } = useReadContracts({
    contracts: LEGACY_GAUGES.flatMap(g => ([
      { address: g.gauge, abi: LEGACY_GAUGE_ABI, functionName: 'balanceOf' as const, args: [address ?? ZERO] },
      { address: g.gauge, abi: LEGACY_GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] },
    ])),
    query: { enabled: !!address, refetchInterval: 30000 },
  })

  const positions = LEGACY_GAUGES
    .map((g, i) => {
      const staked = data?.[i * 2]?.status === 'success' ? (data[i * 2].result as bigint) : 0n
      const earned = data?.[i * 2 + 1]?.status === 'success' ? (data[i * 2 + 1].result as bigint) : 0n
      return { ...g, staked, earned }
    })
    .filter(p => p.staked > 0n)

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } })

  useEffect(() => { if (isSuccess) { refetch(); setActing(null) } }, [isSuccess, refetch])
  useEffect(() => { if (error) setActing(null) }, [error])

  const busy = isPending || isConfirming

  if (!address || positions.length === 0) return null

  return (
    <div>
      <div className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-2">
        <AlertTriangle size={13} /> Migrated / Legacy Staked Positions
      </div>
      <div className="text-2xs text-text-muted mb-3">
        LP you staked before the voter migration is safe but sits in old (orphaned) gauges that no longer emit.
        Unstake to recover your LP, then re-stake it in the current gauge on the <span className="text-aeon-400">Earn</span> tab to earn emissions again.
      </div>
      <div className="space-y-2">
        {positions.map(p => {
          const stakedFmt = parseFloat(formatUnits(p.staked, 18))
          const earnedFmt = parseFloat(formatUnits(p.earned, 18))
          const isActing = (a: string) => acting === `${p.gauge}:${a}`
          return (
            <div key={p.gauge} className="card px-4 py-3 flex items-center justify-between gap-3 border-amber-500/20">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex -space-x-2 shrink-0">
                  <TokenIcon symbol={p.token0} size={36} />
                  <TokenIcon symbol={p.token1} size={36} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary">{p.token0}/{p.token1}</div>
                  <div className="text-2xs font-mono text-text-muted truncate">
                    {stakedFmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} LP staked (old gauge)
                    {earnedFmt > 0.000001 ? ` · ${earnedFmt.toFixed(4)} AEON claimable` : ''}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.earned > 0n && (
                  <button
                    onClick={() => { setActing(`${p.gauge}:claim`); writeContract({ address: p.gauge, abi: LEGACY_GAUGE_ABI, functionName: 'getReward', args: [address], gas: 400_000n }) }}
                    disabled={busy}
                    className="text-2xs font-mono text-emerald-400 border border-emerald-800/50 rounded px-2 py-1 hover:bg-emerald-400/10 disabled:opacity-50"
                  >
                    {isActing('claim') && busy ? <Loader2 size={12} className="animate-spin" /> : 'Claim'}
                  </button>
                )}
                <button
                  onClick={() => { setActing(`${p.gauge}:unstake`); writeContract({ address: p.gauge, abi: LEGACY_GAUGE_ABI, functionName: 'withdraw', args: [p.staked], gas: 600_000n }) }}
                  disabled={busy}
                  className="text-2xs font-mono text-aeon-400 border border-aeon-800/50 rounded px-2 py-1 hover:bg-aeon-400/10 disabled:opacity-50"
                >
                  {isActing('unstake') && busy ? <Loader2 size={12} className="animate-spin" /> : 'Unstake'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className="text-2xs text-red-400 mt-2 font-mono">{error.message.slice(0, 160)}</div>}
    </div>
  )
}
