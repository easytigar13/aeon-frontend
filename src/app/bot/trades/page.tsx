'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, TrendingUp } from 'lucide-react'
import { clsx } from 'clsx'
import { getBotBySlug } from '@/config/bots'

interface Trade {
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
}

type StatusFilter = 'all' | 'success' | 'failed' | 'dry-run'

const LIMIT = 50
const EXPLORER = 'https://robinhoodchain.blockscout.com'

export default function BotTradesPage() {
  return (
    <Suspense fallback={null}>
      <BotTradesPageInner />
    </Suspense>
  )
}

function BotTradesPageInner() {
  const searchParams = useSearchParams()
  const bot = getBotBySlug(searchParams.get('bot'))
  const [trades, setTrades] = useState<Trade[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [cumulativeProfit, setCumulativeProfit] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch(`/api/bot/status?bot=${bot.slug}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setCumulativeProfit(d.cumulativeProfit ?? {}))
      .catch(() => {})
  }, [bot])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ bot: bot.slug, limit: String(LIMIT), offset: String(offset) })
    if (filter !== 'all') params.set('status', filter)
    fetch(`/api/bot/trades?${params}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { if (!cancelled) { setTrades(d.trades ?? []); setTotal(d.total ?? 0) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bot, offset, filter])

  function changeFilter(f: StatusFilter) {
    setFilter(f)
    setOffset(0)
  }

  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + LIMIT, total)

  return (
    <div className="min-h-screen bg-bg-base bg-grid-pattern bg-grid">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <Link href="/bot" className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Arb Keeper
        </Link>

        <div className="mb-8">
          <div className="text-2xs font-mono uppercase tracking-wider text-aeon-400 mb-1">{bot.name}</div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl text-text-primary mb-2">All Trades</h1>
          <p className="text-text-secondary">Complete, unfiltered history of every arb the bot has attempted -- never truncated.</p>
        </div>

        {/* All-time cumulative profit */}
        <div className="card p-6 mb-6">
          <div className="text-text-secondary text-sm font-mono uppercase tracking-wider mb-4 flex items-center gap-2">
            <TrendingUp size={14} /> All-Time Profit (successful trades only)
          </div>
          {Object.entries(cumulativeProfit).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Object.entries(cumulativeProfit).map(([sym, amt]) => (
                <div key={sym}>
                  <div className="text-text-muted text-xs font-mono uppercase">{sym}</div>
                  <div className="text-emerald-400 font-display font-bold text-lg">+{parseFloat(amt).toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
                </div>
              ))}
            </div>
          ) : <div className="text-text-muted text-sm">No profit recorded yet</div>}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-2 mb-4">
          {(['all', 'success', 'failed', 'dry-run'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => changeFilter(f)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize',
                filter === f ? 'bg-aeon-400/10 text-aeon-400 border border-aeon-400/30' : 'text-text-secondary hover:text-text-primary hover:bg-bg-raised border border-transparent'
              )}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-text-muted text-xs font-mono uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Time</th>
                  <th className="text-left px-4 py-3">Pair</th>
                  <th className="text-left px-4 py-3">Bought / Sold</th>
                  <th className="text-right px-4 py-3">Amount In</th>
                  <th className="text-right px-4 py-3">Net Profit</th>
                  <th className="text-right px-4 py-3">Profit %</th>
                  <th className="text-right px-4 py-3">Gas</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Tx</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-b border-bg-border last:border-0 hover:bg-bg-raised/50">
                    <td className="px-4 py-3 text-text-muted whitespace-nowrap">{new Date(t.time).toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono text-text-primary whitespace-nowrap">{t.pair}</td>
                    <td className="px-4 py-3">
                      <span className="text-violet-400 font-mono text-xs whitespace-nowrap">
                        {t.venues ?? t.route ?? 'legacy trade'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono whitespace-nowrap">{t.amountIn} {t.tokenIn}</td>
                    <td className={clsx('px-4 py-3 text-right font-mono whitespace-nowrap', t.status === 'success' ? 'text-emerald-400' : 'text-text-muted')}>
                      {t.status === 'success' ? `+${parseFloat(t.profit).toFixed(6)} ${t.tokenIn}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono">{t.profitPct.toFixed(3)}%</td>
                    <td className="px-4 py-3 text-right text-text-muted font-mono whitespace-nowrap">
                      {t.gasCost ? `${parseFloat(t.gasCost).toFixed(6)} ${t.tokenIn}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono',
                        t.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' :
                        t.status === 'failed'  ? 'bg-red-500/10 text-red-400' :
                                                  'bg-aeon-400/10 text-aeon-400'
                      )}>
                        <span className={clsx('w-1.5 h-1.5 rounded-full', t.status === 'success' ? 'bg-emerald-400' : t.status === 'failed' ? 'bg-red-400' : 'bg-aeon-400')} />
                        {t.status}
                      </span>
                      {t.error && <div className="text-text-muted text-xs mt-1 max-w-xs truncate" title={t.error}>{t.error}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {t.txHash ? (
                        <a href={`${EXPLORER}/tx/${t.txHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-aeon-400 hover:text-aeon-300 font-mono text-xs">
                          {t.txHash.slice(0, 8)}… <ExternalLink size={11} />
                        </a>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                  </tr>
                ))}
                {!loading && trades.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-text-muted">No trades yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-text-muted">Showing {rangeStart}–{rangeEnd} of {total}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                disabled={offset === 0}
                className="btn-ghost text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset(offset + LIMIT)}
                disabled={offset + LIMIT >= total}
                className="btn-ghost text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
