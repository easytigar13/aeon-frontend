// GET /api/dexscreener/latest-block
// DEX Screener Adapter spec: https://docs.dexscreener.com/
// Data is read live from the chain (no local indexing/persistence), so the
// latest block we can serve /events for is simply the chain head.
import { NextResponse } from 'next/server'
import { client, CORS } from '@/lib/dexscreener/shared'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  const block = await client.getBlock({ blockTag: 'latest' })
  return NextResponse.json(
    {
      block: {
        blockNumber: Number(block.number),
        blockTimestamp: Number(block.timestamp),
      },
    },
    { headers: CORS },
  )
}
