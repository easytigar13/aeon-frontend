'use client'
import { useState, useEffect } from 'react'
import { Lock, Flame, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { CONTRACTS, TOKENS } from '@/config/contracts'
import { VOTING_ESCROW_ABI, FURNACE_ABI, ERC20_ABI } from '@/config/abis'

type Tab = 'lock' | 'furnace' | 'manage'

const LOCK_DURATIONS = [
  { label: '1 Week',   days: 7,    multiplier: 0.003 },
  { label: '1 Month',  days: 30,   multiplier: 0.019 },
  { label: '6 Months', days: 182,  multiplier: 0.125 },
  { label: '1 Year',   days: 365,  multiplier: 0.250 },
  { label: '2 Years',  days: 730,  multiplier: 0.500 },
  { label: '4 Years',  days: 1461, multiplier: 1.000 },
]

export default function LockPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,           setTab]          = useState<Tab>('lock')
  const [lockAmount,    setLockAmount]    = useState('')
  const [lockDays,      setLockDays]      = useState(1461)
  const [burnAmount,    setBurnAmount]    = useState('')
  const [mergeFrom,     setMergeFrom]     = useState('')
  const [mergeTo,       setMergeTo]       = useState('')
  const [increaseId,    setIncreaseId]    = useState('')
  const [increaseAmt,   setIncreaseAmt]   = useState('')

  // AEON balance
  const { data: aeonBalance } = useReadContract({
    address: CONTRACTS.AeonToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const aeonFormatted = aeonBalance !== undefined
    ? parseFloat(formatUnits(aeonBalance, 18)).toFixed(4)
    : '—'

  // Allowance for VotingEscrow
  const { data: veAllowance, refetch: refetchVeAllowance } = useReadContract({
    address: CONTRACTS.AeonToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.AeonVotingEscrow] : undefined,
    query: { enabled: !!address },
  })

  // Allowance for Furnace
  const { data: furnaceAllowance, refetch: refetchFurnaceAllowance } = useReadContract({
    address: CONTRACTS.AeonToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.TheFurnace] : undefined,
    query: { enabled: !!address },
  })

  // Furnace position
  const { data: furnaceTokenId } = useReadContract({
    address: CONTRACTS.TheFurnace,
    abi: FURNACE_ABI,
    functionName: 'addressToTokenId',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
  const { data: furnaceBurned } = useReadContract({
    address: CONTRACTS.TheFurnace,
    abi: FURNACE_ABI,
    functionName: 'burnedByToken',
    args: furnaceTokenId ? [furnaceTokenId] : undefined,
    query: { enabled: !!furnaceTokenId },
  })
  const { data: furnaceEarned } = useReadContract({
    address: CONTRACTS.TheFurnace,
    abi: FURNACE_ABI,
    functionName: 'earned',
    args: furnaceTokenId ? [furnaceTokenId] : undefined,
    query: { enabled: !!furnaceTokenId },
  })

  // veNFT count
  const { data: veNFTCount } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow,
    abi: VOTING_ESCROW_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!isSuccess) return
    refetchVeAllowance()
    refetchFurnaceAllowance()
  }, [isSuccess])

  const MAXTIME = 4 * 365
  const multiplier = Math.min(lockDays / MAXTIME, 1)
  const votingPower = lockAmount ? (parseFloat(lockAmount) * multiplier).toFixed(4) : '0'
  const preset = LOCK_DURATIONS.find(d => d.days === lockDays)

  function safeParseUnits18(val: string): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, 18) } catch {
      const [int, dec = ''] = val.split('.')
      return parseUnits(`${int}.${dec.slice(0, 18)}`, 18)
    }
  }

  const parsedLockAmount = safeParseUnits18(lockAmount)
  const needsVeApproval = !!address && parsedLockAmount > 0n && veAllowance !== undefined && veAllowance < parsedLockAmount

  const parsedBurnAmount = safeParseUnits18(burnAmount)
  const needsFurnaceApproval = !!address && parsedBurnAmount > 0n && furnaceAllowance !== undefined && furnaceAllowance < parsedBurnAmount

  const isBusy = isPending || isConfirming

  function handleLock() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!lockAmount || parseFloat(lockAmount) <= 0) return
    if (needsVeApproval) {
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonVotingEscrow, maxUint256] })
      return
    }
    writeContract({
      address: CONTRACTS.AeonVotingEscrow,
      abi: VOTING_ESCROW_ABI,
      functionName: 'createLock',
      args: [parsedLockAmount, BigInt(lockDays * 86400)],
    })
  }

  function handleBurn() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!burnAmount || parseFloat(burnAmount) <= 0) return
    if (needsFurnaceApproval) {
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.TheFurnace, maxUint256] })
      return
    }
    writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'burn', args: [parsedBurnAmount] })
  }

  function handleClaimFurnace() {
    writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'claimRewards' })
  }

  function handleMerge() {
    if (!isConnected) { openConnectModal?.(); return }
    const from = mergeFrom ? BigInt(mergeFrom) : undefined
    const to   = mergeTo   ? BigInt(mergeTo)   : undefined
    if (!from || !to || from === to) return
    writeContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'merge', args: [from, to] })
  }

  function handleIncreaseAmount() {
    if (!isConnected) { openConnectModal?.(); return }
    const id  = increaseId  ? BigInt(increaseId) : undefined
    const amt = safeParseUnits18(increaseAmt)
    if (!id || amt === 0n) return
    if (needsVeApproval || (veAllowance !== undefined && veAllowance < amt)) {
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonVotingEscrow, maxUint256] })
      return
    }
    writeContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'increaseAmount', args: [id, amt] })
  }

  function lockButtonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isBusy) return isPending ? 'Confirm in wallet...' : 'Locking...'
    if (needsVeApproval) return 'Approve AEON'
    return 'Lock AEON & Mint veNFT'
  }

  function burnButtonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isBusy) return isPending ? 'Confirm in wallet...' : 'Burning...'
    if (needsFurnaceApproval) return 'Approve AEON'
    return 'Burn AEON Forever'
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Lock & Burn</h1>
        <p className="text-text-secondary">Lock AEON to get voting power. Or burn permanently for eternal rewards.</p>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-6">
        <button onClick={() => setTab('lock')} className={clsx('flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2', tab === 'lock' ? 'bg-bg-base text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary')}>
          <Lock size={14} /> Lock (veNFT)
        </button>
        <button onClick={() => setTab('furnace')} className={clsx('flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2', tab === 'furnace' ? 'bg-bg-base text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary')}>
          <Flame size={14} className={tab === 'furnace' ? 'text-aeon-400' : ''} /> The Furnace
        </button>
        <button onClick={() => setTab('manage')} className={clsx('flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2', tab === 'manage' ? 'bg-bg-base text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary')}>
          Manage
        </button>
      </div>

      {tab === 'lock' ? (
        <div className="space-y-4">
          {/* Amount */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Amount to Lock</div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={lockAmount}
                onChange={e => setLockAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono text-text-primary placeholder-text-muted focus:outline-none"
              />
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-raised border border-bg-border">
                  <div className="w-6 h-6 rounded-full bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
                  <span className="font-display font-semibold text-sm">AEON</span>
                </div>
                <span className="text-2xs text-text-muted font-mono">Balance: {aeonFormatted}</span>
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              {[25, 50, 75, 100].map(p => (
                <button
                  key={p}
                  disabled={!isConnected || !aeonBalance}
                  onClick={() => {
                    if (aeonBalance) setLockAmount(parseFloat(formatUnits((aeonBalance * BigInt(p)) / 100n, 18)).toFixed(4))
                  }}
                  className="text-2xs text-text-muted hover:text-aeon-400 px-2 py-0.5 rounded border border-bg-border hover:border-aeon-400/30 transition-all font-mono disabled:opacity-40"
                >
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Lock Duration</div>
              <span className="text-xs font-mono text-text-secondary">{preset?.label || `${lockDays} days`}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {LOCK_DURATIONS.map(d => (
                <button key={d.days} onClick={() => setLockDays(d.days)} className={clsx('py-2 rounded-xl text-sm font-medium transition-all text-center', lockDays === d.days ? 'bg-aeon-400/15 text-aeon-400 border border-aeon-400/30' : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover')}>
                  <div className="font-semibold">{d.label}</div>
                  <div className="text-2xs opacity-70">{(d.multiplier * 100).toFixed(0)}% power</div>
                </button>
              ))}
            </div>
            <input type="range" min={7} max={1461} value={lockDays} onChange={e => setLockDays(parseInt(e.target.value))} className="w-full accent-aeon-400" />
            <div className="flex justify-between text-2xs text-text-muted font-mono mt-1">
              <span>7 days</span><span>4 years</span>
            </div>
          </div>

          {/* Preview */}
          <div className="card-raised p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You will receive</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-2xl font-display font-bold text-text-primary">{votingPower}</div>
                <div className="text-xs text-text-muted mt-0.5">veAEON (voting power)</div>
              </div>
              <div>
                <div className="text-2xl font-display font-bold text-aeon-400">{(multiplier * 100).toFixed(0)}%</div>
                <div className="text-xs text-text-muted mt-0.5">of max power</div>
              </div>
            </div>
            <div className="mt-3 h-2 bg-bg-base rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-aeon-600 to-aeon-400 rounded-full transition-all" style={{ width: `${multiplier * 100}%` }} />
            </div>
            <div className="flex justify-between text-2xs text-text-muted font-mono mt-1">
              <span>Expires: {lockDays} days from now</span>
              <span>Power decays linearly</span>
            </div>
          </div>

          <div className="bg-bg-raised border border-bg-border rounded-xl p-3 flex gap-2">
            <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
            <p className="text-xs text-text-muted leading-relaxed">Voting power decays linearly over the lock period. You can extend or add more AEON at any time. You must reset your vote before withdrawing after lock expires.</p>
          </div>

          <button
            onClick={handleLock}
            disabled={isBusy || (isConnected && (!lockAmount || parseFloat(lockAmount) <= 0))}
            className="btn-primary w-full flex items-center justify-center gap-2 py-4"
          >
            <Lock size={16} />
            {lockButtonLabel()}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card-raised border-gradient p-6 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-aeon-400/5 to-transparent pointer-events-none" />
            <div className="relative">
              <Flame size={32} className="text-aeon-400 mx-auto mb-3" />
              <h2 className="font-display font-bold text-xl text-text-primary mb-2">The Furnace</h2>
              <p className="text-sm text-text-secondary leading-relaxed">Burn AEON permanently. Receive a soulbound NFT with static voting power that never decays. Earn a share of every emission's Furnace bonus, plus a share of buyback-redistributed AEON — liquid rewards without ever unstaking.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { title: 'veNFT (Lock)', items: ['Power decays over time', 'Transferable NFT', 'Can withdraw after expiry', 'Time-weighted rewards'], color: 'violet' },
              { title: 'Furnace (Burn)', items: ['Power never decays', 'Soulbound — non-transferable', 'Cannot withdraw — permanent', 'Static proportional rewards'], color: 'aeon', highlight: true },
            ].map(col => (
              <div key={col.title} className={clsx('card p-4', col.highlight && 'border-aeon-400/20 bg-aeon-400/5')}>
                <div className={clsx('text-sm font-display font-semibold mb-3', col.color === 'aeon' ? 'text-aeon-400' : 'text-violet-400')}>{col.title}</div>
                <ul className="space-y-1.5">
                  {col.items.map(item => (
                    <li key={item} className="text-xs text-text-secondary flex gap-1.5">
                      <span className={col.color === 'aeon' ? 'text-aeon-400' : 'text-violet-400'}>•</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Burn amount */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Amount to Burn</div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={burnAmount}
                onChange={e => setBurnAmount(e.target.value)}
                placeholder="0.0"
                className="flex-1 bg-transparent text-2xl font-mono text-text-primary placeholder-text-muted focus:outline-none"
              />
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-raised border border-bg-border">
                  <div className="w-6 h-6 rounded-full bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
                  <span className="font-display font-semibold text-sm">AEON</span>
                </div>
                <span className="text-2xs text-text-muted font-mono">Balance: {aeonFormatted}</span>
              </div>
            </div>
          </div>

          {burnAmount && parseFloat(burnAmount) > 0 && (
            <div className="card-raised p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You receive</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-2xl font-display font-bold text-aeon-400">{burnAmount}</div>
                  <div className="text-xs text-text-muted">Furnace voting power (permanent)</div>
                </div>
                <div>
                  <div className="text-2xl font-display font-bold text-text-primary">1</div>
                  <div className="text-xs text-text-muted">Soulbound NFT</div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex gap-2">
            <Info size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400 leading-relaxed"><strong>This action is irreversible.</strong> Burned AEON goes to the dead address permanently.</p>
          </div>

          <button
            onClick={handleBurn}
            disabled={isBusy || (isConnected && (!burnAmount || parseFloat(burnAmount) <= 0))}
            className="w-full py-4 rounded-xl bg-aeon-400 hover:bg-aeon-300 text-bg-base font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Flame size={16} />
            {burnButtonLabel()}
          </button>
        </div>
      )}

      {tab === 'manage' && (
        <div className="space-y-4">
          {/* Increase Amount */}
          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Increase Lock Amount</div>
            <p className="text-sm text-text-secondary mb-4">Add more AEON to an existing veNFT lock without changing the unlock date.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">veNFT Token ID</label>
                <input type="number" value={increaseId} onChange={e => setIncreaseId(e.target.value)} placeholder="e.g. 1" className="input-base w-full text-sm py-2" />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Additional AEON amount</label>
                <div className="flex items-center gap-2">
                  <input type="number" value={increaseAmt} onChange={e => setIncreaseAmt(e.target.value)} placeholder="0.0" className="input-base flex-1 text-sm py-2" />
                  <span className="text-sm font-mono text-text-muted">AEON</span>
                </div>
                <div className="text-2xs text-text-muted font-mono mt-1">Balance: {aeonFormatted}</div>
              </div>
            </div>
            <button
              onClick={handleIncreaseAmount}
              disabled={isBusy || !increaseId || !increaseAmt || parseFloat(increaseAmt) <= 0}
              className="btn-primary w-full mt-4"
            >
              {isBusy ? 'Confirming...' : veAllowance !== undefined && safeParseUnits18(increaseAmt) > veAllowance ? 'Approve AEON' : 'Increase Lock Amount'}
            </button>
          </div>

          {/* Merge */}
          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Merge veNFTs</div>
            <p className="text-sm text-text-secondary mb-4">Combine two veNFTs into one. The "From" NFT is burned and its locked AEON is added to the "To" NFT. Both must be owned by you and not currently voting.</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">From (NFT to burn)</label>
                <input type="number" value={mergeFrom} onChange={e => setMergeFrom(e.target.value)} placeholder="Token ID to merge from" className="input-base w-full text-sm py-2" />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">Into (NFT to keep)</label>
                <input type="number" value={mergeTo} onChange={e => setMergeTo(e.target.value)} placeholder="Token ID to merge into" className="input-base w-full text-sm py-2" />
              </div>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 flex gap-2 mt-3">
              <Info size={14} className="text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-400">The "From" NFT will be permanently burned. Make sure both NFTs have been reset (not voted this epoch) before merging.</p>
            </div>
            <button
              onClick={handleMerge}
              disabled={isBusy || !mergeFrom || !mergeTo || mergeFrom === mergeTo}
              className="btn-primary w-full mt-4"
            >
              {isBusy ? 'Confirming...' : 'Merge veNFTs'}
            </button>
          </div>
        </div>
      )}

      {/* Positions */}
      <div className="card p-4 mt-6">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Your Positions</div>
        {!isConnected ? (
          <div className="text-center py-6 text-text-muted text-sm">Connect wallet to view your positions</div>
        ) : (
          <div className="space-y-3">
            {/* veNFT summary */}
            <div className="flex items-center justify-between p-3 bg-bg-raised rounded-xl">
              <div>
                <div className="text-sm font-medium text-text-primary">veNFTs owned</div>
                <div className="text-xs text-text-muted">AeonVotingEscrow</div>
              </div>
              <div className="text-lg font-mono font-bold text-violet-400">{veNFTCount?.toString() ?? '—'}</div>
            </div>
            {/* Furnace summary */}
            {furnaceTokenId && furnaceTokenId > 0n ? (
              <div className="p-3 bg-bg-raised rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Furnace NFT #{furnaceTokenId.toString()}</div>
                    <div className="text-xs text-text-muted">Soulbound — permanent</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-aeon-400">{furnaceBurned ? parseFloat(formatUnits(furnaceBurned, 18)).toFixed(2) : '—'} AEON burned</div>
                    <div className="text-xs text-text-muted font-mono">Earned: {furnaceEarned ? parseFloat(formatUnits(furnaceEarned, 18)).toFixed(4) : '—'} AEON</div>
                  </div>
                </div>
                {furnaceEarned && furnaceEarned > 0n && (
                  <button onClick={handleClaimFurnace} disabled={isBusy} className="btn-primary w-full py-2 text-sm">
                    Claim {parseFloat(formatUnits(furnaceEarned, 18)).toFixed(4)} AEON
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-text-muted text-sm">No Furnace NFT yet</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
