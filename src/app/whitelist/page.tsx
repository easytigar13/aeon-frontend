'use client'
import { BadgeCheck } from 'lucide-react'
import Link from 'next/link'

// The 100 AEON whitelist gate on adding liquidity was removed 2026-07-03 —
// LiquidityHelper now points at a fresh, ungated LiquidityHelperRH deployment.
// This route is kept (rather than deleted) so old links/bookmarks don't 404.
export default function WhitelistPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Whitelist</h1>
        <p className="text-text-secondary">The whitelist requirement has been removed.</p>
      </div>

      <div className="card p-8 text-center border-emerald-400/20 bg-emerald-400/5">
        <BadgeCheck size={40} className="text-emerald-400 mx-auto mb-3" />
        <h2 className="font-display font-bold text-xl text-text-primary mb-2">No Whitelist Needed</h2>
        <p className="text-text-secondary text-sm mb-4">
          Adding liquidity on AEON Protocol no longer requires a 100 AEON payment. Any wallet can add liquidity
          to any pool directly. Head to <Link href="/liquidity" className="text-aeon-400 hover:underline">Liquidity</Link> to get started.
        </p>
      </div>
    </div>
  )
}
