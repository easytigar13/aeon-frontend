'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { clsx } from 'clsx'

const NAV_LINKS = [
  { href: '/swap',       label: 'Swap'      },
  { href: '/liquidity',  label: 'Liquidity' },
  { href: '/vote',       label: 'Vote'      },
  { href: '/lock',       label: 'Lock'      },
  { href: '/earn',       label: 'Earn'      },
  { href: '/dashboard',  label: 'Dashboard' },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-bg-border bg-bg-base/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-aeon-400 flex items-center justify-center">
            <span className="text-bg-base font-display font-bold text-sm">A</span>
          </div>
          <span className="font-display font-bold text-lg text-text-primary">AEON</span>
          <span className="hidden sm:block text-text-muted text-sm font-mono">Protocol</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'bg-aeon-400/10 text-aeon-400'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-raised'
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Epoch countdown + connect */}
        <div className="flex items-center gap-3">
          <EpochBadge />
          <ConnectButton
            chainStatus="icon"
            showBalance={false}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
          />
        </div>
      </div>

      {/* Mobile nav */}
      <div className="md:hidden border-t border-bg-border overflow-x-auto">
        <div className="flex px-4 py-2 gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                pathname === link.href
                  ? 'bg-aeon-400/10 text-aeon-400'
                  : 'text-text-secondary'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}

function EpochBadge() {
  // Compute current epoch and time remaining
  const EPOCH_LENGTH = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const epochStart = Math.floor(now / EPOCH_LENGTH) * EPOCH_LENGTH
  const remaining = epochStart + EPOCH_LENGTH - now
  const days    = Math.floor(remaining / (24 * 60 * 60 * 1000))
  const hours   = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))

  return (
    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-raised border border-bg-border">
      <div className="w-1.5 h-1.5 rounded-full bg-aeon-400 animate-pulse-slow" />
      <span className="text-xs font-mono text-text-secondary">
        Epoch ends <span className="text-text-primary">{days}d {hours}h</span>
      </span>
    </div>
  )
}
