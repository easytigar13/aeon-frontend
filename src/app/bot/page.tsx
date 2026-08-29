'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Activity, Copy, Check, TrendingUp, AlertTriangle, Wallet, ArrowRight, Layers, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { GlowPanel, MetricCard, ProtocolBackdrop, type ProtocolAccent } from '@/components/ProtocolVisuals'
import { BOTS, getBotBySlug } from '@/config/bots'

interface Opportunity {
  pair: string
  profitPct: number
  amountIn: string
  tokenIn: string
  grossProfit?: string
  grossProfitToken?: string
  grossProfitUsd?: number
  expectedNetUsd?: number
  gasCostUsd?: number
  venues?: string
  routeScore?: number
  reliabilityPct?: number
  validation?: 'discovery' | 'exact-valid' | 'preflight-rejected' | 'cooldown'
  rejectionReason?: string
}

interface ExecutedArb {
  time: string
  pair: string
  tokenIn: string
  amountIn: string
  profit: string
  profitToken?: string
  profitPct: number
  grossProfit?: string
  gasCost?: string
  gasCostEth?: string
  txHash?: string
  status: 'success' | 'failed' | 'rejected' | 'dry-run'
  error?: string
  route?: 'internal' | 'openocean' | '1inch'
  venues?: string
  quotedProfit?: string
  realizedProfitUsd?: number
  quoteVariancePct?: number
}

function isClosedTrade(pair: string) {
  const tokens = pair.split('→')
  return tokens.length > 1 && tokens[0] === tokens[tokens.length - 1]
}

interface MonitoredPool {
  name: string
  address: string
  poolId?: string | null
  kind: string
  token0: string
  token1: string
  feeBps: number
  live: boolean
  reserves: Record<string, string> | null
}

interface PoolActivityEntry {
  name: string
  address: string
  kind: string
  token0: string
  token1: string
  lastActivityAt: string | null
  inactiveHours: number
  flagged: boolean
  state: 'active' | 'inactive' | 'unknown'
  error?: string
}

interface PoolActivityReport {
  checkedAt: string | null
  nextCheckAt: string | null
  inactiveAfterHours: number
  checkIntervalHours: number
  auditRunning: boolean
  pools: PoolActivityEntry[]
  flagged: PoolActivityEntry[]
  unknown: PoolActivityEntry[]
}

interface BotStatus {
  online?: false
  reason?: string
  updatedAt?: string
  keeperAddress?: string
  dryRun?: boolean
  intervalMs?: number
  tickMs?: number
  scanTelemetry?: {
    mode: string
    stateReadMs: number
    balanceReadMs: number
    localSearchMs: number
    exactQuoteMs: number
    approximateCandidates: number
    exactSelected: number
    exactChecked: number
    exactValid: number
    lastBlock: string | null
  }
  poolsMonitored?: number
  poolsLiveThisTick?: number
  venueBreakdown?: Record<string, { total: number; live: number }>
  monitoredPools?: MonitoredPool[]
  balances?: Record<string, string>
  lastOpportunities?: Opportunity[]
  recentArbs?: ExecutedArb[]
  cumulativeProfit?: Record<string, string>
  totalArbsExecuted?: number
  totalArbsFailed?: number
  recentErrors?: { time: string; message: string }[]
  consecutiveFailures?: number
  pausedUntil?: string | null
  gasReserve?: { requiredEth: string; availableEth: string; healthy: boolean }
  pendingTransaction?: { hash: string; label: string; nonce: number; submittedAt: string; replacements: number } | null
  outcomeCounters?: Record<'detected' | 'executed' | 'belowGas' | 'insufficientBalance' | 'simulationFailed' | 'preflightRejected' | 'staleQuote' | 'reverted', number>
  poolActivity?: PoolActivityReport
}

type ProfitRange = 'today' | 'sevenDays' | 'month' | 'all'

