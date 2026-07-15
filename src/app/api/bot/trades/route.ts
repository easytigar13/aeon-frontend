import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readAllTrades, isBotStoreConfigured } from '@/lib/botStore'
import { getBotBySlug } from '@/config/bots'

function summarizeTrades(trades: any[]) {
  const now = Date.now()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const month = new Date()
  month.setUTCDate(1)
  month.setUTCHours(0, 0, 0, 0)
  const cutoffs = {
    today: today.getTime(),
    sevenDays: now - 7 * 24 * 60 * 60 * 1000,
    month: month.getTime(),
    all: 0,
  }
  const summaries: Record<keyof typeof cutoffs, Record<string, number>> = {
    today: {}, sevenDays: {}, month: {}, all: {},
  }
  for (const trade of trades) {
    if (trade?.status !== 'success') continue
    const time = new Date(trade.time).getTime()
    const value = Number.parseFloat(trade.profit ?? '0')
    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) continue
    const token = trade.profitToken ?? trade.tokenIn ?? 'UNKNOWN'
    for (const [range, cutoff] of Object.entries(cutoffs) as [keyof typeof cutoffs, number][]) {
      if (time < cutoff) continue
      summaries[range][token] = (summaries[range][token] ?? 0) + value
    }
  }
  return Object.fromEntries(Object.entries(summaries).map(([range, values]) => [
    range,
    Object.fromEntries(Object.entries(values).map(([token, value]) => [token, value.toString()])),
  ]))
}

// Full trade history (capped at the last 1000 when read from the shared
// store, never-truncated when read from the local file) -- one record per
// trade (dry-run, success, or failed). status.json/the shared status key
// only ever keep the last 30 for the fast live view; this is what backs
// /bot/trades.
//
// Prefers the shared Upstash store for the same cross-machine reason as
// /api/bot/status; falls back to keeper/trades.log for local dev.
//
// Query params:
//   bot     which registered instance to read (see src/config/bots.ts); default bot #1
//   limit   max rows to return (default 50, capped at 200)
//   offset  rows to skip from the most-recent end (default 0)
//   status  filter to 'success' | 'failed' | 'dry-run' (default: all)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bot = getBotBySlug(searchParams.get('bot'))
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
  const statusFilter = searchParams.get('status')
  const wantsSummary = searchParams.get('summary') === '1'

  if (isBotStoreConfigured()) {
    try {
      let trades = await readAllTrades(bot.botId)   // already newest-first (LPUSH)
      if (wantsSummary) return NextResponse.json({ summaries: summarizeTrades(trades) }, { headers: { 'Cache-Control': 'no-store' } })
      if (statusFilter) trades = trades.filter((t: any) => t.status === statusFilter)
      const total = trades.length
      const page = trades.slice(offset, offset + limit)
      return NextResponse.json({ trades: page, total, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { /* fall through to local file */ }
  }

  const logPath = path.join(process.cwd(), bot.dir, 'trades.log')
  try {
    const raw = fs.readFileSync(logPath, 'utf-8')
    let trades = raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean)
      .reverse()   // most recent first

    if (wantsSummary) return NextResponse.json({ summaries: summarizeTrades(trades) }, { headers: { 'Cache-Control': 'no-store' } })

    if (statusFilter) trades = trades.filter((t: any) => t.status === statusFilter)

    const total = trades.length
    const page = trades.slice(offset, offset + limit)

    return NextResponse.json({ trades: page, total, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ trades: [], total: 0, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
