'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Rocket, Flame, Lock, Info, Loader2, CheckCircle2, ExternalLink, Coins } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatEther, parseEther, parseUnits } from 'viem'
import { AEON_TOKEN_LAUNCHPAD_V2_ABI, ERC20_ABI } from '@/config/abis'
import { CONTRACTS } from '@/config/contracts'
import { robinhoodChain } from '@/config/chain'
import { TokenIcon } from '@/components/TokenIcon'

type QuoteAsset = 'ETH' | 'AEON'

function safeParseTokenAmount(value: string): bigint {
  if (!value || Number(value) <= 0) return 0n
  try {
    return parseUnits(value, 18)
  } catch {
    const [whole, fraction = ''] = value.split('.')
    return parseUnits(`${whole || '0'}.${fraction.slice(0, 18)}`, 18)
  }
}

function safeParseEth(value: string): bigint {
  if (!value || Number(value) <= 0) return 0n
  try {
    return parseEther(value)
  } catch {
    const [whole, fraction = ''] = value.split('.')
    return parseEther(`${whole || '0'}.${fraction.slice(0, 18)}`)
  }
}

function clampSlippageBps(raw: string): bigint {
  const pct = Number(raw)
  if (!Number.isFinite(pct) || pct < 0.01) return 50n
  if (pct > 25) return 2500n
  return BigInt(Math.round(pct * 100))
}

function fmtAmount(raw: bigint, max = 6): string {
  const n = Number(formatEther(raw))
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { maximumFractionDigits: max })
}

function deadlineFromMinutes(minutes: string): bigint {
  const mins = Math.max(1, Math.min(180, Number(minutes) || 20))
  return BigInt(Math.floor(Date.now() / 1000) + mins * 60)
}

