import { NextResponse } from 'next/server'

// Same-origin JSON-RPC proxy for the Robinhood Chain node.
//
// The public RPC (rpc.mainnet.chain.robinhood.com) returns no
// Access-Control-Allow-Origin header, so the browser BLOCKS every direct
// fetch to it from the site origin (CORS preflight failure). That silently
// killed all client-side on-chain reads -- prices, TVL, reserves, balances --
// leaving the dashboard blank. Server-to-server calls have no CORS, so we
// forward the browser's JSON-RPC body through here. Handles both single
// requests and JSON-RPC batch arrays (viem's http batch transport).
const UPSTREAM = 'https://rpc.mainnet.chain.robinhood.com'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: Request) {
  let body: string
  try {
    body = await request.text()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  // The free node rate-limits (429) under the dashboard's read bursts. Retry
  // server-side with backoff so the browser gets a complete 200 instead of a
  // partial failure -- a 429 reaching the client drops part of a multicall and
  // makes the derived totals (TVL, volume, fees) flicker between refreshes.
  const MAX = 5
  let lastText = ''
  let lastStatus = 502
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        cache: 'no-store',
      })
      lastStatus = upstream.status
      lastText = await upstream.text()
      // 429 (rate limit) or 5xx (transient) -> back off and retry
      if ((upstream.status === 429 || upstream.status >= 500) && attempt < MAX - 1) {
        await new Promise(r => setTimeout(r, 250 * (attempt + 1)))
        continue
      }
      return new NextResponse(lastText, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    } catch (e: unknown) {
      lastText = JSON.stringify({ error: 'upstream RPC unreachable', detail: e instanceof Error ? e.message : String(e) })
      if (attempt < MAX - 1) { await new Promise(r => setTimeout(r, 250 * (attempt + 1))); continue }
    }
  }
  return new NextResponse(lastText, {
    status: lastStatus,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
