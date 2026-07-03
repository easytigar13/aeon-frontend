'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Copy, Check, TrendingUp, TrendingDown } from 'lucide-react'
import { TOKENS, POOLS } from '@/config/contracts'
import { usePrices } from '@/hooks/usePrices'
import { useDexTokenInfo } from '@/hooks/useDexTokenInfo'
import { useVolume24h } from '@/hooks/useVolume24h'
import { TokenIcon, ChainBadge } from '@/components/TokenIcon'
import { Sparkline } from '@/components/Sparkline'
import { AddToWalletButton } from '@/components/AddToWalletButton'

function fmtPrice(p: number | null): string {
  if (p === null) return '—'
  if (p >= 1) return '$' + p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 0.0001) return '$' + p.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return '$' + p.toExponential(2)
}

function fmtChange(c: number | null): string {
  if (c === null) return ''
  const sign = c >= 0 ? '+' : ''
  return `${sign}${c.toFixed(2)}%`
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function TokensPage() {
  const prices = usePrices()
  const dexInfo = useDexTokenInfo()
  const volResult = useVolume24h(prices)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const entries = useMemo(() => Object.entries(TOKENS), [])

  const poolCountBySymbol = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of POOLS) {
      counts[p.token0] = (counts[p.token0] ?? 0) + 1
      counts[p.token1] = (counts[p.token1] ?? 0) + 1
    }
    return counts
  }, [])

  const filtered = entries.filter(([key, t]) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return key.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)
  })

  function copyAddr(addr: string) {
    navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="min-h-screen bg-bg-base bg-grid-pattern bg-grid">
      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display font-bold text-3xl sm:text-4xl text-text-primary mb-2">
            Tradable <span className="text-aeon-400">Tokens</span>
          </h1>
          <p className="text-text-secondary text-sm">
            Every asset live on AEON Protocol — ve(3,3) liquidity on Robinhood Chain.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by symbol, name, or contract address..."
            className="w-full bg-bg-surface border border-bg-border rounded-xl2 pl-11 pr-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-aeon-400/50 transition-colors"
          />
        </div>

        {/* Stats strip */}
        <div className="flex items-center gap-4 mb-8 text-xs font-mono text-text-muted">
          <span>{entries.length} tokens</span>
          <span className="w-1 h-1 rounded-full bg-text-muted" />
          <span>{new Set(POOLS.map(p => p.address)).size} pools</span>
          <span className="w-1 h-1 rounded-full bg-text-muted" />
          <span className="flex items-center gap-1.5">
            <ChainBadge size={12} /> Robinhood Chain
          </span>
        </div>

        {/* Token grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(([key, t]) => {
            const price = prices[key] ?? null
            const pools = poolCountBySymbol[key] ?? 0
            const info = dexInfo[key]
            const change = info?.priceChange24h ?? null

            // GeckoTerminal doesn't index this chain (confirmed: 404s on every
            // lookup), so its sparkline is always empty here in practice —
            // fall back to a real on-chain price history built from this
            // token's own recent Swap events, same as the Swap page's cards.
            const geckoSparkline = info?.sparkline ?? []
            const chainSparkline = volResult.priceHistory[key] ?? []
            const usingGecko = geckoSparkline.length >= 2
            const usingChain = !usingGecko && chainSparkline.length >= 2
            const sparkline  = usingGecko ? geckoSparkline : chainSparkline
            const hasChart   = sparkline.length >= 2
            const positive   = usingChain
              ? (sparkline.length < 2 || sparkline[sparkline.length - 1] >= sparkline[0])
              : (change === null || change >= 0)

            return (
              <div
                key={key}
                className="group flex flex-col bg-bg-surface border border-bg-border rounded-xl2 hover:border-aeon-400/40 hover:bg-aeon-glow transition-all duration-150 overflow-hidden"
              >
                {/* Main info row */}
                <div className="flex items-start justify-between p-4 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <TokenIcon symbol={key} size={40} imageUrl={info?.imageUrl} />
                      <div className="absolute -bottom-1 -right-1">
                        <ChainBadge size={16} />
                      </div>
                    </div>
                    <div>
                      <div className="font-display font-bold text-text-primary leading-tight">{t.symbol}</div>
                      <div className="text-xs text-text-muted">{t.name}</div>
                    </div>
                  </div>

                  {/* Price + 24h change */}
                  <div className="text-right">
                    <div className="font-mono text-sm font-medium text-text-primary">{fmtPrice(price)}</div>
                    {change !== null ? (
                      <div className={`flex items-center justify-end gap-0.5 text-2xs font-mono mt-0.5 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                        {positive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {fmtChange(change)}
                      </div>
                    ) : pools > 0 ? (
                      <div className="text-2xs text-emerald-400 font-mono mt-0.5">{pools} pool{pools !== 1 ? 's' : ''}</div>
                    ) : null}
                  </div>
                </div>

                {/* Sparkline chart */}
                {hasChart ? (
                  <div className="px-4 pb-2">
                    <Sparkline prices={sparkline} positive={positive} width={280} height={44} />
                    <div className="text-2xs text-text-muted mt-0.5">{usingGecko ? '24h · hourly' : 'Recent trades · on-chain'}</div>
                  </div>
                ) : (
                  <div className="px-4 pb-3 text-2xs text-text-muted">No chart data yet — shows once this token trades</div>
                )}

                {/* Footer: address + actions */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-bg-border mt-auto">
                  <button
                    onClick={() => copyAddr(t.address)}
                    className="flex items-center gap-1.5 text-2xs font-mono text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {copied === t.address ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    {shortAddr(t.address)}
                  </button>
                  <div className="flex items-center gap-2">
                    <AddToWalletButton tokenKey={key as keyof typeof TOKENS} />
                    <Link
                      href={`/swap?from=${key}`}
                      className="text-2xs font-medium px-2.5 py-1 rounded-lg bg-aeon-400/10 text-aeon-400 hover:bg-aeon-400/20 transition-colors"
                    >
                      Trade
                    </Link>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-text-muted text-sm">No tokens match "{query}"</div>
        )}
      </div>
    </div>
  )
}