export default function LaunchPage() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [metadataURI, setMetadataURI] = useState('')
  const [totalSupply, setTotalSupply] = useState('1000000000')
  const [tokenLiquidity, setTokenLiquidity] = useState('800000000')
  const [quoteAsset, setQuoteAsset] = useState<QuoteAsset>('ETH')
  const [quoteAmount, setQuoteAmount] = useState('0.1')
  const [feeBps, setFeeBps] = useState('100')
  const [slippage, setSlippage] = useState('0.5')
  const [deadlineMinutes, setDeadlineMinutes] = useState('20')
  const [manualError, setManualError] = useState('')
  const [needsApproval, setNeedsApproval] = useState(false)

  const explorerUrl = robinhoodChain.blockExplorers?.default.url
  const launchpad = CONTRACTS.AeonTokenLaunchpadV2

  const { data: launchFeeBpsRaw } = useReadContract({
    address: launchpad,
    abi: AEON_TOKEN_LAUNCHPAD_V2_ABI,
    functionName: 'launchFeeBps',
  })
  const launchFeeBps = (launchFeeBpsRaw as bigint | undefined) ?? 0n

  const totalSupplyWei = safeParseTokenAmount(totalSupply)
  const tokenLiquidityWei = safeParseTokenAmount(tokenLiquidity)
  const quoteAmountWei = quoteAsset === 'ETH' ? safeParseEth(quoteAmount) : safeParseTokenAmount(quoteAmount)
  const slippageBps = clampSlippageBps(slippage)
  const launchFeeAmount = (quoteAmountWei * launchFeeBps) / 10_000n
  const netQuoteAfterFee = quoteAmountWei - launchFeeAmount
  const minTokenAmount = tokenLiquidityWei * (10000n - slippageBps) / 10000n
  const minQuoteAmount = netQuoteAfterFee * (10000n - slippageBps) / 10000n
  const supplyToPoolPct = totalSupplyWei > 0n ? Number(tokenLiquidityWei * 10000n / totalSupplyWei) / 100 : 0

  const initialPrice = useMemo(() => {
    const token = Number(tokenLiquidity || '0')
    const quote = Number(quoteAmount || '0')
    if (!Number.isFinite(token) || !Number.isFinite(quote) || token <= 0 || quote <= 0) return null
    return quote / token
  }, [tokenLiquidity, quoteAmount])

  const aeonQuoteToken = CONTRACTS.AeonToken

  const { data: aeonAllowance } = useReadContract({
    address: aeonQuoteToken,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, launchpad] : undefined,
    query: { enabled: !!address && quoteAsset === 'AEON' },
  })

  useEffect(() => {
    if (quoteAsset !== 'AEON') { setNeedsApproval(false); return }
    const allowance = (aeonAllowance as bigint | undefined) ?? 0n
    setNeedsApproval(allowance < quoteAmountWei)
  }, [quoteAsset, aeonAllowance, quoteAmountWei])

  const validationError = useMemo(() => {
    if (!name.trim()) return 'Enter a token name.'
    if (!symbol.trim()) return 'Enter a token symbol.'
    if (symbol.trim().length > 12) return 'Use a shorter symbol.'
    if (totalSupplyWei === 0n) return 'Total supply must be greater than zero.'
    if (tokenLiquidityWei === 0n) return 'Token liquidity must be greater than zero.'
    if (quoteAmountWei === 0n) return `${quoteAsset} liquidity must be greater than zero.`
    if (tokenLiquidityWei > totalSupplyWei) return 'Token liquidity cannot exceed total supply.'
    if (Number(feeBps) <= 0 || Number(feeBps) > 1000) return 'Fee tier must be between 1 and 1000 bps.'
    return ''
  }, [name, symbol, totalSupplyWei, tokenLiquidityWei, quoteAmountWei, quoteAsset, feeBps])

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })
  const {
    writeContract: writeApprove,
    data: approveHash,
    isPending: isApprovePending,
  } = useWriteContract()
  const { isLoading: isApproveConfirming } = useWaitForTransactionReceipt({ hash: approveHash })
  const busy = isPending || isConfirming || isApprovePending || isApproveConfirming

  function approveAeon() {
    writeApprove({
      address: aeonQuoteToken,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [launchpad, quoteAmountWei],
    })
  }

  function submitLaunch() {
    if (!isConnected) {
      openConnectModal?.()
      return
    }
    if (validationError) {
      setManualError(validationError)
      return
    }
    setManualError('')

    if (quoteAsset === 'ETH') {
      writeContract({
        address: launchpad,
        abi: AEON_TOKEN_LAUNCHPAD_V2_ABI,
        functionName: 'launchTokenWithNativeLiquidity',
        args: [{
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          metadataURI: metadataURI.trim(),
          totalSupply: totalSupplyWei,
          tokenLiquidityAmount: tokenLiquidityWei,
          minTokenAmount,
          minNativeAmount: minQuoteAmount,
          feeBps: Number(feeBps),
          deadline: deadlineFromMinutes(deadlineMinutes),
        }],
        value: quoteAmountWei,
      })
    } else {
      writeContract({
        address: launchpad,
        abi: AEON_TOKEN_LAUNCHPAD_V2_ABI,
        functionName: 'launchTokenWithTokenLiquidity',
        args: [{
          name: name.trim(),
          symbol: symbol.trim().toUpperCase(),
          metadataURI: metadataURI.trim(),
          totalSupply: totalSupplyWei,
          tokenLiquidityAmount: tokenLiquidityWei,
          quoteToken: aeonQuoteToken,
          quoteLiquidityAmount: quoteAmountWei,
          minTokenAmount,
          minQuoteAmount,
          feeBps: Number(feeBps),
          deadline: deadlineFromMinutes(deadlineMinutes),
        }],
      })
    }
  }

  function buttonLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (quoteAsset === 'AEON' && needsApproval) {
      if (isApprovePending) return 'Confirm Approval in Wallet'
      if (isApproveConfirming) return 'Approving AEON'
      return 'Approve AEON'
    }
    if (isPending) return 'Confirm in Wallet'
    if (isConfirming) return 'Creating Token + Pool'
    if (isSuccess) return 'Launch Complete'
    return 'Launch Token + Create Pool'
  }

  function handleSubmit() {
    if (isConnected && quoteAsset === 'AEON' && needsApproval) {
      approveAeon()
      return
    }
    submitLaunch()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <div className="badge-aeon w-fit mb-3">AEON LAUNCHPAD</div>
          <h1 className="font-display font-bold text-3xl text-text-primary">Launch an ERC-20 with instant Aeon liquidity</h1>
          <p className="text-text-secondary mt-2 max-w-2xl">
            Create the token and seed the vAMM pool against ETH or AEON. The LP always ends up permanently staked in a real gauge -- there&apos;s no choice to make and no way to take it back out.
          </p>
        </div>
        <Link href="/liquidity" className="btn-secondary text-sm inline-flex items-center gap-2">
          View Pools <ExternalLink size={14} />
        </Link>
      </div>

      <div className="mb-4 rounded-xl border border-aeon-400/20 bg-aeon-400/10 p-4 flex gap-3">
        <Flame size={18} className="text-aeon-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-aeon-400">Every launched token taxes 0.025% of every transfer</div>
          <div className="text-xs text-aeon-400/80 mt-1">
            That cut is swapped to AEON and burned automatically, on every transfer, forever. It&apos;s not optional and the rate can&apos;t be changed per-launch.
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-violet-400/20 bg-violet-400/10 p-4 flex gap-3">
        <Lock size={18} className="text-violet-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-semibold text-violet-400">LP is permanently staked, not sent to you</div>
          <div className="text-xs text-violet-400/80 mt-1">
            A real gauge gets created for your pool and the launchpad stakes 100% of the LP into it on your behalf -- forever. Nobody, including the creator, can ever withdraw it. This happens automatically shortly after your launch confirms, not in the same transaction (gauge creation needs a separate protocol-level step) -- your pool is live and swappable immediately either way.
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6 items-start">
        <div className="space-y-4">
          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Token Details</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Aeon Cat" className="input-base w-full" />
              </label>
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Symbol</span>
                <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} placeholder="ACAT" className="input-base w-full font-mono" />
              </label>
            </div>
            <label className="block mt-3">
              <span className="text-xs text-text-muted mb-1 block">Metadata URI</span>
              <input value={metadataURI} onChange={e => setMetadataURI(e.target.value)} placeholder="ipfs://... or https://..." className="input-base w-full" />
            </label>
          </div>

          <div className="card p-5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Supply + Initial Pool</div>
            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Total supply</span>
                <input type="number" value={totalSupply} onChange={e => setTotalSupply(e.target.value)} className="input-base w-full font-mono" />
              </label>
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Tokens in pool</span>
                <input type="number" value={tokenLiquidity} onChange={e => setTokenLiquidity(e.target.value)} className="input-base w-full font-mono" />
              </label>
            </div>

            <span className="text-xs text-text-muted mb-1 block">Quote asset</span>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(['ETH', 'AEON'] as const).map(asset => (
                <button
                  key={asset}
                  onClick={() => setQuoteAsset(asset)}
                  className={clsx(
                    'flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all',
                    quoteAsset === asset
                      ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400'
                      : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover'
                  )}
                >
                  <TokenIcon symbol={asset} size={16} />
                  {asset}
                </button>
              ))}
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">{quoteAsset} in pool</span>
                <input type="number" value={quoteAmount} onChange={e => setQuoteAmount(e.target.value)} className="input-base w-full font-mono" />
              </label>
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Fee tier</span>
                <select value={feeBps} onChange={e => setFeeBps(e.target.value)} className="input-base w-full font-mono">
                  <option value="30">0.30%</option>
                  <option value="100">1.00%</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-text-muted mb-1 block">Slippage</span>
                <input type="number" value={slippage} onChange={e => setSlippage(e.target.value)} className="input-base w-full font-mono" />
              </label>
            </div>
            <label className="block mt-3">
              <span className="text-xs text-text-muted mb-1 block">Deadline minutes</span>
              <input type="number" value={deadlineMinutes} onChange={e => setDeadlineMinutes(e.target.value)} className="input-base w-full max-w-[160px] font-mono" />
            </label>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="card p-5">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-aeon-400/15 border border-aeon-400/20 flex items-center justify-center text-aeon-400">
                <Rocket size={20} />
              </div>
              <div>
                <div className="font-display font-bold text-text-primary">Launch Preview</div>
                <div className="text-xs text-text-muted">Token plus {quoteAsset} pool</div>
              </div>
            </div>

            <div className="space-y-2.5">
              {[
                { label: 'Pair', value: `${symbol.trim() || 'TOKEN'}/${quoteAsset}` },
                { label: 'Initial price', value: initialPrice ? `${initialPrice.toExponential(4)} ${quoteAsset}` : '-' },
                { label: 'Supply to pool', value: `${supplyToPoolPct.toFixed(2)}%` },
                { label: 'Min tokens added', value: fmtAmount(minTokenAmount) },
                { label: `Min ${quoteAsset} added`, value: `${fmtAmount(minQuoteAmount)} ${quoteAsset}` },
                { label: 'Launch fee', value: `${(Number(launchFeeBps) / 100).toFixed(2)}% (${fmtAmount(launchFeeAmount)} ${quoteAsset})` },
                { label: `Total ${quoteAsset} sent`, value: `${fmtAmount(quoteAmountWei)} ${quoteAsset}` },
              ].map(row => (
                <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text-muted">{row.label}</span>
                  <span className="font-mono text-text-secondary text-right">{row.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl bg-bg-raised border border-bg-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <Coins size={16} className="text-aeon-400" />
                <span className="text-sm font-semibold text-text-primary">Instant Aeon pool</span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                The launchpad creates the ERC-20, creates or finds the Aeon vAMM pool, and adds the first liquidity. The gauge + permanent stake finish shortly after, automatically.
              </p>
            </div>

            {(manualError || writeError) && (
              <div className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400 break-words">
                {manualError || writeError?.message}
              </div>
            )}

            {isSuccess && txHash && (
              <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <CheckCircle2 size={14} /> Launch transaction confirmed
                </div>
                {explorerUrl && (
                  <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                    View transaction <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={busy || (isConnected && !!validationError)}
              className="btn-primary w-full mt-5 py-4 flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
              {buttonLabel()}
            </button>

            {address && (
              <div className="text-2xs text-text-muted font-mono text-center mt-3">
                Creator: {address.slice(0, 6)}...{address.slice(-4)}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 flex gap-3">
            <Info size={16} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-400/90 leading-relaxed">
              Launched tokens are unaudited by default. Do not promise returns, fake volume, or imply affiliation with Robinhood.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
