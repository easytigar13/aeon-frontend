'use client'
import { useState, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, TrendingDown, Clock, BarChart3, LineChart, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

interface SwapChartProps {
  fromTokenSymbol: string
  toTokenSymbol: string
  currentRate: number // how much toToken per 1 fromToken
  isLoadingRate?: boolean
}

type TimeFrame = '1H' | '24H' | '7D' | '30D' | 'ALL'

export function SwapChart({
  fromTokenSymbol,
  toTokenSymbol,
  currentRate,
  isLoadingRate = false,
}: SwapChartProps) {
  const [timeframe, setTimeframe] = useState<TimeFrame>('24H')
  const [chartType, setChartType] = useState<'area' | 'bar'>('area')

  // Generate realistic historical points anchored to the live currentRate
  const chartData = useMemo(() => {
    const rate = currentRate > 0 ? currentRate : 1.0
    const pointsCount = timeframe === '1H' ? 24 : timeframe === '24H' ? 48 : timeframe === '7D' ? 56 : 60
    const data = []
    const now = Date.now()
    const stepMs =
      timeframe === '1H'
        ? 60 * 1000 * 2.5
        : timeframe === '24H'
        ? 30 * 60 * 1000
        : timeframe === '7D'
        ? 3 * 3600 * 1000
        : 12 * 3600 * 1000

    // Generate deterministic but realistic price trajectory ending at currentRate
    let price = rate * (1 - (Math.sin(fromTokenSymbol.length + toTokenSymbol.length) * 0.04))
    const volatility = timeframe === '1H' ? 0.004 : timeframe === '24H' ? 0.015 : 0.04

    for (let i = pointsCount - 1; i >= 0; i--) {
      const time = new Date(now - i * stepMs)
      const noise = (Math.sin(i * 1.7) * 0.5 + Math.cos(i * 0.8) * 0.5) * volatility
      const curPrice = i === 0 ? rate : price * (1 + noise)
      
      const timeLabel =
        timeframe === '1H'
          ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : timeframe === '24H'
          ? time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : time.toLocaleDateString([], { month: 'short', day: 'numeric' })

      data.push({
        time: timeLabel,
        rawTime: time,
        price: Number(curPrice.toPrecision(6)),
        volume: Math.floor(Math.random() * 5000 + 1000),
      })
      price = curPrice
    }

    return data
  }, [currentRate, timeframe, fromTokenSymbol, toTokenSymbol])

  const firstPrice = chartData[0]?.price || currentRate || 1
  const lastPrice = chartData[chartData.length - 1]?.price || currentRate || 1
  const priceChange = lastPrice - firstPrice
  const priceChangePercent = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0
  const isPositive = priceChangePercent >= 0

  const minPrice = Math.min(...chartData.map(d => d.price))
  const maxPrice = Math.max(...chartData.map(d => d.price))

  return (
    <div className="bg-[#0B0F19]/90 border border-[#182337] rounded-2xl p-4 sm:p-5 flex flex-col h-full backdrop-blur-md shadow-xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#182337]">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-lg text-white">
                {fromTokenSymbol} / {toTokenSymbol}
              </span>
              <span className="text-2xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Robinhood Chain
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-mono font-extrabold text-white">
                {isLoadingRate ? (
                  <span className="text-slate-500 animate-pulse text-lg">Fetching live rate...</span>
                ) : (
                  currentRate.toLocaleString(undefined, { maximumSignificantDigits: 6 })
                )}
              </span>
              <span className="text-xs font-mono text-slate-400">{toTokenSymbol}</span>

              {!isLoadingRate && (
                <div
                  className={clsx(
                    'flex items-center gap-0.5 text-xs font-mono font-semibold px-1.5 py-0.5 rounded',
                    isPositive
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-red-400 bg-red-500/10'
                  )}
                >
                  {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  <span>{isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1 bg-[#101726] p-1 rounded-xl border border-[#1D2B44]">
          {(['1H', '24H', '7D', '30D', 'ALL'] as TimeFrame[]).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={clsx(
                'px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all',
                timeframe === tf
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_10px_-2px_rgba(16,185,129,0.5)]'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* 24h Stats summary */}
      <div className="grid grid-cols-3 gap-2 py-3 text-xs border-b border-[#182337]/60">
        <div>
          <span className="text-slate-500 text-[10px] uppercase font-mono block">24h Low</span>
          <span className="font-mono text-slate-300 font-medium">
            {minPrice.toLocaleString(undefined, { maximumSignificantDigits: 5 })}
          </span>
        </div>
        <div>
          <span className="text-slate-500 text-[10px] uppercase font-mono block">24h High</span>
          <span className="font-mono text-slate-300 font-medium">
            {maxPrice.toLocaleString(undefined, { maximumSignificantDigits: 5 })}
          </span>
        </div>
        <div>
          <span className="text-slate-500 text-[10px] uppercase font-mono block">Chain Dex</span>
          <span className="font-mono text-emerald-400 font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> AEON Pools
          </span>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="flex-1 w-full min-h-[220px] pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={isPositive ? '#10B981' : '#EF4444'}
                  stopOpacity={0.4}
                />
                <stop
                  offset="95%"
                  stopColor={isPositive ? '#10B981' : '#EF4444'}
                  stopOpacity={0.0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              stroke="#334155"
              tick={{ fill: '#64748B', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={25}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke="#334155"
              tick={{ fill: '#64748B', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={val => (val > 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(val < 1 ? 4 : 2))}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0B0F19',
                borderColor: '#1E293B',
                borderRadius: '12px',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                color: '#F8FAFC',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.8)',
              }}
              formatter={(value: number) => [
                `${value.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${toTokenSymbol}`,
                'Rate',
              ]}
              labelStyle={{ color: '#94A3B8' }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={isPositive ? '#10B981' : '#EF4444'}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#priceGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
