'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { CONTRACTS, POOLS, TOKENS } from '@/config/contracts'
import { FURNACE_ABI, ERC20_ABI, PAIR_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

function fmtUsd(n: number | null): string {
  if (!n || n <= 0) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function LiveHomepageStats() {
  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const volResult = useVolume24h(prices)

  const totalTvl  = poolStats.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0)
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

  // Best fee APR across all unique pools as a proxy for "Epoch APR"
  const UNIQUE_POOLS = POOLS.filter((p, _, arr) => arr.findIndex(x => x.address === p.address) === arr.indexOf(p))
  let bestApr: number | null = null
  for (const pool of UNIQUE_POOLS) {
    const tvl = poolStats.find(s => s.address === pool.address)?.tvlUsd ?? null
    const vol = volResult.byPool[pool.address.toLowerCase()] ?? null
    if (tvl && tvl > 0 && vol !== null) {
      const feeRate = parseFloat(pool.fee.replace('%', '')) / 100
      const apr = (vol * feeRate * 365 / tvl) * 100
      if (!bestApr || apr > bestApr) bestApr = apr
    }
  }

  const stats = [
    {
      label: 'Total Value Locked',
      value: fmtUsd(totalTvl || null),
      sub: `across ${UNIQUE_POOLS.length} pools`,
    },
    {
      label: 'AEON Price',
      value: aeonPrice ? `$${aeonPrice < 0.01 ? aeonPrice.toFixed(6) : aeonPrice.toFixed(4)}` : '$—',
      sub: 'TWAP · AEON/USDG',
    },
    {
      label: 'Total Burned',
      value: totalBurned
        ? `${totalBurned.toLocaleString(undefined, { maximumFractionDigits: 0 })} AEON`
        : '— AEON',
      sub: 'via buybacks + furnace',
    },
    {
      label: 'Best Pool APR',
      value: bestApr
        ? bestApr >= 1000 ? '>1000%' : `${bestApr.toFixed(1)}%`
        : '—%',
      sub: 'fee APR, current epoch',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
      {stats.map(stat => (
        <div key={stat.label} className="card p-4 text-center">
          <div className="stat-value text-2xl mb-1">{stat.value}</div>
          <div className="stat-label mb-1">{stat.label}</div>
          <div className="text-2xs text-text-muted">{stat.sub}</div>
        </div>
      ))}
    </div>
  )
}
