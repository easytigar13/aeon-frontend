'use client'
import { useEffect, useState } from 'react'

// One-shot particle burst for celebrating a completed on-chain action (swap,
// add liquidity, claim, etc). Pure CSS -- no canvas/animation library --
// mounted only while `trigger` is true and auto-unmounts itself after the
// animation finishes, so it never lingers or blocks clicks underneath it.
const COLORS = ['#FFB800', '#34D399', '#A78BFA', '#60A5FA', '#F87171']

export function ConfettiBurst({ trigger }: { trigger: boolean }) {
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; rot: number; color: string; delay: number }[]>([])

  useEffect(() => {
    if (!trigger) return
    const next = Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 260,
      y: -(Math.random() * 180 + 60),
      rot: (Math.random() - 0.5) * 540,
      color: COLORS[i % COLORS.length],
      delay: Math.random() * 0.15,
    }))
    setParticles(next)
    const t = setTimeout(() => setParticles([]), 1100)
    return () => clearTimeout(t)
  }, [trigger])

  if (particles.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible z-20">
      {particles.map(p => (
        <span
          key={p.id}
          className="absolute left-1/2 top-1/2 rounded-sm"
          style={{
            width: 6,
            height: 10,
            background: p.color,
            animation: `confetti-burst 0.9s ease-out ${p.delay}s forwards`,
            // @ts-expect-error -- custom properties read by the keyframe below
            '--tx': `${p.x}px`,
            '--ty': `${p.y}px`,
            '--rot': `${p.rot}deg`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes confetti-burst {
          0% { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-50%, -50%) translate(var(--tx), calc(var(--ty) + 140px)) rotate(var(--rot)); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
