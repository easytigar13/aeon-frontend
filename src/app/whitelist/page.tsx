'use client'
import { useState, useEffect } from 'react'
import { BadgeCheck, Flame, Info, Search, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { parseUnits, maxUint256, isAddress } from 'viem'
import { CONTRACTS, TOKENS } from '@/config/contracts'
import { ERC20_ABI, FURNACE_ABI, VOTER_ABI_WHITELIST } from '@/config/abis'

const FEE_REVIEW   = parseUnits('100', 18)   // Tier 1: submit for team review
const FEE_INSTANT  = parseUnits('200', 18)   // Tier 2: self-whitelist on-chain

const KNOWN_TOKENS = Object.values(TOKENS).map(v => v.address.toLowerCase())

type Tier = 1 | 2
// Tier 2 steps: approve furnace → burn 200 AEON → call voter.whitelist
type Tier2Step = 'idle' | 'approving' | 'burning' | 'whitelisting' | 'done'

export default function WhitelistPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tier,       setTier]       = useState<Tier>(1)
  const [tokenAddr,  setTokenAddr]  = useState('')
  const [tier1Done,  setTier1Done]  = useState(false)
  const [tier2Step,  setTier2Step]  = useState<Tier2Step>('idle')

  const validAddr   = isAddress(tokenAddr)
  const alreadyKnown = KNOWN_TOKENS.includes(tokenAddr.toLowerCase())

  // Token info
  const { data: tokenName }     = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'name',     query: { enabled: validAddr } })
  const { data: tokenSymbol }   = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'symbol',   query: { enabled: validAddr } })
  const { data: tokenDecimals } = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'decimals', query: { enabled: validAddr } })

  // Balances & allowances
  const { data: aeonBalance } = useReadContract({
    address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const { data: furnaceAllowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, CONTRACTS.TheFurnace] : undefined, query: { enabled: !!address },
  })

  // Single write hook — shared between both tiers
  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })
  const isBusy = isPending || isConfirming

  const hasEnough1 = aeonBalance !== undefined && aeonBalance >= FEE_REVIEW
  const hasEnough2 = aeonBalance !== undefined && aeonBalance >= FEE_INSTANT

  // ── Tier 1 flow ──────────────────────────────────────────────────────────
  const needsApproval1 = furnaceAllowance !== undefined && furnaceAllowance < FEE_REVIEW

  function handleTier1() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!validAddr || !hasEnough1) return
    if (needsApproval1) {
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.TheFurnace, maxUint256] })
      return
    }
    writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'burn', args: [FEE_REVIEW] })
  }

  // ── Tier 2 state machine ─────────────────────────────────────────────────
  const needsApproval2 = furnaceAllowance !== undefined && furnaceAllowance < FEE_INSTANT

  function handleTier2() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!validAddr || !hasEnough2) return

    if (tier2Step === 'idle' || tier2Step === 'approving') {
      if (needsApproval2) {
        setTier2Step('approving')
        writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.TheFurnace, maxUint256] })
        return
      }
      // Already approved — go straight to burn
      setTier2Step('burning')
      writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'burn', args: [FEE_INSTANT] })
      return
    }

    if (tier2Step === 'burning') {
      writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'burn', args: [FEE_INSTANT] })
      return
    }

    if (tier2Step === 'whitelisting') {
      writeContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI_WHITELIST, functionName: 'whitelist', args: [tokenAddr as `0x${string}`] })
      return
    }
  }

  // Advance state machine on TX success
  useEffect(() => {
    if (!isSuccess) return
    refetchAllowance()

    if (tier === 1) {
      // After approval, user clicks again to burn. After burn, done.
      if (!needsApproval1) setTier1Done(true)
      return
    }

    // Tier 2 state transitions
    if (tier2Step === 'approving') {
      setTier2Step('burning')
      return
    }
    if (tier2Step === 'burning') {
      setTier2Step('whitelisting')
      return
    }
    if (tier2Step === 'whitelisting') {
      setTier2Step('done')
      return
    }
  }, [isSuccess])

  function tier1ButtonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isBusy) return isPending ? 'Confirm in wallet...' : 'Processing...'
    if (!validAddr) return 'Enter a valid token address'
    if (!hasEnough1) return 'Insufficient AEON (need 100)'
    if (needsApproval1) return 'Approve 100 AEON'
    return 'Burn 100 AEON & Submit Request'
  }

  function tier2ButtonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isBusy) return isPending ? 'Confirm in wallet...' : 'Processing...'
    if (!validAddr) return 'Enter a valid token address'
    if (!hasEnough2) return 'Insufficient AEON (need 200)'
    if (tier2Step === 'approving' || (tier2Step === 'idle' && needsApproval2)) return 'Step 1/3 — Approve 200 AEON'
    if (tier2Step === 'burning'   || tier2Step === 'idle') return 'Step 2/3 — Burn 200 AEON'
    if (tier2Step === 'whitelisting') return 'Step 3/3 — Call Whitelist On-Chain'
    return 'Whitelist Instantly'
  }

  const tier2Progress = tier2Step === 'idle' ? 0 : tier2Step === 'approving' ? 1 : tier2Step === 'burning' ? 2 : tier2Step === 'whitelisting' ? 3 : 3

  const tokenInfo = validAddr && tokenSymbol ? (
    <div className="mt-3 p-3 bg-bg-raised rounded-xl flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center text-sm font-bold text-violet-400">
        {tokenSymbol[0]}
      </div>
      <div>
        <div className="text-sm font-semibold text-text-primary">{tokenSymbol}</div>
        <div className="text-xs text-text-muted">{tokenName} · {tokenDecimals} decimals</div>
      </div>
      {alreadyKnown && (
        <div className="ml-auto text-xs font-mono text-emerald-400 flex items-center gap-1">
          <BadgeCheck size={12} /> Already listed
        </div>
      )}
    </div>
  ) : null

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Token Whitelist</h1>
        <p className="text-text-secondary">Whitelist a token so it can be used as bribes and gauge rewards on AeonDEX.</p>
      </div>

      {/* Tier picker */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setTier(1)}
          className={clsx('card p-4 text-left transition-all border-2', tier === 1 ? 'border-aeon-400/40 bg-aeon-400/5' : 'border-transparent hover:border-bg-hover')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Flame size={16} className="text-aeon-400" />
            <span className="text-sm font-display font-bold text-text-primary">Standard</span>
            <span className="ml-auto text-xs font-mono font-bold text-aeon-400">100 AEON</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">Burn 100 AEON and submit for team review. Listed within 24–48 hours if approved.</p>
        </button>

        <button
          onClick={() => setTier(2)}
          className={clsx('card p-4 text-left transition-all border-2', tier === 2 ? 'border-violet-400/40 bg-violet-400/5' : 'border-transparent hover:border-bg-hover')}
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap size={16} className="text-violet-400" />
            <span className="text-sm font-display font-bold text-text-primary">Instant</span>
            <span className="ml-auto text-xs font-mono font-bold text-violet-400">200 AEON</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed">Burn 200 AEON and whitelist the token on-chain yourself — no waiting, no review.</p>
        </button>
      </div>

      {/* Token address — shared */}
      <div className="card p-5 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Token Contract Address (Avalanche C-Chain)</div>
        <input
          type="text"
          value={tokenAddr}
          onChange={e => { setTokenAddr(e.target.value.trim()); setTier2Step('idle') }}
          placeholder="0x..."
          className="input-base w-full font-mono text-sm"
        />
        {tokenInfo}
        {tokenAddr && !validAddr && <div className="mt-2 text-xs text-red-400 font-mono">Not a valid address</div>}
        {alreadyKnown && validAddr && <div className="mt-2 text-xs text-yellow-400 font-mono">This token is already supported on AeonDEX</div>}
      </div>

      {/* ── TIER 1 ── */}
      {tier === 1 && (
        tier1Done ? (
          <div className="card p-8 text-center border-emerald-400/20 bg-emerald-400/5">
            <BadgeCheck size={40} className="text-emerald-400 mx-auto mb-3" />
            <h2 className="font-display font-bold text-xl text-text-primary mb-2">Request Submitted</h2>
            <p className="text-text-secondary text-sm mb-4">
              100 AEON permanently burned. Your listing request for{' '}
              <span className="font-mono text-aeon-400">{tokenSymbol ?? tokenAddr.slice(0, 10) + '...'}</span>{' '}
              is under review. The team will whitelist the token within 24–48 hours.
            </p>
            <div className="text-xs font-mono text-text-muted">{tokenAddr}</div>
            <button onClick={() => { setTier1Done(false); setTokenAddr('') }} className="btn-ghost mt-6 text-sm">Submit Another Token</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card p-5">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Breakdown</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-text-muted">Fee</span><span className="font-mono text-text-primary">100 AEON</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-muted">Destination</span><span className="font-mono text-aeon-400">The Furnace (permanent burn)</span></div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Your balance</span>
                  <span className={clsx('font-mono', hasEnough1 ? 'text-emerald-400' : 'text-red-400')}>
                    {aeonBalance !== undefined ? (Number(aeonBalance) / 1e18).toFixed(2) : '—'} AEON
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-bg-raised border border-bg-border rounded-xl p-3 flex gap-2">
              <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
              <p className="text-xs text-text-muted leading-relaxed">Fee is non-refundable. Scams or tokens without community interest may be rejected.</p>
            </div>
            <button onClick={handleTier1} disabled={isBusy || (isConnected && (!validAddr || !hasEnough1 || alreadyKnown))} className="btn-primary w-full py-4 flex items-center justify-center gap-2">
              {!isBusy && <Flame size={16} />}
              {tier1ButtonLabel()}
            </button>
          </div>
        )
      )}

      {/* ── TIER 2 ── */}
      {tier === 2 && (
        tier2Step === 'done' ? (
          <div className="card p-8 text-center border-violet-400/20 bg-violet-400/5">
            <Zap size={40} className="text-violet-400 mx-auto mb-3" />
            <h2 className="font-display font-bold text-xl text-text-primary mb-2">Token Whitelisted</h2>
            <p className="text-text-secondary text-sm mb-4">
              200 AEON burned. <span className="font-mono text-violet-400">{tokenSymbol ?? tokenAddr.slice(0, 10) + '...'}</span> is now whitelisted on-chain and can be used as a bribe or gauge reward immediately.
            </p>
            <div className="text-xs font-mono text-text-muted">{tokenAddr}</div>
            <button onClick={() => { setTier2Step('idle'); setTokenAddr('') }} className="btn-ghost mt-6 text-sm">Whitelist Another Token</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Progress steps */}
            {tier2Step !== 'idle' && (
              <div className="card p-4">
                <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Progress</div>
                <div className="flex items-center gap-2">
                  {['Approve', 'Burn 200 AEON', 'Whitelist On-Chain'].map((label, i) => (
                    <div key={label} className="flex items-center gap-2 flex-1">
                      <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold shrink-0 transition-all',
                        tier2Progress > i + 1 ? 'bg-emerald-400 text-bg-base' :
                        tier2Progress === i + 1 ? 'bg-violet-400 text-bg-base' :
                        'bg-bg-raised text-text-muted border border-bg-border'
                      )}>
                        {tier2Progress > i + 1 ? '✓' : i + 1}
                      </div>
                      <span className={clsx('text-xs font-mono', tier2Progress === i + 1 ? 'text-text-primary' : 'text-text-muted')}>{label}</span>
                      {i < 2 && <div className="h-px flex-1 bg-bg-border" />}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card p-5">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Breakdown</div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm"><span className="text-text-muted">Fee</span><span className="font-mono text-text-primary">200 AEON</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-muted">Destination</span><span className="font-mono text-violet-400">The Furnace (permanent burn)</span></div>
                <div className="flex justify-between text-sm"><span className="text-text-muted">Whitelist call</span><span className="font-mono text-text-secondary">AeonVoter.whitelist(token)</span></div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Your balance</span>
                  <span className={clsx('font-mono', hasEnough2 ? 'text-emerald-400' : 'text-red-400')}>
                    {aeonBalance !== undefined ? (Number(aeonBalance) / 1e18).toFixed(2) : '—'} AEON
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 flex gap-2">
              <Info size={14} className="text-violet-400 shrink-0 mt-0.5" />
              <p className="text-xs text-violet-300 leading-relaxed">
                Instant whitelist is a 3-transaction flow: approve, burn, then whitelist on-chain. All 3 must complete. The 200 AEON is burned even if the whitelist call fails — ensure the token is legitimate before proceeding.
              </p>
            </div>

            <button
              onClick={handleTier2}
              disabled={isBusy || (isConnected && (!validAddr || !hasEnough2 || alreadyKnown))}
              className={clsx('w-full py-4 flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                'bg-violet-500 hover:bg-violet-400 text-white'
              )}
            >
              {!isBusy && <Zap size={16} />}
              {tier2ButtonLabel()}
            </button>
          </div>
        )
      )}
    </div>
  )
}
