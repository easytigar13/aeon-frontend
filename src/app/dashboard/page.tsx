'use client'
import { useState } from 'react'
import { TrendingUp, Flame, Lock, Vote, BarChart3, Clock } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CL_POOLS, CONTRACTS } from '@/config/contracts'
import { ERC20_ABI, VOTING_ESCROW_ABI, FURNACE_ABI, VOTER_ABI, EMISSIONS_ENGINE_ABI, FEE_DISTRIBUTOR_ABI } from '@/config/abis'
import { clsx } from 'clsx'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useTotalTVL } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

function fmtUsd(n: number | null, compact = false): string {
  if (n === null) return '$—'
  if (compact && n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (compact && n >= 1_000)    return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmt18(v: bigint | undefined, decimals = 2) {
  if (v === undefined) return '—'
  return parseFloat(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function tokenIcon(symbol: string) {
  return symbol.startsWith('WBTC') ? '₿' : symbol[0]
}

export default function DashboardPage() {
  const [chartTab, setChartTab] = useState<'tvl' | 'volume'>('tvl')

  const prices      = usePrices()
  const poolStats   = usePoolStats(prices)
  const clPoolStats = useClPoolStats(prices)
  const totalTVL    = useTotalTVL([...poolStats, ...clPoolStats])
  const volResult   = useVolume24h(prices)
  const volume24h = volResult.total
  const volByAddr = volResult.byPool
  const statByAddr = Object.fromEntries(poolStats.map(s => [s.address, s]))

  const { data: aeonSupply }    = useReadContract({ address: CONTRACTS.AeonToken,        abi: ERC20_ABI,          functionName: 'totalSupply' })
  const { data: totalBurned }   = useReadContract({ address: CONTRACTS.TheFurnace,       abi: FURNACE_ABI,        functionName: 'totalBurned' })
  const { data: veTokenCount }  = useReadContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,  functionName: 'tokenId' })
  const { data: totalVotes }      = useReadContract({ address: CONTRACTS.AeonVoter,       abi: VOTER_ABI,            functionName: 'totalWeight' })
  const { data: weeklyEmissions } = useReadContract({ address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'lastMintAmount' })
  const { data: epochFeesRaw }    = useReadContract({ address: CONTRACTS.FeeDistributor,  abi: FEE_DISTRIBUTOR_ABI, functionName: 'lastEpochFeesUSD' })

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
  const GENESIS_S     = 1782950400 // Robinhood Chain genesis epoch, 2026-07-02
  const protocolEpoch = Math.floor((now / 1000 - GENESIS_S) / WEEK_S)

  // Epoch timing
  const elapsedMs      = now - epochStartMs
  const elapsedDays    = elapsedMs / (24 * 60 * 60 * 1000)
  const blendedFeePct  = 0.003 // ~0.3% blended across pools
  const aeonPrice      = prices.AEON ?? null

  // Projected emissions — prefer on-chain, fall back to volume estimate
  const projectedEmissionsAeon = weeklyEmissions
    ? parseFloat(formatUnits(weeklyEmissions as bigint, 18))
    : (volume24h !== null && aeonPrice && aeonPrice > 0)
      ? (volume24h * 7 * blendedFeePct) / 10 / aeonPrice
      : null

  // Fees this epoch — FeeDistributorV3.lastEpochFeesUSD is already USD-denominated (18 dec)
  const feesThisEpoch = epochFeesRaw
    ? parseFloat(formatUnits(epochFeesRaw as bigint, 18))
    : (volume24h !== null)
      ? volume24h * elapsedDays * blendedFeePct
      : null

  const burnedPct = aeonSupply && totalBurned && aeonSupply > 0n
    ? ((Number(totalBurned) / Number(aeonSupply)) * 100).toFixed(2)
    : '—'

  const lockRate = aeonSupply && totalVotes && aeonSupply > 0n
    ? ((Number(totalVotes) / Number(aeonSupply)) * 100).toFixed(1)
    : '—'

  const seenAddrs = new Set<string>()
  const uniquePools = POOLS.filter(p => {
    if (seenAddrs.has(p.address)) return false
    seenAddrs.add(p.address)
    return true
  })

  const tvlChartData = uniquePools
    .map(p => ({ name: p.name, value: statByAddr[p.address]?.tvlUsd ?? 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const volChartData = uniquePools
    .map(p => ({ name: p.name, value: volByAddr[p.address.toLowerCase()] ?? 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const chartData  = chartTab === 'tvl' ? tvlChartData : volChartData
  const chartEmpty = chartData.length === 0

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Dashboard</h1>
        <p className="text-text-secondary">Protocol stats, pool performance, and epoch data</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Value Locked', value: fmtUsd(totalTVL || null, true),   icon: <TrendingUp size={16} className="text-aeon-400" />,    delta: `${POOLS.length + CL_POOLS.length} pools` },
          { label: 'Volume 24h',         value: fmtUsd(volume24h, true),          icon: <BarChart3  size={16} className="text-violet-400" />,  delta: 'from on-chain swap events' },
          { label: 'AEON Supply',        value: `${fmt18(aeonSupply)} AEON`,      icon: <Vote       size={16} className="text-emerald-400" />, delta: 'genesis: 90,000' },
          { label: 'AEON Burned',        value: `${fmt18(totalBurned)} AEON`,     icon: <Flame      size={16} className="text-red-400" />,     delta: `${burnedPct}% of supply` },
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

      <div className="card p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 p-1 bg-bg-raised rounded-xl border border-bg-border">
            {(['tvl', 'volume'] as const).map(t => (
              <button key={t} onClick={() => setChartTab(t)} className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-all', chartTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                {t === 'tvl' ? 'TVL by Pool' : 'Volume 24h by Pool'}
              </button>
            ))}
          </div>
          <span className="text-xs text-text-muted font-mono">Live on-chain</span>
        </div>
        {chartEmpty ? (
          <div className="h-[200px] flex items-center justify-center text-text-muted text-sm font-mono">
            {chartTab === 'volume' ? 'No swaps through AEON pools yet — pools need rebalancing by LPs before trading is active' : 'No liquidity yet — add to a pool to see TVL here'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 36)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 40 }}>
              <XAxis type="number" stroke="#5A5A60" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} tickFormatter={(v: number) => fmtUsd(v, true)} />
              <YAxis type="category" dataKey="name" width={120} stroke="#5A5A60" tick={{ fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              <Tooltip
                contentStyle={{ background: '#111118', border: '1px solid #23232D', borderRadius: 8, fontSize: 12, fontFamily: 'var(--font-mono)' }}
                formatter={(v: number) => [fmtUsd(v), chartTab === 'tvl' ? 'TVL' : 'Volume']}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {chartData.map((_: unknown, idx: number) => (
                  <Cell key={idx} fill={chartTab === 'tvl' ? '#FFB800' : '#8B5CF6'} fillOpacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-aeon-400" />
            <span className="font-display font-semibold text-text-primary">Epoch Status</span>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Current Epoch',       value: `#${protocolEpoch} (${epochLabel})` },
              { label: 'Epoch Ends',          value: `${days}d ${hours}h remaining` },
              { label: 'Total Votes',         value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
              { label: 'Fees This Epoch',     value: feesThisEpoch !== null ? fmtUsd(feesThisEpoch, true) : '$—' },
              { label: 'Projected Emissions', value: projectedEmissionsAeon !== null ? `~${projectedEmissionsAeon.toLocaleString(undefined, { maximumFractionDigits: 0 })} AEON` : '— AEON' },
              { label: 'Emissions Status',    value: totalVotes && totalVotes > 0n ? 'Active' : 'Awaiting first vote + distribute()', highlight: true },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className={clsx('text-sm font-mono', (item as { highlight?: boolean }).highlight ? 'text-aeon-400' : 'text-text-primary')}>{item.value}</span>
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
              { label: 'Price',        value: prices.AEON ? fmtUsd(prices.AEON) : '$—' },
              { label: 'Market Cap',   value: (prices.AEON && aeonSupply) ? fmtUsd(prices.AEON * parseFloat(formatUnits(aeonSupply, 18)), true) : '$—' },
              { label: 'Total Supply', value: aeonSupply !== undefined ? `${fmt18(aeonSupply)} AEON` : '—' },
              { label: 'Total Burned', value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
              { label: '% Burned',     value: `${burnedPct}%` },
              { label: 'Total Voting Power', value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
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
              { label: 'veNFTs Minted', value: veTokenCount !== undefined ? veTokenCount.toString() : '—' },
              { label: 'Total Votes',   value: totalVotes !== undefined ? `${fmt18(totalVotes)}` : '—' },
              { label: 'Voting Power Rate', value: lockRate !== '—' ? `${lockRate}% of supply` : '—' },
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
              { label: 'Total Burned',       value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
              { label: '% of Supply Burned', value: `${burnedPct}%` },
              { label: 'Buyback Burns',      value: '— AEON' },
            ].map(item => (
              <div key={item.label} className="flex justify-between items-center">
                <span className="text-sm text-text-muted">{item.label}</span>
                <span className="text-sm font-mono text-text-primary">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-bg-border flex items-center justify-between">
          <h2 className="font-display font-semibold text-text-primary">All Pools</h2>
          <span className="text-xs font-mono text-text-muted">{POOLS.length} pools</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bg-border">
                {['Pool', 'Type', 'Fee', 'TVL', 'Volume 24h', 'Fee APR', 'Votes'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-2xs font-mono text-text-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {POOLS.map(pool => {
                const stat    = statByAddr[pool.address]
                const vol     = volByAddr[pool.address.toLowerCase()] ?? null
                const tvl     = stat?.tvlUsd ?? null
                const feePct  = parseFloat(pool.fee) / 100
                const feeApr  = (vol !== null && tvl && tvl > 0)
                  ? ((vol * feePct * 365) / tvl * 100).toFixed(1) + '%'
                  : '—'

                return (
                  <tr key={pool.address + pool.fee} className="hover:bg-bg-raised transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-1">
                          <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold z-10">{tokenIcon(pool.token0)}</div>
                          <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold">{tokenIcon(pool.token1)}</div>
                        </div>
                        <span className="text-sm font-medium text-text-primary">{pool.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span></td>
                    <td className="px-4 py-3 text-xs font-mono text-text-muted">{pool.fee}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">{fmtUsd(tvl)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">{fmtUsd(vol)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-emerald-400">{feeApr}</td>
                    <td className="px-4 py-3 text-xs font-mono text-text-muted">{stat ? `${stat.votesFormatted} veAEON` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
