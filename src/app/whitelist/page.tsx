'use client'
import { useState, useEffect } from 'react'
import { BadgeCheck, Flame, Info, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { parseUnits, maxUint256, isAddress } from 'viem'
import { CONTRACTS, TOKENS } from '@/config/contracts'
import { ERC20_ABI, FURNACE_ABI } from '@/config/abis'

const WHITELIST_FEE = parseUnits('100', 18)

const KNOWN_TOKENS = Object.entries(TOKENS).map(([k, v]) => v.address.toLowerCase())

export default function WhitelistPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenAddr, setTokenAddr] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const validAddr = isAddress(tokenAddr)

  const { data: tokenName }   = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'name',     query: { enabled: validAddr } })
  const { data: tokenSymbol } = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'symbol',   query: { enabled: validAddr } })
  const { data: tokenDecimals } = useReadContract({ address: validAddr ? tokenAddr as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'decimals', query: { enabled: validAddr } })

  const { data: aeonBalance } = useReadContract({
    address: CONTRACTS.AeonToken,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  const { data: furnaceAllowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.AeonToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.TheFurnace] : undefined,
    query: { enabled: !!address },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (isSuccess) {
      refetchAllowance()
      // After approval, user clicks again to burn. After burn, show success.
      if (furnaceAllowance !== undefined && furnaceAllowance >= WHITELIST_FEE) {
        setSubmitted(true)
      }
    }
  }, [isSuccess])

  const isBusy = isPending || isConfirming
  const needsApproval = furnaceAllowance !== undefined && furnaceAllowance < WHITELIST_FEE
  const hasBalance = aeonBalance !== undefined && aeonBalance >= WHITELIST_FEE
  const alreadyKnown = KNOWN_TOKENS.includes(tokenAddr.toLowerCase())

  function handleSubmit() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!validAddr || !hasBalance) return

    if (needsApproval) {
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.TheFurnace, maxUint256] })
      return
    }

    // Burn 100 AEON permanently via Furnace
    writeContract({ address: CONTRACTS.TheFurnace, abi: FURNACE_ABI, functionName: 'burn', args: [WHITELIST_FEE] })
  }

  function buttonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isBusy) return isPending ? 'Confirm in wallet...' : 'Processing...'
    if (!validAddr) return 'Enter a valid token address'
    if (!hasBalance) return 'Insufficient AEON (need 100)'
    if (needsApproval) return 'Approve 100 AEON'
    return 'Burn 100 AEON & Submit Request'
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Token Whitelist</h1>
        <p className="text-text-secondary">Submit a token for whitelisting on AeonDEX. Whitelisted tokens can be used as bribes and gauge rewards.</p>
      </div>

      {/* How it works */}
      <div className="card p-6 mb-6">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">How It Works</div>
        <div className="space-y-3">
          {[
            { icon: <Search size={16} className="text-violet-400" />, label: 'Enter Token Address', desc: 'Paste the contract address of the token you want to whitelist on Avalanche C-Chain.' },
            { icon: <Flame size={16} className="text-aeon-400" />,   label: 'Burn 100 AEON',       desc: '100 AEON is permanently burned via The Furnace — no refunds. This prevents spam listings.' },
            { icon: <BadgeCheck size={16} className="text-emerald-400" />, label: 'Team Review',   desc: 'The AEON team reviews and whitelists the token within 24–48 hours if it meets requirements.' },
          ].map(step => (
            <div key={step.label} className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-bg-raised flex items-center justify-center shrink-0">{step.icon}</div>
              <div>
                <div className="text-sm font-semibold text-text-primary">{step.label}</div>
                <div className="text-xs text-text-muted leading-relaxed">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {submitted ? (
        <div className="card p-8 text-center border-emerald-400/20 bg-emerald-400/5">
          <BadgeCheck size={40} className="text-emerald-400 mx-auto mb-3" />
          <h2 className="font-display font-bold text-xl text-text-primary mb-2">Request Submitted</h2>
          <p className="text-text-secondary text-sm mb-4">
            100 AEON has been permanently burned. Your listing request for{' '}
            <span className="font-mono text-aeon-400">{tokenSymbol ?? tokenAddr.slice(0, 10) + '...'}</span>{' '}
            has been submitted. The team will review and whitelist the token within 24–48 hours.
          </p>
          <div className="text-xs font-mono text-text-muted">{tokenAddr}</div>
          <button onClick={() => { setSubmitted(false); setTokenAddr('') }} className="btn-ghost mt-6 text-sm">Submit Another Token</button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Token address input */}
          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Token Contract Address</div>
            <input
              type="text"
              value={tokenAddr}
              onChange={e => setTokenAddr(e.target.value.trim())}
              placeholder="0x..."
              className="input-base w-full font-mono text-sm"
            />
            {validAddr && tokenSymbol && (
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
            )}
            {tokenAddr && !validAddr && (
              <div className="mt-2 text-xs text-red-400 font-mono">Not a valid address</div>
            )}
            {alreadyKnown && validAddr && (
              <div className="mt-2 text-xs text-yellow-400 font-mono">This token is already supported on AeonDEX</div>
            )}
          </div>

          {/* Fee breakdown */}
          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Breakdown</div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Listing fee</span>
                <span className="font-mono text-text-primary">100 AEON</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Destination</span>
                <span className="font-mono text-aeon-400">The Furnace (permanent burn)</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Your AEON balance</span>
                <span className={clsx('font-mono', hasBalance ? 'text-emerald-400' : 'text-red-400')}>
                  {aeonBalance !== undefined ? parseFloat((Number(aeonBalance) / 1e18).toFixed(4)).toLocaleString() : '—'} AEON
                </span>
              </div>
            </div>
          </div>

          <div className="bg-bg-raised border border-bg-border rounded-xl p-3 flex gap-2">
            <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
            <p className="text-xs text-text-muted leading-relaxed">
              The 100 AEON fee is burned permanently and is non-refundable regardless of whether your token is approved. Tokens that are scams, copy-cats, or lack sufficient community interest may be rejected. Only tokens on Avalanche C-Chain are eligible.
            </p>
          </div>

          <button
            onClick={handleSubmit}
            disabled={isBusy || (isConnected && (!validAddr || !hasBalance || alreadyKnown))}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {isBusy ? null : <Flame size={16} />}
            {buttonLabel()}
          </button>
        </div>
      )}
    </div>
  )
}
