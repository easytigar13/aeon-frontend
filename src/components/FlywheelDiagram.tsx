import { TrendingUp, Lock, Flame } from 'lucide-react'

// Three nodes sitting on a shared circle (r=140, center 200,200) so the
// connecting arcs trace one continuous loop through all of them.
const NODES = [
  { x: 200,   y: 60,  label: 'Trade',           sub: 'fees generated',    color: '#FFB800', Icon: TrendingUp },
  { x: 321.2, y: 270, label: 'Vote & Earn',      sub: '80% to voters',     color: '#A78BFA', Icon: Lock },
  { x: 78.8,  y: 270, label: 'Burn & Buyback',   sub: '20% burned/shared', color: '#34D399', Icon: Flame },
]

const LOOP_PATH = 'M 200,60 A 140,140 0 0,1 321.2,270 A 140,140 0 0,1 78.8,270 A 140,140 0 0,1 200,60'

export function FlywheelDiagram() {
  return (
    <svg viewBox="0 0 400 340" className="w-full max-w-md mx-auto" aria-hidden>
      <defs>
        <marker id="fw-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#5A5A60" />
        </marker>
        <radialGradient id="fw-dot-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFB800" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFB800" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Guide ring */}
      <circle cx="200" cy="200" r="140" fill="none" stroke="#23232D" strokeWidth="1.5" strokeDasharray="2 6" />

      {/* Directional loop path (three arcs sharing the guide circle) */}
      <path
        d={LOOP_PATH}
        fill="none"
        stroke="#3A3A44"
        strokeWidth="2"
        markerEnd="url(#fw-arrow)"
      />

      {/* Traveling glow dots */}
      {[0, 1, 2].map(i => (
        <g key={i}>
          <circle r="10" fill="url(#fw-dot-glow)">
            <animateMotion dur="9s" begin={`${i * 3}s`} repeatCount="indefinite" path={LOOP_PATH} />
          </circle>
          <circle r="3" fill="#FFE08A">
            <animateMotion dur="9s" begin={`${i * 3}s`} repeatCount="indefinite" path={LOOP_PATH} />
          </circle>
        </g>
      ))}

      {/* Nodes */}
      {NODES.map(n => (
        <g key={n.label} transform={`translate(${n.x}, ${n.y})`}>
          <circle r="34" fill="#111118" stroke={n.color} strokeOpacity="0.35" strokeWidth="1.5" />
          <circle r="34" fill={n.color} fillOpacity="0.06" />
          <foreignObject x="-14" y="-14" width="28" height="28">
            <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <n.Icon size={16} color={n.color} />
            </div>
          </foreignObject>
          <text y="54" textAnchor="middle" fontSize="13" fontWeight="600" fill="#F0EFE8" fontFamily="var(--font-display)">
            {n.label}
          </text>
          <text y="70" textAnchor="middle" fontSize="10" fill="#5A5A60" fontFamily="var(--font-mono)">
            {n.sub}
          </text>
        </g>
      ))}

      {/* Center label */}
      <text x="200" y="196" textAnchor="middle" fontSize="11" fill="#5A5A60" fontFamily="var(--font-mono)" letterSpacing="2">
        THE
      </text>
      <text x="200" y="216" textAnchor="middle" fontSize="15" fontWeight="700" fill="#FFB800" fontFamily="var(--font-display)" letterSpacing="1">
        FLYWHEEL
      </text>
    </svg>
  )
}
