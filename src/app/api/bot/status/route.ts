import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readBotStatus, isBotStoreConfigured } from '@/lib/botStore'

// Prefers the shared Upstash store (keeper/index.ts pushes to it every ~15s)
// so this works even when the bot runs on a different machine than this
// website -- Vercel's serverless functions have no access to that machine's
// disk. Falls back to reading keeper/status.json directly for local dev,
// where the bot and the website share the same filesystem. Never touches
// the keeper's private key either way -- only addresses, balances, tx
// hashes, and profit numbers, all of which are already public on-chain.
export async function GET() {
  if (isBotStoreConfigured()) {
    try {
      const status = await readBotStatus()
      if (status) return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
    } catch { /* fall through to local file */ }
  }

  const statusPath = path.join(process.cwd(), 'keeper', 'status.json')
  try {
    const raw = fs.readFileSync(statusPath, 'utf-8')
    return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      {
        online: false,
        reason: isBotStoreConfigured()
          ? 'Bot store is configured but has no data yet -- start keeper/index.ts with KV_REST_API_URL/KV_REST_API_TOKEN set in keeper/.env.'
          : 'No status file yet -- start keeper/index.ts on the server (see keeper/ecosystem.config.cjs), or configure KV_REST_API_URL/KV_REST_API_TOKEN if the bot runs on a different machine than this website.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
