'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { clsx } from 'clsx'
import { Volume2, VolumeX, Activity } from 'lucide-react'
import { useSoundEffects } from '@/hooks/useSoundEffects'

const NAV_LINKS = [
  { href: '/swap',       label: 'Swap'      },
  { href: '/earn',       label: 'Pools'     },
  { href: '/vote',       label: 'Vote'      },
  { href: '/lock',       label: 'Lock'      },
  { href: '/dashboard',  label: 'Dashboard' },
  { href: '/analytics',  label: 'Analytics' },
  { href: '/bot',        label: 'Bots'      },
  { href: '/docs',       label: 'Docs'      },
]

export function Navbar() {
  const pathname = usePathname()
  const { muted, toggleSound, playClick } = useSoundEffects()

  return (
    <header className="sticky top-0 z-50 bg-[#070A10]/90 backdrop-blur-md border-b border-[#181F30] relative">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#10B981]/40 to-transparent" />
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" onClick={playClick} className="flex items-center gap-2.5 shrink-0 group">
          <img
            src="/logo.jpg"
            alt="AEON"
            className="w-9 h-9 rounded-lg object-cover transition-transform duration-300 group-hover:scale-105"
            style={{ boxShadow: '0 0 14px -2px rgba(16,185,129,0.5)' }}
          />
          <div className="flex flex-col">
            <span className="font-display font-extrabold text-lg text-white tracking-wide leading-none">AEON</span>
            <span className="text-[10px] font-mono text-emerald-400 font-semibold tracking-wider">ve(3,3) DEX</span>
          </div>
        </Link>

        {/* Desktop Nav links */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map(link => {
            const isActive = link.href === '/earn'
              ? (pathname === '/earn' || pathname.startsWith('/earn/') || pathname === '/liquidity' || pathname.startsWith('/liquidity/'))
              : (pathname === link.href || pathname.startsWith(link.href + '/'))
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={playClick}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150',
                  isActive
                    ? 'bg-[#151D2F] text-white border border-[#2B3854] shadow-[0_0_12px_-3px_rgba(16,185,129,0.4)]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#101524]'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </nav>

        {/* Right side widgets & Connect */}
        <div className="flex items-center gap-2.5">
          {/* Epoch countdown */}
          <EpochBadge />

          {/* Sound FX Toggle */}
          <button
            onClick={toggleSound}
            title={muted ? 'Enable sound effects' : 'Disable sound effects'}
            className="hidden sm:flex items-center justify-center w-9 h-9 rounded-lg bg-[#0D121F] border border-[#1C263C] text-slate-400 hover:text-white hover:border-slate-600 transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
          </button>

          {/* Wallet Connect */}
          <ConnectButton
            chainStatus="icon"
            showBalance={false}
            accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
          />
        </div>
      </div>

      {/* Mobile / Tablet scrollable nav */}
      <div className="lg:hidden border-t border-[#181F30] overflow-x-auto bg-[#070A10] no-scrollbar">
        <div className="flex px-4 py-2 gap-1 min-w-max">
          {NAV_LINKS.map(link => {
            const isActive = link.href === '/earn'
              ? (pathname === '/earn' || pathname.startsWith('/earn/') || pathname === '/liquidity' || pathname.startsWith('/liquidity/'))
              : (pathname === link.href || pathname.startsWith(link.href + '/'))
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={playClick}
                className={clsx(
                  'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                  isActive
                    ? 'bg-[#151D2F] text-white border border-[#2B3854]'
                    : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {link.label}
              </Link>
            )
          })}
        </div>
      </div>
    </header>
  )
}

function EpochBadge() {
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; mins: number; secs: number } | null>(null)

  useEffect(() => {
    const EPOCH_LENGTH = 7 * 24 * 60 * 60 * 1000
    const updateCountdown = () => {
      const now = Date.now()
      const epochStart = Math.floor(now / EPOCH_LENGTH) * EPOCH_LENGTH
      const remaining = epochStart + EPOCH_LENGTH - now
      const days = Math.floor(remaining / (24 * 60 * 60 * 1000))
      const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
      const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
      const secs = Math.floor((remaining % (60 * 1000)) / 1000)
      setTimeLeft({ days, hours, mins, secs })
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0D121F] border border-[#1C263C]">
      <div className="relative flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <div className="absolute w-2 h-2 rounded-full bg-emerald-400 animate-ping opacity-75" />
      </div>
      <div className="flex flex-col text-left">
        <span className="text-[9px] uppercase tracking-wider font-mono text-slate-400 leading-none">Epoch Ends In</span>
        <span className="text-xs font-mono font-bold text-white mt-0.5">
          {timeLeft ? `${timeLeft.days}d ${timeLeft.hours}h ${timeLeft.mins}m ${timeLeft.secs}s` : 'Calculating...'}
        </span>
      </div>
    </div>
  )
}
