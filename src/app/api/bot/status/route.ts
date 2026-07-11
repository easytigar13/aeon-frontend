import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// Reads keeper/status.json, written every tick by keeper/index.ts when it's
// running on this same server. Never touches the keeper's private key --
// that file only ever contains addresses, balances, tx hashes, and profit
// numbers, all of which are already public on-chain.
export async function GET() {
  const statusPath = path.join(process.cwd(), 'keeper', 'status.json')
  try {
    const raw = fs.readFileSync(statusPath, 'utf-8')
    return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(
      { online: false, reason: 'No status file yet -- start keeper/index.ts on the server (see keeper/ecosystem.config.cjs).' },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
