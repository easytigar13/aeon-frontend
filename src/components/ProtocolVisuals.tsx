import type { ReactNode } from 'react'
import { clsx } from 'clsx'

export type ProtocolAccent = 'emerald' | 'blue' | 'aeon' | 'violet' | 'red'

const ACCENTS: Record<ProtocolAccent, { text: string; border: string; iconBg: string; glow: string }> = {
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/30', iconBg: 'bg-emerald-500/15', glow: 'rgba(16,185,129,0.35)' },
  blue:    { text: 'text-blue-400',    border: 'border-blue-500/30',    iconBg: 'bg-blue-500/15',    glow: 'rgba(59,130,246,0.35)' },
  aeon:    { text: 'text-aeon-400',    border: 'border-aeon-400/30',    iconBg: 'bg-aeon-400/15',    glow: 'rgba(255,184,0,0.35)' },
  violet:  { text: 'text-violet-400',  border: 'border-violet-500/30',  iconBg: 'bg-violet-500/15',  glow: 'rgba(139,92,246,0.35)' },
  red:     { text: 'text-red-400',     border: 'border-red-500/30',     iconBg: 'bg-red-500/15',     glow: 'rgba(239,68,68,0.35)' },
}

export function ProtocolBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-aeon-glow" />
      <div className="absolute inset-0 bg-violet-glow" style={{ transform: 'scaleY(-1)' }} />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 40px 60px, rgba(240,239,232,0.6) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 140px 20px, rgba(240,239,232,0.4) 1px, transparent 0),' +
            'radial-gradient(1.5px 1.5px at 90px 140px, rgba(240,239,232,0.5) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 190px 100px, rgba(240,239,232,0.3) 1px, transparent 0)',
          backgroundSize: '220px 220px',
        }}
      />
    </div>
  )
}

export function MetricCard({ label, value, detail, icon, accent }: {
  label: string
  value: string
  detail: string
  icon: ReactNode
  accent: ProtocolAccent
}) {
  const a = ACCENTS[accent]
  return (
    <div
      className={clsx('group relative min-w-0 overflow-hidden rounded-2xl border bg-bg-surface p-4 transition-all duration-300 hover:-translate-y-1', a.border)}
      style={{ boxShadow: `0 0 32px -12px ${a.glow}` }}
    >
      <div className="absolute inset-x-0 top-0 h-20 opacity-60 pointer-events-none" style={{ background: `linear-gradient(to bottom, ${a.glow}, transparent)` }} />
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-300 animate-shimmer"
        style={{ background: `linear-gradient(115deg, transparent 30%, ${a.glow} 50%, transparent 70%)`, backgroundSize: '200% 100%' }}
      />
      <div className="relative flex items-center justify-between mb-3">
        <span className="stat-label">{label}</span>
        <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center border transition-transform duration-300 group-hover:scale-110', a.iconBg, a.border)}>{icon}</div>
      </div>
      <div className="relative stat-value text-2xl mb-1 tracking-tight" style={{ textShadow: `0 0 24px ${a.glow}` }}>{value}</div>
      <div className={clsx('relative text-2xs font-mono break-words', a.text)}>{detail}</div>
    </div>
  )
}

export function GlowPanel({ children, accent = 'aeon', className }: {
  children: ReactNode
  accent?: ProtocolAccent
  className?: string
}) {
  const a = ACCENTS[accent]
  return (
    <div
      className={clsx('card relative overflow-hidden', a.border, className)}
      style={{ boxShadow: `0 0 38px -22px ${a.glow}` }}
    >
      <div className="absolute inset-x-0 top-0 h-24 opacity-40 pointer-events-none" style={{ background: `linear-gradient(to bottom, ${a.glow}, transparent)` }} />
      <div className="relative">{children}</div>
    </div>
  )
}
