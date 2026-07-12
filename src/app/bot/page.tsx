'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, Copy, Check, TrendingUp, AlertTriangle, Wallet, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'

interface Opportunity {
  pair: string
  profitPct: number
  amountIn: string
  tokenIn: string
  grossProfit?: string
  grossProfitUsd?: number
  expectedNetUsd?: number
  venues?: string
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
}

const STALE_AFTER_MS = 15_000

export default function BotPage() {
  const [status, setStatus] = useState<BotStatus | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch('/api/bot/status', { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) setStatus(data)
      } catch { /* keep showing last known status */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const hasFile = status && status.updatedAt
  const isOnline = hasFile && (Date.now() - new Date(status.updatedAt!).getTime()) < STALE_AFTER_MS

  function copyAddr() {
    if (!status?.keeperAddress) return
    navigator.clipboard.writeText(status.keeperAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="min-h-screen bg-bg-base bg-grid-pattern bg-grid">
      <div className="max-w-5xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-text-primary mb-2">Arb Keeper</h1>
            <p className="text-text-secondary">
              Scans every AEON pool for price-equalization opportunities and executes them atomically
              through the on-chain AeonArbKeeper contract — it can never execute at a loss.
            </p>
          </div>
          <div className={clsx(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-xs font-bold tracking-wider uppercase',
            isOnline ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          )}>
            <span className={clsx('w-2 h-2 rounded-full', isOnline ? 'bg-emerald-400 animate-pulse-slow' : 'bg-red-400')} />
            {isOnline ? (status?.dryRun ? 'Online · Dry Run' : 'Online · Live') : 'Offline'}
          </div>
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
            <div className="card p-6 mb-6">
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
            </div>

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

            {/* Balances + cumulative profit */}
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="card p-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4">Wallet Balances</div>
                <div className="space-y-2">
                  {status.balances && Object.entries(status.balances).length > 0 ? Object.entries(status.balances).map(([sym, bal]) => (
                    <div key={sym} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{sym}</span>
                      <span className="text-text-primary font-mono">{parseFloat(bal).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                    </div>
                  )) : <div className="text-text-muted text-sm">No balances yet</div>}
                </div>
              </div>
              <div className="card p-6">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
                  <TrendingUp size={14} /> Cumulative Profit
                </div>
                <div className="space-y-2">
                  {status.cumulativeProfit && Object.entries(status.cumulativeProfit).length > 0 ? Object.entries(status.cumulativeProfit).map(([sym, amt]) => (
                    <div key={sym} className="flex justify-between text-sm">
                      <span className="text-text-secondary">{sym}</span>
                      <span className="text-emerald-400 font-mono">+{parseFloat(amt).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                    </div>
                  )) : <div className="text-text-muted text-sm">No profit recorded yet</div>}
                </div>
              </div>
            </div>

            {/* Current opportunities */}
            <div className="card p-6 mb-6">
              <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity size={14} /> Current Opportunities
              </div>
              {status.lastOpportunities && status.lastOpportunities.length > 0 ? (
                <div className="space-y-2">
                  {status.lastOpportunities.map((o, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center text-sm py-1.5 border-b border-bg-border last:border-0">
                      <span className="font-mono text-text-primary">{o.pair}</span>
                      {o.venues && <span className="text-violet-400 font-mono text-xs">{o.venues}</span>}
                      <span className="text-text-secondary">{o.amountIn} {o.tokenIn}</span>
                      <span className="text-emerald-400 font-mono">net est. {o.expectedNetUsd != null ? `$${o.expectedNetUsd.toFixed(4)}` : '—'} (gross {o.grossProfit ?? '—'} {o.tokenIn})</span>
                      <span className="text-aeon-400 font-mono">{o.profitPct.toFixed(3)}%</span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No profitable opportunities right now — that's normal, arbitrage is transient.</div>}
            </div>

            {/* Recent arbs */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-text-secondary text-sm font-mono uppercase tracking-wider">Recent Activity</div>
                <Link href="/bot/trades" className="inline-flex items-center gap-1 text-aeon-400 hover:text-aeon-300 text-xs font-medium">
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
                        {a.route && a.route !== 'internal' && (
                          <span className="px-1.5 py-0.5 rounded text-2xs font-mono uppercase text-violet-400 bg-violet-500/10 border border-violet-500/20">
                            {a.route}
                          </span>
                        )}
                      </div>
                      <span className="text-text-muted text-xs">{new Date(a.time).toLocaleTimeString()}</span>
                      <span className={a.status === 'success' ? 'text-emerald-400 font-mono' : 'text-text-muted font-mono'}>
                        {a.status === 'success' ? `net +${parseFloat(a.profit).toFixed(6)} ${a.tokenIn}${a.gasCost ? ` (gas ${parseFloat(a.gasCost).toFixed(6)})` : ''}` : a.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : <div className="text-text-muted text-sm">No activity yet.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-text-muted text-xs font-mono uppercase tracking-wider mb-1">{label}</div>
      <div className="text-text-primary font-display font-bold text-xl">{value}</div>
    </div>
  )
}
