'use client'
import { useState, useCallback, useEffect } from 'react'
import { ArrowUpDown, Settings, ChevronDown, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { TOKENS, CONTRACTS } from '@/config/contracts'
import { AEON_ROUTER_ABI, ERC20_ABI } from '@/config/abis'
import { useRouting } from '@/hooks/useRouting'
import { usePrices } from '@/hooks/usePrices'

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

function useTokenBalance(tokenKey: TokenKey, address?: `0x${string}`) {
  const token = TOKENS[tokenKey]
  const isNative = token.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
  const { data } = useBalance({
    address,
    token: isNative ? undefined : token.address,
    query: { enabled: !!address },
  })
  if (!address || !data) return { formatted: '—', raw: 0n, decimals: 18 }
  return { formatted: parseFloat(formatUnits(data.value, data.decimals)).toFixed(4), raw: data.value, decimals: data.decimals }
}

const WAVAX_ABI = [
  { name: 'deposit',  type: 'function', stateMutability: 'payable',    inputs: [],                                  outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
] as const

export default function SwapPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenIn,  setTokenIn]  = useState<TokenKey>('WAVAX')
  const [tokenOut, setTokenOut] = useState<TokenKey>('AEON')
  const [amountIn, setAmountIn] = useState('')
  const [slippage, setSlippage] = useState('0.5')
  const [showSettings,      setShowSettings]      = useState(false)
  const [showTokenInModal,  setShowTokenInModal]  = useState(false)
  const [showTokenOutModal, setShowTokenOutModal] = useState(false)

  const balanceIn  = useTokenBalance(tokenIn,  address)
  const balanceOut = useTokenBalance(tokenOut, address)
  const prices     = usePrices()

  const isWrapUnwrap = (tokenIn === 'AVAX' && tokenOut === 'WAVAX') || (tokenIn === 'WAVAX' && tokenOut === 'AVAX')

  const isNativeIn = TOKENS[tokenIn].address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: isNativeIn ? undefined : TOKENS[tokenIn].address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.AeonRouter] : undefined,
    query: { enabled: !!address && !isNativeIn },
  })

  const { writeContract, data: approveTxHash, isPending: isApproving, error: approveError } = useWriteContract()
  const { writeContract: writeSwap, data: swapTxHash, isPending: isSwapping, error: swapError } = useWriteContract()
  const { isLoading: isApproveConfirming, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash })
  const { isLoading: isSwapConfirming,   isSuccess: swapSuccess }    = useWaitForTransactionReceipt({ hash: swapTxHash })

  useEffect(() => { if (approveSuccess) refetchAllowance() }, [approveSuccess])

  const flip = useCallback(() => { setTokenIn(tokenOut); setTokenOut(tokenIn); setAmountIn('') }, [tokenIn, tokenOut])

  const parsedAmountIn = safeParseUnits(amountIn, TOKENS[tokenIn].decimals)

  // Multi-hop routing (skipped for wrap/unwrap)
  const route = useRouting(
    isWrapUnwrap ? '' : tokenIn,
    isWrapUnwrap ? '' : tokenOut,
    isWrapUnwrap ? 0n : parsedAmountIn,
  )

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
  const needsApproval  = !isNativeIn && hasAmount && allowance !== undefined && allowance < parsedAmountIn
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

  // Market-price deviation: compare route rate vs oracle prices
  // If the pool is mis-priced vs market, users would lose money even at 0% AMM impact.
  const marketDeviation = (() => {
    if (isWrapUnwrap || !priceIn || !priceOut || spotRate <= 0) return 0
    const marketRate = priceIn / priceOut          // expected tokenOut per tokenIn
    return ((marketRate - spotRate) / marketRate) * 100  // % below fair value
  })()
  const badPrice = marketDeviation > 5   // pool price more than 5% worse than market

  function setPercent(pct: number) {
    if (!isConnected || balanceIn.raw === 0n) return
    const portion = (balanceIn.raw * BigInt(pct)) / 100n
    setAmountIn(parseFloat(formatUnits(portion, balanceIn.decimals)).toFixed(6))
  }

  function buildRouterSteps() {
    if (!route) return []
    const wavaxAddr = TOKENS['WAVAX'].address
    return route.steps.map(step => ({
      tokenIn:  step.tokenIn  === 'AVAX' ? wavaxAddr : TOKENS[step.tokenIn  as keyof typeof TOKENS].address,
      tokenOut: step.tokenOut === 'AVAX' ? wavaxAddr : TOKENS[step.tokenOut as keyof typeof TOKENS].address,
      pool:     step.poolAddress,
      poolType: 0,  // router only implements poolType=0; all pool types share the same swap interface
      feeBps:   Number(step.feeBps),
    }))
  }

  function handleSwapClick() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!hasAmount || !address) return

    if (isWrapUnwrap) {
      if (tokenIn === 'AVAX') {
        writeSwap({ address: TOKENS['WAVAX'].address, abi: WAVAX_ABI, functionName: 'deposit', args: [], value: parsedAmountIn })
      } else {
        writeSwap({ address: TOKENS['WAVAX'].address, abi: WAVAX_ABI, functionName: 'withdraw', args: [parsedAmountIn] })
      }
      return
    }

    if (!route) return

    if (needsApproval) {
      writeContract({ address: TOKENS[tokenIn].address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonRouter, maxUint256] })
      return
    }

    const steps    = buildRouterSteps()
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    if (tokenIn === 'AVAX') {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactAVAXForTokens',    args: [steps, amountOutMin, address, deadline], value: parsedAmountIn })
    } else if (tokenOut === 'AVAX') {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForAVAX',    args: [steps, parsedAmountIn, amountOutMin, address, deadline] })
    } else {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens',  args: [steps, parsedAmountIn, amountOutMin, address, deadline] })
    }
  }

  const isBusy  = isApproving || isApproveConfirming || isSwapping || isSwapConfirming

  function sanitizeErr(msg?: string): string {
    if (!msg) return ''
    // Strip URLs and long hex strings that could be used for social engineering
    return msg.replace(/https?:\/\/\S+/g, '[url]').replace(/0x[0-9a-fA-F]{20,}/g, '[addr]').slice(0, 120)
  }
  const errMsg  = sanitizeErr(approveError?.message ?? swapError?.message)

  const noRoute     = hasAmount && !route && !isWrapUnwrap
  const overBal     = hasAmount && balanceIn.raw > 0n && parsedAmountIn > balanceIn.raw
  const noLiquidity = hasAmount && route && route.amountOut === 0n

  function buttonLabel() {
    if (!isConnected)  return 'Connect Wallet to Swap'
    if (!hasAmount)    return 'Enter an amount'
    if (overBal)       return 'Insufficient balance'
    if (noRoute)       return 'No route found'
    if (noLiquidity)   return 'Insufficient liquidity'
    if (isApproving || isApproveConfirming) return 'Approving…'
    if (isSwapping   || isSwapConfirming)   return 'Swapping…'
    if (swapSuccess)   return '✓ Swap complete!'
    if (badPrice)      return 'Pool price too far from market'
    if (needsApproval) return `Approve ${TOKENS[tokenIn].symbol}`
    if (isWrapUnwrap)  return tokenIn === 'AVAX' ? 'Wrap AVAX → WAVAX' : 'Unwrap WAVAX → AVAX'
    return `Swap ${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
  }

  const disabled = isConnected && (!hasAmount || overBal || (noRoute && !isWrapUnwrap) || !!noLiquidity || isBusy || badPrice)

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

  // Route label for display
  const routeLabel = isWrapUnwrap
    ? `${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
    : route?.label.replace(/WAVAX/g, 'AVAX/WAVAX') ?? ''

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
            <input type="number" value={amountIn} onChange={e => setAmountIn(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-2xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <button onClick={() => setShowTokenInModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all">
                <TokenIcon symbol={TOKENS[tokenIn].symbol} />
                <span className="font-display font-semibold text-sm">{TOKENS[tokenIn].symbol}</span>
                <ChevronDown size={14} className="text-text-muted" />
              </button>
              {TOKENS[tokenIn].address !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' && (
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
                <button key={label} onClick={() => setPercent(label === 'MAX' ? 100 : parseInt(label))} disabled={!isConnected} className="text-2xs text-text-muted hover:text-aeon-400 px-1.5 py-0.5 rounded border border-bg-border hover:border-aeon-400/30 transition-all font-mono disabled:opacity-40">
                  {label === '25' ? '25%' : label === '50' ? '50%' : 'MAX'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center -my-0.5 relative z-10">
          <button onClick={flip} className="w-9 h-9 rounded-xl bg-bg-base border border-bg-border hover:border-aeon-400/50 hover:text-aeon-400 transition-all flex items-center justify-center text-text-muted">
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
              <button onClick={() => setShowTokenOutModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all">
                <TokenIcon symbol={TOKENS[tokenOut].symbol} />
                <span className="font-display font-semibold text-sm">{TOKENS[tokenOut].symbol}</span>
                <ChevronDown size={14} className="text-text-muted" />
              </button>
              {TOKENS[tokenOut].address !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' && (
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
              { label: 'Action', value: tokenIn === 'AVAX' ? 'Wrap AVAX → WAVAX' : 'Unwrap WAVAX → AVAX' },
              { label: 'Fee',    value: 'None' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className="text-xs font-mono text-text-secondary">{item.value}</span>
              </div>
            ))}
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

function TokenIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    AEON: 'bg-aeon-400/20 text-aeon-400', AVAX: 'bg-red-500/20 text-red-400',
    WAVAX: 'bg-red-500/20 text-red-400', USDC: 'bg-blue-500/20 text-blue-400',
    WUSDT: 'bg-green-500/20 text-green-400', SPX6900: 'bg-purple-500/20 text-purple-400',
    GUNZ: 'bg-cyan-500/20 text-cyan-400', ARENA: 'bg-pink-500/20 text-pink-400',
    COQ: 'bg-yellow-500/20 text-yellow-400',
    'WBTC.b': 'bg-orange-500/20 text-orange-400', 'WBTC.e': 'bg-orange-500/20 text-orange-400',
    'WETH.e': 'bg-indigo-500/20 text-indigo-400',
  }
  return (
    <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold font-mono shrink-0', colors[symbol] || 'bg-bg-raised text-text-muted')}>
      {symbol.startsWith('WBTC') ? '₿' : symbol[0]}
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
      <TokenIcon symbol={token.symbol} />
      <div>
        <div className="font-semibold text-sm text-text-primary">{token.symbol}</div>
        <div className="text-xs text-text-muted">{token.name}</div>
        {token.address !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' && (
          <div className="text-2xs font-mono text-text-muted/60">{token.address.slice(0, 6)}…{token.address.slice(-4)}</div>
        )}
      </div>
      <div className="ml-auto text-xs font-mono text-text-muted">{bal.formatted}</div>
    </button>
  )
}
