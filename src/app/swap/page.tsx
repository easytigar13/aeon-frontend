'use client'
import { useState, useCallback, useEffect } from 'react'
import { ArrowUpDown, Settings, ChevronDown, Loader2, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { TOKENS, POOLS, CL_POOLS, DLMM_POOLS, CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { robinhoodChain } from '@/config/chain'
import { AEON_ROUTER_ABI, AEON_UNIVERSAL_ROUTER_ABI, AEON_SWAP_UNWRAP_HELPER_ABI, ERC20_ABI, WETH_ABI } from '@/config/abis'
import { useRouting } from '@/hooks/useRouting'
import { usePrices } from '@/hooks/usePrices'
import { useDexTokenInfo } from '@/hooks/useDexTokenInfo'
import { useVolume24h } from '@/hooks/useVolume24h'
import { useDexScreenerPairs, dexTokenStats } from '@/hooks/useDexScreener'
import { TokenIcon } from '@/components/TokenIcon'
import { Sparkline } from '@/components/Sparkline'
import { AddToWalletButton } from '@/components/AddToWalletButton'

type TokenKey = keyof typeof TOKENS

// Clamp slippage to a safe range; returns a valid number between 0.01 and 49
function safeSlippage(raw: string): number {
  const n = parseFloat(raw)
  if (!isFinite(n) || n < 0.01) return 0.5   // bad input → safe default
  if (n > 49) return 49                        // cap — above 49% is almost certainly a mistake
  return n
}

// Safe parseUnits that handles excess decimals without throwing
function safeParseUnits(val: string, decimals: number): bigint {
  if (!val || parseFloat(val) <= 0) return 0n
  try {
    return parseUnits(val, decimals)
  } catch {
    // Truncate to allowed decimal places and retry
    const [int, dec = ''] = val.split('.')
    return parseUnits(`${int}.${dec.slice(0, decimals)}`, decimals)
  }
}

const TOKEN_LIST = Object.entries(TOKENS).map(([key, val]) => ({ key: key as TokenKey, ...val }))
const WETH_ADDR = TOKENS['WETH'].address
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

// symbol → number of pools (across all 3 pool types) that hold it
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

function useTokenBalance(tokenKey: TokenKey, address?: `0x${string}`) {
  const token = TOKENS[tokenKey]
  const isNative = token.address === NATIVE_SENTINEL
  const { data } = useBalance({
    address,
    token: isNative ? undefined : token.address,
    query: { enabled: !!address },
  })
  if (!address || !data) return { formatted: '—', raw: 0n, decimals: 18 }
  return { formatted: parseFloat(formatUnits(data.value, data.decimals)).toFixed(4), raw: data.value, decimals: data.decimals }
}

// idle -> [wrap -> wrap_wait] -> [approve -> approve_wait] -> swap -> swap_wait -> done
// Every step but 'swap' is conditional on the token pair — a plain ERC20<->ERC20
// swap with existing allowance skips straight from idle to swap. Swap-into-ETH
// used to be its own extra [unwrap -> unwrap_wait] tail (a second wallet
// prompt calling WETH.withdraw() directly) -- now bundled into a single
// 'swap' call to AeonSwapUnwrapHelper, so this is one wallet prompt, not two.
type Step = 'idle' | 'wrap' | 'wrap_wait' | 'approve' | 'approve_wait' | 'swap' | 'swap_wait' | 'done'

export default function SwapPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenIn,  setTokenIn]  = useState<TokenKey>('ETH')
  const [tokenOut, setTokenOut] = useState<TokenKey>('AEON')
  const [amountIn, setAmountIn] = useState('')
  const [slippage, setSlippage] = useState('0.5')
  const [showSettings,      setShowSettings]      = useState(false)
  const [showTokenInModal,  setShowTokenInModal]  = useState(false)
  const [showTokenOutModal, setShowTokenOutModal] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [manualErrMsg, setErrMsgState] = useState('')

  const balanceIn  = useTokenBalance(tokenIn,  address)
  const balanceOut = useTokenBalance(tokenOut, address)
  const prices     = usePrices()
  const dexInfo    = useDexTokenInfo()
  const volResult  = useVolume24h(prices)
  const dexScreenerPairs = useDexScreenerPairs()

  // Direct ETH<->WETH pair: a single deposit()/withdraw() call, no router involved.
  const isWrapUnwrap = (tokenIn === 'ETH' && tokenOut === 'WETH') || (tokenIn === 'WETH' && tokenOut === 'ETH')
  // Any other pair touching native ETH needs an auto wrap-then-swap or swap-then-unwrap chain,
  // since AeonRouterRH only implements swapExactTokensForTokens (ERC20 in, ERC20 out).
  const needsWrapStep   = tokenIn  === 'ETH' && !isWrapUnwrap
  const needsUnwrapStep = tokenOut === 'ETH' && !isWrapUnwrap

  const parsedAmountIn = safeParseUnits(amountIn, TOKENS[tokenIn].decimals)

  // Multi-hop routing (skipped for wrap/unwrap) — useRouting already normalises ETH -> WETH internally.
  // Searches across vAMM + CL + DLMM together (AeonUniversalRouter can chain
  // all three), but ETH-output swaps go through AeonSwapUnwrapHelper, which
  // only knows how to call the older vAMM-only AeonRouterRH -- so that case
  // always uses the vAMM-only fallback route, even if a mixed route would be
  // marginally better, to keep that path on its proven contract.
  const routing = useRouting(
    isWrapUnwrap ? '' : tokenIn,
    isWrapUnwrap ? '' : tokenOut,
    isWrapUnwrap ? 0n : parsedAmountIn,
  )
  const route = needsUnwrapStep ? routing.vammOnly : routing.best
  const hasNonVammHop = !!route && route.steps.some(s => s.poolType !== 0)

  // The address actually approved/spent for this swap — WETH when starting
  // from native ETH. Spender is the unwrap helper when the output is native
  // ETH (that contract pulls the input tokens for that path); the universal
  // router when the best route crosses pool types; otherwise the plain
  // vAMM-only router, unchanged from before.
  const swapTokenInAddr = needsWrapStep ? WETH_ADDR : TOKENS[tokenIn].address
  const swapSpender     = needsUnwrapStep ? CONTRACTS.SwapUnwrapHelper : hasNonVammHop ? CONTRACTS.UniversalRouter : CONTRACTS.AeonRouter

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: swapTokenInAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, swapSpender] : undefined,
    query: { enabled: !!address && !isWrapUnwrap },
  })

  const { writeContract, data: approveTxHash, isPending: isApproving, error: approveError } = useWriteContract()
  const { writeContract: writeAction, data: actionTxHash, isPending: isActing, error: actionError } = useWriteContract()
  const { isLoading: isApproveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: isActionConfirming, isSuccess: actionSuccess }   = useWaitForTransactionReceipt({ hash: actionTxHash })

  const flip = useCallback(() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn(''); setStep('idle') }, [tokenIn, tokenOut])

  // Reset the flow whenever the pair changes so a stale step never carries over.
  useEffect(() => { setStep('idle') }, [tokenIn, tokenOut])

  // Determine final amountOut
  let amountOutWei  = 0n
  let priceImpact   = 0
  if (isWrapUnwrap) {
    amountOutWei = parsedAmountIn
  } else if (route) {
    amountOutWei = route.amountOut
    priceImpact  = route.priceImpact
  }

  const amountOutFormatted = amountOutWei > 0n
    ? parseFloat(formatUnits(amountOutWei, TOKENS[tokenOut].decimals)).toFixed(6)
    : ''

  const hasAmount      = parsedAmountIn > 0n
  const needsApproval  = !isWrapUnwrap && hasAmount && allowance !== undefined && allowance < parsedAmountIn
  const slippageSafe   = safeSlippage(slippage)          // always 0.01–49, never NaN
  const slippagePct    = slippageSafe / 100
  const highSlippage   = slippageSafe >= 5
  const amountOutMin   = amountOutWei > 0n
    ? (amountOutWei * BigInt(Math.floor((1 - slippagePct) * 10000))) / 10000n
    : 0n

  // Spot rate display (from the route's first step or 1:1 for wrap)
  const spotRate = isWrapUnwrap ? 1
    : amountOutWei > 0n && parsedAmountIn > 0n
      ? parseFloat(formatUnits(amountOutWei, TOKENS[tokenOut].decimals)) /
        parseFloat(formatUnits(parsedAmountIn, TOKENS[tokenIn].decimals))
      : 0


  function setPercent(pct: number) {
    if (!isConnected || balanceIn.raw === 0n) return
    const portion = (balanceIn.raw * BigInt(pct)) / 100n
    setAmountIn(parseFloat(formatUnits(portion, balanceIn.decimals)).toFixed(6))
  }

  // Steps for AeonRouterRH / AeonSwapUnwrapHelper — both only ever implement
  // poolType 0, so this is only ever called for a route guaranteed all-vAMM
  // (either routing.vammOnly directly, or routing.best when hasNonVammHop is false).
  function buildLegacySteps() {
    if (!route) return []
    return route.steps.map(step => ({
      tokenIn:  step.tokenIn  === 'ETH' ? WETH_ADDR : TOKENS[step.tokenIn  as keyof typeof TOKENS].address,
      tokenOut: step.tokenOut === 'ETH' ? WETH_ADDR : TOKENS[step.tokenOut as keyof typeof TOKENS].address,
      pool:     step.poolAddress,
      poolType: 0,
      feeBps:   Number(step.feeBps),
    }))
  }

  // Hops for AeonUniversalRouter — used whenever the best route crosses pool
  // types. CL/DLMM hops pass address(0) for `pool` (Algebra derives its pool
  // from tokenIn/tokenOut/deployer; the LB router derives its pair from
  // tokenPath/binStep) — neither needs an explicit pool address. vAMM (0) and
  // external Uniswap V2 (3) hops both need the real pool/pair address, since
  // the router calls that contract directly rather than going through an
  // intermediary router.
  function buildUniversalHops() {
    if (!route) return []
    return route.steps.map(step => ({
      poolType: step.poolType,
      pool:     (step.poolType === 0 || step.poolType === 3) ? step.poolAddress : ZERO_ADDR,
      tokenIn:  step.tokenIn  === 'ETH' ? WETH_ADDR : TOKENS[step.tokenIn  as keyof typeof TOKENS].address,
      tokenOut: step.tokenOut === 'ETH' ? WETH_ADDR : TOKENS[step.tokenOut as keyof typeof TOKENS].address,
      feeBps:   Number(step.feeBps),
      binStep:  step.binStep,
    }))
  }

  // Fires the actual swap. Output-is-ETH goes through AeonSwapUnwrapHelper
  // (one call: swap + unwrap + send native ETH) instead of the plain router,
  // so there's no separate WETH.withdraw() step left for the wallet to show.
  // A route crossing pool types goes through AeonUniversalRouter instead of
  // the older vAMM-only AeonRouterRH.
  function fireSwap() {
    if (!address) return
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
    if (needsUnwrapStep) {
      const steps = buildLegacySteps()
      writeAction({ address: CONTRACTS.SwapUnwrapHelper, abi: AEON_SWAP_UNWRAP_HELPER_ABI, functionName: 'swapExactTokensForETH', args: [steps, parsedAmountIn, amountOutMin, address, deadline] })
    } else if (hasNonVammHop) {
      const hops = buildUniversalHops()
      writeAction({ address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [hops, parsedAmountIn, amountOutMin, address, deadline] })
    } else {
      const steps = buildLegacySteps()
      writeAction({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [steps, parsedAmountIn, amountOutMin, address, deadline] })
    }
    setStep('swap_wait')
  }

  function handleSwapClick() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!hasAmount || !address) return

    if (isWrapUnwrap) {
      if (tokenIn === 'ETH') {
        writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'deposit', args: [], value: parsedAmountIn })
      } else {
        writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'withdraw', args: [parsedAmountIn] })
      }
      setStep('swap_wait') // reuses the same "done" landing as a plain swap; no unwrap follows a direct wrap/unwrap
      return
    }

    if (!route) return

    if (needsWrapStep) {
      writeAction({ address: WETH_ADDR, abi: WETH_ABI, functionName: 'deposit', args: [], value: parsedAmountIn })
      setStep('wrap_wait')
      return
    }

    if (needsApproval) {
      writeContract({ address: swapTokenInAddr, abi: ERC20_ABI, functionName: 'approve', args: [swapSpender, maxUint256] })
      setStep('approve_wait')
      return
    }

    fireSwap()
  }

  // Advance the chain once each step's transaction confirms.
  useEffect(() => {
    if (!actionSuccess) return
    if (step === 'wrap_wait') {
      refetchAllowance().then(res => {
        if ((res.data ?? 0n) < parsedAmountIn) {
          writeContract({ address: swapTokenInAddr, abi: ERC20_ABI, functionName: 'approve', args: [swapSpender, maxUint256] })
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
    if (step === 'approve_wait') fireSwap()
  }, [approveSuccess])

  useEffect(() => { if (approveError) { setErrMsgState(approveError.message); setStep('idle') } }, [approveError])
  useEffect(() => { if (actionError)  { setErrMsgState(actionError.message);  setStep('idle') } }, [actionError])
  useEffect(() => { if (hasAmount) setErrMsgState('') }, [amountIn, tokenIn, tokenOut])

  const isBusy  = isApproving || isApproveConfirming || isActing || isActionConfirming || (step !== 'idle' && step !== 'done')
  const isFlowLocked = step !== 'idle' && step !== 'done' // freeze inputs mid-chain so amountOutMin/route stay consistent with the tx already in flight

  function sanitizeErr(msg?: string): string {
    if (!msg) return ''
    // Strip URLs and long hex strings that could be used for social engineering
    return msg.replace(/https?:\/\/\S+/g, '[url]').replace(/0x[0-9a-fA-F]{20,}/g, '[addr]').slice(0, 120)
  }
  const errMsg  = sanitizeErr(manualErrMsg)

  const noRoute     = hasAmount && !route && !isWrapUnwrap
  const overBal     = hasAmount && balanceIn.raw > 0n && parsedAmountIn > balanceIn.raw
  const noLiquidity = hasAmount && route && route.amountOut === 0n

  function buttonLabel() {
    if (!isConnected)  return 'Connect Wallet to Swap'
    if (!hasAmount)    return 'Enter an amount'
    if (overBal)       return 'Insufficient balance'
    if (noRoute)       return 'No route found'
    if (noLiquidity)   return 'Insufficient liquidity'
    if (step === 'wrap' || step === 'wrap_wait')       return 'Wrapping ETH…'
    if (step === 'approve' || step === 'approve_wait') return `Approving ${needsWrapStep ? 'WETH' : TOKENS[tokenIn].symbol}…`
    if (step === 'swap_wait' && !isWrapUnwrap)         return 'Swapping…'
    if (isWrapUnwrap && step === 'swap_wait')          return tokenIn === 'ETH' ? 'Wrapping…' : 'Unwrapping…'
    if (step === 'done')   return '✓ Swap complete!'
    if (badPrice)      return 'Pool price too far from market'
    if (needsApproval) return `Approve ${TOKENS[tokenIn].symbol}`
    if (isWrapUnwrap)  return tokenIn === 'ETH' ? 'Wrap ETH → WETH' : 'Unwrap WETH → ETH'
    if (needsWrapStep) return `Wrap & Swap ${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
    return `Swap ${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
  }

  function fmtUsd(n: number | null): string {
    if (!n || n <= 0) return ''
    if (n >= 1_000_000) return `≈ $${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)    return `≈ $${(n / 1_000).toFixed(2)}K`
    return `≈ $${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const priceIn  = prices[tokenIn]  ?? null
  const priceOut = prices[tokenOut] ?? null
  const valueIn  = amountIn && parseFloat(amountIn) > 0 && priceIn  ? parseFloat(amountIn)          * priceIn  : null
  const valueOut = amountOutFormatted && priceOut                    ? parseFloat(amountOutFormatted) * priceOut : null

  // Market-price deviation: compare route rate vs oracle prices
  // If the pool is mis-priced vs market, users would lose money even at 0% AMM impact.
  const marketDeviation = (() => {
    if (isWrapUnwrap || !priceIn || !priceOut || spotRate <= 0) return 0
    const marketRate = priceIn / priceOut          // expected tokenOut per tokenIn
    return ((marketRate - spotRate) / marketRate) * 100  // % below fair value
  })()
  const badPrice = marketDeviation > 25   // pool price more than 25% worse than market

  const disabled = isConnected && (!hasAmount || overBal || (noRoute && !isWrapUnwrap) || !!noLiquidity || isBusy || badPrice)

  // Route label for display
  const routeLabel = isWrapUnwrap
    ? `${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
    : route?.label ?? ''

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Swap</h1>
          <p className="text-sm text-text-muted mt-0.5">Automatically routed for best price</p>
        </div>
        <button onClick={() => setShowSettings(!showSettings)} className="btn-ghost p-2">
          <Settings size={18} className={clsx(showSettings && 'text-aeon-400')} />
        </button>
      </div>

      {showSettings && (
        <div className="card p-4 mb-4">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Slippage Tolerance</div>
          <div className="flex gap-2">
            {['0.1', '0.5', '1.0'].map(v => (
              <button key={v} onClick={() => setSlippage(v)} className={clsx('px-3 py-1.5 rounded-lg text-sm font-mono transition-all', slippage === v ? 'bg-aeon-400/20 text-aeon-400 border border-aeon-400/30' : 'bg-bg-raised text-text-secondary border border-bg-border hover:border-bg-hover')}>
                {v}%
              </button>
            ))}
            <div className="flex-1 relative">
              <input type="number" value={!['0.1','0.5','1.0'].includes(slippage) ? slippage : ''} onChange={e => setSlippage(e.target.value)} placeholder="Custom" className="input-base w-full text-sm py-1.5 pr-6" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">%</span>
            </div>
          </div>
        </div>
      )}

      <div className="card p-1">
        {/* Token In */}
        <div className="bg-bg-raised rounded-xl p-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">You pay</span>
            <span className="text-xs text-text-muted font-mono">Balance: {balanceIn.formatted}</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="number" value={amountIn} onChange={e => setAmountIn(e.target.value)} disabled={isFlowLocked} placeholder="0.0" className="flex-1 bg-transparent text-2xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-60" />
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <button onClick={() => !isFlowLocked && setShowTokenInModal(true)} disabled={isFlowLocked} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all disabled:opacity-60">
                <TokenIcon symbol={tokenIn} size={28} />
                <span className="font-display font-semibold text-base">{TOKENS[tokenIn].symbol}</span>
                <ChevronDown size={15} className="text-text-muted" />
              </button>
              {TOKENS[tokenIn].address !== NATIVE_SENTINEL && (
                <button
                  onClick={() => navigator.clipboard.writeText(TOKENS[tokenIn].address)}
                  title="Copy contract address"
                  className="text-2xs font-mono text-text-muted hover:text-aeon-400 transition-colors px-1"
                >
                  {TOKENS[tokenIn].address.slice(0, 6)}…{TOKENS[tokenIn].address.slice(-4)} 📋
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">{valueIn ? fmtUsd(valueIn) : '≈ $—'}</span>
            <div className="flex gap-1">
              {(['25', '50', 'MAX'] as const).map(label => (
                <button key={label} onClick={() => setPercent(label === 'MAX' ? 100 : parseInt(label))} disabled={!isConnected || isFlowLocked} className="text-2xs text-text-muted hover:text-aeon-400 px-1.5 py-0.5 rounded border border-bg-border hover:border-aeon-400/30 transition-all font-mono disabled:opacity-40">
                  {label === '25' ? '25%' : label === '50' ? '50%' : 'MAX'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-0.5 relative z-10">
          <button onClick={flip} disabled={isFlowLocked} className="w-9 h-9 rounded-xl bg-bg-base border border-bg-border hover:border-aeon-400/50 hover:text-aeon-400 transition-all flex items-center justify-center text-text-muted disabled:opacity-60">
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* Token Out */}
        <div className="bg-bg-raised rounded-xl p-4 mt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">You receive</span>
            <span className="text-xs text-text-muted font-mono">Balance: {balanceOut.formatted}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-mono text-text-primary">
              {amountOutFormatted || <span className="text-text-muted">0.0</span>}
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <button onClick={() => !isFlowLocked && setShowTokenOutModal(true)} disabled={isFlowLocked} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all disabled:opacity-60">
                <TokenIcon symbol={tokenOut} size={28} />
                <span className="font-display font-semibold text-base">{TOKENS[tokenOut].symbol}</span>
                <ChevronDown size={15} className="text-text-muted" />
              </button>
              {TOKENS[tokenOut].address !== NATIVE_SENTINEL && (
                <button
                  onClick={() => navigator.clipboard.writeText(TOKENS[tokenOut].address)}
                  title="Copy contract address"
                  className="text-2xs font-mono text-text-muted hover:text-aeon-400 transition-colors px-1"
                >
                  {TOKENS[tokenOut].address.slice(0, 6)}…{TOKENS[tokenOut].address.slice(-4)} 📋
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">{valueOut ? fmtUsd(valueOut) : '≈ $—'}</span>
            {route && route.steps.length > 1 && (
              <span className="text-2xs font-mono text-violet-400">Multi-hop</span>
            )}
            {route && route.steps.length === 1 && (
              <span className="text-2xs font-mono text-blue-400">Direct</span>
            )}
          </div>
        </div>

        {/* Wrap/unwrap info */}
        {isWrapUnwrap && hasAmount && (
          <div className="mt-3 mx-1 p-3 bg-bg-base rounded-xl space-y-1.5">
            {[
              { label: 'Rate',   value: '1 : 1 (no price impact)' },
              { label: 'Action', value: tokenIn === 'ETH' ? 'Wrap ETH → WETH' : 'Unwrap WETH → ETH' },
              { label: 'Fee',    value: 'None' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className="text-xs font-mono text-text-secondary">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Wrap chain notice — only the ETH-input direction still needs a
            heads-up; ETH-output now goes through AeonSwapUnwrapHelper as one
            call, same as any other swap, so it needs no special notice. */}
        {needsWrapStep && hasAmount && (
          <div className="mt-3 mx-1 p-3 bg-bg-base rounded-xl space-y-1.5">
            <div className="text-2xs text-text-muted">
              This swap wraps ETH → WETH automatically, then routes to your output token — confirm each step in your wallet.
            </div>
          </div>
        )}

        {/* High slippage warning */}
        {highSlippage && (
          <div className="mt-3 mx-1 p-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400 text-center font-mono">
            ⚠ Slippage {slippageSafe}% — high risk of sandwich attack
          </div>
        )}

        {/* Pool price vs market warning */}
        {badPrice && hasAmount && route && amountOutWei > 0n && (
          <div className="mt-3 mx-1 p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 text-xs text-orange-400 space-y-1">
            <div className="font-semibold">⚠ Pool price is {marketDeviation.toFixed(1)}% below market</div>
            <div className="text-orange-400/80">
              This pool has low liquidity and is out of sync with market prices.
              You would receive significantly less than fair value. Consider waiting
              for an LP to rebalance, or swap on a larger aggregator.
            </div>
          </div>
        )}

        {/* Quote info */}
        {hasAmount && route && amountOutWei > 0n && (
          <div className="mt-3 mx-1 p-3 bg-bg-base rounded-xl space-y-1.5">
            {[
              { label: 'Rate',         value: spotRate > 0 ? `1 ${TOKENS[tokenIn].symbol} = ${spotRate.toFixed(6)} ${TOKENS[tokenOut].symbol}` : '—' },
              { label: 'Price Impact', value: priceImpact < 0.01 ? '< 0.01%' : `${priceImpact.toFixed(2)}%`, warn: priceImpact > 2 },
              { label: 'Min Received', value: `${parseFloat(formatUnits(amountOutMin, TOKENS[tokenOut].decimals)).toFixed(6)} ${TOKENS[tokenOut].symbol}` },
              { label: 'Route',        value: routeLabel },
              { label: 'Via',          value: route.via },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className={clsx('text-xs font-mono', (item as any).warn ? 'text-red-400' : 'text-text-secondary')}>{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {noRoute && hasAmount && (
          <div className="mt-3 mx-1 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            No route found for {TOKENS[tokenIn].symbol} → {TOKENS[tokenOut].symbol}.
          </div>
        )}

        {errMsg && (
          <div className="mt-3 mx-1 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
        )}

        <div className="p-2 mt-1">
          <button onClick={handleSwapClick} disabled={disabled} className="btn-primary w-full text-base py-4 flex items-center justify-center gap-2">
            {isBusy && <Loader2 size={16} className="animate-spin" />}
            {buttonLabel()}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <TokenInfoCard
          tokenKey={tokenIn}
          info={dexInfo[tokenIn]}
          price={prices[tokenIn] ?? null}
          onChainSparkline={volResult.priceHistory[tokenIn]}
          dexStats={dexTokenStats(dexScreenerPairs, tokenIn)}
        />
        <TokenInfoCard
          tokenKey={tokenOut}
          info={dexInfo[tokenOut]}
          price={prices[tokenOut] ?? null}
          onChainSparkline={volResult.priceHistory[tokenOut]}
          dexStats={dexTokenStats(dexScreenerPairs, tokenOut)}
        />
      </div>

      {(showTokenInModal || showTokenOutModal) && (
        <TokenSelectModal
          onSelect={key => { if (showTokenInModal) setTokenIn(key); else setTokenOut(key); setShowTokenInModal(false); setShowTokenOutModal(false) }}
          onClose={() => { setShowTokenInModal(false); setShowTokenOutModal(false) }}
          exclude={showTokenInModal ? tokenOut : tokenIn}
          walletAddress={address}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Token info side panel — real price, real 24h chart (GeckoTerminal hourly
// OHLCV via useDexTokenInfo, same source already used on /tokens), contract
// address with a link to the real Robinhood Chain explorer, and how many
// AEON pools carry it. No invented numbers — a token with no chart data yet
// just shows none rather than a fake flat line.
// ─────────────────────────────────────────────────────────────────────────

function TokenInfoCard({ tokenKey, info, price, onChainSparkline, dexStats }: {
  tokenKey: TokenKey
  info: ReturnType<typeof useDexTokenInfo>[string] | undefined
  price: number | null
  onChainSparkline: number[] | undefined
  dexStats: ReturnType<typeof dexTokenStats>
}) {
  const token = TOKENS[tokenKey]
  const geckoSparkline = info?.sparkline ?? []
  const chainSparkline = onChainSparkline ?? []

  // DexScreener actually indexes this chain (GeckoTerminal doesn't — confirmed
  // 404 on every lookup), so prefer its price/change/volume when it has the
  // token; GeckoTerminal's hourly chart is still the best chart source when
  // present, otherwise fall back to a live chart built from this token's own
  // real on-chain trades (useVolume24h's priceHistory) rather than nothing.
  const displayPrice  = dexStats.priceUsd ?? price
  const change        = dexStats.priceChange24h ?? info?.priceChange24h ?? null
  const volume24h     = dexStats.volume24h

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
    <div className="card p-4">
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
          <Sparkline prices={sparkline} positive={positive} width={280} height={52} />
          <div className="text-2xs text-text-muted mt-1">{usingGecko ? '24h · hourly' : 'Recent trades · on-chain'}</div>
        </div>
      ) : (
        <div className="text-2xs text-text-muted text-center py-4 mt-1">No chart data yet — shows once this token trades</div>
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
              className="flex items-center gap-1 font-mono text-aeon-400 hover:underline"
            >
              {token.address.slice(0, 6)}…{token.address.slice(-4)} <ExternalLink size={10} />
            </a>
          ) : (
            <span className="font-mono text-text-secondary">{token.address.slice(0, 6)}…{token.address.slice(-4)}</span>
          )}
        </div>
        {!isNative && (
          <div className="flex justify-end">
            <AddToWalletButton tokenKey={tokenKey} />
          </div>
        )}
      </div>
    </div>
  )
}


function TokenSelectModal({ onSelect, onClose, exclude, walletAddress }: {
  onSelect: (key: TokenKey) => void; onClose: () => void; exclude: TokenKey; walletAddress?: `0x${string}`
}) {
  const [search, setSearch] = useState('')
  const filtered = TOKEN_LIST.filter(t => t.key !== exclude && (t.symbol.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase())))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-base/80 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold">Select Token</h3>
          <button onClick={onClose} className="btn-ghost p-1 text-text-muted">✕</button>
        </div>
        <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search token..." className="input-base w-full mb-3" />
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {filtered.map(token => <TokenRow key={token.key} token={token} walletAddress={walletAddress} onSelect={onSelect} />)}
        </div>
      </div>
    </div>
  )
}

function TokenRow({ token, walletAddress, onSelect }: { token: typeof TOKEN_LIST[number]; walletAddress?: `0x${string}`; onSelect: (key: TokenKey) => void }) {
  const bal = useTokenBalance(token.key, walletAddress)
  return (
    <button onClick={() => onSelect(token.key)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-bg-raised transition-colors text-left">
      <TokenIcon symbol={token.key} size={36} />
      <div>
        <div className="font-semibold text-sm text-text-primary">{token.symbol}</div>
        <div className="text-xs text-text-muted">{token.name}</div>
        {token.address !== NATIVE_SENTINEL && (
          <div className="text-2xs font-mono text-text-muted/60">{token.address.slice(0, 6)}…{token.address.slice(-4)}</div>
        )}
      </div>
      <div className="ml-auto text-xs font-mono text-text-muted">{bal.formatted}</div>
    </button>
  )
}
