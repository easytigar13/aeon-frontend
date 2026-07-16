import { CheckCircle2 } from 'lucide-react'

// Shown on Vote/Earn/Dashboard after the 2026-07-16 AeonVoterV3 cutover
// (fixes the furnace multi-veNFT vote-power double-count exploit). See
// aeon-protocol-v5/MIGRATION_V3_CHECKLIST.md. Remove once LPs/voters have
// finished migrating over and this stops being useful context.
export function MigrationBanner() {
  return (
    <div className="mb-4 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-start gap-2.5">
      <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
      <div className="text-xs text-emerald-200/90 leading-relaxed">
        <span className="font-semibold text-emerald-300">Voter migration is live.</span>{' '}
        The furnace vote-power exploit fix has been cut over — this is now the real,
        emitting system. If you had LP staked in an old gauge, it's no longer earning
        emissions: unstake it and restake into the New gauge on the{' '}
        <a href="/earn" className="underline hover:text-emerald-100">Earn page</a> (Old/New
        toggle). If you voted before the cutover, you'll need to vote again here — old
        votes didn't carry over to the new voter contract.
      </div>
    </div>
  )
}
