'use client'
import { useState, useCallback } from 'react'
import { ArrowUpDown, Settings, ChevronDown, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { TOKENS, POOLS, CL_RANGE_PRESETS } from '@/config/contracts'

type TokenKey = keyof typeof TOKENS
type PoolType = 'vAMM' | 'CL' | 'DLMM'

const TOKEN_LIST = Object.entries(TOKENS).map(([key, val]) => ({ key: key as TokenKey, ...val }))

export default function SwapPage() {
  const [tokenIn,   setTokenIn]   = useState<TokenKey>('WAVAX')
  const [tokenOut,  setTokenOut]  = useState<TokenKey>('AEON')
  const [amountIn,  setAmountIn]  = useState('')
  const [poolType,  setPoolType]  = useState<PoolType>('vAMM')
  const [clRange,   setClRange]   = useState('normal')
  const [slippage,  setSlippage]  = useState('0.5')
  const [showSettings, setShowSettings] = useState(false)
  const [showTokenInModal,  setShowTokenInModal]  = useState(false)
  const [showTokenOutModal, setShowTokenOutModal] = useState(false)
  const [customRangeLow,  setCustomRangeLow]  = useState('')
  const [customRangeHigh, setCustomRangeHigh] = useState('')

  const flip = useCallback(() => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn('')
  }, [tokenIn, tokenOut])

  const selectedPool = POOLS.find(
    p => p.type === poolType &&
    ((p.token0 === tokenIn && p.token1 === tokenOut) ||
     (p.token0 === tokenOut && p.token1 === tokenIn))
  )

  const amountOut = amountIn ? (parseFloat(amountIn) * 0.998).toFixed(6) : ''

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Swap</h1>
          <p className="text-sm text-text-muted mt-0.5">Trade tokens across all pool types</p>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="btn-ghost p-2 relative"
        >
          <Settings size={18} className={clsx(showSettings && 'text-aeon-400')} />
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="card p-4 mb-4 animate-slide-up">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
            Settings
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-2 block">Slippage Tolerance</label>
            <div className="flex gap-2">
              {['0.1', '0.5', '1.0'].map(v => (
                <button
                  key={v}
                  onClick={() => setSlippage(v)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm font-mono transition-all',
                    slippage === v
                      ? 'bg-aeon-400/20 text-aeon-400 border border-aeon-400/30'
                      : 'bg-bg-raised text-text-secondary border border-bg-border hover:border-bg-hover'
                  )}
                >
                  {v}%
                </button>
              ))}
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={!['0.1','0.5','1.0'].includes(slippage) ? slippage : ''}
                  onChange={e => setSlippage(e.target.value)}
                  placeholder="Custom"
                  className="input-base w-full text-sm py-1.5 pr-6"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pool type selector */}
      <div className="flex gap-1 p-1 bg-bg-raised rounded-xl border border-bg-border mb-4">
        {(['vAMM', 'CL', 'DLMM'] as PoolType[]).map(type => (
          <button
            key={type}
            onClick={() => setPoolType(type)}
            className={clsx(
              'flex-1 py-2 rounded-lg text-sm font-medium transition-all',
              poolType === type
                ? 'bg-bg-base text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Swap card */}
      <div className="card p-1">
        {/* Token In */}
        <div className="bg-bg-raised rounded-xl p-4 mb-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">You pay</span>
            <span className="text-xs text-text-muted font-mono">Balance: —</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-2xl font-mono text-text-primary
                         placeholder-text-muted focus:outline-none"
            />
            <button
              onClick={() => setShowTokenInModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base
                         border border-bg-border hover:border-bg-hover transition-all shrink-0"
            >
              <TokenIcon symbol={TOKENS[tokenIn].symbol} />
              <span className="font-display font-semibold text-sm">{TOKENS[tokenIn].symbol}</span>
              <ChevronDown size={14} className="text-text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">≈ $—</span>
            <div className="flex gap-1">
              {['25%', '50%', 'MAX'].map(p => (
                <button key={p} className="text-2xs text-text-muted hover:text-aeon-400
                                          px-1.5 py-0.5 rounded border border-bg-border
                                          hover:border-aeon-400/30 transition-all font-mono">
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Flip button */}
        <div className="flex justify-center -my-0.5 relative z-10">
          <button
            onClick={flip}
            className="w-9 h-9 rounded-xl bg-bg-base border border-bg-border
                       hover:border-aeon-400/50 hover:text-aeon-400 transition-all
                       flex items-center justify-center text-text-muted"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* Token Out */}
        <div className="bg-bg-raised rounded-xl p-4 mt-1">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-muted">You receive</span>
            <span className="text-xs text-text-muted font-mono">Balance: —</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-mono text-text-primary">
              {amountOut || <span className="text-text-muted">0.0</span>}
            </div>
            <button
              onClick={() => setShowTokenOutModal(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base
                         border border-bg-border hover:border-bg-hover transition-all shrink-0"
            >
              <TokenIcon symbol={TOKENS[tokenOut].symbol} />
              <span className="font-display font-semibold text-sm">{TOKENS[tokenOut].symbol}</span>
              <ChevronDown size={14} className="text-text-muted" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted font-mono">≈ $—</span>
            {selectedPool && (
              <span className={clsx('text-2xs font-mono font-bold',
                selectedPool.type === 'vAMM' ? 'text-blue-400' :
                selectedPool.type === 'CL'   ? 'text-violet-400' : 'text-emerald-400'
              )}>
                {selectedPool.type} · {selectedPool.fee}
              </span>
            )}
          </div>
        </div>

        {/* CL Range selector */}
        {poolType === 'CL' && (
          <div className="mt-3 p-3 bg-bg-raised rounded-xl border border-bg-border">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">
              Price Range
            </div>
            <div className="grid grid-cols-4 gap-1 mb-3">
              {CL_RANGE_PRESETS.map(preset => (
                <button
                  key={preset.key}
                  onClick={() => { setClRange(preset.key); setCustomRangeLow(''); setCustomRangeHigh(''); }}
                  className={clsx(
                    'py-1.5 rounded-lg text-xs font-medium transition-all text-center',
                    clRange === preset.key
                      ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'bg-bg-base text-text-muted border border-bg-border hover:border-bg-hover'
                  )}
                >
                  <div className="font-bold">{preset.label}</div>
                  <div className="text-2xs opacity-70">{preset.desc}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-2xs text-text-muted mb-1 block">Min Price</label>
                <input
                  type="number"
                  value={customRangeLow}
                  onChange={e => { setCustomRangeLow(e.target.value); setClRange('custom'); }}
                  placeholder="0.0"
                  className="input-base w-full text-sm py-1.5"
                />
              </div>
              <div className="flex-1">
                <label className="text-2xs text-text-muted mb-1 block">Max Price</label>
                <input
                  type="number"
                  value={customRangeHigh}
                  onChange={e => { setCustomRangeHigh(e.target.value); setClRange('custom'); }}
                  placeholder="∞"
                  className="input-base w-full text-sm py-1.5"
                />
              </div>
            </div>
          </div>
        )}

        {/* Route info */}
        {amountIn && parseFloat(amountIn) > 0 && (
          <div className="mt-3 p-3 bg-bg-base rounded-xl space-y-1.5">
            {[
              { label: 'Rate',         value: `1 ${TOKENS[tokenIn].symbol} = — ${TOKENS[tokenOut].symbol}` },
              { label: 'Price Impact', value: '< 0.01%' },
              { label: 'Min Received', value: `${((parseFloat(amountOut) || 0) * (1 - parseFloat(slippage)/100)).toFixed(6)} ${TOKENS[tokenOut].symbol}` },
              { label: 'Fee',          value: selectedPool ? selectedPool.fee : '—' },
              { label: 'Route',        value: `${TOKENS[tokenIn].symbol} → ${TOKENS[tokenOut].symbol}` },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-xs text-text-muted">{item.label}</span>
                <span className="text-xs font-mono text-text-secondary">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Swap button */}
        <div className="p-2 mt-1">
          <button
            disabled={!amountIn || parseFloat(amountIn) <= 0}
            className="btn-primary w-full text-base py-4"
          >
            {!amountIn || parseFloat(amountIn) <= 0 ? 'Enter amount' : 'Connect Wallet to Swap'}
          </button>
        </div>
      </div>

      {/* Token modal */}
      {(showTokenInModal || showTokenOutModal) && (
        <TokenSelectModal
          onSelect={key => {
            if (showTokenInModal) setTokenIn(key)
            else setTokenOut(key)
            setShowTokenInModal(false)
            setShowTokenOutModal(false)
          }}
          onClose={() => { setShowTokenInModal(false); setShowTokenOutModal(false) }}
          exclude={showTokenInModal ? tokenOut : tokenIn}
        />
      )}
    </div>
  )
}

function TokenIcon({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    AEON: 'bg-aeon-400/20 text-aeon-400',
    WAVAX: 'bg-red-500/20 text-red-400',
    USDC: 'bg-blue-500/20 text-blue-400',
    WUSDT: 'bg-green-500/20 text-green-400',
    'WBTC.e': 'bg-orange-500/20 text-orange-400',
    'WBTC.b': 'bg-orange-500/20 text-orange-400',
    'WETH.e': 'bg-indigo-500/20 text-indigo-400',
    SPX: 'bg-purple-500/20 text-purple-400',
    GUNZ: 'bg-cyan-500/20 text-cyan-400',
    ARENA: 'bg-pink-500/20 text-pink-400',
    COQ: 'bg-yellow-500/20 text-yellow-400',
  }
  return (
    <div className={clsx('w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold font-mono shrink-0',
      colors[symbol] || 'bg-bg-raised text-text-muted')}>
      {symbol[0]}
    </div>
  )
}

function TokenSelectModal({
  onSelect, onClose, exclude,
}: {
  onSelect: (key: TokenKey) => void
  onClose: () => void
  exclude: TokenKey
}) {
  const [search, setSearch] = useState('')
  const filtered = TOKEN_LIST.filter(t =>
    t.key !== exclude &&
    (t.symbol.toLowerCase().includes(search.toLowerCase()) ||
     t.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-base/80 backdrop-blur-sm"
         onClick={onClose}>
      <div className="card w-full max-w-sm p-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold">Select Token</h3>
          <button onClick={onClose} className="btn-ghost p-1 text-text-muted">✕</button>
        </div>
        <input
          autoFocus
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search token name or symbol..."
          className="input-base w-full mb-3"
        />
        <div className="space-y-1 max-h-72 overflow-y-auto">
          {filtered.map(token => (
            <button
              key={token.key}
              onClick={() => onSelect(token.key)}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-bg-raised
                         transition-colors text-left"
            >
              <TokenIcon symbol={token.symbol} />
              <div>
                <div className="font-semibold text-sm text-text-primary">{token.symbol}</div>
                <div className="text-xs text-text-muted">{token.name}</div>
              </div>
              <div className="ml-auto text-xs font-mono text-text-muted">—</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
