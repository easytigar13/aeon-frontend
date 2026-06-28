'use client'
import { useState } from 'react'
import { Vote, Plus, X, ChevronRight, Info } from 'lucide-react'
import { clsx } from 'clsx'
import { POOLS } from '@/config/contracts'

interface VoteAllocation {
  pool: string
  weight: number
}

export default function VotePage() {
  const [selectedNFT,   setSelectedNFT]   = useState<number | null>(null)
  const [allocations,   setAllocations]   = useState<VoteAllocation[]>([])
  const [search,        setSearch]        = useState('')
  const [filterType,    setFilterType]    = useState<'all' | 'vAMM' | 'CL' | 'DLMM'>('all')

  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0)
  const remaining   = 100 - totalWeight

  const filteredPools = POOLS.filter(p =>
    (filterType === 'all' || p.type === filterType) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const addPool = (poolName: string) => {
    if (allocations.length >= 6) return
    if (allocations.find(a => a.pool === poolName)) return
    const share = Math.floor(remaining / (6 - allocations.length + 1))
    setAllocations(prev => [...prev, { pool: poolName, weight: share }])
  }

  const removePool = (poolName: string) => {
    setAllocations(prev => prev.filter(a => a.pool !== poolName))
  }

  const setWeight = (poolName: string, weight: number) => {
    setAllocations(prev => prev.map(a =>
      a.pool === poolName ? { ...a, weight: Math.max(0, Math.min(100, weight)) } : a
    ))
  }

  const distribute = () => {
    if (allocations.length === 0) return
    const share = Math.floor(100 / allocations.length)
    const rem   = 100 - share * allocations.length
    setAllocations(prev => prev.map((a, i) => ({
      ...a,
      weight: i === 0 ? share + rem : share
    })))
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Vote</h1>
        <p className="text-text-secondary">
          Direct emissions by voting with your veNFT. Earn fees from pools you vote for.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: veNFT selector + vote builder */}
        <div className="lg:col-span-1 space-y-4">
          {/* veNFT selector */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
              Your veNFTs
            </div>
            <div className="text-center py-6 text-text-muted text-sm">
              Connect wallet to see your veNFTs
            </div>
          </div>

          {/* Vote builder */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider">
                Vote Allocation
              </div>
              <button
                onClick={distribute}
                className="text-2xs font-mono text-aeon-400 hover:text-aeon-300 transition-colors"
                disabled={allocations.length === 0}
              >
                Distribute evenly
              </button>
            </div>

            {allocations.length === 0 ? (
              <div className="text-center py-6">
                <Vote size={24} className="text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">Select pools from the list to allocate votes</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allocations.map(alloc => (
                  <div key={alloc.pool} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text-primary">{alloc.pool}</span>
                      <button onClick={() => removePool(alloc.pool)} className="text-text-muted hover:text-red-400 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={alloc.weight}
                        onChange={e => setWeight(alloc.pool, parseInt(e.target.value))}
                        className="flex-1 accent-aeon-400"
                      />
                      <div className="flex items-center gap-1 w-16">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={alloc.weight}
                          onChange={e => setWeight(alloc.pool, parseInt(e.target.value) || 0)}
                          className="w-12 bg-bg-base border border-bg-border rounded-lg px-2 py-1
                                     text-xs font-mono text-center text-text-primary focus:outline-none
                                     focus:border-aeon-400"
                        />
                        <span className="text-xs text-text-muted">%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Total bar */}
            <div className="mt-4 pt-4 border-t border-bg-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Total weight</span>
                <span className={clsx(
                  'text-sm font-mono font-bold',
                  totalWeight === 100 ? 'text-emerald-400' :
                  totalWeight > 100  ? 'text-red-400'     : 'text-text-primary'
                )}>
                  {totalWeight}%
                </span>
              </div>
              <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                <div
                  className={clsx(
                    'h-full rounded-full transition-all',
                    totalWeight === 100 ? 'bg-emerald-400' :
                    totalWeight > 100  ? 'bg-red-400'     : 'bg-aeon-400'
                  )}
                  style={{ width: `${Math.min(totalWeight, 100)}%` }}
                />
              </div>
              {totalWeight !== 100 && allocations.length > 0 && (
                <p className="text-2xs text-text-muted mt-1">
                  {totalWeight > 100
                    ? `${totalWeight - 100}% over limit`
                    : `${remaining}% unallocated`}
                </p>
              )}
            </div>

            <button
              disabled={totalWeight !== 100 || allocations.length === 0 || !selectedNFT}
              className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
            >
              <Vote size={16} />
              Cast Vote
            </button>
            {!selectedNFT && (
              <p className="text-2xs text-text-muted text-center mt-2">Select a veNFT above to vote</p>
            )}
          </div>

          {/* Epoch info */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
              Epoch Info
            </div>
            <div className="space-y-2">
              {[
                { label: 'Current Epoch', value: '—' },
                { label: 'Epoch Ends',    value: '— days' },
                { label: 'Total Votes',   value: '— veAEON' },
                { label: 'Next Emissions',value: '— AEON' },
              ].map(item => (
                <div key={item.label} className="flex justify-between text-sm">
                  <span className="text-text-muted">{item.label}</span>
                  <span className="font-mono text-text-primary">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Pool list */}
        <div className="lg:col-span-2">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pools..."
              className="input-base flex-1 text-sm py-2"
            />
            <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
              {(['all', 'vAMM', 'CL', 'DLMM'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize',
                    filterType === t
                      ? 'bg-bg-base text-text-primary'
                      : 'text-text-muted hover:text-text-secondary'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Pool table */}
          <div className="card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-bg-border">
              {['Pool', 'Type', 'TVL', 'Volume 24h', 'APR', 'vAPR', ''].map((h, i) => (
                <div key={h} className={clsx(
                  'text-2xs font-mono text-text-muted uppercase tracking-wider',
                  i === 0 ? 'col-span-3' :
                  i === 1 ? 'col-span-1' :
                  i === 6 ? 'col-span-1 text-right' : 'col-span-2'
                )}>
                  {h}
                </div>
              ))}
            </div>

            <div className="divide-y divide-bg-border">
              {filteredPools.slice(0, 30).map(pool => {
                const isSelected = allocations.some(a => a.pool === pool.name + ' ' + pool.type)
                const poolKey = pool.name + ' ' + pool.type

                return (
                  <div
                    key={pool.address}
                    className={clsx(
                      'grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-bg-raised transition-colors',
                      isSelected && 'bg-aeon-400/5'
                    )}
                  >
                    {/* Pool name */}
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="flex -space-x-1">
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border
                                        flex items-center justify-center text-2xs font-bold z-10">
                          {pool.token0[0]}
                        </div>
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border
                                        flex items-center justify-center text-2xs font-bold">
                          {pool.token1[0]}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary leading-tight">{pool.name}</div>
                        <div className="text-2xs font-mono text-text-muted">{pool.fee}</div>
                      </div>
                    </div>

                    {/* Type */}
                    <div className="col-span-1">
                      <span className={clsx(
                        'text-2xs font-mono font-bold',
                        pool.type === 'vAMM' ? 'text-blue-400' :
                        pool.type === 'CL'   ? 'text-violet-400' : 'text-emerald-400'
                      )}>
                        {pool.type}
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="col-span-2 text-sm font-mono text-text-secondary">$—</div>
                    <div className="col-span-2 text-sm font-mono text-text-secondary">$—</div>
                    <div className="col-span-2 text-sm font-mono text-emerald-400 apr-value">—%</div>
                    <div className="col-span-1 text-sm font-mono text-violet-400">—%</div>

                    {/* Add button */}
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => isSelected ? removePool(poolKey) : addPool(poolKey)}
                        className={clsx(
                          'w-7 h-7 rounded-lg flex items-center justify-center transition-all',
                          isSelected
                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                            : 'bg-aeon-400/10 text-aeon-400 hover:bg-aeon-400/20',
                          allocations.length >= 6 && !isSelected && 'opacity-30 cursor-not-allowed'
                        )}
                        disabled={allocations.length >= 6 && !isSelected}
                      >
                        {isSelected ? <X size={12} /> : <Plus size={12} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-text-muted mt-3 text-center font-mono">
            {filteredPools.length} pools · Max 6 pools per vote
          </p>
        </div>
      </div>
    </div>
  )
}
