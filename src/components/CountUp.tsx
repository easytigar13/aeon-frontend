'use client'
import { useEffect, useRef, useState } from 'react'

// Animates a numeric display towards `value` whenever it changes (from
// whatever was last displayed, not always from 0 — so live updates glide
// instead of restarting). Renders `nullText` until a real value arrives.
export function CountUp({
  value,
  format,
  nullText = '',
  duration = 900,
}: {
  value: number | null
  format: (n: number) => string
  nullText?: string
  duration?: number
}) {
  const [display, setDisplay] = useState<number | null>(null)
  const fromRef = useRef(0)

  useEffect(() => {
    if (value === null) return
    const from = fromRef.current
    const to = value
    const start = performance.now()
    let raf: number
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  if (value === null) return <>{nullText}</>
  return <>{format(display ?? 0)}</>
}
