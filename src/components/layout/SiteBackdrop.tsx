// High-performance pitch-black sitewide backdrop
// Eliminates heavy 150px blur GPU composite lag & rendering glitches
export function SiteBackdrop() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none bg-[#070A10]">
      {/* High-performance Ramses ambient radial glow */}
      <div
        className="absolute w-[900px] h-[900px] rounded-full opacity-[0.12]"
        style={{
          background: 'radial-gradient(circle, rgba(56,189,248,0.2) 0%, rgba(7,10,16,0) 70%)',
          top: '-25%',
          left: '15%',
        }}
      />
      <div
        className="absolute w-[700px] h-[700px] rounded-full opacity-[0.08]"
        style={{
          background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, rgba(7,10,16,0) 70%)',
          bottom: '-15%',
          right: '15%',
        }}
      />
    </div>
  )
}
