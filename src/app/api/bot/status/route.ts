import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { readBotStatus, isBotStoreConfigured } from '@/lib/botStore'
import { getBotBySlug } from '@/config/bots'

// Prefers the shared Upstash store (the bot process pushes to it every ~15s)
// so this works even when the bot runs on a different machine than this
// website -- Vercel's serverless functions have no access to that machine's
// disk. Falls back to reading <bot dir>/status.json directly for local dev,
// where the bot and the website share the same filesystem. Never touches
// the keeper's private key either way -- only addresses, balances, tx
// hashes, and profit numbers, all of which are already public on-chain.
//
// ?bot= selects which registered instance (see src/config/bots.ts) to read;
// omitted defaults to bot #1, preserving the original single-bot behavior.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bot = getBotBySlug(searchParams.get('bot'))

  if (isBotStoreConfigured()) {
    try {
      const status = await readBotStatus(bot.botId)
      if (status) return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
    } catch { /* fall through to local file */ }
  }

  const statusPath = path.join(process.cwd(), bot.dir, 'status.json')
  try {
    const raw = fs.readFileSync(statusPath, 'utf-8')
    return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      {
        online: false,
        reason: isBotStoreConfigured()
          ? `Bot store is configured but has no data yet -- start ${bot.dir}/index.ts with KV_REST_API_URL/KV_REST_API_TOKEN set in ${bot.dir}/.env.`
          : `No status file yet -- start ${bot.dir}/index.ts on the server (see ${bot.dir}/ecosystem.config.cjs), or configure KV_REST_API_URL/KV_REST_API_TOKEN if the bot runs on a different machine than this website.`,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
