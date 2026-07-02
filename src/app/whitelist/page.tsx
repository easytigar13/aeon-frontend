'use client'
import { useState, useEffect } from 'react'
import { BadgeCheck, Droplets, Info, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { maxUint256 } from 'viem'
import { CONTRACTS } from '@/config/contracts'
import { ERC20_ABI, WHITELIST_ABI } from '@/config/abis'

// WhitelistRH.sol: pay 100 AEON to the protocol treasury, once, and your
// wallet can add liquidity via LiquidityHelperRH forever after.
type Step = 'idle' | 'approving' | 'approve_wait' | 'joining' | 'joining_wait'

export default function WhitelistPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [step, setStep] = useState<Step>('idle')

  const { data: isWhitelistedRaw, refetch: refetchWhitelisted } = useReadContract({
    address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'isWhitelisted',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const isWhitelisted = !!isWhitelistedRaw

  const { data: costRaw } = useReadContract({
    address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'WHITELIST_COST',
  })
  const cost = (costRaw as bigint | undefined) ?? 100n * 10n ** 18n

  const { data: aeonBalance } = useReadContract({
    address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, CONTRACTS.Whitelist] : undefined, query: { enabled: !!address },
  })

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })
  const isBusy = isPending || isConfirming

  const hasEnough = aeonBalance !== undefined && aeonBalance >= cost
  const needsApproval = allowance !== undefined && allowance < cost

  useEffect(() => {
    if (!isSuccess) return
    refetchAllowance(); refetchWhitelisted()
    if (step === 'approve_wait') { setStep('joining'); return }
    if (step === 'joining_wait') { setStep('idle'); return }
  }, [isSuccess])

  function handleJoin() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!hasEnough || isWhitelisted) return
    if (needsApproval) {
      setStep('approving')
      writeContract({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.Whitelist, maxUint256] })
      setStep('approve_wait')
      return
    }
    setStep('joining')
    writeContract({ address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'joinWhitelist', args: [] })
    setStep('joining_wait')
  }

  function buttonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (isWhitelisted) return 'Already Whitelisted'
    if (isBusy) return step === 'approve_wait' || step === 'approving' ? 'Approving…' : 'Joining…'
    if (!hasEnough) return 'Insufficient AEON (need 100)'
    if (needsApproval) return 'Approve 100 AEON'
    return 'Pay 100 AEON — Join Whitelist'
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Whitelist</h1>
        <p className="text-text-secondary">Pay 100 AEON once, and your wallet can add liquidity on AEON Protocol forever.</p>
      </div>

      {isWhitelisted ? (
        <div className="card p-8 text-center border-emerald-400/20 bg-emerald-400/5">
          <BadgeCheck size={40} className="text-emerald-400 mx-auto mb-3" />
          <h2 className="font-display font-bold text-xl text-text-primary mb-2">You're Whitelisted</h2>
          <p className="text-text-secondary text-sm mb-4">
            This wallet can add liquidity to any AEON pool. Head to <a href="/liquidity" className="text-aeon-400 hover:underline">Liquidity</a> to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center shrink-0">
              <Lock size={20} className="text-violet-400" />
            </div>
            <div>
              <h3 className="font-display font-semibold text-text-primary mb-1">Why a whitelist?</h3>
              <p className="text-sm text-text-secondary leading-relaxed">
                Adding liquidity on AEON Protocol is gated behind a one-time 100 AEON payment to the protocol treasury.
                This is a permanent unlock — pay once, and this wallet can add liquidity to any pool for as long as the protocol exists.
              </p>
            </div>
          </div>

          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Breakdown</div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-text-muted">Fee</span><span className="font-mono text-text-primary">100 AEON</span></div>
              <div className="flex justify-between text-sm"><span className="text-text-muted">Destination</span><span className="font-mono text-aeon-400">Protocol treasury</span></div>
              <div className="flex justify-between text-sm"><span className="text-text-muted">Unlocks</span><span className="font-mono text-text-secondary">Add liquidity — permanently, for this wallet</span></div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Your balance</span>
                <span className={clsx('font-mono', hasEnough ? 'text-emerald-400' : 'text-red-400')}>
                  {aeonBalance !== undefined ? (Number(aeonBalance) / 1e18).toFixed(2) : '—'} AEON
                </span>
              </div>
            </div>
          </div>

          <div className="bg-bg-raised border border-bg-border rounded-xl p-3 flex gap-2">
            <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
            <p className="text-xs text-text-muted leading-relaxed">Fee is non-refundable. This is a 2-transaction flow: approve, then join.</p>
          </div>

          <button onClick={handleJoin} disabled={isBusy || (isConnected && !hasEnough)} className="btn-primary w-full py-4 flex items-center justify-center gap-2">
            {!isBusy && <Droplets size={16} />}
            {buttonLabel()}
          </button>
        </div>
      )}
    </div>
  )
}
