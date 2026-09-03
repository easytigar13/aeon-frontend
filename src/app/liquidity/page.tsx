'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Minus, Layers, Sparkles, TrendingUp, DollarSign, Search, ArrowUpRight, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount } from 'wagmi'
import { POOLS, CL_POOLS, TOKENS } from '@/config/contracts'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useTotalTVL } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { TokenIcon } from '@/components/TokenIcon'
import { UnifiedLiquidityHub } from '@/components/liquidity/UnifiedLiquidityHub'
import { ProtocolBackdrop } from '@/components/ProtocolVisuals'

function fmtUsd(n: number | null): string {
  if (n === null || n <= 0 || !isFinite(n)) return '$0.00'
  if (n < 0.01) return '<$0.01'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseFeePct(fee: string): number {
  return parseFloat(fee.replace('%', '')) / 100
}

export default function LiquidityPage() {
  const { isConnected } = useAccount()
  const prices = usePrices()
  const poolStats = usePoolStats(prices)
  const clPoolStats = useClPoolStats(prices)
  const volResult = useVolume24h(prices)

  const allStats = useMemo(() => [...poolStats, ...clPoolStats], [poolStats, clPoolStats])
  const totalTVL = useTotalTVL(allStats)
  const [searchPool, setSearchPool] = useState('')

  // Map all pools with live stats
  const statByAddr = useMemo(() => {
    return Object.fromEntries(allStats.map(s => [s.address.toLowerCase(), s]))
  }, [allStats])

  const poolsTable = useMemo(() => {
    const rawList = [...POOLS, ...CL_POOLS]
    const seen = new Set<string>()
    const unique = rawList.filter(p => {
      const addr = p.address.toLowerCase()
      if (seen.has(addr)) return false
      seen.add(addr)
      return true
    })

    return unique.map(p => {
      const stat = statByAddr[p.address.toLowerCase()]
      const tvl = stat?.tvlUsd ?? 0
      const vol24h = volResult?.byPool24h?.[p.address.toLowerCase()] ?? 0
      const volWeek = volResult?.byPoolWeek?.[p.address.toLowerCase()] ?? (vol24h * 7)
      const feeRate = parseFeePct(p.fee)
      const fees24h = vol24h * feeRate
      const feesWeek = volWeek * feeRate
      const feeApr = (tvl > 0 && feesWeek > 0)
        ? (feesWeek * (365 / 7) / tvl) * 100
        : (stat?.apr ?? 0)

      return {
        address: p.address,
        name: p.name,
        token0: p.token0,
        token1: p.token1,
        type: p.type,
        fee: p.fee,
        tvl,
        volume24h: vol24h,
        fees24h,
        apr: feeApr,
      }
    }).sort((a, b) => b.tvl - a.tvl)
  }, [statByAddr, volResult])

  const filteredPools = useMemo(() => {
    const q = searchPool.trim().toLowerCase()
    if (!q) return poolsTable
    return poolsTable.filter(p => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
  }, [poolsTable, searchPool])

  return (
    <div className="relative isolate min-h-screen py-10 px-4 sm:px-6 max-w-7xl mx-auto space-y-12">
      <ProtocolBackdrop />

      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Unified Liquidity Hub</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-white">
          Provide Liquidity & Earn Fees
        </h1>
        <p className="text-sm text-slate-400">
          Deposit into any pool in one click with automated ratio balancing, optimal slippage protection, and zero friction.
        </p>
      </div>

      {/* Top 1-Card Unified Add/Withdraw Liquidity Interface */}
      <UnifiedLiquidityHub />

      {/* Pools Explorer Leaderboard */}
      <div className="bg-[#0B0F19]/90 border border-[#182337] rounded-3xl p-5 sm:p-7 backdrop-blur-xl shadow-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#182337] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-white">All Protocol Pools</h3>
              <p className="text-xs text-slate-400">Live reserves and trailing fee APR across all active pairs</p>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search pools..."
              value={searchPool}
              onChange={e => setSearchPool(e.target.value)}
              className="w-full bg-[#101728] border border-[#1E2B44] rounded-xl pl-9 pr-4 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#182337] text-xs font-mono text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-4">Pool Pair</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Fee Tier</th>
                <th className="py-3 px-4">Total Liquidity</th>
                <th className="py-3 px-4">24h Volume</th>
                <th className="py-3 px-4">Fee APR</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#182337]/50 font-mono">
              {filteredPools.map(pool => (
                <tr key={pool.address} className="hover:bg-[#101728]/50 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="flex -space-x-1.5">
                        <TokenIcon symbol={pool.token0} size={26} />
                        <TokenIcon symbol={pool.token1} size={26} />
                      </div>
                      <span className="font-bold text-sm text-white font-display">{pool.name}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className={clsx(
                      'text-2xs px-2 py-0.5 rounded-full font-bold border',
                      pool.type === 'vAMM' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-violet-500/10 text-violet-400 border-violet-500/30'
                    )}>
                      {pool.type}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-xs text-slate-300">{pool.fee}</td>
                  <td className="py-3.5 px-4 text-sm font-bold text-white">{fmtUsd(pool.tvl)}</td>
                  <td className="py-3.5 px-4 text-xs text-slate-300">{fmtUsd(pool.volume24h)}</td>
                  <td className="py-3.5 px-4 text-sm font-bold text-emerald-400">
                    {pool.apr > 0 ? `${pool.apr.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 font-bold text-xs transition-all cursor-pointer"
                    >
                      Deposit
                    </button>
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
