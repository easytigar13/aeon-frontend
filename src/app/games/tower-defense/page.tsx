'use client'
import { useState, useEffect, useCallback } from 'react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSignMessage } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, maxUint256, decodeEventLog } from 'viem'
import { CONTRACTS, TOKENS } from '@/config/contracts'
import { TOWER_DEFENSE_ARENA_ABI, ERC20_ABI } from '@/config/abis'
import { TowerDefenseCanvas, GameEndResult } from '@/components/games/TowerDefenseCanvas'
import { MAPS } from '@/lib/towerDefense/maps'
import { DIFFICULTY_LABEL, DIFFICULTY_ORDER, DIFFICULTY_INDEX, DIFFICULTY_TOTAL_WAVES, REWARD_FOR_WIN } from '@/lib/towerDefense/enemies'
import { Difficulty } from '@/lib/towerDefense/types'
import { Loader2 } from 'lucide-react'

type Mode = 'practice' | 'staked'
type Phase = 'setup' | 'playing' | 'result'
type StakedStep = 'idle' | 'approve' | 'approve_wait' | 'starting' | 'start_wait' | 'claiming' | 'claim_wait' | 'done'

export default function TowerDefensePage() {
  const { address, isConnected: _isConnected } = useAccount()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [mode, setMode] = useState<Mode>('practice')
  const [mapId, setMapId] = useState(MAPS[0].id)
  const [difficulty, setDifficulty] = useState<Difficulty>('normal')
  const [phase, setPhase] = useState<Phase>('setup')
  const [sessionId, setSessionId] = useState<bigint | null>(null)
  const [stakedStep, setStakedStep] = useState<StakedStep>('idle')
  const [result, setResult] = useState<GameEndResult | null>(null)
  const [claimedReward, setClaimedReward] = useState<bigint | null>(null)
  const [errMsg, setErrMsg] = useState('')

  const entryFeeQuery = useReadContract({ address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'entryFee' })
  const entryFee = entryFeeQuery.data ?? 0n

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: TOKENS.AEON.address, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, CONTRACTS.TowerDefenseArena] : undefined,
    query: { enabled: !!address },
  })

  const { writeContract: writeApprove, data: approveHash, error: approveError } = useWriteContract()
  const { writeContract: writeStart,   data: startHash,   error: startError }   = useWriteContract()
  const { writeContract: writeClaim,   data: claimHash,   error: claimTxError } = useWriteContract()
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveHash })
  const { data: startReceipt, isSuccess: startSuccess } = useWaitForTransactionReceipt({ hash: startHash })
  const { isSuccess: claimSuccess } = useWaitForTransactionReceipt({ hash: claimHash })
  const { signMessageAsync } = useSignMessage()

  const needsApproval = mode === 'staked' && entryFee > 0n && allowance !== undefined && allowance < entryFee

  function beginStaked() {
    if (!address) return
    setErrMsg('')
    if (needsApproval) {
      setStakedStep('approve')
      writeApprove({ address: TOKENS.AEON.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.TowerDefenseArena, maxUint256] })
      setStakedStep('approve_wait')
    } else {
      setStakedStep('starting')
      writeStart({ address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'startSession', args: [DIFFICULTY_INDEX[difficulty]] })
      setStakedStep('start_wait')
    }
  }

  useEffect(() => {
    if (!approveSuccess) return
    refetchAllowance().then(() => {
      setStakedStep('starting')
      writeStart({ address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'startSession', args: [DIFFICULTY_INDEX[difficulty]] })
      setStakedStep('start_wait')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveSuccess])

  useEffect(() => {
    if (!startSuccess || !startReceipt) return
    for (const log of startReceipt.logs) {
      if (log.address.toLowerCase() !== CONTRACTS.TowerDefenseArena.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: TOWER_DEFENSE_ARENA_ABI, eventName: 'SessionStarted', data: log.data, topics: log.topics })
        setSessionId(decoded.args.sessionId as bigint)
      } catch { /* not the event we're looking for */ }
    }
    setStakedStep('idle')
    setPhase('playing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSuccess, startReceipt])

  useEffect(() => { if (approveError) { setErrMsg(approveError.message); setStakedStep('idle') } }, [approveError])
  useEffect(() => { if (startError)   { setErrMsg(startError.message);   setStakedStep('idle') } }, [startError])
  useEffect(() => { if (claimTxError) { setErrMsg(claimTxError.message); setStakedStep('idle') } }, [claimTxError])
  useEffect(() => { if (claimSuccess) setStakedStep('done') }, [claimSuccess])

  const handleGameEnd = useCallback((r: GameEndResult) => {
    setResult(r)
    setPhase('result')
  }, [])

  async function claimReward() {
    if (!address || sessionId === null || !result) return
    setErrMsg('')
    setStakedStep('claiming')
    try {
      const proof = await signMessageAsync({ message: `Claim Tower Defense reward for session ${sessionId.toString()}` })
      const res = await fetch('/api/games/tower-defense/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.toString(),
          player: address,
          wavesReached: result.waveReached,
          elapsedSeconds: Math.floor(result.elapsedSeconds),
          proof,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Claim rejected')
      setClaimedReward(BigInt(body.rewardAmount))
      writeClaim({
        address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'claimReward',
        args: [sessionId, BigInt(body.rewardAmount), body.signature],
      })
      setStakedStep('claim_wait')
    } catch (e: any) {
      setErrMsg(e?.message ?? 'Claim failed')
      setStakedStep('idle')
    }
  }

  function playAgain() {
    setPhase('setup')
    setResult(null)
    setSessionId(null)
    setClaimedReward(null)
    setStakedStep('idle')
    setErrMsg('')
  }

  const feeFormatted = formatUnits(entryFee, TOKENS.AEON.decimals)
  const busy = stakedStep !== 'idle' && stakedStep !== 'done'

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="mb-6">
        <h1 className="font-display font-bold text-2xl text-text-primary">Tower Defense</h1>
        <p className="text-sm text-text-muted mt-0.5">Defend the base. Place towers, survive every wave.</p>
      </div>

      {phase === 'setup' && (
        <div className="card p-5 space-y-5">
          {/* Mode */}
          <div>
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Mode</div>
            <div className="flex gap-2">
              <button onClick={() => setMode('practice')} className={clsx('flex-1 px-4 py-3 rounded-xl border text-left transition-all', mode === 'practice' ? 'border-aeon-400/60 bg-aeon-400/5' : 'border-bg-border hover:border-bg-hover')}>
                <div className="font-semibold text-sm text-text-primary">Practice</div>
                <div className="text-2xs text-text-muted mt-0.5">Free. No wallet, no rewards.</div>
              </button>
              <button onClick={() => setMode('staked')} className={clsx('flex-1 px-4 py-3 rounded-xl border text-left transition-all', mode === 'staked' ? 'border-aeon-400/60 bg-aeon-400/5' : 'border-bg-border hover:border-bg-hover')}>
                <div className="font-semibold text-sm text-text-primary">Staked</div>
                <div className="text-2xs text-text-muted mt-0.5">Pay {feeFormatted} AEON. Win to earn real AEON.</div>
              </button>
            </div>
          </div>

          {/* Map */}
          <div>
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Map</div>
            <div className="flex gap-2">
              {MAPS.map(m => (
                <button key={m.id} onClick={() => setMapId(m.id)} className={clsx('px-4 py-2 rounded-lg border text-sm transition-all', mapId === m.id ? 'border-aeon-400/60 text-aeon-400 bg-aeon-400/5' : 'border-bg-border text-text-secondary hover:border-bg-hover')}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Difficulty</div>
            <div className="flex gap-2">
              {DIFFICULTY_ORDER.map(d => (
                <button key={d} onClick={() => setDifficulty(d)} className={clsx('flex-1 px-3 py-2.5 rounded-lg border text-left transition-all', difficulty === d ? 'border-aeon-400/60 bg-aeon-400/5' : 'border-bg-border hover:border-bg-hover')}>
                  <div className="text-sm font-semibold text-text-primary">{DIFFICULTY_LABEL[d]}</div>
                  <div className="text-2xs text-text-muted">{DIFFICULTY_TOTAL_WAVES[d]} waves{mode === 'staked' ? ` · win pays ${REWARD_FOR_WIN[d]} AEON` : ''}</div>
                </button>
              ))}
            </div>
          </div>

          {errMsg && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>}

          {mode === 'staked' && !isConnected && (
            <button onClick={() => openConnectModal?.()} className="btn-primary w-full py-3">Connect Wallet to Stake</button>
          )}
          {mode === 'staked' && isConnected && (
            <button onClick={beginStaked} disabled={busy} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {stakedStep === 'approve_wait' ? `Approving AEON…` : stakedStep === 'start_wait' ? 'Starting session…' : `Pay ${feeFormatted} AEON & Start`}
            </button>
          )}
          {mode === 'practice' && (
            <button onClick={() => setPhase('playing')} className="btn-primary w-full py-3">Start Practice Run</button>
          )}
        </div>
      )}

      {phase === 'playing' && (
        <TowerDefenseCanvas mapId={mapId} difficulty={difficulty} onGameEnd={handleGameEnd} />
      )}

      {phase === 'result' && result && (
        <div className="card p-6 text-center space-y-4">
          <div>
            <div className={clsx('font-display font-bold text-3xl mb-1', result.status === 'won' ? 'text-aeon-400' : 'text-red-400')}>
              {result.status === 'won' ? 'Victory!' : 'Defeated'}
            </div>
            <div className="text-text-secondary text-sm">Reached wave {result.waveReached} / {result.totalWaves}</div>
          </div>

          {errMsg && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all text-left">{errMsg}</div>}

          {mode === 'staked' && result.status === 'won' && sessionId !== null && stakedStep !== 'done' && (
            <button onClick={claimReward} disabled={busy} className="btn-primary px-6 py-3 flex items-center justify-center gap-2 mx-auto disabled:opacity-50">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {stakedStep === 'claiming' ? 'Verifying win…' : stakedStep === 'claim_wait' ? 'Claiming…' : 'Claim AEON Reward'}
            </button>
          )}
          {mode === 'staked' && result.status === 'lost' && (
            <div className="text-xs text-text-muted">No reward for this session — the entry fee stays in the prize pool for future winners.</div>
          )}
          {stakedStep === 'done' && claimedReward !== null && (
            <div className="text-emerald-400 font-mono text-sm">✓ Claimed {formatUnits(claimedReward, TOKENS.AEON.decimals)} AEON</div>
          )}

          <button onClick={playAgain} className="btn-ghost px-6 py-2 text-sm">Back to Setup</button>
        </div>
      )}
    </div>
  )
}
