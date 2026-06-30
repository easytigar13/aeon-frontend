export function Sparkline({
  prices,
  positive = true,
  width = 120,
  height = 40,
}: {
  prices: number[]
  positive?: boolean
  width?: number
  height?: number
}) {
  if (prices.length < 2) return null

  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || Math.abs(min) * 0.001 || 1

  const pad = 2
  const pts = prices.map((p, i) => ({
    x: (i / (prices.length - 1)) * width,
    y: height - pad - ((p - min) / range) * (height - pad * 2),
  }))

  // Smooth cubic bezier through all points
  let d = `M ${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const cur = pts[i]
    const cpx = (prev.x + cur.x) / 2
    d += ` C ${cpx},${prev.y} ${cpx},${cur.y} ${cur.x},${cur.y}`
  }
  const fillD = `${d} L ${width},${height} L 0,${height} Z`

  const color = positive ? '#34D399' : '#EF4444'
  const gradId = positive ? 'spark-pos' : 'spark-neg'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
