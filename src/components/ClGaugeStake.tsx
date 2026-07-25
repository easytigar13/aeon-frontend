'use client'

// CL gauge staking panel for a single pool. Extracted from the Portfolio/Earn
// page (2026-07-24) so staking lives on the Liquidity page next to the pool it
// belongs to, instead of buried under Portfolio > My Positions.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits } from 'viem'
import { CL_POOLS, CL_GAUGES, ALGEBRA_CONTRACTS, TOKENS } from '@/config/contracts'
import { CL_GAUGE_ABI, ERC721_APPROVE_ABI } from '@/config/abis'
import { useClPositions } from '@/hooks/useClPositions'
import { TokenIcon } from '@/components/TokenIcon'

type GaugeStep = 'idle' | 'approving' | 'approve_wait' | 'staking' | 'stake_wait' | 'unstaking' | 'unstake_wait' | 'claiming' | 'claim_wait'

export function ClGaugeRow({ pool, wallet, defaultOpen = false }: { pool: typeof CL_POOLS[number]; wallet?: `0x${string}`; defaultOpen?: boolean }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [step, setStep] = useState<GaugeStep>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [activeTokenId, setActiveTokenId] = useState<bigint | null>(null)

  const gauge = CL_GAUGES[pool.address]
  const t0Addr = TOKENS[pool.token0 as keyof typeof TOKENS].address.toLowerCase()
  const t1Addr = TOKENS[pool.token1 as keyof typeof TOKENS].address.toLowerCase()

  const { positions: myPositions, refetch: refetchPositions } = useClPositions(wallet)
  const poolPositions = myPositions.filter(p => {
    const pt0 = p.token0.toLowerCase(), pt1 = p.token1.toLowerCase()
    return (pt0 === t0Addr && pt1 === t1Addr) || (pt0 === t1Addr && pt1 === t0Addr)
  })

  const { data: stakedIdsRaw, refetch: refetchStakedIds } = useReadContract({
    address: gauge, abi: CL_GAUGE_ABI, functionName: 'getStakedTokenIds',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet && expanded },
  })
  const stakedIds = (stakedIdsRaw as readonly bigint[] | undefined) ?? []

  const { data: stakedLiqRaw } = useReadContracts({
    contracts: stakedIds.map(id => ({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'stakedLiquidity' as const, args: [id] as const })),
    query: { enabled: stakedIds.length > 0 },
  })
  const stakedPositions = stakedIds.map((id, i) => ({
    id,
    liquidity: stakedLiqRaw?.[i]?.status === 'success' ? stakedLiqRaw[i].result as bigint : 0n,
  }))

  const { data: earnedRaw, refetch: refetchEarned } = useReadContract({
    address: gauge, abi: CL_GAUGE_ABI, functionName: 'earned',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet, refetchInterval: 15000 },
  })
  const earned = (earnedRaw as bigint | undefined) ?? 0n
  const earnedFormatted = earned > 0n ? parseFloat(formatUnits(earned, 18)).toFixed(4) : '0'

  const { data: rewardRateRaw } = useReadContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'rewardRate', query: { refetchInterval: 60000 } })
  const { data: periodFinishRaw } = useReadContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'periodFinish' })
  const rewardRate = (rewardRateRaw as bigint | undefined) ?? 0n
  const periodFinish = (periodFinishRaw as bigint | undefined) ?? 0n
  const isEmitting = periodFinish > BigInt(Math.floor(Date.now() / 1000))

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchPositions(); refetchStakedIds(); refetchEarned()
    if (step === 'approve_wait') { setStep('staking'); return }
    if (['stake_wait', 'unstake_wait', 'claim_wait'].includes(step)) { setStep('idle'); setActiveTokenId(null); return }
  }, [txSuccess])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving' && activeTokenId !== null) {
      writeContract({ address: ALGEBRA_CONTRACTS.nonfungiblePositionManager, abi: ERC721_APPROVE_ABI, functionName: 'approve', args: [gauge, activeTokenId] })
      setStep('approve_wait')
    }
    if (step === 'staking' && activeTokenId !== null) {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'stake', args: [activeTokenId] })
      setStep('stake_wait')
    }
    if (step === 'unstaking' && activeTokenId !== null) {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'withdraw', args: [activeTokenId] })
      setStep('unstake_wait')
    }
    if (step === 'claiming') {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'getReward', args: [] })
      setStep('claim_wait')
    }
  }, [step])

  const isBusy = step !== 'idle'

  function handleStake(tokenId: bigint) { setActiveTokenId(tokenId); setStep('approving') }
  function handleUnstake(tokenId: bigint) { setActiveTokenId(tokenId); setStep('unstaking') }

  if (!gauge) return null

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      <button className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left" onClick={() => setExpanded(!expanded)}>
        <div className="col-span-4 flex items-center gap-2">
          <div className="flex -space-x-1">
            <TokenIcon symbol={pool.token0} size={28} />
            <TokenIcon symbol={pool.token1} size={28} />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary">{pool.name}</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-2xs font-mono font-bold text-violet-400">CL</span>
              <span className="text-2xs text-text-muted">· {pool.fee}</span>
            </div>
          </div>
        </div>
        <div className="col-span-3">
          <div className="text-sm font-mono text-text-secondary">{poolPositions.length} unstaked · {stakedIds.length} staked</div>
          <div className="text-2xs text-text-muted">Your positions</div>
        </div>
        <div className="col-span-3">
          <div className={clsx('text-sm font-mono', isEmitting ? 'text-aeon-400 font-bold' : 'text-text-muted')}>{isEmitting ? 'Emitting' : 'No active rewards'}</div>
          <div className="text-2xs text-text-muted">Reward status</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border bg-bg-raised px-4 py-4 space-y-3">
          {!wallet ? (
            <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
          ) : (
            <>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider">Unstaked positions</div>
              {poolPositions.length === 0 && <div className="text-xs text-text-muted">None — add liquidity above first, then stake it here.</div>}
              {poolPositions.map(p => (
                <div key={p.tokenId.toString()} className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                  <span className="text-xs font-mono text-text-secondary">#{p.tokenId.toString()} · liquidity {p.liquidity.toString()}</span>
                  <button
                    disabled={isBusy && activeTokenId === p.tokenId}
                    onClick={() => handleStake(p.tokenId)}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1"
                  >
                    {isBusy && activeTokenId === p.tokenId && <Loader2 size={11} className="animate-spin" />}
                    {isBusy && activeTokenId === p.tokenId ? (step === 'approving' || step === 'approve_wait' ? 'Approving…' : 'Staking…') : 'Stake'}
                  </button>
                </div>
              ))}

              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider pt-2">Staked positions</div>
              {stakedPositions.length === 0 && <div className="text-xs text-text-muted">None yet.</div>}
              {stakedPositions.map(p => (
                <div key={p.id.toString()} className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                  <span className="text-xs font-mono text-text-secondary">#{p.id.toString()} · liquidity {p.liquidity.toString()}</span>
                  <button
                    disabled={isBusy && activeTokenId === p.id}
                    onClick={() => handleUnstake(p.id)}
                    className="btn-ghost text-xs py-1.5 px-3 border border-bg-border disabled:opacity-40 flex items-center gap-1"
                  >
                    {isBusy && activeTokenId === p.id && <Loader2 size={11} className="animate-spin" />}
                    Unstake
                  </button>
                </div>
              ))}

              <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl mt-2">
                <span className="text-sm text-text-muted">Claimable AEON</span>
                <div className="flex items-center gap-2">
                  <span className={clsx('font-mono font-bold text-sm', earned > 0n ? 'text-aeon-400' : 'text-text-muted')}>{earnedFormatted} AEON</span>
                  <button disabled={earned === 0n || isBusy} onClick={() => setStep('claiming')} className="text-xs btn-ghost py-1 px-2 text-aeon-400 disabled:opacity-40 flex items-center gap-1">
                    {(step === 'claiming' || step === 'claim_wait') && <Loader2 size={10} className="animate-spin" />}
                    Claim
                  </button>
                </div>
              </div>

              {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
