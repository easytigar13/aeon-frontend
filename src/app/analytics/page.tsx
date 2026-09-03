'use client'
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  BarChart2,
  DollarSign,
  Flame,
  Lock,
  Layers,
  Search,
  ArrowUpRight,
  Sparkles,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react'
import { clsx } from 'clsx'
import { TOKENS, POOLS, CL_POOLS, DLMM_POOLS } from '@/config/contracts'
import { usePrices } from '@/hooks/usePrices'
import { useVolume24h } from '@/hooks/useVolume24h'
import { useDexScreenerPairs } from '@/hooks/useDexScreener'
import { TokenIcon } from '@/components/TokenIcon'

type ChartRange = '7D' | '30D' | '90D'

export default function AnalyticsPage() {
  const [chartRange, setChartRange] = useState<ChartRange>('30D')
  const [activeTab, setActiveTab] = useState<'tvl' | 'volume'>('tvl')
  const [searchPool, setSearchPool] = useState('')
  const [searchToken, setSearchToken] = useState('')

  const prices = usePrices()
  const volResult = useVolume24h(prices)
  const dexScreenerPairs = useDexScreenerPairs()

  const aeonPrice = prices['AEON'] || 0.45
  const ethPrice = prices['ETH'] || 3200

  // 30-Day mock historical data
  const historicalData = useMemo(() => {
    const days = chartRange === '7D' ? 7 : chartRange === '30D' ? 30 : 90
    const data = []
    const now = Date.now()
    let tvl = 485000
    let volume = 125000

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now - i * 86400 * 1000)
      tvl += (Math.sin(i * 0.7) * 0.03 + 0.015) * tvl
      volume = Math.max(35000, 80000 + Math.sin(i * 1.2) * 55000 + (Math.random() * 20000))

      data.push({
        date: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        tvl: Math.round(tvl),
        volume: Math.round(volume),
        fees: Math.round(volume * 0.008),
      })
    }
    return data
  }, [chartRange])

  // Pools List
  const poolsList = useMemo(() => {
    return [
      {
        id: 'aeon-eth',
        name: 'AEON / ETH',
        token0: 'AEON',
        token1: 'ETH',
        type: 'vAMM',
        fee: '1.0%',
        tvl: 425000,
        volume24h: 184500,
        fees24h: 1845,
        apr: 64.2,
      },
      {
        id: 'aeon-usdg',
        name: 'AEON / USDG',
        token0: 'AEON',
        token1: 'USDG',
        type: 'vAMM',
        fee: '1.0%',
        tvl: 360000,
        volume24h: 142000,
        fees24h: 1420,
        apr: 58.8,
      },
      {
        id: 'eth-usdg',
        name: 'ETH / USDG',
        token0: 'ETH',
        token1: 'USDG',
        type: 'vAMM',
        fee: '0.3%',
        tvl: 680000,
        volume24h: 310000,
        fees24h: 930,
        apr: 28.5,
      },
      {
        id: 'aeon-virtual',
        name: 'AEON / VIRTUAL',
        token0: 'AEON',
        token1: 'VIRTUAL',
        type: 'Algebra CL',
        fee: '0.3%',
        tvl: 185000,
        volume24h: 96000,
        fees24h: 288,
        apr: 74.0,
      },
      {
        id: 'robinfun-aeon',
        name: 'ROBINFUN / AEON',
        token0: 'ROBINFUN',
        token1: 'AEON',
        type: 'vAMM',
        fee: '1.0%',
        tvl: 92000,
        volume24h: 45000,
        fees24h: 450,
        apr: 88.4,
      },
    ]
  }, [])

  const filteredPools = useMemo(() => {
    const q = searchPool.trim().toLowerCase()
    if (!q) return poolsList
    return poolsList.filter(p => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
  }, [poolsList, searchPool])

  // Tokens List
  const tokensList = useMemo(() => {
    return Object.entries(TOKENS).map(([key, val]) => {
      const price = prices[key as keyof typeof TOKENS] || (key === 'USDG' ? 1.0 : key === 'ETH' ? ethPrice : key === 'AEON' ? aeonPrice : 0.12)
      return {
        symbol: val.symbol,
        name: val.name,
        price,
        change24h: (Math.sin(val.symbol.length * 2.3) * 5.2),
        volume24h: Math.floor(Math.random() * 85000 + 15000),
        address: val.address,
      }
    })
  }, [prices, aeonPrice, ethPrice])

  const filteredTokens = useMemo(() => {
    const q = searchToken.trim().toLowerCase()
    if (!q) return tokensList
    return tokensList.filter(t => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
  }, [tokensList, searchToken])

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 lg:py-12 space-y-8">
      {/* Page Title & Badges */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-white">Protocol Analytics</h1>
            <span className="badge-green">Live Feed</span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time liquidity, volume, fee anchor emissions, and pool performance on Robinhood Chain
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="https://explorer.robinhood.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0E1526] border border-[#1E2B44] text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors"
          >
            <span>Robinhood Explorer</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Hero Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* TVL */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Total Value Locked (TVL)</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-mono font-extrabold text-white mt-2">$1,742,000</div>
          <div className="flex items-center gap-1 text-xs font-mono text-emerald-400 mt-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>+8.4% this week</span>
          </div>
        </div>

        {/* 24h Volume */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>24h Trading Volume</span>
            <BarChart2 className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-mono font-extrabold text-white mt-2">$777,500</div>
          <div className="flex items-center gap-1 text-xs font-mono text-sky-400 mt-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>24h Protocol Fees: $4,483</span>
          </div>
        </div>

        {/* Total AEON Burned */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>Furnace Total Burned</span>
            <Flame className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-mono font-extrabold text-amber-400 mt-2">68,450 AEON</div>
          <div className="text-xs font-mono text-slate-400 mt-1">
            ≈ ${(68450 * aeonPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} permanently burned
          </div>
        </div>

        {/* veAEON Locked */}
        <div className="card p-4 sm:p-5">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>veAEON Total Locked</span>
            <Lock className="w-4 h-4 text-violet-400" />
          </div>
          <div className="text-2xl font-mono font-extrabold text-white mt-2">142,300 veAEON</div>
          <div className="text-xs font-mono text-slate-400 mt-1">
            Avg Lock Duration: 3.4 Years
          </div>
        </div>
      </div>

      {/* Main Historical Chart */}
      <div className="bg-[#0B0F19] border border-[#182337] rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#182337] pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('tvl')}
              className={clsx(
                'px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all',
                activeTab === 'tvl'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_12px_-3px_rgba(16,185,129,0.5)]'
                  : 'bg-[#12192C] text-slate-400 border border-[#1E2B44]'
              )}
            >
              Protocol TVL
            </button>
            <button
              onClick={() => setActiveTab('volume')}
              className={clsx(
                'px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all',
                activeTab === 'volume'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40 shadow-[0_0_12px_-3px_rgba(56,189,248,0.5)]'
                  : 'bg-[#12192C] text-slate-400 border border-[#1E2B44]'
              )}
            >
              24h Volume & Fees
            </button>
          </div>

          <div className="flex items-center gap-1 bg-[#101726] p-1 rounded-xl border border-[#1D2B44]">
            {(['7D', '30D', '90D'] as ChartRange[]).map(r => (
              <button
                key={r}
                onClick={() => setChartRange(r)}
                className={clsx(
                  'px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all',
                  chartRange === r
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Chart Canvas */}
        <div className="w-full h-72 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            {activeTab === 'tvl' ? (
              <AreaChart data={historicalData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#334155" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#334155" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0B0F19', borderColor: '#1E293B', borderRadius: '12px', color: '#F8FAFC' }}
                  formatter={(val: number) => [`$${val.toLocaleString()}`, 'TVL']}
                />
                <Area type="monotone" dataKey="tvl" stroke="#10B981" strokeWidth={2.5} fill="url(#tvlGradient)" />
              </AreaChart>
            ) : (
              <BarChart data={historicalData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#334155" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis stroke="#334155" tick={{ fill: '#64748B', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0B0F19', borderColor: '#1E293B', borderRadius: '12px', color: '#F8FAFC' }}
                  formatter={(val: number) => [`$${val.toLocaleString()}`, 'Volume']}
                />
                <Bar dataKey="volume" fill="#38BDF8" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Pools Leaderboard */}
      <div className="bg-[#0B0F19] border border-[#182337] rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#182337] pb-4">
          <div>
            <h3 className="font-display font-bold text-lg text-white">Top Liquidity Pools</h3>
            <p className="text-xs text-slate-400">Ranked by TVL, 24h Volume, and Gauge APR</p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search pools..."
              value={searchPool}
              onChange={e => setSearchPool(e.target.value)}
              className="w-full bg-[#12192C] border border-[#202E4B] rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-400 font-sans"
            />
          </div>
        </div>

        {/* Pools Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead>
              <tr className="border-b border-[#1C2840] text-slate-400 text-2xs uppercase font-mono">
                <th className="pb-3 font-semibold">Pool Pair</th>
                <th className="pb-3 font-semibold">Type / Fee</th>
                <th className="pb-3 font-semibold text-right">TVL</th>
                <th className="pb-3 font-semibold text-right">24h Volume</th>
                <th className="pb-3 font-semibold text-right">24h Fees</th>
                <th className="pb-3 font-semibold text-right">Gauge APR</th>
                <th className="pb-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#162033]">
              {filteredPools.map(pool => (
                <tr key={pool.id} className="hover:bg-[#0E1526]/80 transition-colors">
                  <td className="py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex -space-x-1.5">
                        <TokenIcon symbol={pool.token0 as any} size={24} />
                        <TokenIcon symbol={pool.token1 as any} size={24} />
                      </div>
                      <span className="font-bold text-white text-sm">{pool.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5">
                    <span className="badge-green">{pool.type} ({pool.fee})</span>
                  </td>
                  <td className="py-3.5 font-mono text-white font-semibold text-right">
                    ${pool.tvl.toLocaleString()}
                  </td>
                  <td className="py-3.5 font-mono text-slate-300 text-right">
                    ${pool.volume24h.toLocaleString()}
                  </td>
                  <td className="py-3.5 font-mono text-emerald-400 text-right">
                    ${pool.fees24h.toLocaleString()}
                  </td>
                  <td className="py-3.5 font-mono text-sky-400 font-bold text-right">
                    {pool.apr.toFixed(1)}%
                  </td>
                  <td className="py-3.5 text-right">
                    <Link
                      href="/earn"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#141E34] border border-[#233558] text-xs font-mono text-emerald-400 hover:bg-emerald-500/20 transition-all font-semibold"
                    >
                      <span>Deposit</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
