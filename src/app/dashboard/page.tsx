'use client'
import { useState } from 'react'
import { TrendingUp, Flame, Lock, Vote, BarChart3, Clock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CONTRACTS } from '@/config/contracts'
import { ERC20_ABI, VOTING_ESCROW_ABI, FURNACE_ABI, VOTER_ABI } from '@/config/abis'
import { clsx } from 'clsx'

const tvlData = Array.from({ length: 30 }, (_, i) => ({
  day: i + 1,
  tvl: 1000 + Math.random() * 500 + i * 50,
  volume: 200 + Math.random() * 300,
}))
const emissionData = Array.from({ length: 10 }, (_, i) => ({
  epoch: i + 1,
  emissions: i < 2 ? 250 : Math.round(50 + Math.random() * 200),
  fees: Math.round(100 + Math.random() * 500),
}))

function fmt18(v: bigint | undefined, decimals = 2) {
  if (v === undefined) return '—'
  return parseFloat(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

export default function DashboardPage() {
  const [chartTab, setChartTab] = useState<'tvl' | 'volume' | 'emissions'>('tvl')

  const { data: aeonSupply }    = useReadContract({ address: CONTRACTS.AeonToken,        abi: ERC20_ABI,          functionName: 'totalSupply' })
  const { data: totalBurned }   = useReadContract({ address: CONTRACTS.TheFurnace,       abi: FURNACE_ABI,        functionName: 'totalBurned' })
  const { data: veTotalSupply } = useReadContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,  functionName: 'totalSupply' })
  const { data: veTokenCount }  = useReadContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,  functionName: 'tokenId' })
  const { data: totalVotes }    = useReadContract({ address: CONTRACTS.AeonVoter,        abi: VOTER_ABI,          functionName: 'totalWeight' })

  // Epoch = weeks since Unix epoch (matches contract: timestamp / WEEK * WEEK)
  const WEEK_MS       = 7 * 24 * 60 * 60 * 1000
  const WEEK_S        = 7 * 24 * 60 * 60
  const now           = Date.now()
  const epochStartMs  = Math.floor(now / WEEK_MS) * WEEK_MS
  const epochEndMs    = epochStartMs + WEEK_MS
  const remaining     = epochEndMs - now
  const days          = Math.floor(remaining / (24 * 60 * 60 * 1000))
  const hours         = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const fmtDate       = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const epochLabel    = `${fmtDate(epochStartMs)} – ${fmtDate(epochEndMs)}`
  // Protocol epoch number: weeks since deployment (~Jun 27 2026)
  const GENESIS_S     = 1751000000 // approx Jun 27 2026 unix timestamp
  const protocolEpoch = Math.floor((now / 1000 - GENESIS_S) / WEEK_S) + 1

  const burnedPct = aeonSupply && totalBurned && aeonSupply > 0n
    ? ((Number(totalBurned) / Number(aeonSupply)) * 100).toFixed(2)
    : '—'

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Dashboard</h1>
        <p className="text-text-secondary">Protocol stats, pool performance, and epoch data</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Value Locked', value: '$—',                                           icon: <TrendingUp size={16} className="text-aeon-400" />,    delta: '+—%' },
          { label: 'Volume 24h',         value: '$—',                                           icon: <BarChart3  size={16} className="text-violet-400" />,  delta: '+—%' },
          { label: 'AEON Supply',        value: `${fmt18(aeonSupply)} AEON`,                   icon: <Vote       size={16} className="text-emerald-400" />, delta: 'genesis: 1,000' },
          { label: 'AEON Burned',        value: `${fmt18(totalBurned)} AEON`,                  icon: <Flame      size={16} className="text-red-400" />,     delta: `${burnedPct}% of supply` },
        ].map(kpi => (
          <div key={kpi.label} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="stat-label">{kpi.label}</span>
              {kpi.icon}
            </div>
            <div className="stat-value text-xl mb-1">{kpi.value}</div>
            <div className="text-2xs font-mono text-emerald-400">{kpi.delta}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 p-1 bg-bg-raised rounded-xl border border-bg-border">
            {(['tvl', 'volume', 'emissions'] as const).map(t => (
              <button key={t} onClick={() => setChartTab(t)} className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all', chartTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {t}
              </button>
            ))}
          </div>
          <span className="text-xs text-text-muted font-mono">Last 30 days</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartTab === 'emissions' ? emissionData : tvlData}>
            <defs>
              <linearGradient id="aeonGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#FFB800" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#FFB800" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey={chartTab === 'emissions' ? 'epoch' : 'day'} stroke="#5A5A60" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
            <YAxis stroke="#5A5A60" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
            <Tooltip contentStyle={{ background: '#111118', border: '1px solid #23232D', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
            <Area type="monotone" dataKey={chartTab === 'tvl' ? 'tvl' : chartTab === 'volume' ? 'volume' : 'emissions'} stroke="#FFB800" strokeWidth={2} fill="url(#aeonGrad)" />
            {chartTab === 'emissions' && <Area type="monotone" dataKey="fees" stroke="#8B5CF6" strokeWidth={2} fill="none" strokeDasharray="4 4" />}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Protocol stats */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-aeon-400" />
            <span className="font-display font-semibold text-text-primary">Epoch Status</span>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Current Epoch',      value: `#${protocolEpoch} (${epochLabel})` },
              { label: 'Epoch Ends',         value: `${days}d ${hours}h remaining` },
              { label: 'Total Votes',        value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
              { label: 'Fees This Epoch',    value: '$—' },
              { label: 'Projected Emissions',value: '— AEON' },
              { label: 'Emissions Status',   value: 'Awaiting first vote + distribute()', highlight: true },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className={clsx('text-sm font-mono', (item as any).highlight ? 'text-aeon-400' : 'text-text-primary')}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-4 h-4 rounded bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
            <span className="font-display font-semibold text-text-primary">AEON Token</span>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Price',         value: '$—' },
              { label: 'Market Cap',    value: '$—' },
              { label: 'Total Supply',  value: aeonSupply !== undefined ? `${fmt18(aeonSupply)} AEON` : '—' },
              { label: 'Total Burned',  value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
              { label: '% Burned',      value: `${burnedPct}%` },
              { label: 'Total Locked',  value: veTotalSupply !== undefined ? `${fmt18(veTotalSupply)} veAEON` : '—' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className="text-sm font-mono text-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-violet-400" />
            <span className="font-display font-semibold text-text-primary">VotingEscrow</span>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Total veAEON',     value: veTotalSupply !== undefined ? `${fmt18(veTotalSupply)}` : '—' },
              { label: 'veNFTs Minted',    value: veTokenCount !== undefined ? veTokenCount.toString() : '—' },
              { label: 'Total Votes',      value: totalVotes !== undefined ? `${fmt18(totalVotes)}` : '—' },
              { label: 'Avg Lock Duration',value: '— days' },
              { label: 'Lock Rate',        value: '—% of supply' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className="text-sm font-mono text-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Flame size={16} className="text-aeon-400" />
            <span className="font-display font-semibold text-text-primary">The Furnace</span>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Total Burned',        value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
              { label: '% of Supply Burned',  value: `${burnedPct}%` },
              { label: 'Buyback Burns',       value: '— AEON' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className="text-sm font-mono text-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pool table */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-bg-border flex items-center justify-between">
          <h2 className="font-display font-semibold text-text-primary">All Pools</h2>
          <span className="text-xs font-mono text-text-muted">{POOLS.length} pools</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bg-border">
                {['Pool', 'Type', 'Fee', 'TVL', 'Volume 24h', 'APR', 'vAPR', 'Votes'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-2xs font-mono text-text-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {POOLS.map(pool => (
                <tr key={pool.address} className="hover:bg-bg-raised transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1">
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold z-10">{pool.token0[0]}</div>
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold">{pool.token1[0]}</div>
                      </div>
                      <span className="text-sm font-medium text-text-primary">{pool.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span></td>
                  <td className="px-4 py-3 text-xs font-mono text-text-muted">{pool.fee}</td>
                  <td className="px-4 py-3 text-sm font-mono text-text-secondary">$—</td>
                  <td className="px-4 py-3 text-sm font-mono text-text-secondary">$—</td>
                  <td className="px-4 py-3 text-sm font-mono text-emerald-400">—%</td>
                  <td className="px-4 py-3 text-sm font-mono text-violet-400">—%</td>
                  <td className="px-4 py-3 text-xs font-mono text-text-muted">— veAEON</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
