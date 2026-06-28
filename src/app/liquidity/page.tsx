'use client'
import { useState, useEffect } from 'react'
import { Plus, Minus, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { POOLS, CL_RANGE_PRESETS, TOKENS, CONTRACTS } from '@/config/contracts'

type Tab = 'add' | 'remove'
type PoolType = 'vAMM' | 'CL' | 'DLMM'

function useTokenBal(address: `0x${string}`, wallet?: `0x${string}`) {
  const isNative = address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
  const { data } = useBalance({ address: wallet, token: isNative ? undefined : address, query: { enabled: !!wallet } })
  if (!wallet || !data) return '—'
  return parseFloat(formatUnits(data.value, data.decimals)).toFixed(4)
}

export default function LiquidityPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,          setTab]          = useState<Tab>('add')
  const [poolType,     setPoolType]     = useState<PoolType>('vAMM')
  const [selectedPool, setSelectedPool] = useState(POOLS[0])
  const [amount0,      setAmount0]      = useState('')
  const [amount1,      setAmount1]      = useState('')
  const [clRange,      setClRange]      = useState('normal')
  const [customLow,    setCustomLow]    = useState('')
  const [customHigh,   setCustomHigh]   = useState('')
  const [removeAmount, setRemoveAmount] = useState(50)
  const [showPoolPicker, setShowPoolPicker] = useState(false)

  const filteredPools = POOLS.filter(p => p.type === poolType)

  // token keys for selected pool
  const token0Key = Object.keys(TOKENS).find(k => (TOKENS as any)[k].symbol === selectedPool.token0) as keyof typeof TOKENS | undefined
  const token1Key = Object.keys(TOKENS).find(k => (TOKENS as any)[k].symbol === selectedPool.token1) as keyof typeof TOKENS | undefined
  const token0Addr = token0Key ? TOKENS[token0Key].address : undefined
  const token1Addr = token1Key ? TOKENS[token1Key].address : undefined

  const bal0 = useTokenBal(token0Addr as `0x${string}` ?? '0x0', address)
  const bal1 = useTokenBal(token1Addr as `0x${string}` ?? '0x0', address)

  const poolHasRealAddress = selectedPool.address !== '0x0000000000000000000000000000000000001001' &&
    !selectedPool.address.startsWith('0x000000000000000000000000000000000000')

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity</h1>
          <p className="text-sm text-text-muted mt-0.5">Provide liquidity and stake LP tokens to earn</p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => setTab('add')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => setTab('remove')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        {(['vAMM', 'CL', 'DLMM'] as PoolType[]).map(t => (
          <button key={t} onClick={() => { setPoolType(t); setSelectedPool(POOLS.find(p => p.type === t) || POOLS[0]) }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-all', poolType === t ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
            {t}
          </button>
        ))}
      </div>

      {/* Pool selector */}
      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <div className="w-7 h-7 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-xs font-bold z-10">{selectedPool.token0[0]}</div>
              <div className="w-7 h-7 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-xs font-bold">{selectedPool.token1[0]}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {filteredPools.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false) }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <div className="w-6 h-6 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-2xs font-bold z-10">{pool.token0[0]}</div>
                  <div className="w-6 h-6 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-2xs font-bold">{pool.token1[0]}</div>
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">{pool.fee}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!poolHasRealAddress && (
        <div className="mb-4 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
          Pool not yet deployed on-chain. Liquidity operations will be enabled once pools are live.
        </div>
      )}

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <span className="text-xs text-text-muted font-mono">Balance: {bal0}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount0} onChange={e => setAmount0(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <span className="text-xs text-text-muted font-mono">Balance: {bal1}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount1} onChange={e => setAmount1(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
          </div>

          {poolType === 'CL' && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Price Range</div>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {CL_RANGE_PRESETS.map(preset => (
                  <button key={preset.key} onClick={() => { setClRange(preset.key); setCustomLow(''); setCustomHigh('') }} className={clsx('py-2 rounded-xl text-xs font-medium transition-all text-center', clRange === preset.key ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover')}>
                    <div className="font-bold">{preset.label}</div>
                    <div className="text-2xs opacity-70">{preset.desc}</div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Min Price</label>
                  <input type="number" value={customLow} onChange={e => { setCustomLow(e.target.value); setClRange('custom') }} placeholder="0.0" className="input-base w-full text-sm py-2" />
                </div>
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Max Price</label>
                  <input type="number" value={customHigh} onChange={e => { setCustomHigh(e.target.value); setClRange('custom') }} placeholder="∞" className="input-base w-full text-sm py-2" />
                </div>
              </div>
            </div>
          )}

          {poolType === 'DLMM' && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Bin Step</div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">Active bin step</span>
                <span className="font-mono text-aeon-400 font-bold">{'binStep' in selectedPool ? `${(selectedPool as any).binStep} bps` : '—'}</span>
              </div>
            </div>
          )}

          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Summary</div>
            <div className="space-y-2">
              {[
                { label: 'Pool Share', value: '< 0.01%' },
                { label: 'LP Tokens', value: '—' },
                { label: 'Pool APR',  value: '—%' },
                { label: 'Gauge APR', value: '—% (stake LP to earn)' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-text-muted">{item.label}</span>
                  <span className="font-mono text-text-primary">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => { if (!isConnected) openConnectModal?.() }}
            disabled={isConnected && (!amount0 && !amount1 || !poolHasRealAddress)}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            {!isConnected ? 'Connect Wallet' : !poolHasRealAddress ? 'Pool Not Yet Deployed' : 'Add Liquidity'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Remove Amount</div>
            <div className="text-center mb-4">
              <div className="text-5xl font-display font-bold text-text-primary mb-1">{removeAmount}%</div>
              <div className="text-sm text-text-muted">of your position</div>
            </div>
            <input type="range" min={0} max={100} value={removeAmount} onChange={e => setRemoveAmount(parseInt(e.target.value))} className="w-full accent-aeon-400 mb-3" />
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => setRemoveAmount(p)} className={clsx('flex-1 py-2 rounded-xl text-sm font-medium transition-all', removeAmount === p ? 'bg-aeon-400/15 text-aeon-400 border border-aeon-400/30' : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover')}>
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You Receive</div>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-sm text-text-muted">{selectedPool.token0}</span><span className="font-mono text-text-primary">—</span></div>
              <div className="flex justify-between"><span className="text-sm text-text-muted">{selectedPool.token1}</span><span className="font-mono text-text-primary">—</span></div>
            </div>
          </div>

          <button
            onClick={() => { if (!isConnected) openConnectModal?.() }}
            disabled={isConnected && !poolHasRealAddress}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Minus size={16} />
            {!isConnected ? 'Connect Wallet' : !poolHasRealAddress ? 'Pool Not Yet Deployed' : 'Remove Liquidity'}
          </button>
        </div>
      )}
    </div>
  )
}
