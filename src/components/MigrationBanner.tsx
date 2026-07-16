import { AlertTriangle } from 'lucide-react'

// Shown on Vote/Earn/Dashboard while AeonVoterV3 (furnace-double-count-vote
// fix) is staged but not yet cut over. See aeon-protocol-v5/MIGRATION_V3_CHECKLIST.md.
// Remove once CutoverV3.s.sol has run and the frontend's live addresses are
// updated to point at the new voter/engine/fee distributor.
export function MigrationBanner() {
  return (
    <div className="mb-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-2.5">
      <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
      <div className="text-xs text-amber-200/90 leading-relaxed">
        <span className="font-semibold text-amber-300">Voter migration in progress.</span>{' '}
        A fix for a vote-power exploit is staged and ready. Everything you see here
        (votes, emissions, fees) is still running on the current, fully-functional
        system — nothing changes until cutover. New gauges are already live on the{' '}
        <a href="/earn" className="underline hover:text-amber-100">Earn page</a> if you
        want to stake ahead of time (they earn 0 emissions until cutover). Voting itself
        will flip in a single announced moment — you'll need to re-vote right after.
      </div>
    </div>
  )
}
