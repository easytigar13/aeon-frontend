import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readAllTrades, isBotStoreConfigured } from '@/lib/botStore'

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
//   limit   max rows to return (default 50, capped at 200)
//   offset  rows to skip from the most-recent end (default 0)
//   status  filter to 'success' | 'failed' | 'dry-run' (default: all)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200)
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
  const statusFilter = searchParams.get('status')

  if (isBotStoreConfigured()) {
    try {
      let trades = await readAllTrades()   // already newest-first (LPUSH)
      if (statusFilter) trades = trades.filter((t: any) => t.status === statusFilter)
      const total = trades.length
      const page = trades.slice(offset, offset + limit)
      return NextResponse.json({ trades: page, total, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
    } catch { /* fall through to local file */ }
  }

  const logPath = path.join(process.cwd(), 'keeper', 'trades.log')
  try {
    const raw = fs.readFileSync(logPath, 'utf-8')
    let trades = raw
      .split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) } catch { return null } })
      .filter(Boolean)
      .reverse()   // most recent first

    if (statusFilter) trades = trades.filter((t: any) => t.status === statusFilter)

    const total = trades.length
    const page = trades.slice(offset, offset + limit)

    return NextResponse.json({ trades: page, total, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ trades: [], total: 0, limit, offset }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
