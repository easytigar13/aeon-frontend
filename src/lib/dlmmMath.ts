// Client-side helpers for Trader Joe / LFJ Liquidity Book (joe-v2) DLMM math.
// Bin id 8388608 (2^23) is price ratio 1.0; each step multiplies/divides the
// price by (1 + binStep/10000). Used only for UI previews.

export const ID_ONE = 8388608

export function binIdToPrice(id: number, binStep: number, decimalsX: number, decimalsY: number): number {
  const rawPrice = Math.pow(1 + binStep / 10000, id - ID_ONE)
  return rawPrice * Math.pow(10, decimalsX - decimalsY)
}
