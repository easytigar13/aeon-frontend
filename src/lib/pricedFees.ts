// Only fees paid in oracle-priced tokens count toward the protocol's
// lastEpochFeesUSD (and therefore toward the 25% emission mint). A pool's swap
// fees accrue in BOTH of its tokens (fee is taken on each swap's input token),
// so we approximate the priced share as ~half per priced side — the same
// even-ish directional split the FeeDistributor sees in aggregate. Examples:
//   AEON/USDG  -> both priced   -> 1.0  (all fees count)
//   CASHCAT/USDG -> USDG priced  -> 0.5  (only the USDG-side fees count)
//   CASHCAT/ROBINFUN -> neither  -> 0.0  ($0 toward emissions, though voters/LPs
//                                         still receive these fees in-kind)
export function pricedFeeFraction(
  token0: string,
  token1: string,
  priced: Set<string>,
): number {
  return (priced.has(token0) ? 0.5 : 0) + (priced.has(token1) ? 0.5 : 0)
}

interface FeePoolLike { address: string; token0: string; token1: string; fee: string }

// Sum of the oracle-priced portion of each pool's live in-epoch fees, mirroring
// what the protocol will actually finalize into lastEpochFeesUSD. `feeRateOf`
// converts a pool's fee string (e.g. "0.25%") to a fraction; `feesRawFor`
// returns that pool's estimated total (all-token) fees USD for the window.
export function pricedFeesUsd(
  pools: FeePoolLike[],
  priced: Set<string>,
  feeRateOf: (fee: string) => number,
  feesRawFor: (pool: FeePoolLike) => number | null | undefined,
): number {
  return pools.reduce((sum, p) => {
    const raw = feesRawFor(p)
    if (raw === null || raw === undefined) return sum
    return sum + raw * pricedFeeFraction(p.token0, p.token1, priced)
  }, 0)
}
