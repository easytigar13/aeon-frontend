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
        className="absolute w-[900px] h-[900px] rounded-full blur-[160px] opacity-[0.10] animate-drift-a"
        style={{ background: '#FFB800', top: '-20%', left: '-10%' }}
      />
      <div
        className="absolute w-[700px] h-[700px] rounded-full blur-[160px] opacity-[0.08] animate-drift-b"
        style={{ background: '#8B5CF6', top: '30%', right: '-15%' }}
      />
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[160px] opacity-[0.06] animate-drift-c"
        style={{ background: '#10B981', bottom: '-15%', left: '20%' }}
      />
      <div
        className="absolute inset-0 opacity-[0.25]"
        style={{
          backgroundImage:
            'radial-gradient(1px 1px at 40px 60px, rgba(240,239,232,0.5) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 140px 20px, rgba(240,239,232,0.35) 1px, transparent 0),' +
            'radial-gradient(1.5px 1.5px at 90px 140px, rgba(240,239,232,0.4) 1px, transparent 0),' +
            'radial-gradient(1px 1px at 190px 100px, rgba(240,239,232,0.25) 1px, transparent 0)',
          backgroundSize: '220px 220px',
        }}
      />
    </div>
  )
}