// Status now reaches the site via the GitHub bot-status branch (published every
// ~60s) plus GitHub's raw CDN, so end-to-end latency is a couple of minutes even
// when the bot is perfectly healthy. Allow for that before calling it offline; a
// truly dead bot/publisher still ages out within this window.
const STALE_AFTER_MS = 300_000

export default function BotPage() {
  return (
    <Suspense fallback={null}>
      <BotPageInner />
    </Suspense>
  )
}

function BotPageInner() {
  const searchParams = useSearchParams()
  const [selectedBot, setSelectedBot] = useState(() => getBotBySlug(searchParams.get('bot')))
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [profitRange, setProfitRange] = useState<ProfitRange>('today')
  const [profitSummaries, setProfitSummaries] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    let cancelled = false
    setStatus(null)   // clear stale data from the previous bot immediately on switch
    async function poll() {
      try {
        const res = await fetch(`/api/bot/status?bot=${selectedBot.slug}`, { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) setStatus(data)
      } catch { /* keep showing last known status */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [selectedBot])

  useEffect(() => {
    let cancelled = false
    setProfitSummaries({})
    async function pollProfit() {
      try {
        const res = await fetch(`/api/bot/trades?bot=${selectedBot.slug}&summary=1`, { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) setProfitSummaries(data.summaries ?? {})
      } catch { /* retain the last successful summary */ }
    }
    pollProfit()
    const id = setInterval(pollProfit, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [selectedBot])

  const hasFile = status && status.updatedAt
  const isOnline = hasFile && (Date.now() - new Date(status.updatedAt!).getTime()) < STALE_AFTER_MS
  const executionReady = isOnline && status?.gasReserve?.healthy !== false && !status?.pausedUntil
  const displayedProfit = profitRange === 'all'
    ? (status?.cumulativeProfit ?? {})
    : (profitSummaries[profitRange] ?? {})
  const visibleBalances = status?.balances
    ? Object.entries(status.balances).filter(([, balance]) => parseFloat(balance) > 0.0001)
    : []

  function copyAddr() {
    if (!status?.keeperAddress) return
    navigator.clipboard.writeText(status.keeperAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative isolate min-h-screen">
      <ProtocolBackdrop />
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-2xs font-mono uppercase tracking-[0.2em] text-emerald-400 mb-3">
              <Zap size={12} /> Autonomous execution layer
            </div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-text-primary mb-2">Arb <span className="text-aeon-400">Keeper</span></h1>
            <p className="text-text-secondary max-w-3xl">
              Scans AEON&apos;s own pools alongside external venues for cycles that start and end in the
              same token, then executes them in a single atomic transaction through the on-chain
              AeonArbKeeper contract. Every cycle must clear its buffered gas cost plus a 0.05% margin
              on the input — that floor is passed on-chain as <span className="font-mono text-text-primary">minProfit</span>,
              so the contract reverts rather than settle for less.
            </p>
          </div>
          <div className={clsx(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-xs font-bold tracking-wider uppercase',
            executionReady ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : isOnline ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          )}>
            <span className={clsx('w-2 h-2 rounded-full', executionReady ? 'bg-emerald-400 animate-pulse-slow' : isOnline ? 'bg-yellow-400 animate-pulse-slow' : 'bg-red-400')} />
            {!isOnline ? 'Offline' : status?.dryRun ? 'Online · Dry Run' : !status?.gasReserve?.healthy ? 'Online · Refilling Gas' : status?.pausedUntil ? 'Online · Safety Pause' : 'Online · Live'}
          </div>
        </div>

        {/* Bot selector */}
        <div className="flex gap-2 mb-8">
          {BOTS.map(bot => (
            <button
              key={bot.slug}
              onClick={() => setSelectedBot(bot)}
              className={clsx(
                'px-4 py-2.5 rounded-xl border text-left transition-all',
                selectedBot.slug === bot.slug
                  ? 'bg-aeon-400/10 border-aeon-400/40 shadow-[0_0_20px_-8px_rgba(255,184,0,0.5)]'
                  : 'bg-bg-raised border-bg-border hover:border-bg-border/80 text-text-muted'
              )}
            >
              <div className={clsx('font-display font-semibold text-sm', selectedBot.slug === bot.slug ? 'text-aeon-400' : 'text-text-primary')}>{bot.name}</div>
              <div className="text-2xs font-mono text-text-muted">{bot.subtitle}</div>
            </button>
          ))}
        </div>

        {!hasFile && (
          <div className="card p-6 mb-8 flex items-start gap-3">
            <AlertTriangle size={20} className="text-aeon-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-text-primary font-medium mb-1">Bot hasn't reported in yet</div>
              <div className="text-text-secondary text-sm">
                {status?.reason ?? 'Waiting for the first status update...'}
              </div>
            </div>
          </div>
        )}

        {hasFile && (
          <>
            {/* Wallet + fund box */}
            <GlowPanel accent="blue" className="p-6 mb-6">
              <div className="flex items-center gap-2 mb-3 text-text-secondary text-sm font-mono uppercase tracking-wider">
                <Wallet size={14} /> Keeper Wallet
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <code className="text-text-primary font-mono text-sm bg-bg-raised px-3 py-2 rounded-lg border border-bg-border break-all">
                  {status.keeperAddress}
                </code>
                <button onClick={copyAddr} className="btn-ghost flex items-center gap-1.5 text-sm">
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-text-muted text-xs mt-3">
                Send AEON, USDG, WETH, or any other token this bot trades to this address to fund it.
                This wallet's private key is held only by the operator — the website has no access to it
                and cannot move these funds.
              </p>
            </GlowPanel>

            {/* Live Diagnostics & Reason Banner */}
            {isOnline && (
              <GlowPanel accent="aeon" className="p-6 mb-6">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="flex items-center gap-2 text-text-primary font-mono text-sm font-semibold uppercase tracking-wider">
                    <Activity size={16} className="text-aeon-400 animate-pulse" /> Live Scanner Diagnostics
                  </div>
                  <div className="text-xs font-mono text-text-muted">
                    Updated {Math.round((Date.now() - new Date(status.updatedAt!).getTime()) / 1000)}s ago
                    {status.tickMs ? ` · Tick time ${status.tickMs}ms` : ''}
                  </div>
                </div>

                {status.lastOpportunities && status.lastOpportunities.length > 0 ? (
                  (() => {
                    const topOpp = status.lastOpportunities[0]
                    const isNetLoss = topOpp.expectedNetUsd != null && topOpp.expectedNetUsd < 0
                    return (
                      <div className="rounded-xl bg-bg-base/80 border border-bg-border p-4 text-sm">
                        <div className="flex items-start gap-3">
                          {isNetLoss ? (
                            <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                          ) : (
                            <Zap size={18} className="text-emerald-400 shrink-0 mt-0.5" />
                          )}
                          <div>
                            <div className="font-semibold text-text-primary mb-1">
                              {isNetLoss ? 'Opportunities Detected — Filtered by Gas Floor' : 'Profitable Trade Executable'}
                            </div>
                            <p className="text-text-secondary text-xs leading-relaxed">
                              Top route <code className="font-mono text-aeon-400">{topOpp.pair}</code> shows gross yield of{' '}
                              <span className="font-mono text-emerald-400">+{topOpp.profitPct}%</span>
                              {topOpp.grossProfitUsd != null && <> ($\sim${topOpp.grossProfitUsd.toFixed(4)})</>}.
                              {isNetLoss && topOpp.gasCostUsd != null && (
                                <>
                                  {' '}Estimated gas cost ($\sim${topOpp.gasCostUsd.toFixed(4)}) exceeds gross gain.
                                  Net yield is <span className="font-mono text-red-400 font-bold">-${Math.abs(topOpp.expectedNetUsd!).toFixed(4)}</span>.
                                  The bot automatically filters out net-negative trades to preserve wallet funds.
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <div className="text-xs text-text-muted font-mono">
                    Scanning active block-by-block. No candidate opportunities clearing gas cost right now.
                  </div>
                )}
              </GlowPanel>
            )}

            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <StatCard
                label="Pools Live / Total"
                value={status.poolsMonitored != null
                  ? `${status.poolsLiveThisTick ?? status.monitoredPools?.filter(pool => pool.live).length ?? '—'} / ${status.poolsMonitored}`
                  : '—'}
              />
              <StatCard label="Arbs Executed" value={String(status.totalArbsExecuted ?? 0)} />
              <StatCard label="Arbs Failed" value={String(status.totalArbsFailed ?? 0)} />
              <StatCard label="Poll Gap" value={status.intervalMs ? `${status.intervalMs}ms` : '—'} />
            </div>

            {status.scanTelemetry && (
              <GlowPanel accent="blue" className="p-6 mb-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4">Scanner Hot Path</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  {[
                    ['Block', status.scanTelemetry.lastBlock ?? '—'],
                    ['Mode', status.scanTelemetry.mode],
                    ['Pool reads', `${status.scanTelemetry.stateReadMs}ms`],
                    ['Balances', `${status.scanTelemetry.balanceReadMs}ms`],
                    ['Local search', `${status.scanTelemetry.localSearchMs}ms`],
                    ['Exact checks', `${status.scanTelemetry.exactChecked}/${status.scanTelemetry.exactSelected}`],
                    ['Exact quoting', `${status.scanTelemetry.exactQuoteMs}ms`],
                    ['Executable', String(status.scanTelemetry.exactValid)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl border border-bg-border bg-bg-raised/60 p-3">
                      <div className="text-2xs text-text-muted uppercase font-mono">{label}</div>
                      <div className="text-sm text-text-primary font-mono mt-1 break-all">{value}</div>
                    </div>
                  ))}
                </div>
              </GlowPanel>
            )}

            {status.pausedUntil && new Date(status.pausedUntil).getTime() > Date.now() && (
              <div className="card p-4 mb-6 border-red-500/30 text-red-400 text-sm">
                Execution paused until {new Date(status.pausedUntil).toLocaleTimeString()} after {status.consecutiveFailures ?? 0} consecutive failures.
              </div>
            )}

            {status.gasReserve && !status.gasReserve.healthy && (
              <div className="card p-4 mb-6 border-red-500/30 text-red-400 text-sm">
                Execution is safely paused: gas wallet has {parseFloat(status.gasReserve.availableEth).toFixed(6)} ETH, below the dynamic {parseFloat(status.gasReserve.requiredEth).toFixed(6)} ETH reserve.
              </div>
            )}

            {status.pendingTransaction && (
              <div className="card p-4 mb-6 border-aeon-400/30 text-aeon-400 text-sm font-mono">
                Pending nonce {status.pendingTransaction.nonce}: {status.pendingTransaction.label} · {status.pendingTransaction.replacements} replacement(s)
              </div>
            )}

            {status.poolActivity && (
              <GlowPanel accent={status.poolActivity.flagged.length > 0 ? 'red' : 'emerald'} className="p-6 mb-6">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div className="flex items-center gap-2 text-text-primary font-mono text-sm font-semibold uppercase tracking-wider">
                    <AlertTriangle size={16} className={status.poolActivity.flagged.length > 0 ? 'text-amber-400' : 'text-emerald-400'} />
                    Pool Activity Review
                  </div>
                  <div className="text-xs font-mono text-text-muted">
                    {status.poolActivity.auditRunning
                      ? 'On-chain check running now'
                      : status.poolActivity.checkedAt
                        ? `Checked ${new Date(status.poolActivity.checkedAt).toLocaleString()}`
                        : 'Waiting for first check'}
                  </div>
                </div>
                <p className="text-xs text-text-secondary mb-4">
                  Checked every {status.poolActivity.checkIntervalHours} hours. Pools with no on-chain event for {status.poolActivity.inactiveAfterHours} hours are flagged for manual review; Keeper2 never removes them automatically.
                </p>
                {status.poolActivity.flagged.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {status.poolActivity.flagged.map(pool => (
                      <div key={`${pool.kind}-${pool.address}`} className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-text-primary">{pool.token0}/{pool.token1}</span>
                            <span className="px-1.5 py-0.5 rounded text-2xs font-mono uppercase text-violet-400 bg-violet-500/10 border border-violet-500/20">{pool.kind}</span>
                          </div>
                          <div className="font-mono text-2xs text-text-muted break-all mt-1">{pool.address}</div>
                        </div>
                        <div className="text-amber-400 font-mono text-xs sm:text-right">
                          No activity in {Math.floor(pool.inactiveHours)}+ hours
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-emerald-400">
                    {status.poolActivity.checkedAt ? 'No inactive pools are currently flagged.' : 'The first activity review will appear here when complete.'}
                  </div>
                )}
                {status.poolActivity.unknown.length > 0 && (
                  <div className="mt-3 text-xs text-amber-400">
                    {status.poolActivity.unknown.length} pool(s) could not be checked because the RPC did not return a complete result. They were not marked inactive.
                  </div>
                )}
              </GlowPanel>
            )}

            {status.outcomeCounters && (
              <GlowPanel accent="blue" className="p-6 mb-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4">Execution Funnel</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                  {([
                    ['Candidates/tick', 'detected'], ['Executed', 'executed'], ['Below gas', 'belowGas'],
                    ['No balance', 'insufficientBalance'], ['Simulation', 'simulationFailed'],
                    ['Preflight rejected', 'preflightRejected'], ['Stale quote', 'staleQuote'], ['Reverted', 'reverted'],
                  ] as const).map(([label, key]) => (
                    <div key={key} className="rounded-xl border border-bg-border bg-bg-raised/60 p-3">
                      <div className="text-2xs text-text-muted uppercase font-mono">{label}</div>
                      <div className="text-lg text-text-primary font-mono mt-1">{status.outcomeCounters?.[key] ?? 0}</div>
                    </div>
                  ))}
                </div>
              </GlowPanel>
            )}

            {/* Balances + cumulative profit */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <GlowPanel accent="blue" className="p-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4">Wallet Balances</div>
                <div className="space-y-2">
                  {visibleBalances.length > 0 ? visibleBalances.map(([sym, bal]) => {
                    const num = parseFloat(bal)
                    // A tiny dust balance (e.g. 0.00003) rounds to "0" at 4
                    // decimals, making it look identical to a token never
                    // held at all -- show more precision below 0.001 so a
                    // real (if small) balance is never hidden.
                    const display = num > 0 && num < 0.001
                      ? num.toLocaleString(undefined, { maximumFractionDigits: 10 })
                      : num.toLocaleString(undefined, { maximumFractionDigits: 4 })
                    return (
                      <div key={sym} className="flex justify-between text-sm">
                        <span className="text-text-secondary">{sym}</span>
                        <span className="text-text-primary font-mono">{display}</span>
                      </div>
                    )
                  }) : <div className="text-text-muted text-sm">No balances yet</div>}
                </div>
              </GlowPanel>
              <GlowPanel accent="emerald" className="p-6">
                <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                  <div className="text-text-secondary text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp size={14} /> Profit
                  </div>
                  <div className="flex rounded-lg bg-bg-base p-0.5 border border-bg-border">
                    {([
                      ['today', 'Today'], ['sevenDays', '7 Days'], ['month', 'Month'], ['all', 'All Time'],
                    ] as [ProfitRange, string][]).map(([range, label]) => (
                      <button key={range} onClick={() => setProfitRange(range)} className={clsx(
                        'px-2 py-1 rounded-md text-2xs font-mono transition-colors',
                        profitRange === range ? 'bg-emerald-400/15 text-emerald-400' : 'text-text-muted hover:text-text-secondary',
                      )}>{label}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {Object.entries(displayedProfit).length > 0 ? Object.entries(displayedProfit).map(([sym, amt]) => (
                    <div key={sym} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{sym}</span>
                      <span className="text-emerald-400 font-mono">+{parseFloat(amt).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                    </div>
                  )) : <div className="text-text-muted text-sm">No successful profit in this period</div>}
                </div>
              </GlowPanel>
            </div>

            {/* Current opportunities */}
            <GlowPanel accent="aeon" className="p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                  <Activity size={14} /> Current Opportunities
                </div>
                <Link href={`/bot/opportunities?bot=${selectedBot.slug}`} className="inline-flex items-center gap-1 text-aeon-400 hover:text-aeon-300 text-xs font-medium">
                  View all opportunities <ArrowRight size={12} />
                </Link>
              </div>
              {status.lastOpportunities && status.lastOpportunities.length > 0 ? (
                <div className="space-y-2">
                  {status.lastOpportunities.slice(0, 5).map((o, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm py-2 border-b border-bg-border last:border-0">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-text-primary">{o.pair}</span>
                          {o.validation && (
                            <span className={clsx(
                              'px-1.5 py-0.5 rounded text-2xs font-mono uppercase border',
                              o.validation === 'exact-valid'
                                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                                : o.validation === 'preflight-rejected'
                                  ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                                  : 'text-violet-400 bg-violet-500/10 border-violet-500/20',
                            )}>{o.validation}</span>
                          )}
                        </div>
                        {o.rejectionReason && <div className="text-2xs text-amber-400/80 font-mono mt-1 max-w-xl">{o.rejectionReason}</div>}
                      </div>
                      {o.venues && <span className="text-violet-400 font-mono text-xs">{o.venues}{o.reliabilityPct != null ? ` · ${o.reliabilityPct.toFixed(0)}% reliable` : ''}</span>}
                      <span className="text-text-secondary">{o.amountIn} {o.tokenIn}</span>
                      <span className={clsx('font-mono', o.expectedNetUsd != null && o.expectedNetUsd < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        net est. {o.expectedNetUsd != null ? `${o.expectedNetUsd < 0 ? '-' : ''}$${Math.abs(o.expectedNetUsd).toFixed(4)}` : '—'} (gross {o.grossProfit ?? '—'} {o.grossProfitToken ?? o.tokenIn}
                        {o.gasCostUsd != null && <>, gas <span className="text-text-muted">${o.gasCostUsd.toFixed(4)}</span></>})
                      </span>
                      <span className="text-aeon-400 font-mono">{o.profitPct.toFixed(3)}%</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No candidate routes were seen in the latest completed scan.</div>}
            </GlowPanel>

            {/* Recent arbs */}
            <GlowPanel accent="violet" className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider">Recent Activity</div>
                <Link href={`/bot/trades?bot=${selectedBot.slug}`} className="inline-flex items-center gap-1 text-aeon-400 hover:text-aeon-300 text-xs font-medium">
                  View all trades <ArrowRight size={12} />
                </Link>
              </div>
              {status.recentArbs && status.recentArbs.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {status.recentArbs.map((a, i) => (
                    <div key={i} className="flex justify-between items-center text-sm py-2 border-b border-bg-border last:border-0 flex-wrap gap-1">
                      <div className="flex items-center gap-2">
                        <span className={clsx(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          a.status === 'success' ? 'bg-emerald-400' : a.status === 'dry-run' ? 'bg-aeon-400' : a.status === 'rejected' ? 'bg-amber-400' : 'bg-red-400'
                        )} />
                        <span className="font-mono text-text-primary">{a.pair}</span>
                        {a.venues && (
                          <span className="text-violet-400 font-mono text-xs">{a.venues}</span>
                        )}
                        {a.route && a.route !== 'internal' && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-mono uppercase text-violet-400 bg-violet-500/10 border border-violet-500/20">
                            {a.route}
                          </span>
                        )}
                      </div>
                      <span className="text-text-muted text-xs">{new Date(a.time).toLocaleTimeString()}</span>
                      <span className={a.status === 'success' ? 'text-emerald-400 font-mono' : 'text-text-muted font-mono'}>
                        {a.status === 'success'
                          ? isClosedTrade(a.pair)
                            ? `net +${parseFloat(a.profit).toFixed(6)} ${a.profitToken ?? a.tokenIn}${a.realizedProfitUsd != null ? ` ($${a.realizedProfitUsd.toFixed(4)})` : ''}${a.gasCost ? ` · gas ${parseFloat(a.gasCost).toFixed(6)} ${a.profitToken ?? a.tokenIn}` : ''}${a.quoteVariancePct != null ? ` · quote ${a.quoteVariancePct >= 0 ? '+' : ''}${a.quoteVariancePct.toFixed(2)}%` : ''}`
                            : `legacy cross-settlement · P&L unverified${a.gasCostEth ? ` · gas ${parseFloat(a.gasCostEth).toFixed(6)} ETH` : ''}`
                          : a.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No activity yet.</div>}
            </GlowPanel>

            {/* Full transparency: every pool the bot monitors, with the live
                reserves it actually priced this tick. */}
            {status.monitoredPools && status.monitoredPools.length > 0 && (
              <GlowPanel accent="blue" className="p-6 mt-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-text-secondary text-sm font-mono uppercase tracking-wider flex items-center gap-2">
                    <Layers size={14} /> What the bot sees — Monitored Pools
                  </div>
                  <span className="text-xs font-mono text-text-muted">
                    <span className="text-emerald-400">{status.poolsLiveThisTick ?? status.monitoredPools.filter(p => p.live).length}</span> live / {status.monitoredPools.length} total
                  </span>
                </div>
                {status.venueBreakdown && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {Object.entries(status.venueBreakdown).map(([venue, v]) => (
                      <span key={venue} className="px-2 py-0.5 rounded text-2xs font-mono text-violet-400 bg-violet-500/10 border border-violet-500/20">
                        {venue}: <span className="text-emerald-400">{v.live}</span>/{v.total}
                      </span>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5 max-h-[28rem] overflow-y-auto">
                  {[...status.monitoredPools]
                    .sort((a, b) => Number(b.live) - Number(a.live) || a.kind.localeCompare(b.kind))
                    .map((p) => (
                    <div key={`${p.kind}:${p.poolId ?? p.address}:${p.name}`} className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 items-center text-sm py-1.5 border-b border-bg-border last:border-0">
                      <div className="flex items-center gap-2">
                        <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', p.live ? 'bg-emerald-400' : 'bg-text-muted/40')} title={p.live ? 'priced live this tick' : 'not reachable this tick'} />
                        <span className="px-1.5 py-0.5 rounded text-2xs font-mono uppercase text-violet-400 bg-violet-500/10 border border-violet-500/20 shrink-0">{p.kind}</span>
                        <span className="font-mono text-text-primary">{p.name}</span>
                      </div>
                      <span className="font-mono text-xs text-text-muted truncate">
                        {p.reserves
                          ? Object.entries(p.reserves).map(([sym, amt]) => `${parseFloat(amt).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${sym}`).join('  ·  ')
                          : <span className="italic">no live reserves this tick</span>}
                      </span>
                      <span className="text-2xs font-mono text-text-muted text-right">{(p.feeBps / 100).toFixed(2)}% fee</span>
                    </div>
                  ))}
                </div>
              </GlowPanel>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  const visuals: Record<string, { detail: string; icon: React.ReactNode; accent: ProtocolAccent }> = {
    'Pools Live / Total': { detail: 'current route graph', icon: <Layers size={16} />, accent: 'blue' },
    'Arbs Executed': { detail: 'confirmed cycles', icon: <CheckCircle size={16} />, accent: 'emerald' },
    'Arbs Failed': { detail: 'confirmed reverts', icon: <XCircle size={16} />, accent: 'red' },
    'Poll Gap': { detail: 'delay after completed scan', icon: <Clock size={16} />, accent: 'violet' },
  }
  const v = visuals[label] ?? { detail: 'live metric', icon: <Activity size={16} />, accent: 'aeon' as const }
  return <MetricCard label={label} value={value} detail={v.detail} icon={v.icon} accent={v.accent} />
}
