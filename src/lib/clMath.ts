// Client-side helpers for Algebra Integral (Uniswap-V3-style) concentrated
// liquidity math. Used only for UI previews — the on-chain pool computes the
// authoritative amounts at mint time, so small float error here is harmless.

export const Q96 = 2n ** 96n
export const MIN_TICK = -887272
export const MAX_TICK = 887272
// getSqrtRatioAtTick(MIN_TICK) / getSqrtRatioAtTick(MAX_TICK) — TickMath.sol
export const MIN_SQRT_RATIO = 4295128739n
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n

export function tickToSqrtPriceX96(tick: number): bigint {
  if (tick <= MIN_TICK) return MIN_SQRT_RATIO
  if (tick >= MAX_TICK) return MAX_SQRT_RATIO
  const sqrtPrice = Math.pow(1.0001, tick / 2)
  const PREC = 1e12
  const scaled = BigInt(Math.round(sqrtPrice * PREC))
  return (scaled * Q96) / BigInt(PREC)
}

// Nearest usable tick for "currentTick shifted by pct%", rounded to a multiple
// of tickSpacing. pct <= -99.9 / >= 9999 are treated as the full-range presets.
export function priceOffsetToTick(currentTick: number, pct: number, tickSpacing: number, roundUp: boolean): number {
  if (pct <= -99.9) return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing
  if (pct >= 9999) return Math.floor(MAX_TICK / tickSpacing) * tickSpacing
  const tickDelta = Math.log(1 + pct / 100) / Math.log(1.0001)
  const rawTick = currentTick + tickDelta
  const spacingFn = roundUp ? Math.ceil : Math.floor
  const tick = spacingFn(rawTick / tickSpacing) * tickSpacing
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick))
}

// Convert a raw on-chain tick to a human-readable price (token1 per 1 token0,
// decimal-adjusted) and back — used for custom min/max price range inputs.
export function tickToPrice(tick: number, decimals0: number, decimals1: number): number {
  const rawPrice = Math.pow(1.0001, tick)
  return rawPrice * Math.pow(10, decimals0 - decimals1)
}
export function priceToTick(price: number, decimals0: number, decimals1: number, tickSpacing: number, roundUp: boolean): number {
  if (!(price > 0)) return roundUp ? MAX_TICK : MIN_TICK
  const rawPrice = price * Math.pow(10, decimals1 - decimals0)
  const rawTick = Math.log(rawPrice) / Math.log(1.0001)
  const spacingFn = roundUp ? Math.ceil : Math.floor
  const tick = spacingFn(rawTick / tickSpacing) * tickSpacing
  return Math.max(MIN_TICK, Math.min(MAX_TICK, tick))
}

function sortAB(sqrtA: bigint, sqrtB: bigint): [bigint, bigint] {
  return sqrtA > sqrtB ? [sqrtB, sqrtA] : [sqrtA, sqrtB]
}
export function liquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [a, b] = sortAB(sqrtA, sqrtB)
  const intermediate = (a * b) / Q96
  return (amount0 * intermediate) / (b - a)
}
export function liquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [a, b] = sortAB(sqrtA, sqrtB)
  return (amount1 * Q96) / (b - a)
}

// Mirrors LiquidityAmounts.getLiquidityForAmounts — the min-of-both-sides
// liquidity the contract would actually mint for a given pair of amounts.
export function liquidityForAmounts(sqrtPriceX96: bigint, tickLower: number, tickUpper: number, amount0: bigint, amount1: bigint): bigint {
  const [a, b] = sortAB(tickToSqrtPriceX96(tickLower), tickToSqrtPriceX96(tickUpper))
  if (sqrtPriceX96 <= a) return liquidityForAmount0(a, b, amount0)
  if (sqrtPriceX96 >= b) return liquidityForAmount1(a, b, amount1)
  const L0 = liquidityForAmount0(sqrtPriceX96, b, amount0)
  const L1 = liquidityForAmount1(a, sqrtPriceX96, amount1)
  return L0 < L1 ? L0 : L1
}
export function amount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, L: bigint): bigint {
  const [a, b] = sortAB(sqrtA, sqrtB)
  return ((L << 96n) * (b - a)) / b / a
}
export function amount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, L: bigint): bigint {
  const [a, b] = sortAB(sqrtA, sqrtB)
  return (L * (b - a)) / Q96
}

// Mirrors LiquidityAmounts.getAmountsForLiquidity — the current token0/token1
// amounts a live position's liquidity represents at the pool's current price.
// Used to value existing positions (e.g. in Portfolio), not just new mints.
export function amountsForLiquidity(sqrtPriceX96: bigint, tickLower: number, tickUpper: number, liquidity: bigint): { amount0: bigint; amount1: bigint } {
  const [a, b] = sortAB(tickToSqrtPriceX96(tickLower), tickToSqrtPriceX96(tickUpper))
  if (sqrtPriceX96 <= a) return { amount0: amount0ForLiquidity(a, b, liquidity), amount1: 0n }
  if (sqrtPriceX96 >= b) return { amount0: 0n, amount1: amount1ForLiquidity(a, b, liquidity) }
  return {
    amount0: amount0ForLiquidity(sqrtPriceX96, b, liquidity),
    amount1: amount1ForLiquidity(a, sqrtPriceX96, liquidity),
  }
}

export type RangeSide = 'token0' | 'token1' | 'both'

export function rangeSide(tickLower: number, currentTick: number, tickUpper: number): RangeSide {
  if (currentTick < tickLower) return 'token0'
  if (currentTick >= tickUpper) return 'token1'
  return 'both'
}

// Given one side's desired amount, compute the paired amount for the other
// side so both sides get used efficiently at the pool's current price.
export function pairedAmount(opts: {
  amountIn: bigint
  isAmount0: boolean
  tickLower: number
  tickUpper: number
  currentTick: number
  sqrtPriceX96: bigint
}): bigint {
  const { amountIn, isAmount0, tickLower, tickUpper, currentTick, sqrtPriceX96 } = opts
  const side = rangeSide(tickLower, currentTick, tickUpper)
  if (side !== 'both') return 0n

  const sqrtA = tickToSqrtPriceX96(tickLower)
  const sqrtB = tickToSqrtPriceX96(tickUpper)

  if (isAmount0) {
    const L = liquidityForAmount0(sqrtPriceX96, sqrtB, amountIn)
    return amount1ForLiquidity(sqrtA, sqrtPriceX96, L)
  } else {
    const L = liquidityForAmount1(sqrtA, sqrtPriceX96, amountIn)
    return amount0ForLiquidity(sqrtPriceX96, sqrtB, L)
  }
}

// Rough Uniswap-V3-style capital-efficiency multiplier for a symmetric %
// range vs. providing across the full range — used only for the APR estimate.
export function concentrationMultiplier(halfWidthPct: number): number {
  if (halfWidthPct >= 99) return 1
  const r = halfWidthPct / 100
  const denom = 1 - Math.sqrt(1 - r)
  return denom > 0 ? Math.min(1 / denom, 500) : 500
}
