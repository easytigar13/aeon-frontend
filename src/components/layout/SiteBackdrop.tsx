// Fixed, sitewide atmosphere layer -- rendered once in the root layout so
// every route gets it for free. Built to read as a sci-fi HUD/circuit-board
// scene (glowing node-and-trace mesh + nebula wash + a slow vertical scan
// beam) rather than a plain blurred-blob gradient. Fully static (no
// Math.random()/Date.now()), so there's no SSR/hydration mismatch risk.
export function SiteBackdrop() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-bg-base" />

      {/* Nebula wash -- green-dominant with a cyan accent for a techy cast */}
      <div
        className="absolute w-[1150px] h-[1150px] rounded-full blur-[150px] opacity-[0.24] animate-drift-a"
        style={{ background: '#10B981', top: '-25%', left: '-15%' }}
      />
      <div
        className="absolute w-[900px] h-[900px] rounded-full blur-[150px] opacity-[0.18] animate-drift-c"
        style={{ background: '#22D3EE', bottom: '-20%', left: '10%' }}
      />
      <div
        className="absolute w-[800px] h-[800px] rounded-full blur-[150px] opacity-[0.13] animate-drift-b"
        style={{ background: '#8B5CF6', top: '20%', right: '-20%' }}
      />
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[150px] opacity-[0.09] animate-drift-b"
        style={{ background: '#FFB800', top: '45%', left: '35%' }}
      />

      {/* Circuit/network mesh -- the actual "futuristic" signal: glowing
          traces with pulsing node pads, tiled across the whole screen. */}
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <defs>
          <pattern id="circuitMesh" width="220" height="220" patternUnits="userSpaceOnUse">
            <path d="M0,60 H80 V0" stroke="#10B981" strokeOpacity="0.28" strokeWidth="1" fill="none" />
            <path d="M80,60 V150 H220" stroke="#22D3EE" strokeOpacity="0.22" strokeWidth="1" fill="none" />
            <path d="M150,220 V180 H0" stroke="#10B981" strokeOpacity="0.22" strokeWidth="1" fill="none" />
            <path d="M220,100 H170 V220" stroke="#22D3EE" strokeOpacity="0.2" strokeWidth="1" fill="none" />
            <path d="M30,220 V190" stroke="#10B981" strokeOpacity="0.18" strokeWidth="1" fill="none" />
            <rect x="74" y="54" width="12" height="12" rx="2" stroke="#22D3EE" strokeOpacity="0.35" strokeWidth="1" fill="none" />
            <circle cx="80" cy="60" r="2.5" fill="#10B981" fillOpacity="0.6" />
            <circle cx="80" cy="150" r="2.5" fill="#22D3EE" fillOpacity="0.5" />
            <circle cx="150" cy="180" r="2.5" fill="#10B981" fillOpacity="0.5" />
            <circle cx="170" cy="100" r="2.5" fill="#22D3EE" fillOpacity="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#circuitMesh)" />
        {/* A few brighter pulsing nodes for a "live signal" feel -- positions
            are fixed fractions of the viewport so they scale with any screen
            size without needing JS measurement. */}
        <circle cx="12%" cy="18%" r="3" fill="#34D399" className="animate-node-pulse" style={{ filter: 'drop-shadow(0 0 6px #34D399)' }} />
        <circle cx="68%" cy="34%" r="2.5" fill="#22D3EE" className="animate-node-pulse" style={{ filter: 'drop-shadow(0 0 6px #22D3EE)', animationDelay: '1s' }} />
        <circle cx="85%" cy="72%" r="3" fill="#34D399" className="animate-node-pulse" style={{ filter: 'drop-shadow(0 0 6px #34D399)', animationDelay: '2s' }} />
        <circle cx="30%" cy="80%" r="2.5" fill="#22D3EE" className="animate-node-pulse" style={{ filter: 'drop-shadow(0 0 6px #22D3EE)', animationDelay: '0.5s' }} />
      </svg>

      {/* Slow vertical scan beam -- classic HUD sweep */}
      <div
        className="absolute inset-x-0 top-0 h-[40vh] opacity-[0.05] animate-scan"
        style={{ background: 'linear-gradient(to bottom, transparent, #22D3EE, transparent)' }}
      />

      {/* Faint starfield dust for depth */}
      <div
        className="absolute inset-0 opacity-[0.3]"
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
