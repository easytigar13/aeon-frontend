export interface EmissionProjectionInput {
  feeHistoryUSD: Array<number | null>
  feeHistoryIndex: number
  liveEpochFeesUSD: number | null
  previousMintAeon: number
  aeonPriceUSD: number | null
}

// Mirrors MultiGaugeEmissionsEngineRH.updatePeriod(), but first inserts the
// current live fee estimate into the exact rolling-history slot the next
// epoch flip will overwrite. This makes the UI genuinely forward-looking
// instead of calculating "next epoch" from last epoch's history alone.
export function projectNextEmission({
  feeHistoryUSD,
  feeHistoryIndex,
  liveEpochFeesUSD,
  previousMintAeon,
  aeonPriceUSD,
}: EmissionProjectionInput) {
  const projectedHistory = [...feeHistoryUSD]
  while (projectedHistory.length < 3) projectedHistory.push(null)

  if (liveEpochFeesUSD !== null && Number.isFinite(liveEpochFeesUSD)) {
    projectedHistory[feeHistoryIndex % 3] = Math.max(0, liveEpochFeesUSD)
  }

  const nonZeroFees = projectedHistory.filter((value): value is number => value !== null && value > 0)
  const smoothedFeesUSD = nonZeroFees.length > 0
    ? nonZeroFees.reduce((sum, value) => sum + value, 0) / nonZeroFees.length
    : 0
  const emissionBudgetUSD = smoothedFeesUSD / 10
  const rawMintAeon = aeonPriceUSD && aeonPriceUSD > 0 ? emissionBudgetUSD / aeonPriceUSD : 0
  const capAeon = previousMintAeon > 0 ? previousMintAeon * 3 : Number.POSITIVE_INFINITY
  const projectedMintAeon = Math.min(rawMintAeon, capAeon)

  return {
    projectedHistory,
    smoothedFeesUSD,
    emissionBudgetUSD,
    rawMintAeon,
    capAeon,
    projectedMintAeon,
    circuitBreakerActive: rawMintAeon > capAeon,
  }
}
