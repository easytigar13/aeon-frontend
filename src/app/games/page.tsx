'use client'
import Link from 'next/link'
import { Swords } from 'lucide-react'

const GAMES = [
  {
    href: '/games/tower-defense',
    name: 'Tower Defense',
    description: 'Defend the base across escalating waves. Play free, or stake AEON for a shot at real rewards.',
    icon: Swords,
    live: true,
  },
]

export default function GamesHubPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-2xl text-text-primary">Games</h1>
        <p className="text-sm text-text-muted mt-0.5">Mini-games built on AEON Protocol — play free, or stake AEON for real rewards.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {GAMES.map(game => (
          <Link key={game.href} href={game.href} className="card p-5 hover:border-aeon-400/30 border border-transparent transition-all group">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-aeon-400/10 flex items-center justify-center text-aeon-400 group-hover:bg-aeon-400/20 transition-colors">
                <game.icon size={20} />
              </div>
              <span className="font-display font-semibold text-text-primary">{game.name}</span>
            </div>
            <p className="text-sm text-text-secondary">{game.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
