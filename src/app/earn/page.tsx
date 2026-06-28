'use client'
import { useState } from 'react'
import { TrendingUp, Coins, ChevronDown, ChevronUp } from 'lucide-react'
import { clsx } from 'clsx'
import { POOLS } from '@/config/contracts'

export default function EarnPage() {
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<'all' | 'my'>('all')

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Earn</h1>
        <p className="text-text-secondary">
          Stake LP tokens to earn AEON emissions. Vote with veNFTs to earn trading fees.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'My Staked LP',     value: '$—',     sub: 'across all gauges' },
          { label: 'Claimable Fees',   value: '— AEON', sub: 'from voted pools' },
          { label: 'Claimable Emiss.', value: '— AEON', sub: 'from staked LP' },
          { label: 'My Avg APR',       value: '—%',     sub: 'weighted average' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <div className="stat-label mb-1">{s.label}</div>
            <div className="stat-value text-xl mb-0.5">{s.value}</div>
            <div className="text-2xs text-text-muted">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Claim all button */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
          {(['all', 'my'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterTab(t)}
              className={clsx(
                'px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all',
                filterTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted'
              )}
            >
              {t === 'all' ? 'All Pools' : 'My Positions'}
            </button>
          ))}
        </div>
        <button className="btn-primary text-sm py-2 px-4 flex items-center gap-2">
          <Coins size={14} />
          Claim All
        </button>
      </div>

      {/* Pool list */}
      <div className="space-y-2">
        {POOLS.map(pool => {
          const isExpanded = expandedPool === pool.address
          const poolKey = `${pool.name}-${pool.type}`

          return (
            <div key={pool.address} className={clsx('card overflow-hidden transition-all', isExpanded && 'border-aeon-400/20')}>
              {/* Header row */}
              <button
                className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left"
                onClick={() => setExpandedPool(isExpanded ? null : pool.address)}
              >
                {/* Pool */}
                <div className="col-span-3 flex items-center gap-2">
                  <div className="flex -space-x-1">
                    <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border
                                    flex items-center justify-center text-xs font-bold z-10">
                      {pool.token0[0]}
                    </div>
                    <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border
                                    flex items-center justify-center text-xs font-bold">
                      {pool.token1[0]}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{pool.name}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={clsx(
                        'text-2xs font-mono font-bold',
                        pool.type === 'vAMM' ? 'text-blue-400' :
                        pool.type === 'CL'   ? 'text-violet-400' : 'text-emerald-400'
                      )}>{pool.type}</span>
                      <span className="text-2xs text-text-muted">· {pool.fee}</span>
                    </div>
                  </div>
                </div>

                {/* TVL */}
                <div className="col-span-2 hidden md:block">
                  <div className="text-sm font-mono text-text-secondary">$—</div>
                  <div className="text-2xs text-text-muted">TVL</div>
                </div>

                {/* APR */}
                <div className="col-span-2">
                  <div className="text-sm font-mono font-bold text-emerald-400">—%</div>
                  <div className="text-2xs text-text-muted">APR</div>
                </div>

                {/* vAPR */}
                <div className="col-span-2 hidden sm:block">
                  <div className="text-sm font-mono font-bold text-violet-400">—%</div>
                  <div className="text-2xs text-text-muted">vAPR</div>
                </div>

                {/* My stake */}
                <div className="col-span-2">
                  <div className="text-sm font-mono text-text-secondary">$—</div>
                  <div className="text-2xs text-text-muted">My Stake</div>
                </div>

                {/* Expand */}
                <div className="col-span-1 flex justify-end">
                  {isExpanded
                    ? <ChevronUp size={16} className="text-text-muted" />
                    : <ChevronDown size={16} className="text-text-muted" />
                  }
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-bg-border px-4 py-4 bg-bg-raised animate-fade-in">
                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Stake LP */}
                    <div>
                      <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
                        Stake LP — Earn AEON Emissions
                      </h4>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            placeholder="0.0"
                            className="input-base flex-1 text-sm py-2"
                          />
                          <button className="btn-primary text-sm py-2 px-4">Stake</button>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-text-muted">LP Balance: —</span>
                          <span className="text-text-muted">Staked: —</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                          <span className="text-sm text-text-muted">Claimable AEON</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-aeon-400">— AEON</span>
                            <button className="text-xs btn-ghost py-1 px-2 text-aeon-400">Claim</button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Fee rewards */}
                    <div>
                      <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
                        Fee Rewards — From Your veNFT Vote
                      </h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                          <span className="text-sm text-text-muted">{pool.token0} fees</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-text-primary">—</span>
                            <button className="text-xs btn-ghost py-1 px-2 text-emerald-400">Claim</button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                          <span className="text-sm text-text-muted">{pool.token1} fees</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-text-primary">—</span>
                            <button className="text-xs btn-ghost py-1 px-2 text-emerald-400">Claim</button>
                          </div>
                        </div>
                        <div className="text-2xs text-text-muted mt-2 text-center">
                          Vote for this pool with your veNFT to earn fee rewards
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
