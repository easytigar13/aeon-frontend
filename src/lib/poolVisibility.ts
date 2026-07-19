// A pool with less than one cent of priced reserves is economically empty.
// Keep `null` separate: it means the on-chain read or price is still pending,
// not that the pool has been confirmed empty.
export const MIN_VISIBLE_POOL_TVL_USD = 0.01

export function hasMeaningfulPoolLiquidity(tvlUsd: number | null): tvlUsd is number {
  return tvlUsd !== null && Number.isFinite(tvlUsd) && tvlUsd >= MIN_VISIBLE_POOL_TVL_USD
}

export function shouldDisplayPool(tvlUsd: number | null): boolean {
  return tvlUsd === null || hasMeaningfulPoolLiquidity(tvlUsd)
}
