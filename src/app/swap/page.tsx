'use client'
import { useState, useCallback, useEffect } from 'react'
import { ArrowUpDown, Settings, ChevronDown, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { TOKENS, POOLS, CONTRACTS } from '@/config/contracts'
import { AEON_ROUTER_ABI, ERC20_ABI, PAIR_ABI } from '@/config/abis'

type TokenKey = keyof typeof TOKENS

const TOKEN_LIST = Object.entries(TOKENS).map(([key, val]) => ({ key: key as TokenKey, ...val }))

// Parse "1%" -> 100n, "0.3%" -> 30n, "0.05%" -> 5n etc.
function feeToBps(fee: string): bigint {
  return BigInt(Math.round(parseFloat(fee) * 100))
}

// x*y=k output formula
function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) return 0n
  const amountInWithFee = amountIn * (10000n - feeBps)
  return amountInWithFee * reserveOut / (reserveIn * 10000n + amountInWithFee)
}

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
  const [showSettings,       setShowSettings]       = useState(false)
  const [showTokenInModal,   setShowTokenInModal]   = useState(false)
  const [showTokenOutModal,  setShowTokenOutModal]  = useState(false)

  const balanceIn  = useTokenBalance(tokenIn,  address)
  const balanceOut = useTokenBalance(tokenOut, address)

  // AVAX and WAVAX are the same asset in pools (router wraps/unwraps)
  const poolKey = (k: TokenKey) => k === 'AVAX' ? 'WAVAX' : k

  // Find the best pool for this pair — prefer lowest fee vAMM first
  const selectedPool = POOLS.find(p =>
    p.type === 'vAMM' &&
    ((p.token0 === poolKey(tokenIn)  && p.token1 === poolKey(tokenOut)) ||
     (p.token0 === poolKey(tokenOut) && p.token1 === poolKey(tokenIn)))
  ) ?? POOLS.find(p =>
    (p.token0 === poolKey(tokenIn)  && p.token1 === poolKey(tokenOut)) ||
    (p.token0 === poolKey(tokenOut) && p.token1 === poolKey(tokenIn))
  )

  // Read reserves from the selected pool
  const { data: reserves } = useReadContract({
    address: selectedPool?.address,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: !!selectedPool, refetchInterval: 10000 },
  })

  // Read token0 from pool to know ordering
  const { data: poolToken0 } = useReadContract({
    address: selectedPool?.address,
    abi: PAIR_ABI,
    functionName: 'token0',
    query: { enabled: !!selectedPool },
  })

  // Allowance
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

  // Real quote from reserves
  const parsedAmountIn = amountIn && parseFloat(amountIn) > 0
    ? parseUnits(amountIn, TOKENS[tokenIn].decimals)
    : 0n

  let amountOutWei = 0n
  let spotRate = 0
  let priceImpactPct = 0

  if (reserves && poolToken0 && parsedAmountIn > 0n && selectedPool) {
    const [r0, r1] = reserves
    // AVAX routes through WAVAX in the pool
    const effectiveTokenIn = tokenIn === 'AVAX' ? 'WAVAX' : tokenIn
    const tokenInAddr  = TOKENS[effectiveTokenIn].address.toLowerCase()
    const isToken0In   = poolToken0.toLowerCase() === tokenInAddr
    const reserveIn    = isToken0In ? r0 : r1
    const reserveOut   = isToken0In ? r1 : r0
    const feeBps       = feeToBps(selectedPool.fee)

    amountOutWei = getAmountOut(parsedAmountIn, reserveIn, reserveOut, feeBps)

    // Spot rate: how much tokenOut per 1 tokenIn (from reserves)
    const oneIn = parseUnits('1', TOKENS[tokenIn].decimals)
    const spotOut = getAmountOut(oneIn, reserveIn, reserveOut, feeBps)
    spotRate = parseFloat(formatUnits(spotOut, TOKENS[tokenOut].decimals))

    // Price impact
    if (reserveIn > 0n) {
      const midPrice = Number(reserveOut) / Number(reserveIn)
      const execPrice = Number(amountOutWei) / Number(parsedAmountIn) *
        (10 ** TOKENS[tokenIn].decimals) / (10 ** TOKENS[tokenOut].decimals)
      priceImpactPct = Math.max(0, ((midPrice - execPrice) / midPrice) * 100)
    }
  }

  const amountOutFormatted = amountOutWei > 0n
    ? parseFloat(formatUnits(amountOutWei, TOKENS[tokenOut].decimals)).toFixed(6)
    : ''

  const hasAmount = parsedAmountIn > 0n
  const needsApproval = !isNativeIn && hasAmount && allowance !== undefined && allowance < parsedAmountIn

  const slippagePct = parseFloat(slippage) / 100
  const amountOutMin = amountOutWei > 0n
    ? (amountOutWei * BigInt(Math.floor((1 - slippagePct) * 10000))) / 10000n
    : 0n

  function setPercent(pct: number) {
    if (!isConnected || balanceIn.raw === 0n) return
    const portion = (balanceIn.raw * BigInt(pct)) / 100n
    setAmountIn(parseFloat(formatUnits(portion, balanceIn.decimals)).toFixed(6))
  }

  function handleSwapClick() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!hasAmount || !selectedPool || !address) return

    if (needsApproval) {
      writeContract({ address: TOKENS[tokenIn].address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonRouter, maxUint256] })
      return
    }

    const wavaxAddr = TOKENS['WAVAX'].address
    const routeTokenIn  = tokenIn  === 'AVAX' ? wavaxAddr : TOKENS[tokenIn].address
    const routeTokenOut = tokenOut === 'AVAX' ? wavaxAddr : TOKENS[tokenOut].address
    const route = [{
      tokenIn:  routeTokenIn,
      tokenOut: routeTokenOut,
      pool:     selectedPool.address,
      poolType: 0,
      feeBps:   Number(feeToBps(selectedPool.fee)),
    }]
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    if (tokenIn === 'AVAX') {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactAVAXForTokens', args: [route, amountOutMin, address, deadline], value: parsedAmountIn })
    } else if (tokenOut === 'AVAX') {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForAVAX', args: [route, parsedAmountIn, amountOutMin, address, deadline] })
    } else {
      writeSwap({ address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens', args: [route, parsedAmountIn, amountOutMin, address, deadline] })
    }
  }

  const isBusy = isApproving || isApproveConfirming || isSwapping || isSwapConfirming
  const errMsg = approveError?.message.slice(0, 150) ?? swapError?.message.slice(0, 150) ?? ''

  const noPool    = hasAmount && !selectedPool
  const overBal   = hasAmount && balanceIn.raw > 0n && parsedAmountIn > balanceIn.raw
  const noLiquidity = hasAmount && selectedPool && (!reserves || (reserves[0] === 0n && reserves[1] === 0n))

  function buttonLabel() {
    if (!isConnected) return 'Connect Wallet to Swap'
    if (!hasAmount) return 'Enter an amount'
    if (overBal) return 'Insufficient balance'
    if (noPool) return 'No pool for this pair'
    if (noLiquidity) return 'Pool has no liquidity'
    if (isApproving || isApproveConfirming) return 'Approving…'
    if (isSwapping  || isSwapConfirming)   return 'Swapping…'
    if (swapSuccess) return '✓ Swap complete!'
    if (needsApproval) return `Approve ${TOKENS[tokenIn].symbol}`
    return `Swap ${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}`
  }

  const disabled = isConnected && (!hasAmount || overBal || noPool || !!noLiquidity || isBusy)

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Swap</h1>
          <p className="text-sm text-text-muted mt-0.5">Trade tokens at real pool prices</p>
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
            <button onClick={() => setShowTokenInModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all shrink-0">
              <TokenIcon symbol={TOKENS[tokenIn].symbol} />
              <span className="font-display font-semibold text-sm">{TOKENS[tokenIn].symbol}</span>
              <ChevronDown size={14} className="text-text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">≈ $—</span>
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
            <button onClick={() => setShowTokenOutModal(true)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border hover:border-bg-hover transition-all shrink-0">
              <TokenIcon symbol={TOKENS[tokenOut].symbol} />
              <span className="font-display font-semibold text-sm">{TOKENS[tokenOut].symbol}</span>
              <ChevronDown size={14} className="text-text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">≈ $—</span>
            {selectedPool && <span className="text-2xs font-mono text-blue-400">{selectedPool.type} · {selectedPool.fee}</span>}
          </div>
        </div>

        {/* Quote info */}
        {hasAmount && selectedPool && amountOutWei > 0n && (
          <div className="mt-3 mx-1 p-3 bg-bg-base rounded-xl space-y-1.5">
            {[
              { label: 'Rate',         value: spotRate > 0 ? `1 ${TOKENS[tokenIn].symbol} = ${spotRate.toFixed(6)} ${TOKENS[tokenOut].symbol}` : '—' },
              { label: 'Price Impact', value: priceImpactPct < 0.01 ? '< 0.01%' : `${priceImpactPct.toFixed(2)}%`, warn: priceImpactPct > 2 },
              { label: 'Min Received', value: `${parseFloat(formatUnits(amountOutMin, TOKENS[tokenOut].decimals)).toFixed(6)} ${TOKENS[tokenOut].symbol}` },
              { label: 'Fee',          value: selectedPool.fee },
              { label: 'Route',        value: `${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}` },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className={clsx('text-xs font-mono', (item as any).warn ? 'text-red-400' : 'text-text-secondary')}>{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {noPool && hasAmount && (
          <div className="mt-3 mx-1 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            No pool found for {TOKENS[tokenIn].symbol}/{TOKENS[tokenOut].symbol}. Try a different pair.
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
    WUSDT: 'bg-green-500/20 text-green-400', 'WBTC.e': 'bg-orange-500/20 text-orange-400',
    'WBTC.b': 'bg-orange-500/20 text-orange-400', 'WETH.e': 'bg-indigo-500/20 text-indigo-400',
    SPX: 'bg-purple-500/20 text-purple-400', GUNZ: 'bg-cyan-500/20 text-cyan-400',
    ARENA: 'bg-pink-500/20 text-pink-400', COQ: 'bg-yellow-500/20 text-yellow-400',
  }
  return (
    <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold font-mono shrink-0', colors[symbol] || 'bg-bg-raised text-text-muted')}>
      {symbol[0]}
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
      </div>
      <div className="ml-auto text-xs font-mono text-text-muted">{bal.formatted}</div>
    </button>
  )
}
