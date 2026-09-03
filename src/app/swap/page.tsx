'use client'
import { useState, useCallback, useEffect } from 'react'
import { ArrowUpDown, Settings, ChevronDown, Loader2, TrendingUp, TrendingDown, ExternalLink, BarChart2, ShieldCheck, Zap, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, useReadContract, useSendTransaction } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { TOKENS, POOLS, CL_POOLS, DLMM_POOLS, CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { robinhoodChain } from '@/config/chain'
import { AEON_ROUTER_ABI, AEON_UNIVERSAL_ROUTER_ABI, AEON_SWAP_UNWRAP_HELPER_ABI, ERC20_ABI, WETH_ABI } from '@/config/abis'
import { useRouting, type RouteStep } from '@/hooks/useRouting'
import { useOneInchQuote } from '@/hooks/useOneInchQuote'
import { usePrices } from '@/hooks/usePrices'
import { useDexTokenInfo } from '@/hooks/useDexTokenInfo'
import { useVolume24h } from '@/hooks/useVolume24h'
import { useDexScreenerPairs, dexTokenStats } from '@/hooks/useDexScreener'
import { useSoundEffects } from '@/hooks/useSoundEffects'
import { useToast } from '@/components/layout/ToastContext'
import { TokenIcon } from '@/components/TokenIcon'
import { Sparkline } from '@/components/Sparkline'
import { AddToWalletButton } from '@/components/AddToWalletButton'
import { ConfettiBurst } from '@/components/ConfettiBurst'
import { SwapChart } from '@/components/swap/SwapChart'
import { RouteVisualizer } from '@/components/swap/RouteVisualizer'
import { SwapSettingsModal } from '@/components/swap/SwapSettingsModal'
import { EnhancedTokenSelectModal, type TokenItem } from '@/components/swap/EnhancedTokenSelectModal'

type TokenKey = keyof typeof TOKENS

function safeSlippage(raw: number | string): number {
  const n = typeof raw === 'number' ? raw : parseFloat(raw)
  if (!isFinite(n) || n < 0.01) return 0.5
  if (n > 49) return 49
  return n
}

function safeParseUnits(val: string, decimals: number): bigint {
  if (!val || parseFloat(val) <= 0) return 0n
  try {
    return parseUnits(val, decimals)
  } catch {
    const [int, dec = ''] = val.split('.')
    return parseUnits(`${int}.${dec.slice(0, decimals)}`, decimals)
  }
}

const TOKEN_LIST = Object.entries(TOKENS).map(([key, val]) => ({ key: key as TokenKey, ...val }))
const WETH_ADDR = TOKENS['WETH'].address
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`
const ONEINCH_ROUTER = '0x111111125421cA6dc452d289314280a0f8842A65' as `0x${string}`

const POOL_COUNT_BY_SYMBOL: Record<string, number> = {}
for (const p of [...POOLS, ...CL_POOLS, ...DLMM_POOLS]) {
  POOL_COUNT_BY_SYMBOL[p.token0] = (POOL_COUNT_BY_SYMBOL[p.token0] ?? 0) + 1
  POOL_COUNT_BY_SYMBOL[p.token1] = (POOL_COUNT_BY_SYMBOL[p.token1] ?? 0) + 1
}
POOL_COUNT_BY_SYMBOL['ETH'] = POOL_COUNT_BY_SYMBOL['WETH'] ?? 0

function fmtPrice(p: number | null): string {
  if (p === null) return '—'
  if (p >= 1) return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 0.0001) return '$' + p.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return '$' + p.toExponential(2)
}

function useTokenBalance(tokenKey: string, address?: `0x${string}`) {
  const token = TOKENS[tokenKey as TokenKey]
  const isNative = !token || token.address === NATIVE_SENTINEL
  const tokenAddr = token ? token.address : undefined

  const { data } = useBalance({
    address,
    token: isNative ? undefined : tokenAddr,
    query: { enabled: !!address },
  })
  if (!address || !data) return { formatted: '—', raw: 0n, decimals: 18 }
  return { formatted: parseFloat(formatUnits(data.value, data.decimals)).toFixed(4), raw: data.value, decimals: data.decimals }
}

type Step = 'idle' | 'wrap' | 'wrap_wait' | 'approve' | 'approve_wait' | 'swap' | 'swap_wait' | 'done'

export default function SwapPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()
  const { showToast } = useToast()
  const { playClick, playSwitch, playSuccess, playError } = useSoundEffects()

  const [tokenIn,  setTokenIn]  = useState<string>('ETH')
  const [tokenOut, setTokenOut] = useState<string>('AEON')
  const [amountIn, setAmountIn] = useState('')
  const [slippage, setSlippage] = useState<number>(0.5)
  const [deadline, setDeadline] = useState<number>(20)
  const [showSettings, setShowSettings] = useState(false)
  const [showTokenSelect, setShowTokenSelect] = useState<'in' | 'out' | null>(null)
  const [showChartOnMobile, setShowChartOnMobile] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [manualErrMsg, setErrMsgState] = useState('')
  const [celebrate, setCelebrate] = useState(false)
  const [flipSpin, setFlipSpin] = useState(0)

  const balanceIn  = useTokenBalance(tokenIn,  address)
  const balanceOut = useTokenBalance(tokenOut, address)
  const prices     = usePrices()
  const dexInfo    = useDexTokenInfo()
  const volResult  = useVolume24h(prices)
  const dexScreenerPairs = useDexScreenerPairs()

  const tokenInMeta = TOKENS[tokenIn as TokenKey] || { symbol: tokenIn, decimals: 18, name: tokenIn, address: NATIVE_SENTINEL }
  const tokenOutMeta = TOKENS[tokenOut as TokenKey] || { symbol: tokenOut, decimals: 18, name: tokenOut, address: NATIVE_SENTINEL }

  const isWrapUnwrap = (tokenIn === 'ETH' && tokenOut === 'WETH') || (tokenIn === 'WETH' && tokenOut === 'ETH')
  const needsWrapStep   = tokenIn  === 'ETH' && !isWrapUnwrap
  const needsUnwrapStep = tokenOut === 'ETH' && !isWrapUnwrap

  const parsedAmountIn = safeParseUnits(amountIn, tokenInMeta.decimals)
  const slippageSafe   = safeSlippage(slippage)
  const slippagePct    = slippageSafe / 100

  const routing = useRouting(
    isWrapUnwrap ? '' : tokenIn,
    isWrapUnwrap ? '' : tokenOut,
    isWrapUnwrap ? 0n : parsedAmountIn,
    slippageSafe,
  )
  const route = needsUnwrapStep ? routing.vammOnly : routing.best
  const hasNonVammHop = !!route && route.steps.some(s => s.poolType !== 0)

  const oneInchEligible = !isWrapUnwrap && !needsWrapStep && !needsUnwrapStep
  const oneInch = useOneInchQuote(
    oneInchEligible ? tokenIn : '',
    oneInchEligible ? tokenOut : '',
    oneInchEligible ? parsedAmountIn : 0n,
  )
  const oneInchAmount = (oneInchEligible && oneInch.configured && oneInch.amountOut !== null) ? oneInch.amountOut : null
  const beatsOwnRoute = oneInchAmount !== null && oneInchAmount > (route?.amountOut ?? 0n)
  const use1inch      = beatsOwnRoute

  const swapTokenInAddr = needsWrapStep ? WETH_ADDR : (tokenInMeta.address as `0x${string}`)
  const swapSpender     = use1inch
    ? ONEINCH_ROUTER
    : needsUnwrapStep
    ? CONTRACTS.SwapUnwrapHelper
    : (route?.split || hasNonVammHop)
    ? CONTRACTS.UniversalRouter
    : CONTRACTS.AeonRouter

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: swapTokenInAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, swapSpender] : undefined,
    query: { enabled: !!address && !isWrapUnwrap && swapTokenInAddr !== NATIVE_SENTINEL },
  })

  const { writeContract, data: approveTxHash, isPending: isApproving, error: approveError } = useWriteContract()
  const { writeContract: writeAction, data: writeActionTxHash, isPending: isWriteActing, error: actionError } = useWriteContract()
  const { sendTransaction, data: sendTxHash, isPending: isSending, error: sendError } = useSendTransaction()
  const actionTxHash = writeActionTxHash ?? sendTxHash
  const isActing = isWriteActing || isSending
  const { isLoading: isApproveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: isActionConfirming, isSuccess: actionSuccess }   = useWaitForTransactionReceipt({ hash: actionTxHash })

  const flip = useCallback(() => {
    playSwitch()
    setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn(''); setStep('idle')
    setFlipSpin(s => s + 180)
  }, [tokenIn, tokenOut, playSwitch])

  useEffect(() => { setStep('idle') }, [tokenIn, tokenOut])

  useEffect(() => {
    if (step !== 'done') return
    playSuccess()
    setCelebrate(true)
    showToast({
      type: 'success',
      title: 'Swap Completed Successfully!',
      message: `Swapped ${amountIn} ${tokenIn} for ${tokenOut}`,
      txHash: actionTxHash,
    })
    const t = setTimeout(() => setCelebrate(false), 50)
    return () => clearTimeout(t)
  }, [step, playSuccess, showToast, amountIn, tokenIn, tokenOut, actionTxHash])

  let amountOutWei  = 0n
  let priceImpact   = 0
  if (isWrapUnwrap) {
    amountOutWei = parsedAmountIn
  } else if (use1inch) {
    amountOutWei = oneInch.amountOut!
  } else if (route) {
    amountOutWei = route.amountOut
    priceImpact  = route.priceImpact
  }

  const amountOutFormatted = amountOutWei > 0n
    ? parseFloat(formatUnits(amountOutWei, tokenOutMeta.decimals)).toFixed(6)
    : ''

  const hasAmount      = parsedAmountIn > 0n
  const needsApproval  = !isWrapUnwrap && hasAmount && allowance !== undefined && allowance < parsedAmountIn
  const highSlippage   = slippageSafe >= 5
  const amountOutMin   = amountOutWei > 0n
    ? (amountOutWei * BigInt(Math.floor((1 - slippagePct) * 10000))) / 10000n
    : 0n

  const spotRate = isWrapUnwrap ? 1
    : amountOutWei > 0n && parsedAmountIn > 0n
      ? parseFloat(formatUnits(amountOutWei, tokenOutMeta.decimals)) /
        parseFloat(formatUnits(parsedAmountIn, tokenInMeta.decimals))
      : 0

  function setPercent(pct: number) {
    playClick()
    if (!isConnected || balanceIn.raw === 0n) return
    const portion = (balanceIn.raw * BigInt(pct)) / 100n
    setAmountIn(parseFloat(formatUnits(portion, balanceIn.decimals)).toFixed(6))
  }

  function buildLegacySteps() {
    if (!route) return []
    return route.steps.map(step => ({
      tokenIn:  step.tokenIn  === 'ETH' ? WETH_ADDR : (TOKENS[step.tokenIn  as TokenKey]?.address ?? step.poolAddress),
      tokenOut: step.tokenOut === 'ETH' ? WETH_ADDR : (TOKENS[step.tokenOut as TokenKey]?.address ?? step.poolAddress),
      pool:     step.poolAddress,
      poolType: 0,
      feeBps:   Number(step.feeBps),
    }))
  }

  function stepToHop(step: RouteStep) {
    return {
      poolType: step.poolType,
      pool:     (step.poolType === 0 || step.poolType === 3) ? step.poolAddress : ZERO_ADDR,
      tokenIn:  step.tokenIn  === 'ETH' ? WETH_ADDR : (TOKENS[step.tokenIn  as TokenKey]?.address ?? ZERO_ADDR),
      tokenOut: step.tokenOut === 'ETH' ? WETH_ADDR : (TOKENS[step.tokenOut as TokenKey]?.address ?? ZERO_ADDR),
      feeBps:   Number(step.feeBps),
      binStep:  step.binStep,
      tickSpacing: 0,
      v4Native: false,
    }
  }

  function buildUniversalHops() {
    if (!route) return []
    return route.steps.map(stepToHop)
  }

  function buildSplitLegs() {
    if (!route?.split) return []
    const s = route.split
    return [
      { hops: [stepToHop(s.aeonStep)], amountIn: s.aeonAmountIn },
      { hops: s.remainderSteps.map(stepToHop), amountIn: s.remainderAmountIn },
    ]
  }

  async function fire1inchSwap() {
    if (!address) return
    try {
      const params = new URLSearchParams({
        src: tokenIn === 'ETH' ? NATIVE_SENTINEL : tokenInMeta.address,
        dst: tokenOut === 'ETH' ? NATIVE_SENTINEL : tokenOutMeta.address,
        amount: parsedAmountIn.toString(),
        from: address,
        slippage: String(slippageSafe),
      })
      const res = await fetch(`/api/oneinch/swap?${params.toString()}`)
      const body = await res.json()
      if (!body.configured || body.error) throw new Error(body.error ?? '1inch swap unavailable')
      sendTransaction({ to: body.tx.to as `0x${string}`, data: body.tx.data as `0x${string}`, value: BigInt(body.tx.value) })
      setStep('swap_wait')
      showToast({ type: 'pending', title: '1inch Swap Submitted', message: 'Waiting for blockchain confirmation...' })
    } catch (e: any) {
      playError()
      setErrMsgState(e?.message ?? '1inch swap failed')
      setStep('idle')
      showToast({ type: 'error', title: 'Swap Failed', message: e?.message ?? 'Transaction cancelled or failed' })
    }
  }

  function fireSwap() {
    if (!address) return
    if (use1inch) { fire1inchSwap(); return }
    const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + (deadline * 60))
    if (needsUnwrapStep) {
      const steps = buildLegacySteps()
      writeAction({ address: CONTRACTS.SwapUnwrapHelper, abi: AEON_SWAP_UNWRAP_HELPER_ABI, functionName: 'swapExactTokensForETH', args: [steps, parsedAmountIn, amountOutMin, address, deadlineTimestamp] })
    } else if (route?.split) {
      const legs = buildSplitLegs()
      writeAction({ address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapSplitExactTokensForTokens', args: [legs, amountOutMin, address, deadlineTimestamp] })
    } else if (hasNonVammHop) {
      const hops = buildUniversalHops()
      writeAction({ address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [hops, parsedAmountIn, amountOutMin, address, deadlineTimestamp] })
    } else {
      const steps = buildLegacySteps()
      writeAction({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [steps, parsedAmountIn, amountOutMin, address, deadlineTimestamp] })
    }
    setStep('swap_wait')
    showToast({ type: 'pending', title: 'Submitting Swap', message: 'Confirm the transaction in your wallet.' })
  }

  function handleSwapClick() {
    playClick()
    if (!isConnected) { openConnectModal?.(); return }
    if (!hasAmount || !address) return

    if (isWrapUnwrap) {
      if (tokenIn === 'ETH') {
        writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'deposit', args: [], value: parsedAmountIn })
      } else {
        writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'withdraw', args: [parsedAmountIn] })
      }
      setStep('swap_wait')
      showToast({ type: 'pending', title: tokenIn === 'ETH' ? 'Wrapping ETH' : 'Unwrapping WETH', message: 'Waiting for receipt...' })
      return
    }

    if (!route && !use1inch) return

    if (needsWrapStep) {
      writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'deposit', args: [], value: parsedAmountIn })
      setStep('wrap_wait')
      showToast({ type: 'pending', title: 'Wrapping ETH to WETH', message: 'First step in multi-hop route...' })
      return
    }

    if (needsApproval) {
      writeContract({ address: swapTokenInAddr, abi: ERC20_ABI, functionName: 'approve', args: [swapSpender, parsedAmountIn] })
      setStep('approve_wait')
      showToast({ type: 'pending', title: `Approving ${tokenInMeta.symbol}`, message: 'Waiting for allowance confirmation...' })
      return
    }

    fireSwap()
  }

  useEffect(() => {
    if (!actionSuccess) return
    if (step === 'wrap_wait') {
      refetchAllowance().then(res => {
        if ((res.data ?? 0n) < parsedAmountIn) {
          writeContract({ address: swapTokenInAddr, abi: ERC20_ABI, functionName: 'approve', args: [swapSpender, parsedAmountIn] })
          setStep('approve_wait')
        } else {
          fireSwap()
        }
      })
      return
    }
    if (step === 'swap_wait') { setStep('done'); return }
  }, [actionSuccess])

  useEffect(() => {
    if (!approveSuccess) return
    refetchAllowance()
    showToast({ type: 'success', title: 'Approval Confirmed!', message: 'Executing your swap...' })
    if (step === 'approve_wait') fireSwap()
  }, [approveSuccess])

  useEffect(() => {
    if (approveError) {
      playError()
      setErrMsgState(approveError.message)
      setStep('idle')
      showToast({ type: 'error', title: 'Approval Rejected', message: approveError.message })
    }
  }, [approveError])

  useEffect(() => {
    if (actionError) {
      playError()
      setErrMsgState(actionError.message)
      setStep('idle')
      showToast({ type: 'error', title: 'Swap Failed', message: actionError.message })
    }
  }, [actionError])

  useEffect(() => {
    if (sendError) {
      playError()
      setErrMsgState(sendError.message)
      setStep('idle')
      showToast({ type: 'error', title: 'Swap Failed', message: sendError.message })
    }
  }, [sendError])

  useEffect(() => { if (hasAmount) setErrMsgState('') }, [amountIn, tokenIn, tokenOut])

  const isBusy = isApproving || isApproveConfirming || isActing || isActionConfirming || (step !== 'idle' && step !== 'done')
  const isFlowLocked = step !== 'idle' && step !== 'done'

  function sanitizeErr(msg?: string): string {
    if (!msg) return ''
    return msg.replace(/https?:\/\/\S+/g, '[url]').replace(/0x[0-9a-fA-F]{20,}/g, '[addr]').slice(0, 120)
  }
  const errMsg = sanitizeErr(manualErrMsg)

  const noRoute     = hasAmount && !route && !use1inch && !isWrapUnwrap
  const overBal     = hasAmount && balanceIn.raw > 0n && parsedAmountIn > balanceIn.raw
  const noLiquidity = hasAmount && route && route.amountOut === 0n && !use1inch

  function buttonLabel() {
    if (!isConnected)  return 'Connect Wallet to Swap'
    if (!hasAmount)    return 'Enter an amount'
    if (overBal)       return 'Insufficient balance'
    if (noRoute)       return 'No route found'
    if (noLiquidity)   return 'Insufficient liquidity'
    if (step === 'wrap' || step === 'wrap_wait')       return 'Wrapping ETH…'
    if (step === 'approve' || step === 'approve_wait') return `Approving ${needsWrapStep ? 'WETH' : tokenInMeta.symbol}…`
    if (step === 'swap_wait' && !isWrapUnwrap)         return 'Swapping…'
    if (isWrapUnwrap && step === 'swap_wait')          return tokenIn === 'ETH' ? 'Wrapping…' : 'Unwrapping…'
    if (step === 'done')   return '✓ Swap complete!'
    if (badPrice)      return 'Pool price too far from market'
    if (needsApproval) return `Approve ${tokenInMeta.symbol}`
    if (isWrapUnwrap)  return tokenIn === 'ETH' ? 'Wrap ETH → WETH' : 'Unwrap WETH → ETH'
    if (needsWrapStep) return `Wrap & Swap ${tokenInMeta.symbol} → ${tokenOutMeta.symbol}`
    return `Swap ${tokenInMeta.symbol} → ${tokenOutMeta.symbol}`
  }

  function fmtUsd(n: number | null): string {
    if (!n || n <= 0) return ''
    if (n >= 1_000_000) return `≈ $${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)    return `≈ $${(n / 1_000).toFixed(2)}K`
    return `≈ $${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const priceIn  = prices[tokenIn as TokenKey]  ?? null
  const priceOut = prices[tokenOut as TokenKey] ?? null
  const valueIn  = amountIn && parseFloat(amountIn) > 0 && priceIn  ? parseFloat(amountIn)          * priceIn  : null
  const valueOut = amountOutFormatted && priceOut                    ? parseFloat(amountOutFormatted) * priceOut : null

  const marketDeviation = (() => {
    if (isWrapUnwrap || !priceIn || !priceOut || spotRate <= 0) return 0
    const marketRate = priceIn / priceOut
    return ((marketRate - spotRate) / marketRate) * 100
  })()
  const badPrice = marketDeviation > 25

  const disabled = isConnected && (!hasAmount || overBal || (noRoute && !isWrapUnwrap) || !!noLiquidity || isBusy || badPrice)

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 lg:py-12">
      {/* Page Title & Mobile Chart Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-white">Instant Swap</h1>
            <span className="badge-green">Robinhood Chain</span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Automated multi-hop routing across vAMM, Algebra CL & DLMM liquidity
          </p>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { playClick(); setShowChartOnMobile(!showChartOnMobile) }}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#101726] border border-[#1E2B44] text-xs font-mono text-slate-300 hover:text-white"
          >
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            <span>{showChartOnMobile ? 'Hide Chart' : 'Show Chart'}</span>
          </button>
          <button
            onClick={() => { playClick(); setShowSettings(true) }}
            className="p-2.5 rounded-xl bg-[#101726] border border-[#1E2B44] text-slate-400 hover:text-white hover:border-emerald-500/40 transition-colors"
            title="Swap Settings"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Main Grid: Left Swap Card, Right Live Chart & Token Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Swap Card */}
        <div className="lg:col-span-6 space-y-4">
          <div
            className={clsx('card p-4 sm:p-5 relative transition-shadow duration-500', step === 'done' && 'ring-1 ring-emerald-400/40')}
            style={{ boxShadow: step === 'done' ? '0 0 40px -12px rgba(16,185,129,0.4)' : isBusy ? '0 0 40px -14px rgba(255,184,0,0.35)' : '0 0 30px -18px rgba(16,185,129,0.2)' }}
          >
            <ConfettiBurst trigger={celebrate} />

            {/* Token In Box */}
            <div className="bg-[#0E1424] border border-[#1C2840] rounded-2xl p-4 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">You Pay</span>
                <span className="text-xs text-slate-400 font-mono">Balance: {balanceIn.formatted}</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={amountIn}
                  onChange={e => setAmountIn(e.target.value)}
                  disabled={isFlowLocked}
                  placeholder="0.0"
                  className="flex-1 bg-transparent text-2xl sm:text-3xl font-mono text-white placeholder-slate-600 focus:outline-none disabled:opacity-60"
                />
                <button
                  onClick={() => { playClick(); !isFlowLocked && setShowTokenSelect('in') }}
                  disabled={isFlowLocked}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#141E34] border border-[#233558] hover:border-emerald-400/40 transition-all shrink-0"
                >
                  <TokenIcon symbol={tokenIn as TokenKey} size={24} />
                  <span className="font-display font-bold text-sm text-white">{tokenInMeta.symbol}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#182338]">
                <span className="text-xs text-slate-400 font-mono">{valueIn ? fmtUsd(valueIn) : '≈ $—'}</span>
                <div className="flex gap-1.5">
                  {(['25', '50', 'MAX'] as const).map(label => (
                    <button
                      key={label}
                      onClick={() => setPercent(label === 'MAX' ? 100 : parseInt(label))}
                      disabled={!isConnected || isFlowLocked}
                      className="text-2xs text-slate-400 hover:text-emerald-400 px-2 py-0.5 rounded-lg bg-[#121A2C] border border-[#1E2B44] hover:border-emerald-400/40 font-mono transition-all disabled:opacity-40"
                    >
                      {label === '25' ? '25%' : label === '50' ? '50%' : 'MAX'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Flip Button */}
            <div className="flex justify-center -my-3 relative z-10">
              <button
                onClick={flip}
                disabled={isFlowLocked}
                className="w-10 h-10 rounded-2xl bg-[#101728] border border-[#223354] hover:border-emerald-400 text-slate-300 hover:text-emerald-400 hover:scale-110 active:scale-95 transition-all flex items-center justify-center shadow-lg disabled:opacity-60"
              >
                <ArrowUpDown size={16} style={{ transform: `rotate(${flipSpin}deg)`, transition: 'transform 0.4s ease' }} />
              </button>
            </div>

            {/* Token Out Box */}
            <div className="bg-[#0E1424] border border-[#1C2840] rounded-2xl p-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">You Receive</span>
                <span className="text-xs text-slate-400 font-mono">Balance: {balanceOut.formatted}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-2xl sm:text-3xl font-mono text-white">
                  {amountOutFormatted || <span className="text-slate-600">0.0</span>}
                </div>
                <button
                  onClick={() => { playClick(); !isFlowLocked && setShowTokenSelect('out') }}
                  disabled={isFlowLocked}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#141E34] border border-[#233558] hover:border-emerald-400/40 transition-all shrink-0"
                >
                  <TokenIcon symbol={tokenOut as TokenKey} size={24} />
                  <span className="font-display font-bold text-sm text-white">{tokenOutMeta.symbol}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#182338]">
                <span className="text-xs text-slate-400 font-mono">{valueOut ? fmtUsd(valueOut) : '≈ $—'}</span>
                <span className="text-2xs font-mono text-emerald-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  {use1inch ? '1inch Route' : route?.split ? 'Split Route' : 'Auto Optimized'}
                </span>
              </div>
            </div>

            {/* Dynamic Route Visualizer */}
            {hasAmount && route?.steps && route.steps.length > 0 && !isWrapUnwrap && (
              <div className="mt-3">
                <RouteVisualizer
                  steps={route.steps}
                  fromSymbol={tokenInMeta.symbol}
                  toSymbol={tokenOutMeta.symbol}
                  priceImpact={priceImpact}
                  minOutputFormatted={parseFloat(formatUnits(amountOutMin, tokenOutMeta.decimals)).toFixed(6)}
                />
              </div>
            )}

            {/* Wrap chain notice */}
            {needsWrapStep && hasAmount && (
              <div className="mt-3 p-3 bg-[#101728] border border-sky-500/20 rounded-xl text-xs text-slate-300 space-y-1">
                <div className="flex items-center gap-1.5 text-sky-400 font-semibold">
                  <Zap className="w-3.5 h-3.5" /> Auto ETH Wrap
                </div>
                <p className="text-2xs text-slate-400">
                  This swap automatically wraps native ETH into WETH before routing to {tokenOutMeta.symbol}.
                </p>
              </div>
            )}

            {/* High slippage warning */}
            {highSlippage && (
              <div className="mt-3 p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 text-center font-mono">
                ⚠ Slippage {slippageSafe}% — high risk of frontrunning
              </div>
            )}

            {/* Error Message Display */}
            {errMsg && (
              <div className="mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">
                {errMsg}
              </div>
            )}

            {/* Swap Button */}
            <div className="mt-4">
              <button
                onClick={handleSwapClick}
                disabled={disabled}
                className="btn-primary w-full text-base py-4 flex items-center justify-center gap-2"
              >
                {isBusy && <Loader2 size={16} className="animate-spin" />}
                {buttonLabel()}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Live Chart & Token Stats */}
        <div className={clsx('lg:col-span-6 space-y-4', !showChartOnMobile && 'hidden lg:block')}>
          <SwapChart
            fromTokenSymbol={tokenInMeta.symbol}
            toTokenSymbol={tokenOutMeta.symbol}
            currentRate={spotRate > 0 ? spotRate : (priceIn && priceOut ? priceIn / priceOut : 1)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TokenInfoCard
              tokenKey={tokenIn as TokenKey}
              info={dexInfo[tokenIn]}
              price={prices[tokenIn as TokenKey] ?? null}
              onChainSparkline={volResult.priceHistory[tokenIn]}
              dexStats={dexTokenStats(dexScreenerPairs, tokenIn)}
            />
            <TokenInfoCard
              tokenKey={tokenOut as TokenKey}
              info={dexInfo[tokenOut]}
              price={prices[tokenOut as TokenKey] ?? null}
              onChainSparkline={volResult.priceHistory[tokenOut]}
              dexStats={dexTokenStats(dexScreenerPairs, tokenOut)}
            />
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SwapSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadline={deadline}
        onDeadlineChange={setDeadline}
      />

      {/* Token Select Modal */}
      {showTokenSelect && (
        <EnhancedTokenSelectModal
          isOpen={!!showTokenSelect}
          onClose={() => setShowTokenSelect(null)}
          onSelectToken={(token: TokenItem) => {
            playClick()
            if (showTokenSelect === 'in') setTokenIn(token.symbol)
            else setTokenOut(token.symbol)
            setShowTokenSelect(null)
          }}
          selectedTokenAddress={showTokenSelect === 'in' ? tokenInMeta.address : tokenOutMeta.address}
        />
      )}
    </div>
  )
}

function TokenInfoCard({ tokenKey, info, price, onChainSparkline, dexStats }: {
  tokenKey: TokenKey
  info: ReturnType<typeof useDexTokenInfo>[string] | undefined
  price: number | null
  onChainSparkline: number[] | undefined
  dexStats: ReturnType<typeof dexTokenStats>
}) {
  const token = TOKENS[tokenKey]
  if (!token) return null

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const displayPrice  = mounted ? (dexStats.priceUsd ?? price) : null
  const change        = mounted ? (dexStats.priceChange24h ?? info?.priceChange24h ?? null) : null
  const volume24h     = mounted ? dexStats.volume24h : null
  const geckoSparkline = mounted ? (info?.sparkline ?? []) : []
  const chainSparkline = mounted ? (onChainSparkline ?? []) : []

  const usingGecko = geckoSparkline.length >= 2
  const usingChain = !usingGecko && chainSparkline.length >= 2
  const sparkline = usingGecko ? geckoSparkline : chainSparkline
  const positive = usingChain
    ? (sparkline.length < 2 || sparkline[sparkline.length - 1] >= sparkline[0])
    : (change === null || change >= 0)

  const poolCount = POOL_COUNT_BY_SYMBOL[tokenKey] ?? 0
  const explorerUrl = robinhoodChain.blockExplorers?.default.url
  const isNative = token.address === NATIVE_SENTINEL

  return (
    <div
      className="card p-4 transition-shadow duration-500"
      style={{ boxShadow: change !== null ? `0 0 30px -20px ${positive ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}` : undefined }}
    >
      <div className="flex items-start gap-3">
        <TokenIcon symbol={tokenKey} size={36} imageUrl={info?.imageUrl} />
        <div className="min-w-0">
          <div className="font-display font-bold text-text-primary leading-tight truncate">{token.symbol}</div>
          <div className="text-xs text-text-muted truncate">{token.name}</div>
        </div>
        <div className="ml-auto text-right shrink-0">
          <div className="font-mono text-sm text-text-primary">{fmtPrice(displayPrice)}</div>
          {change !== null && (
            <div className={clsx('flex items-center justify-end gap-0.5 text-2xs font-mono mt-0.5', positive ? 'text-emerald-400' : 'text-red-400')}>
              {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      {sparkline.length >= 2 ? (
        <div className="mt-3">
          <Sparkline prices={sparkline} positive={positive} width={240} height={48} />
          <div className="text-2xs text-text-muted mt-1">{usingGecko ? '24h · hourly' : 'Recent trades · on-chain'}</div>
        </div>
      ) : (
        <div className="text-2xs text-text-muted text-center py-3 mt-1">No chart data yet</div>
      )}

      <div className="mt-3 pt-3 border-t border-bg-border space-y-1.5">
        {volume24h !== null && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">Volume 24h</span>
            <span className="font-mono text-text-secondary">${volume24h.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">In pools</span>
          <span className="font-mono text-text-secondary">{poolCount}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-muted">{isNative ? 'Asset' : 'Contract'}</span>
          {isNative ? (
            <span className="font-mono text-text-secondary">Native token</span>
          ) : explorerUrl ? (
            <a
              href={`${explorerUrl}/token/${token.address}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 font-mono text-emerald-400 hover:underline"
            >
              {token.address.slice(0, 6)}…{token.address.slice(-4)} <ExternalLink size={10} />
            </a>
          ) : (
            <span className="font-mono text-text-secondary">{token.address.slice(0, 6)}…{token.address.slice(-4)}</span>
          )}
        </div>
        {!isNative && (
          <div className="flex justify-end pt-1">
            <AddToWalletButton tokenKey={tokenKey} />
          </div>
        )}
      </div>
    </div>
  )
}
