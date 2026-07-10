'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { CONTRACTS, POOLS, CL_POOLS, DLMM_POOLS, TOKENS } from '@/config/contracts'
import { FURNACE_ABI, ERC20_ABI, PAIR_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useDlmmPoolStats, useTotalTVL } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { CountUp } from '@/components/CountUp'

function fmtUsd(n: number): string {
  if (n <= 0) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function LiveHomepageStats() {
  const prices        = usePrices()
  const poolStats     = usePoolStats(prices)
  const clPoolStats   = useClPoolStats(prices)
  const dlmmPoolStats = useDlmmPoolStats(prices)
  const volResult     = useVolume24h(prices)

  const totalTvl  = useTotalTVL([...poolStats, ...clPoolStats, ...dlmmPoolStats])
  const aeonPrice = prices['AEON'] ?? null

  const { data: totalBurnedRaw } = useReadContract({
    address: CONTRACTS.TheFurnace,
    abi: FURNACE_ABI,
    functionName: 'totalBurned',
    query: { refetchInterval: 60000 },
  })
  const totalBurned = totalBurnedRaw
    ? parseFloat(formatUnits(totalBurnedRaw as bigint, 18))
    : null

  // Best fee APR across all unique pools as a proxy for "Epoch APR" -- uses
  // trailing-week volume (not literal 24h) so a pool doesn't drop out of
  // this just because nothing traded in the exact last 24h.
  const UNIQUE_POOLS = POOLS.filter((p, _, arr) => arr.findIndex(x => x.address === p.address) === arr.indexOf(p))
  let bestApr: number | null = null
  for (const pool of UNIQUE_POOLS) {
    const tvl = poolStats.find(s => s.address === pool.address)?.tvlUsd ?? null
    const volWeek = volResult.byPoolWeek[pool.address.toLowerCase()] ?? null
    if (tvl && tvl > 0 && volWeek !== null) {
      const feeRate = parseFloat(pool.fee.replace('%', '')) / 100
      const apr = (volWeek * feeRate * (365 / 7) / tvl) * 100
      if (!bestApr || apr > bestApr) bestApr = apr
    }
  }

  const stats = [
    {
      label: 'Total Value Locked',
      node: <CountUp value={totalTvl || null} format={fmtUsd} nullText="$—" />,
      sub: `across ${UNIQUE_POOLS.length + CL_POOLS.length + DLMM_POOLS.length} pools`,
    },
    {
      label: 'AEON Price',
      node: <CountUp value={aeonPrice} format={n => `$${n < 0.01 ? n.toFixed(6) : n.toFixed(4)}`} nullText="$—" />,
      sub: 'TWAP · AEON/USDG',
    },
    {
      label: 'Total Burned',
      node: <CountUp value={totalBurned} format={n => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} AEON`} nullText="— AEON" />,
      sub: 'via buybacks + furnace',
    },
    {
      label: 'Best Pool APR',
      node: bestApr && bestApr >= 1000
        ? '>1000%'
        : <CountUp value={bestApr} format={n => `${n.toFixed(1)}%`} nullText="—%" />,
      sub: 'fee APR, current epoch',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="card p-4 text-center transition-all duration-300 hover:border-aeon-400/30 hover:-translate-y-0.5 hover:shadow-[0_0_24px_rgba(255,184,0,0.08)] animate-fade-in"
          style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'backwards' }}
        >
          <div className="stat-value text-2xl mb-1">{stat.node}</div>
          <div className="stat-label mb-1">{stat.label}</div>
          <div className="text-2xs text-text-muted">{stat.sub}</div>
        </div>
      ))}
    </div>
  )
}
