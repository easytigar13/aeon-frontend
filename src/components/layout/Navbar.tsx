'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { clsx } from 'clsx'

const NAV_LINKS = [
  { href: '/swap',       label: 'Swap'      },
  { href: '/liquidity',  label: 'Liquidity' },
  { href: '/earn',       label: 'Portfolio' },
  { href: '/vote',       label: 'Vote'      },
  { href: '/lock',       label: 'Lock'      },
  { href: '/dashboard',  label: 'Dashboard' },
  { href: '/docs',       label: 'Docs'      },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 bg-[#070A10]/90 backdrop-blur-md border-b border-[#181F30] relative">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#38BDF8]/40 to-transparent" />
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0 group">
          <img
            src="/logo.jpg"
            alt="AEON"
            className="w-9 h-9 rounded-lg object-cover transition-transform duration-300 group-hover:scale-105"
            style={{ boxShadow: '0 0 14px -2px rgba(56,189,248,0.5)' }}
          />
          <span className="font-display font-extrabold text-lg text-white tracking-wide">AEON</span>
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
                  'px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150',
                  isActive
                    ? 'bg-[#151D2F] text-white border border-[#2B3854] shadow-[0_0_12px_-3px_rgba(56,189,248,0.4)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#101524]'
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
      <div className="md:hidden border-t border-[#181F30] overflow-x-auto bg-[#070A10]">
        <div className="flex px-4 py-2 gap-1">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                pathname === link.href
                  ? 'bg-[#151D2F] text-white'
                  : 'text-slate-400'
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
    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D121F] border border-[#1C263C]">
      <div className="w-1.5 h-1.5 rounded-full bg-[#38BDF8] animate-pulse-slow" />
      <span className="text-xs font-mono text-slate-400">
        Epoch ends <span className="text-white font-bold">{days}d {hours}h</span>
      </span>
    </div>
  )
}
