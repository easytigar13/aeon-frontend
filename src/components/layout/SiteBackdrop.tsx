// Fixed, sitewide atmosphere layer -- every page previously sat on a flat
// #0A0A0F with zero background treatment except a couple of pages that built
// their own local glow blobs. Rendered once in the root layout instead, so
// every route (including ones nobody's touched yet) gets the same living
// backdrop for free: slow-drifting gold/violet/emerald glow orbs plus a very
// faint starfield, all pointer-events-none and behind everything (-z-10).
export function SiteBackdrop() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 bg-bg-base" />
      <div
        className="absolute w-[1100px] h-[1100px] rounded-full blur-[150px] opacity-[0.22] animate-drift-a"
        style={{ background: '#FFB800', top: '-25%', left: '-15%' }}
      />
      <div
        className="absolute w-[850px] h-[850px] rounded-full blur-[150px] opacity-[0.18] animate-drift-b"
        style={{ background: '#8B5CF6', top: '25%', right: '-20%' }}
      />
      <div
        className="absolute w-[750px] h-[750px] rounded-full blur-[150px] opacity-[0.14] animate-drift-c"
        style={{ background: '#10B981', bottom: '-20%', left: '15%' }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,184,0,0.035) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,184,0,0.035) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 75%)',
        }}
      />
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
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 100% 60% at 50% 0%, transparent 0%, rgba(10,10,15,0.5) 100%)' }} />
    </div>
  )
}
