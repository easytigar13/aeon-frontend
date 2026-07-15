export interface EmissionProjectionInput {
  lastFeesUSD: number | null
  liveEpochFeesUSD: number | null
  aeonPriceUSD: number | null
}

// Mirrors VoteDirectedLpEmissionsEngineRH.updatePeriod()/previewMint(): the
// next mint is exactly 25% of that epoch's finalized USD fees, converted to
// AEON at the current price -- no rolling average, no previous-mint growth
// cap (both removed when this engine replaced the old smoothed one on
// 2026-07-13). Prefers the live in-epoch fee estimate when available so the
// UI stays forward-looking instead of only reflecting the last finalized
// epoch's number.
export function projectNextEmission({
  lastFeesUSD,
  liveEpochFeesUSD,
  aeonPriceUSD,
}: EmissionProjectionInput) {
  const feesUSD = liveEpochFeesUSD !== null && Number.isFinite(liveEpochFeesUSD)
    ? Math.max(0, liveEpochFeesUSD)
    : (lastFeesUSD ?? 0)

  const emissionBudgetUSD = feesUSD * 0.25
  const projectedMintAeon = aeonPriceUSD && aeonPriceUSD > 0 ? emissionBudgetUSD / aeonPriceUSD : 0

  return {
    feesUSD,
    emissionBudgetUSD,
    projectedMintAeon,
  }
}
