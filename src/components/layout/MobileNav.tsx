'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import { ArrowLeftRight, Droplets, Vote, Lock, LayoutDashboard, BarChart2 } from 'lucide-react'

const MOBILE_ITEMS = [
  { href: '/swap',       label: 'Swap',      icon: ArrowLeftRight },
  { href: '/earn',       label: 'Pools',     icon: Droplets       },
  { href: '/vote',       label: 'Vote',      icon: Vote           },
  { href: '/lock',       label: 'Lock',      icon: Lock           },
  { href: '/dashboard',  label: 'Portfolio', icon: LayoutDashboard},
  { href: '/analytics',  label: 'Analytics', icon: BarChart2      },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-[#070A10]/95 backdrop-blur-xl border-t border-[#181F30] px-2 py-1.5 pb-safe">
      <div className="flex items-center justify-around">
        {MOBILE_ITEMS.map(item => {
          const Icon = item.icon
          const isActive = item.href === '/earn'
            ? (pathname === '/earn' || pathname.startsWith('/earn/') || pathname === '/liquidity' || pathname.startsWith('/liquidity/'))
            : (pathname === item.href || pathname.startsWith(item.href + '/'))

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex flex-col items-center justify-center py-1 px-2 rounded-lg text-2xs font-medium transition-all duration-150 relative min-w-[52px]',
                isActive
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {isActive && (
                <div className="absolute -top-1 w-6 h-0.5 bg-gradient-to-r from-emerald-400 to-sky-400 rounded-full" />
              )}
              <Icon className={clsx('w-5 h-5 mb-0.5 transition-transform', isActive && 'scale-110 text-emerald-400')} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
