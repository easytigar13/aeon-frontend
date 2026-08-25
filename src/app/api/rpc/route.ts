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
  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
    })
    const text = await upstream.text()
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: 'upstream RPC unreachable', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
