'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { clsx } from 'clsx'

const NAV_LINKS = [
  { href: '/swap',       label: 'Swap'      },
  { href: '/launch',     label: 'Launch'    },
  { href: '/tokens',     label: 'Tokens'    },
  { href: '/liquidity',  label: 'Liquidity' },
  { href: '/earn',       label: 'Portfolio' },
  { href: '/vote',       label: 'Vote'      },
  { href: '/lock',       label: 'Lock'      },
  { href: '/games',      label: 'Games'     },
  { href: '/dashboard',  label: 'Dashboard' },
  { href: '/bot',        label: 'Bot'       },
  { href: '/docs',       label: 'Docs'      },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-bg-base/80 backdrop-blur-xl relative">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-aeon-400/40 to-transparent" />
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <img
            src="/logo.jpg"
            alt="AEON"
            className="w-9 h-9 rounded-lg object-cover transition-shadow duration-300 group-hover:scale-105"
            style={{ boxShadow: '0 0 14px -2px rgba(255,184,0,0.5)' }}
          />
          <span className="font-display font-bold text-lg text-gradient-aeon">AEON</span>
          <span className="hidden sm:block text-text-muted text-sm font-mono">Protocol</span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(link => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
            return (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-aeon-400/10 text-aeon-400 shadow-[0_0_16px_-6px_rgba(255,184,0,0.6)]'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-raised'
                )}
              >
                {link.label}
              </Link>
            )
          })}
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
    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-raised border border-aeon-400/20 shadow-[0_0_14px_-8px_rgba(255,184,0,0.5)]">
      <div className="w-1.5 h-1.5 rounded-full bg-aeon-400 animate-pulse-slow" />
      <span className="text-xs font-mono text-text-secondary">
        Epoch ends <span className="text-text-primary">{days}d {hours}h</span>
      </span>
    </div>
  )
}
