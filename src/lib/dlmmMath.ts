// Client-side helpers for Trader Joe / LFJ Liquidity Book (joe-v2) DLMM math.
// Bin id 8388608 (2^23) is price ratio 1.0; each step multiplies/divides the
// price by (1 + binStep/10000). Used only for UI previews.

export const ID_ONE = 8388608

export function binIdToPrice(id: number, binStep: number, decimalsX: number, decimalsY: number): number {
  const rawPrice = Math.pow(1 + binStep / 10000, id - ID_ONE)
  return rawPrice * Math.pow(10, decimalsX - decimalsY)
}

export function priceToBinId(price: number, binStep: number, decimalsX: number, decimalsY: number): number {
  if (!(price > 0)) return ID_ONE
  const rawPrice = price * Math.pow(10, decimalsY - decimalsX)
  const delta = Math.round(Math.log(rawPrice) / Math.log(1 + binStep / 10000))
  return ID_ONE + delta
}

export type DlmmRangeSide = 'x' | 'y' | 'both'

export function dlmmRangeSide(binOffsetLower: number, binOffsetUpper: number): DlmmRangeSide {
  if (binOffsetLower > 0) return 'x'
  if (binOffsetUpper < 0) return 'y'
  return 'both'
}

// A "spot" (uniform) liquidity shape across [activeId+binOffsetLower, activeId+binOffsetUpper]:
// every bin at or below the active bin holds an even share of Y, every bin at or
// above holds an even share of X (the active bin, if included, holds both).
export function computeSpotDistribution(binOffsetLower: number, binOffsetUpper: number) {
  const deltaIds: number[] = []
  for (let d = binOffsetLower; d <= binOffsetUpper; d++) deltaIds.push(d)

  const yCount = deltaIds.filter(d => d <= 0).length
  const xCount = deltaIds.filter(d => d >= 0).length

  function evenShares(n: number): bigint[] {
    if (n === 0) return []
    const total = 10n ** 18n
    const base = total / BigInt(n)
    const shares = new Array(n).fill(base) as bigint[]
    shares[n - 1] += total - base * BigInt(n) // remainder to the last share, exact sum
    return shares
  }

  const yShares = evenShares(yCount)
  const xShares = evenShares(xCount)

  let yi = 0, xi = 0
  const distributionX: bigint[] = []
  const distributionY: bigint[] = []
  for (const d of deltaIds) {
    distributionY.push(d <= 0 ? yShares[yi++] : 0n)
    distributionX.push(d >= 0 ? xShares[xi++] : 0n)
  }

  return { deltaIds, distributionX, distributionY }
}
