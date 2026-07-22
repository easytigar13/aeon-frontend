'use client'
import { useState } from 'react'
import { TrendingUp, Flame, Lock, Vote, BarChart3, Clock, Coins, Sparkles, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useReadContract, useReadContracts } from 'wagmi'
import { formatUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, CONTRACTS, EPOCH_CONFIG, LEGACY_FEE_DISTRIBUTOR, TOKENS } from '@/config/contracts'
import { ERC20_ABI, VOTING_ESCROW_ABI, FURNACE_ABI, VOTER_ABI, EMISSIONS_ENGINE_ABI, FEE_DISTRIBUTOR_ABI } from '@/config/abis'
import { clsx } from 'clsx'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useDlmmPoolStats, useTotalTVL } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { projectNextEmission } from '@/lib/emissionsProjection'
import { useOraclePricedTokens } from '@/hooks/useOraclePricedTokens'
import { pricedFeeFraction } from '@/lib/pricedFees'
import { hasMeaningfulPoolLiquidity } from '@/lib/poolVisibility'

function fmtUsd(n: number | null, compact = false): string {
  if (n === null) return '$—'
  if (n > 0 && n < 0.01) return '<$0.01'
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

function parseFeeRate(fee: string): number { return parseFloat(fee.replace('%', '')) / 100 }

// ─────────────────────────────────────────────────────────────────────────
// Presentational helpers for the redesigned dashboard -- glowing color-coded
// stat cards, a circular epoch-progress gauge, a hex AEON badge, and icon
// "orb" panels. Tailwind's JIT scanner needs full literal class names (not
// string-concatenated ones), so accent colors are a lookup table of
// complete class strings rather than built from a template.
// ─────────────────────────────────────────────────────────────────────────

type Accent = 'emerald' | 'blue' | 'aeon' | 'violet' | 'red'

const ACCENT: Record<Accent, { text: string; border: string; iconBg: string; glow: string; barHex: string }> = {
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/30', iconBg: 'bg-emerald-500/15', glow: 'rgba(16,185,129,0.35)',  barHex: '#34D399' },
  blue:    { text: 'text-blue-400',    border: 'border-blue-500/30',    iconBg: 'bg-blue-500/15',    glow: 'rgba(59,130,246,0.35)',  barHex: '#60A5FA' },
  aeon:    { text: 'text-aeon-400',    border: 'border-aeon-400/30',    iconBg: 'bg-aeon-400/15',    glow: 'rgba(255,184,0,0.35)',   barHex: '#FFB800' },
  violet:  { text: 'text-violet-400',  border: 'border-violet-500/30',  iconBg: 'bg-violet-500/15',  glow: 'rgba(139,92,246,0.35)',  barHex: '#A78BFA' },
  red:     { text: 'text-red-400',     border: 'border-red-500/30',     iconBg: 'bg-red-500/15',     glow: 'rgba(239,68,68,0.35)',   barHex: '#F87171' },
}

function KpiCard({ label, value, icon, delta, accent }: { label: string; value: string; icon: React.ReactNode; delta: string; accent: Accent }) {
  const a = ACCENT[accent]
  return (
    <div
      className={clsx('group relative overflow-hidden rounded-2xl border bg-bg-surface p-4 transition-all duration-300 hover:-translate-y-1', a.border)}
      style={{ boxShadow: `0 0 32px -12px ${a.glow}` }}
    >
      <div className="absolute inset-x-0 top-0 h-20 opacity-60 pointer-events-none" style={{ background: `linear-gradient(to bottom, ${a.glow}, transparent)` }} />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-300 animate-shimmer"
        style={{ background: `linear-gradient(115deg, transparent 30%, ${a.glow} 50%, transparent 70%)`, backgroundSize: '200% 100%' }}
      />
      <div className="relative flex items-center justify-between mb-3">
        <span className="stat-label">{label}</span>
        <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center border transition-transform duration-300 group-hover:scale-110', a.iconBg, a.border)}>{icon}</div>
      </div>
      <div className="relative stat-value text-2xl mb-1 tracking-tight" style={{ textShadow: `0 0 24px ${a.glow}` }}>{value}</div>
      <div className={clsx('relative text-2xs font-mono', a.text)}>{delta}</div>
    </div>
  )
}

function RadialGauge({ percent, size = 152, stroke = 10, color, children }: { percent: number; size?: number; stroke?: number; color: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(100, Math.max(0, percent))
  const offset = c * (1 - clamped / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          suppressHydrationWarning
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">{children}</div>
    </div>
  )
}

function hexPoints(size: number): string {
  const cx = size / 2, cy = size / 2, r = size / 2 - 2
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`)
  }
  return pts.join(' ')
}

function HexBadge({ size = 96 }: { size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="aeonHexGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFE08A" />
            <stop offset="100%" stopColor="#E6A500" />
          </linearGradient>
        </defs>
        <polygon points={hexPoints(size)} fill="url(#aeonHexGrad)" stroke="#FFB800" strokeWidth={2} style={{ filter: 'drop-shadow(0 0 14px rgba(255,184,0,0.5))' }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-display font-bold text-bg-base" style={{ fontSize: size * 0.36 }}>A</div>
    </div>
  )
}

function IconOrb({ icon, size = 88, accent }: { icon: React.ReactNode; size?: number; accent: Accent }) {
  const a = ACCENT[accent]
  return (
    <div
      className={clsx('relative shrink-0 rounded-full border flex items-center justify-center', a.iconBg, a.border)}
      style={{ width: size, height: size, boxShadow: `0 0 28px ${a.glow}, inset 0 0 20px ${a.glow}` }}
    >
      {icon}
    </div>
  )
}

// Faint starfield + nebula wash, scoped to this page only (absolutely
// positioned behind the content, pointer-events-none) rather than a literal
// space-photo asset -- keeps the page self-contained and on-brand with the
// existing amber/violet glow utilities instead of pulling in new imagery.
function DashboardBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-aeon-glow" />
      <div className="absolute inset-0 bg-violet-glow" style={{ transform: 'scaleY(-1)' }} />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 40px 60px, rgba(240,239,232,0.6) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 140px 20px, rgba(240,239,232,0.4) 1px, transparent 0),' +
            'radial-gradient(1.5px 1.5px at 90px 140px, rgba(240,239,232,0.5) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 190px 100px, rgba(240,239,232,0.3) 1px, transparent 0)',
          backgroundSize: '220px 220px',
        }}
      />
    </div>
  )
}

export default function DashboardPage() {
  const [chartTab, setChartTab] = useState<'tvl' | 'volume'>('tvl')

  const prices        = usePrices()
  const poolStats     = usePoolStats(prices)
  const clPoolStats   = useClPoolStats(prices)
  const dlmmPoolStats = useDlmmPoolStats(prices)
  const allPoolStats  = [...poolStats, ...clPoolStats, ...dlmmPoolStats]
  const liquidPoolStats = allPoolStats.filter(stat => hasMeaningfulPoolLiquidity(stat.tvlUsd))
  const totalTVL      = useTotalTVL(liquidPoolStats)
  const volResult     = useVolume24h(prices)
  const volume24h = volResult.total
  const volByAddr = volResult.byPool
  const volByAddrWeek = volResult.byPoolWeek
  const statByAddr = Object.fromEntries(allPoolStats.map(s => [s.address.toLowerCase(), s]))

  const seenAddrs = new Set<string>()
  const uniquePools = [...POOLS, ...CL_POOLS, ...DLMM_POOLS].filter(p => {
    const address = p.address.toLowerCase()
    if (seenAddrs.has(address)) return false
    seenAddrs.add(address)
    return true
  })
  const liquidPools = uniquePools.filter(pool => hasMeaningfulPoolLiquidity(statByAddr[pool.address.toLowerCase()]?.tvlUsd ?? null))
  const nameCounts = liquidPools.reduce<Record<string, number>>((counts, pool) => {
    counts[pool.name] = (counts[pool.name] ?? 0) + 1
    return counts
  }, {})
  const chartName = (pool: typeof liquidPools[number]) => nameCounts[pool.name] > 1 ? `${pool.name} · ${pool.type}` : pool.name

  // Matches usePoolStats (30s) / usePrices (15s) / useVolume24h (60s) below --
  // these 6 reads used to fire once on mount and never again, so the top
  // summary panels (Epoch Status, AEON Token, VotingEscrow, Furnace) went
  // stale until a manual page reload while everything else on the page kept
  // refreshing live.
  const LIVE = { query: { refetchInterval: 60_000 } }
  const { data: aeonSupply }    = useReadContract({ address: CONTRACTS.AeonToken,        abi: ERC20_ABI,          functionName: 'totalSupply', ...LIVE })
  const { data: totalBurned }   = useReadContract({ address: CONTRACTS.TheFurnace,       abi: FURNACE_ABI,        functionName: 'totalBurned', ...LIVE })
  const { data: veTokenCount }  = useReadContract({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,  functionName: 'tokenId', ...LIVE })
  const { data: totalVotes }      = useReadContract({ address: CONTRACTS.AeonVoter,       abi: VOTER_ABI,            functionName: 'totalWeight', ...LIVE })
  const { data: lastFeesUSDRaw } = useReadContract({ address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'lastFeesUSD', ...LIVE })
  const { data: epochFeesRaw }    = useReadContract({ address: CONTRACTS.FeeDistributor,  abi: FEE_DISTRIBUTOR_ABI, functionName: 'lastEpochFeesUSD', ...LIVE })
  // Real tokens sitting in the pre-cutover FeeDistributor -- collected but
  // not yet claimable (that epoch closes independently of the voter/engine
  // cutover, pure wall-clock math). Every fee token that actually flowed
  // in, not just AEON -- pools pay fees in both of their underlying tokens,
  // so CASHCAT/ROBINFUN/VIRTUAL/WETH/USDG are all real balances here too.
  const LEGACY_TOKENS = [
    { symbol: 'AEON',     address: CONTRACTS.AeonToken, decimals: 18 },
    { symbol: 'WETH',     address: TOKENS.WETH.address, decimals: 18 },
    { symbol: 'USDG',     address: TOKENS.USDG.address, decimals: 6 },
    { symbol: 'VIRTUAL',  address: TOKENS.VIRTUAL.address, decimals: 18 },
    { symbol: 'ROBINFUN', address: TOKENS.ROBINFUN.address, decimals: 18 },
    { symbol: 'CASHCAT',  address: TOKENS.CASHCAT.address, decimals: 18 },
  ] as const
  const { data: legacyBalances } = useReadContracts({
    contracts: LEGACY_TOKENS.map(t => ({ address: t.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [LEGACY_FEE_DISTRIBUTOR] as const })),
    query: { refetchInterval: 60_000 },
  })
  const legacyPendingRaw = legacyBalances?.[0]?.status === 'success' ? legacyBalances[0].result as bigint : undefined

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

  // Fees this epoch — FeeDistributorV3.lastEpochFeesUSD only updates once per
  // epoch (on distribute()), so mid-epoch it's still reporting the PREVIOUS
  // epoch's already-finalized total, not what's actually accrued so far this
  // epoch. Real per-pool volume (byPoolWeek, a genuinely-measured trailing
  // 7-day window) at each pool's real fee tier, scaled to how far into the
  // current epoch we are, tracks live activity instead -- same fix pattern
  // as the APR calc above (real trailing average, not a stale/blended guess).
  const pricedTokens = useOraclePricedTokens()
  // Only vAMM pools' fees reach the FeeDistributor (their gauges call
  // collectFees->notifyFees). CL/DLMM swap fees accrue to LPs natively and are
  // NOT part of the voter/emission fee flow, so every FeeDistributor-derived
  // number below (voter 80% share AND the 25% emission budget) is vAMM-only.
  const vammFeePools = POOLS
  const realFeesThisEpoch = vammFeePools.reduce((sum, p) => {
    const volWeek = volByAddrWeek[p.address.toLowerCase()]
    if (volWeek === undefined || volWeek === null) return sum
    return sum + (volWeek / 7) * elapsedDays * parseFeeRate(p.fee)
  }, 0)
  // The emission mint is sized off ONLY oracle-priced-token fees — the protocol
  // counts unpriced (memecoin) fees as $0 toward lastEpochFeesUSD. Weight each
  // pool's fees by its priced fraction so the projected mint matches reality
  // instead of overstating it with fees the protocol values at zero.
  const pricedRealFeesThisEpoch = vammFeePools.reduce((sum, p) => {
    const volWeek = volByAddrWeek[p.address.toLowerCase()]
    if (volWeek === undefined || volWeek === null) return sum
    const raw = (volWeek / 7) * elapsedDays * parseFeeRate(p.fee)
    return sum + raw * pricedFeeFraction(p.token0, p.token1, pricedTokens)
  }, 0)
  const hasLiveVolumeData = Object.keys(volByAddrWeek).length > 0

  const feesThisEpoch = hasLiveVolumeData
    ? realFeesThisEpoch
    : epochFeesRaw
      ? parseFloat(formatUnits(epochFeesRaw as bigint, 18))
      : (volume24h !== null)
        ? volume24h * elapsedDays * blendedFeePct
        : null

  // Live next-epoch model. VoteDirectedLpEmissionsEngineRH (live since
  // 2026-07-13, confirmed via MinterProxy.logic()) mints AEON worth exactly
  // 25% of the epoch's finalized fees -- no rolling average, no growth cap.
  // Projecting the live in-epoch fee estimate (feesThisEpoch) instead of
  // only the last finalized snapshot is what keeps this forward-looking.
  const lastFeesUSD = lastFeesUSDRaw !== undefined ? Number(formatUnits(lastFeesUSDRaw as bigint, 18)) : null
  const liveEmissionProjection = aeonPrice !== null
    ? projectNextEmission({
        lastFeesUSD,
        // priced-only: matches what the engine actually mints on (unpriced fees
        // -> $0). Falls back to the on-chain finalized lastFeesUSD when there's
        // no live volume data (that number is already priced-only by design).
        liveEpochFeesUSD: hasLiveVolumeData ? pricedRealFeesThisEpoch : null,
        aeonPriceUSD: aeonPrice,
      })
    : null
  const projectedEmissionsAeon = liveEmissionProjection?.projectedMintAeon ?? null

  // Voter fee share — FeeDistributorV3 pays feeVoterSplit% (80%) of each
  // pool's RAW trading fees directly to voters who backed that pool, in the
  // pool's own fee token -- a completely separate stream from AEON
  // emissions above (which pay LP gauge stakers, not voters). Per-pool
  // basis is the SAME live weekly-volume estimate now powering the fee/APR
  // numbers elsewhere (byPoolWeek), not the on-chain snapshot -- that
  // snapshot only updates when the fee-collection keeper runs.
  const feesByPool = vammFeePools
    .map(p => {
      const volWeek = volByAddrWeek[p.address.toLowerCase()]
      const feesWeek = volWeek !== undefined ? volWeek * parseFeeRate(p.fee) : null
      return { pool: p, feesWeek }
    })
    .filter((x): x is { pool: typeof x.pool; feesWeek: number } => x.feesWeek !== null && x.feesWeek > 0)
    .sort((a, b) => b.feesWeek - a.feesWeek)
  const totalFeesWeekUsd = feesByPool.reduce((sum, x) => sum + x.feesWeek, 0)
  const voterShareThisEpoch = feesThisEpoch !== null ? feesThisEpoch * (EPOCH_CONFIG.feeVoterSplit / 100) : null
  const voterShareNextEpoch = totalFeesWeekUsd > 0 ? totalFeesWeekUsd * (EPOCH_CONFIG.feeVoterSplit / 100) : null

  // The other 20% of raw fees (feeBuybackSplit) routes to BuybackEngineV3,
  // which splits it 50/50: half swapped to AEON and permanently burned,
  // half swapped to AEON and redistributed directly to Furnace burners --
  // together with the 80% voter share above, these three numbers always
  // sum to exactly 100% of raw fees collected.
  const buybackTotalThisEpoch = feesThisEpoch !== null ? feesThisEpoch * (EPOCH_CONFIG.feeBuybackSplit / 100) : null
  const buybackTotalNextEpoch = totalFeesWeekUsd > 0 ? totalFeesWeekUsd * (EPOCH_CONFIG.feeBuybackSplit / 100) : null
  const buybackBurnThisEpoch = buybackTotalThisEpoch !== null ? buybackTotalThisEpoch * (EPOCH_CONFIG.buybackBurnSplit / 100) : null
  const buybackBurnNextEpoch = buybackTotalNextEpoch !== null ? buybackTotalNextEpoch * (EPOCH_CONFIG.buybackBurnSplit / 100) : null
  const furnaceRewardThisEpoch = buybackTotalThisEpoch !== null ? buybackTotalThisEpoch * (EPOCH_CONFIG.buybackRedistributeSplit / 100) : null
  const furnaceRewardNextEpoch = buybackTotalNextEpoch !== null ? buybackTotalNextEpoch * (EPOCH_CONFIG.buybackRedistributeSplit / 100) : null

  const burnedPct = aeonSupply && totalBurned && aeonSupply > 0n
    ? ((Number(totalBurned) / Number(aeonSupply)) * 100).toFixed(2)
    : '—'

  // No team allocation or treasury lockup to net out (verified at genesis) --
  // circulating = total supply minus everything permanently burned.
  const circulatingSupply = (aeonSupply !== undefined && totalBurned !== undefined)
    ? (aeonSupply as bigint) - (totalBurned as bigint)
    : undefined

  const lockRate = aeonSupply && totalVotes && aeonSupply > 0n
    ? ((Number(totalVotes) / Number(aeonSupply)) * 100).toFixed(1)
    : '—'

  const tvlChartData = liquidPools
    .map(p => ({ name: chartName(p), value: statByAddr[p.address.toLowerCase()]?.tvlUsd ?? 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const volChartData = liquidPools
    .map(p => ({ name: chartName(p), value: volByAddr[p.address.toLowerCase()] ?? 0 }))
    .filter(d => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)

  const chartData  = chartTab === 'tvl' ? tvlChartData : volChartData
  const chartEmpty = chartData.length === 0

  const epochProgressPct = (elapsedMs / WEEK_MS) * 100
  const emissionsActive  = !!totalVotes && totalVotes > 0n
  const chartAccentHex   = chartTab === 'tvl' ? ACCENT.aeon.barHex : ACCENT.violet.barHex

  return (
    <div className="relative isolate">
      <DashboardBackdrop />
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Dashboard</h1>
          <p className="text-text-secondary">Protocol stats, pool performance, and epoch data</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <KpiCard label="Total Value Locked" value={fmtUsd(totalTVL || null, true)} accent="emerald" icon={<TrendingUp size={16} className="text-emerald-400" />} delta={`${liquidPools.length} non-empty pools`} />
          <KpiCard label="Volume 24h"         value={fmtUsd(volume24h, true)}         accent="blue"    icon={<BarChart3  size={16} className="text-blue-400" />}    delta="from on-chain swap events" />
          <KpiCard label="AEON Supply"        value={`${fmt18(aeonSupply)} AEON`}     accent="aeon"    icon={<Coins      size={16} className="text-aeon-400" />}    delta="genesis: 90,000" />
          <KpiCard label="Circulating Supply" value={`${fmt18(circulatingSupply)} AEON`} accent="violet" icon={<Vote      size={16} className="text-violet-400" />}  delta="supply − burned" />
          <KpiCard label="AEON Burned"        value={`${fmt18(totalBurned)} AEON`}    accent="red"     icon={<Flame      size={16} className="text-red-400" />}     delta={`${burnedPct}% of supply`} />
        </div>

        <div className="mb-8 rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
            <div>
              <h2 className="font-display font-semibold text-red-300">Protocol voting disclosure</h2>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                The developer made a mistake and accidentally burned 50,000 AEON. The AEON is permanently burned and cannot be recovered.
              </p>
            </div>
          </div>
        </div>

        <div className="card p-6 mb-8 relative" style={{ boxShadow: `0 0 40px -20px ${chartTab === 'tvl' ? ACCENT.aeon.glow : ACCENT.violet.glow}` }}>
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
                    <Cell key={idx} fill={chartAccentHex} fillOpacity={0.85} style={{ filter: `drop-shadow(0 0 5px ${chartAccentHex}88)` }} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${emissionsActive ? ACCENT.emerald.glow : ACCENT.aeon.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Clock size={16} className="text-aeon-400" />
            <span className="font-display font-semibold text-text-primary">Epoch Status</span>
          </div>
          <div className="flex items-center gap-6">
            <RadialGauge percent={epochProgressPct} color={emissionsActive ? ACCENT.emerald.barHex : ACCENT.aeon.barHex}>
              <span className="font-display font-bold text-lg text-text-primary">#{protocolEpoch}</span>
              <span className={clsx('text-2xs font-mono mt-1', emissionsActive ? 'text-emerald-400' : 'text-aeon-400')}>{emissionsActive ? 'ACTIVE' : 'AWAITING VOTE'}</span>
            </RadialGauge>
            <div className="flex-1 space-y-3 min-w-0">
              {[
                { label: 'Current Epoch',       value: epochLabel },
                { label: 'Epoch Ends',          value: `${days}d ${hours}h remaining` },
                { label: 'Total Votes',         value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
                { label: 'Estimated gross fees this epoch', value: feesThisEpoch !== null ? fmtUsd(feesThisEpoch, true) : '$—' },
                { label: 'Live next-epoch emission estimate', value: projectedEmissionsAeon !== null ? `~${projectedEmissionsAeon.toLocaleString(undefined, { maximumFractionDigits: 3 })} AEON` : '— AEON' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center gap-3">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-mono text-text-primary text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Next Epoch — live projection from current fees/votes/price, refreshed
            every 60s (same LIVE cadence as the reads feeding it). Separate from
            Epoch Status on purpose: this epoch's real state stays untouched,
            this card is purely forward-looking, replicating
            VoteDirectedLpEmissionsEngineRH's exact formula (fees × 25% ÷ AEON
            price, no rolling average, no growth cap) against LIVE numbers that
            keep moving until the epoch actually flips. */}
        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.violet.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={16} className="text-violet-400" />
            <span className="font-display font-semibold text-text-primary">Next Epoch</span>
            <span className="ml-auto text-2xs font-mono text-text-muted uppercase tracking-wider">Live · updates every 60s</span>
          </div>
          <div className="flex items-center gap-6">
            <IconOrb accent="violet" size={88} icon={<Sparkles size={32} className="text-violet-400" />} />
            <div className="flex-1 space-y-3 min-w-0">
              {[
                { label: 'Fees so far this epoch',   value: feesThisEpoch !== null ? fmtUsd(feesThisEpoch, true) : '$—' },
                { label: 'Emission rate',             value: `${EPOCH_CONFIG.emissionPct}% of fees` },
                { label: 'Projected emission budget', value: liveEmissionProjection ? fmtUsd(liveEmissionProjection.emissionBudgetUSD, true) : '$—' },
                { label: 'AEON price used',           value: aeonPrice !== null ? fmtUsd(aeonPrice) : '$—' },
                { label: 'Total votes (current)',     value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
                { label: 'Projected AEON minted',      value: projectedEmissionsAeon !== null ? `~${projectedEmissionsAeon.toLocaleString(undefined, { maximumFractionDigits: 3 })} AEON` : '— AEON' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center gap-3">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-mono text-text-primary text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="text-2xs text-text-muted mt-4 pt-4 border-t border-bg-border">
            Projection only — the real mint locks in when the epoch actually flips, using that moment's finalized fees, live vote weight, and live AEON price. 100% goes to vote-directed LP gauges.
          </p>
        </div>

        {/* Fee Distribution — where 100% of raw trading fees go, split three
            ways by FeeDistributorV3 + BuybackEngineV3. A SEPARATE stream
            from AEON emissions above (which pay LP gauge stakers, not
            voters/burners). Per-pool voter split is by epoch-scoped vote
            weight -- see the Vote page for a personalized "if you vote
            here" estimate. */}
        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.emerald.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Vote size={16} className="text-emerald-400" />
            <span className="font-display font-semibold text-text-primary">Fee Distribution</span>
            <span className="ml-auto text-2xs font-mono text-text-muted uppercase tracking-wider">100% of raw fees</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl border border-bg-border bg-bg-raised/60 p-3">
              <div className="text-2xs text-text-muted uppercase font-mono">Voters ({EPOCH_CONFIG.feeVoterSplit}%)</div>
              <div className="text-lg text-emerald-400 font-mono mt-1">{voterShareThisEpoch !== null ? fmtUsd(voterShareThisEpoch, true) : '$—'}</div>
              <div className="text-2xs text-text-muted font-mono mt-0.5">next: {voterShareNextEpoch !== null ? fmtUsd(voterShareNextEpoch, true) : '$—'}</div>
            </div>
            <div className="rounded-xl border border-bg-border bg-bg-raised/60 p-3">
              <div className="text-2xs text-text-muted uppercase font-mono">Buyback burn ({EPOCH_CONFIG.feeBuybackSplit * EPOCH_CONFIG.buybackBurnSplit / 100}%)</div>
              <div className="text-lg text-red-400 font-mono mt-1">{buybackBurnThisEpoch !== null ? fmtUsd(buybackBurnThisEpoch, true) : '$—'}</div>
              <div className="text-2xs text-text-muted font-mono mt-0.5">next: {buybackBurnNextEpoch !== null ? fmtUsd(buybackBurnNextEpoch, true) : '$—'}</div>
            </div>
            <div className="rounded-xl border border-bg-border bg-bg-raised/60 p-3">
              <div className="text-2xs text-text-muted uppercase font-mono">Furnace reward ({EPOCH_CONFIG.feeBuybackSplit * EPOCH_CONFIG.buybackRedistributeSplit / 100}%)</div>
              <div className="text-lg text-aeon-400 font-mono mt-1">{furnaceRewardThisEpoch !== null ? fmtUsd(furnaceRewardThisEpoch, true) : '$—'}</div>
              <div className="text-2xs text-text-muted font-mono mt-0.5">next: {furnaceRewardNextEpoch !== null ? fmtUsd(furnaceRewardNextEpoch, true) : '$—'}</div>
            </div>
          </div>
          <div className="text-2xs text-text-muted font-mono uppercase tracking-wider mb-2">Voter share by pool</div>
          {feesByPool.length > 0 ? (
            <div className="space-y-1.5">
              {feesByPool.slice(0, 5).map(({ pool, feesWeek }) => (
                <div key={pool.address} className="flex justify-between items-center gap-3 text-sm">
                  <span className="text-text-muted">{pool.name}</span>
                  <span className="font-mono text-text-primary">{fmtUsd(feesWeek * (EPOCH_CONFIG.feeVoterSplit / 100), true)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-text-muted text-sm">No trailing-week fee data yet</div>
          )}
        </div>

        {/* Pre-Migration Rewards — every real fee token sitting in the
            pre-cutover FeeDistributor, collected but locked until that
            epoch closes (independent of the voter/engine cutover). Pools
            pay fees in BOTH underlying tokens, so this isn't AEON-only --
            direct on-chain balanceOf reads, not projected or estimated. */}
        {legacyPendingRaw !== undefined && legacyPendingRaw > 0n && (() => {
          const rows = LEGACY_TOKENS.map((t, i) => {
            const bal = legacyBalances?.[i]?.status === 'success' ? legacyBalances[i].result as bigint : 0n
            const amount = parseFloat(formatUnits(bal, t.decimals))
            const usd = prices[t.symbol as keyof typeof prices] ?? null
            return { symbol: t.symbol, amount, usdValue: usd !== null ? amount * usd : null }
          }).filter(r => r.amount > 0)
          const totalUsd = rows.every(r => r.usdValue !== null) ? rows.reduce((s, r) => s + (r.usdValue ?? 0), 0) : null

          return (
            <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.aeon.glow}` }}>
              <div className="flex items-center gap-2 mb-4">
                <Lock size={16} className="text-aeon-400" />
                <span className="font-display font-semibold text-text-primary">Pre-Migration Rewards</span>
                <span className="ml-auto text-2xs font-mono text-text-muted uppercase tracking-wider">Real, on-chain balances</span>
              </div>
              <div className="flex items-center gap-6 mb-4">
                <IconOrb accent="aeon" size={88} icon={<Lock size={32} className="text-aeon-400" />} />
                <div className="flex-1 space-y-1">
                  <div className="text-2xl font-mono font-bold text-aeon-400">{totalUsd !== null ? fmtUsd(totalUsd, true) : `${rows.length} tokens`}</div>
                  <p className="text-2xs text-text-muted leading-relaxed">
                    Collected before the AeonVoterV3 cutover, sitting in the old FeeDistributor — every fee token
                    that actually came in, not just AEON. Locked until that epoch closes, then claimable on the
                    Vote page for whoever voted before the switch.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {rows.map(r => (
                  <div key={r.symbol} className="rounded-xl border border-bg-border bg-bg-raised/60 p-2.5">
                    <div className="text-2xs text-text-muted uppercase font-mono">{r.symbol}</div>
                    <div className="text-sm font-mono text-text-primary mt-0.5">{r.amount.toLocaleString(undefined, { maximumFractionDigits: r.amount < 1 ? 6 : 2 })}</div>
                    {r.usdValue !== null && <div className="text-2xs text-text-muted font-mono">{fmtUsd(r.usdValue)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.aeon.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-4 h-4 rounded bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
            <span className="font-display font-semibold text-text-primary">AEON Token</span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex-1 space-y-3 min-w-0">
              {[
                { label: 'Price',        value: prices.AEON ? fmtUsd(prices.AEON) : '$—' },
                { label: 'Circulating Market Cap', value: (prices.AEON && circulatingSupply !== undefined) ? fmtUsd(prices.AEON * parseFloat(formatUnits(circulatingSupply, 18)), true) : '$—' },
                { label: 'Fully Diluted Value', value: (prices.AEON && aeonSupply) ? fmtUsd(prices.AEON * parseFloat(formatUnits(aeonSupply, 18)), true) : '$—' },
                { label: 'Total Supply', value: aeonSupply !== undefined ? `${fmt18(aeonSupply)} AEON` : '—' },
                { label: 'Total Burned', value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
                { label: '% Burned',     value: `${burnedPct}%` },
                { label: 'Total Voting Power', value: totalVotes !== undefined ? `${fmt18(totalVotes)} veAEON` : '—' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center gap-3">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-mono text-text-primary text-right">{item.value}</span>
                </div>
              ))}
            </div>
            <HexBadge size={104} />
          </div>
        </div>

        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.violet.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-violet-400" />
            <span className="font-display font-semibold text-text-primary">VotingEscrow</span>
          </div>
          <div className="flex items-center gap-6">
            <IconOrb accent="violet" size={88} icon={<Lock size={32} className="text-violet-400" />} />
            <div className="flex-1 space-y-3 min-w-0">
              {[
                { label: 'veNFTs Minted', value: veTokenCount !== undefined ? veTokenCount.toString() : '—' },
                { label: 'Total Votes',   value: totalVotes !== undefined ? `${fmt18(totalVotes)}` : '—' },
                { label: 'Voting Power Rate', value: lockRate !== '—' ? `${lockRate}% of supply` : '—' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center gap-3">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-mono text-text-primary text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-6" style={{ boxShadow: `0 0 40px -22px ${ACCENT.red.glow}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Flame size={16} className="text-red-400" />
            <span className="font-display font-semibold text-text-primary">The Furnace</span>
          </div>
          <div className="flex items-center gap-6">
            <IconOrb accent="red" size={88} icon={<Flame size={32} className="text-red-400" />} />
            <div className="flex-1 space-y-3 min-w-0">
              {[
                { label: 'Total Burned',       value: totalBurned !== undefined ? `${fmt18(totalBurned)} AEON` : '—' },
                { label: '% of Supply Burned', value: `${burnedPct}%` },
                { label: 'Protocol Reward Route', value: 'LP treasury' },
              ].map(item => (
                <div key={item.label} className="flex justify-between items-center gap-3">
                  <span className="text-sm text-text-muted">{item.label}</span>
                  <span className="text-sm font-mono text-text-primary text-right">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-bg-border flex items-center justify-between">
          <h2 className="font-display font-semibold text-text-primary">All Pools</h2>
          <span className="text-xs font-mono text-text-muted">{liquidPools.length} non-empty pools</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bg-border">
                {['Pool', 'Type', 'Fee', 'TVL', 'Volume 24h', 'Trailing 7d gross fee APR', 'Votes'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-2xs font-mono text-text-muted uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {liquidPools.map(pool => {
                const stat    = statByAddr[pool.address.toLowerCase()]
                const vol     = volByAddr[pool.address.toLowerCase()] ?? null
                const volWeek = volByAddrWeek[pool.address.toLowerCase()] ?? null
                const tvl     = stat?.tvlUsd ?? null
                const feePct  = parseFeeRate(pool.fee)
                // Trailing-week average, not literal 24h -- see useVolume24h's
                // byPoolWeek comment for why. Fees-first (feesWeek, then
                // annualized) so this always matches the real Fees This
                // Epoch number above -- not a separately-derived estimate.
                const feesWeek = volWeek !== null ? volWeek * feePct : null
                const feeApr  = (feesWeek !== null && tvl && tvl > 0)
                  ? ((feesWeek * (365 / 7)) / tvl * 100).toFixed(1) + '%'
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
                    <td className="px-4 py-3"><span className={pool.type === 'vAMM' ? 'pool-type-vamm' : pool.type === 'CL' ? 'pool-type-cl' : 'pool-type-dlmm'}>{pool.type}</span></td>
                    <td className="px-4 py-3 text-xs font-mono text-text-muted">{pool.fee}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">{fmtUsd(tvl)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-text-secondary">{fmtUsd(vol)}</td>
                    <td className="px-4 py-3 text-sm font-mono text-emerald-400">{feeApr}</td>
                    <td className="px-4 py-3 text-xs font-mono text-text-muted">{stat && 'votesFormatted' in stat ? `${stat.votesFormatted} veAEON` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  )
}
