'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, Copy, Check, TrendingUp, AlertTriangle, Wallet, ArrowRight, Layers, CheckCircle, XCircle, Clock, Zap } from 'lucide-react'
import { clsx } from 'clsx'
import { GlowPanel, MetricCard, ProtocolBackdrop, type ProtocolAccent } from '@/components/ProtocolVisuals'
import { BOTS, DEFAULT_BOT } from '@/config/bots'

interface Opportunity {
  pair: string
  profitPct: number
  amountIn: string
  tokenIn: string
  grossProfit?: string
  grossProfitUsd?: number
  expectedNetUsd?: number
  gasCostUsd?: number
  venues?: string
  routeScore?: number
  reliabilityPct?: number
}

interface ExecutedArb {
  time: string
  pair: string
  tokenIn: string
  amountIn: string
  profit: string
  profitPct: number
  grossProfit?: string
  gasCost?: string
  gasCostEth?: string
  txHash?: string
  status: 'success' | 'failed' | 'dry-run'
  error?: string
  route?: 'internal' | 'openocean' | '1inch'
  venues?: string
  quotedProfit?: string
  realizedProfitUsd?: number
  quoteVariancePct?: number
}

interface BotStatus {
  online?: false
  reason?: string
  updatedAt?: string
  keeperAddress?: string
  dryRun?: boolean
  intervalMs?: number
  poolsMonitored?: number
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
  outcomeCounters?: Record<'detected' | 'executed' | 'belowGas' | 'insufficientBalance' | 'simulationFailed' | 'staleQuote' | 'reverted', number>
}

type ProfitRange = 'today' | 'sevenDays' | 'month' | 'all'

// A full 93-pool scan plus final simulation can legitimately exceed 15s.
// Treat that as busy, not offline; PM2/process failures still age out quickly.
const STALE_AFTER_MS = 60_000

export default function BotPage() {
  const [selectedBot, setSelectedBot] = useState(DEFAULT_BOT)
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
              Scans every AEON pool for price-equalization opportunities and executes them atomically
              through the on-chain AeonArbKeeper contract — it can never execute at a loss.
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

            {/* Stat row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <StatCard label="Pools Monitored" value={String(status.poolsMonitored ?? '—')} />
              <StatCard label="Arbs Executed" value={String(status.totalArbsExecuted ?? 0)} />
              <StatCard label="Arbs Failed" value={String(status.totalArbsFailed ?? 0)} />
              <StatCard label="Scan Interval" value={status.intervalMs ? `${status.intervalMs}ms` : '—'} />
            </div>

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

            {status.outcomeCounters && (
              <GlowPanel accent="blue" className="p-6 mb-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4">Execution Funnel</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  {([
                    ['Detected', 'detected'], ['Executed', 'executed'], ['Below gas', 'belowGas'],
                    ['No balance', 'insufficientBalance'], ['Simulation', 'simulationFailed'],
                    ['Stale quote', 'staleQuote'], ['Reverted', 'reverted'],
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
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm py-1.5 border-b border-bg-border last:border-0">
                      <span className="font-mono text-text-primary">{o.pair}</span>
                      {o.venues && <span className="text-violet-400 font-mono text-xs">{o.venues}{o.reliabilityPct != null ? ` · ${o.reliabilityPct.toFixed(0)}% reliable` : ''}</span>}
                      <span className="text-text-secondary">{o.amountIn} {o.tokenIn}</span>
                      <span className={clsx('font-mono', o.expectedNetUsd != null && o.expectedNetUsd < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        net est. {o.expectedNetUsd != null ? `${o.expectedNetUsd < 0 ? '-' : ''}$${Math.abs(o.expectedNetUsd).toFixed(4)}` : '—'} (gross {o.grossProfit ?? '—'} {o.tokenIn}
                        {o.gasCostUsd != null && <>, gas <span className="text-text-muted">${o.gasCostUsd.toFixed(4)}</span></>})
                      </span>
                      <span className="text-aeon-400 font-mono">{o.profitPct.toFixed(3)}%</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No profitable opportunities right now — that's normal, arbitrage is transient.</div>}
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
                          a.status === 'success' ? 'bg-emerald-400' : a.status === 'dry-run' ? 'bg-aeon-400' : 'bg-red-400'
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
                        {a.status === 'success' ? `net +${parseFloat(a.profit).toFixed(6)} ${a.tokenIn}${a.realizedProfitUsd != null ? ` ($${a.realizedProfitUsd.toFixed(4)})` : ''}${a.gasCost ? ` · gas ${parseFloat(a.gasCost).toFixed(6)}` : ''}${a.quoteVariancePct != null ? ` · quote ${a.quoteVariancePct >= 0 ? '+' : ''}${a.quoteVariancePct.toFixed(2)}%` : ''}` : a.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No activity yet.</div>}
            </GlowPanel>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  const visuals: Record<string, { detail: string; icon: React.ReactNode; accent: ProtocolAccent }> = {
    'Pools Monitored': { detail: 'live route graph', icon: <Layers size={16} />, accent: 'blue' },
    'Arbs Executed': { detail: 'confirmed cycles', icon: <CheckCircle size={16} />, accent: 'emerald' },
    'Arbs Failed': { detail: 'atomic reverts', icon: <XCircle size={16} />, accent: 'red' },
    'Scan Interval': { detail: 'continuous scanning', icon: <Clock size={16} />, accent: 'violet' },
  }
  const v = visuals[label] ?? { detail: 'live metric', icon: <Activity size={16} />, accent: 'aeon' as const }
  return <MetricCard label={label} value={value} detail={v.detail} icon={v.icon} accent={v.accent} />
}
