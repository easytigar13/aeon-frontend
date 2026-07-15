'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Activity } from 'lucide-react'
import { clsx } from 'clsx'
import { getBotBySlug } from '@/config/bots'

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
}

const STALE_AFTER_MS = 60_000

export default function BotOpportunitiesPage() {
  return (
    <Suspense fallback={null}>
      <BotOpportunitiesPageInner />
    </Suspense>
  )
}

function BotOpportunitiesPageInner() {
  const searchParams = useSearchParams()
  const bot = getBotBySlug(searchParams.get('bot'))
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch(`/api/bot/status?bot=${bot.slug}`, { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) {
          setOpportunities(data.lastOpportunities ?? [])
          setUpdatedAt(data.updatedAt ?? null)
        }
      } catch { /* keep showing last known opportunities */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [bot])

  const isLive = updatedAt && (Date.now() - new Date(updatedAt).getTime()) < STALE_AFTER_MS

  return (
    <div className="min-h-screen bg-bg-base bg-grid-pattern bg-grid">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <Link href="/bot" className="inline-flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm mb-6 transition-colors">
          <ArrowLeft size={14} /> Back to Arb Keeper
        </Link>

        <div className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-2xs font-mono uppercase tracking-wider text-aeon-400 mb-1">{bot.name}</div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-text-primary mb-2">Current Opportunities</h1>
            <p className="text-text-secondary">
              Every route the bot is evaluating right now, refreshed live from its latest scan --
              not just the top few shown on the main page.
            </p>
          </div>
          <div className={clsx(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-xs font-bold tracking-wider uppercase',
            isLive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-red-500/10 border-red-500/30 text-red-400'
          )}>
            <span className={clsx('w-2 h-2 rounded-full', isLive ? 'bg-emerald-400 animate-pulse-slow' : 'bg-red-400')} />
            {isLive ? 'Live' : 'Stale'}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bg-border text-text-muted text-xs font-mono uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Route</th>
                  <th className="text-left px-4 py-3">Venues</th>
                  <th className="text-right px-4 py-3">Amount In</th>
                  <th className="text-right px-4 py-3">Gross</th>
                  <th className="text-right px-4 py-3">Gas</th>
                  <th className="text-right px-4 py-3">Net Est.</th>
                  <th className="text-right px-4 py-3">Profit %</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o, i) => (
                  <tr key={i} className="border-b border-bg-border last:border-0 hover:bg-bg-raised/50">
                    <td className="px-4 py-3 font-mono text-text-primary whitespace-nowrap">{o.pair}</td>
                    <td className="px-4 py-3 font-mono text-violet-400 text-xs whitespace-nowrap">{o.venues ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono whitespace-nowrap">{o.amountIn} {o.tokenIn}</td>
                    <td className="px-4 py-3 text-right text-text-secondary font-mono whitespace-nowrap">
                      {o.grossProfit ?? '—'} {o.tokenIn}
                    </td>
                    <td className="px-4 py-3 text-right text-text-muted font-mono whitespace-nowrap">
                      {o.gasCostUsd != null ? `$${o.gasCostUsd.toFixed(4)}` : '—'}
                    </td>
                    <td className={clsx(
                      'px-4 py-3 text-right font-mono whitespace-nowrap',
                      o.expectedNetUsd != null && o.expectedNetUsd < 0 ? 'text-red-400' : 'text-emerald-400',
                    )}>
                      {o.expectedNetUsd != null ? `${o.expectedNetUsd < 0 ? '-' : ''}$${Math.abs(o.expectedNetUsd).toFixed(4)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-aeon-400 font-mono">{o.profitPct.toFixed(3)}%</td>
                  </tr>
                ))}
                {opportunities.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-text-muted">No profitable opportunities right now -- that's normal, arbitrage is transient.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-text-muted text-xs mt-4">
          Shows up to the top {opportunities.length > 0 ? Math.max(opportunities.length, 20) : 20} opportunities from the bot's most recent scan,
          ranked by estimated net profit -- most just fall short of covering gas, which is expected; arbitrage
          windows are transient and most scans find nothing worth executing.
        </p>
      </div>
    </div>
  )
}
