'use client'
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { POOLS, CL_POOLS, DLMM_POOLS, UNISWAP_POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI, ALGEBRA_POOL_ABI, LB_PAIR_ABI } from '@/config/abis'

export interface RouteStep {
  poolAddress: `0x${string}`
  tokenIn:  string   // TOKENS key (never 'ETH' — use 'WETH')
  tokenOut: string
  feeBps:   bigint
  poolType: number   // 0 = vAMM, 1 = CL, 2 = DLMM, 3 = external UniV2 — matches AeonUniversalRouter.Hop.poolType
  binStep:  number   // DLMM only
}

export interface BestRoute {
  steps:        RouteStep[]
  amountOut:    bigint
  priceImpact:  number   // percent, computed across the whole path (not just the first hop)
  label:        string   // e.g. "AEON → WETH → USDG"
  via:          string   // pool name(s)
  // Present when this route prioritizes our own pool over the theoretical
  // best route -- see the "priority split" comment below. Absent means a
  // plain single route (possibly still multi-hop), same as before.
  split?: {
    aeonStep:            RouteStep
    aeonAmountIn:        bigint
    aeonAmountOut:       bigint
    remainderSteps:      RouteStep[]
    remainderAmountIn:   bigint
    remainderAmountOut:  bigint
  }
}

export interface RoutingResult {
  best:     BestRoute | null  // best route across all pool types (vAMM + CL + DLMM + Uniswap),
                              // possibly a priority split (see `split` on BestRoute)
  vammOnly: BestRoute | null  // best route restricted to vAMM — the fallback for ETH-output
                              // swaps, since AeonSwapUnwrapHelper only knows how to call
                              // AeonRouterRH (poolType 0), not the newer mixed-type router.
                              // Never a split (SwapUnwrapHelper can't call the split function either).
}

// Exhaustive path search across vAMM, CL, DLMM, and real external Uniswap V2
// pools together — AeonRouterRH can only ever execute poolType 0 (vAMM), but
// AeonUniversalRouter (deployed 2026-07-05, redeployed same day to add
// poolType 3 for Uniswap) can chain hops across all four, so this search no
// longer needs to exclude any of them. Uniswap pools use the same simple
// reserve-pair shape as our own vAMM pools (real getReserves()/token0()) — CL
// and DLMM don't, so each of those hops' expected output is approximated
// using "virtual reserves" derived from real on-chain state:
//   - CL:   virtualReserve0 = liquidity * 2^96 / sqrtPriceX96,
//           virtualReserve1 = liquidity * sqrtPriceX96 / 2^96
//           (the standard Uniswap V3/Algebra identity for the CURRENT active
//           tick's local liquidity — accurate for trades that stay within it,
//           which is the normal case for routing-sized comparisons here).
//   - DLMM: the active bin's own (reserveX, reserveY) from getBin(activeId) —
//           same "local constant-product" approximation, accurate as long as
//           the trade doesn't cross out of the active bin.
// This is a ranking/quoting approximation only — actual execution still goes
// through AeonUniversalRouter/AeonRouterRH with real on-chain amountOutMin
// slippage protection, so an imperfect estimate here can't cause fund loss,
// only pick a slightly suboptimal route in a rare edge case.
//
// Priority split (added 2026-07-05): a pure best-price search sends most
// volume on overlapping pairs (e.g. ETH/USDG) straight to Uniswap's real
// pair, since our own vAMM/CL/DLMM pools there are currently far shallower.
// Product decision: prioritize filling from our own pool first, and only
// spill the remainder to whichever route is best, capped so the BLENDED
// output never falls further behind the theoretical best route than the
// user's own slippage tolerance allows. Mechanically: binary-search the max
// amount sendable to our own direct pool such that
// (ourPoolOutput + bestRemainderRouteOutput) >= bestRoute * (1 - tolerance).
// Only applies when we actually have a direct (single-hop) pool for the
// exact pair being traded — Uniswap-only pairs (no AEON equivalent, e.g.
// WETH/VIRTUAL) are untouched by this and still just use the best route.
const MAX_HOPS = 3

type UnifiedPool = {
  address: `0x${string}`
  name: string
  token0: string
  token1: string
  fee: string
  poolType: number
  binStep: number
}

function feeToBps(fee: string): bigint {
  return BigInt(Math.round(parseFloat(fee) * 100))
}

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

const Q96 = 1n << 96n

export function useRouting(
  tokenInKey:  string,
  tokenOutKey: string,
  amountIn:    bigint,
  slippagePct: number = 0.5,   // percent, e.g. 0.5 for 0.5% — caps the priority-split leg (see above)
): RoutingResult {
  const tkIn  = tokenInKey  === 'ETH' ? 'WETH' : tokenInKey
  const tkOut = tokenOutKey === 'ETH' ? 'WETH' : tokenOutKey
  const searchEnabled = amountIn > 0n && tkIn !== tkOut

  // vAMM — reserves + token0 per pool (unchanged from before)
  const vammContracts = useMemo(() =>
    POOLS.flatMap(p => [
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0'      as const },
    ]),
  [])
  const { data: vammData } = useReadContracts({ contracts: vammContracts, query: { refetchInterval: 10000, enabled: searchEnabled } })

  // Real external Uniswap V2 pairs — same getReserves()/token0() read
  // interface as our own vAMM pools, so the quoting side reuses the exact
  // same fetch pattern. Only the swap-execution side differs (poolType 3
  // in AeonUniversalRouter uses the 4-param swap() these real pairs need).
  const uniswapContracts = useMemo(() =>
    UNISWAP_POOLS.flatMap(p => [
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0'      as const },
    ]),
  [])
  const { data: uniswapData } = useReadContracts({ contracts: uniswapContracts, query: { refetchInterval: 10000, enabled: searchEnabled } })

  // CL — token0, globalState (sqrtPriceX96), liquidity per pool
  const clContracts = useMemo(() =>
    CL_POOLS.flatMap(p => [
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0' as const },
      { address: p.address as `0x${string}`, abi: ALGEBRA_POOL_ABI, functionName: 'globalState' as const },
      { address: p.address as `0x${string}`, abi: ALGEBRA_POOL_ABI, functionName: 'liquidity' as const },
    ]),
  [])
  const { data: clData } = useReadContracts({ contracts: clContracts, query: { refetchInterval: 10000, enabled: searchEnabled } })

  // DLMM — phase 1: tokenX + activeId per pool
  const dlmmPhase1Contracts = useMemo(() =>
    DLMM_POOLS.flatMap(p => [
      { address: p.address as `0x${string}`, abi: LB_PAIR_ABI, functionName: 'getTokenX' as const },
      { address: p.address as `0x${string}`, abi: LB_PAIR_ABI, functionName: 'getActiveId' as const },
    ]),
  [])
  const { data: dlmmPhase1 } = useReadContracts({ contracts: dlmmPhase1Contracts, query: { refetchInterval: 10000, enabled: searchEnabled } })

  const activeIds = DLMM_POOLS.map((_, i) => {
    const r = dlmmPhase1?.[i * 2 + 1]
    return r?.status === 'success' ? (r.result as number) : undefined
  })

  // DLMM — phase 2: active bin's reserves, once we know each pool's activeId
  const dlmmPhase2Contracts = useMemo(() =>
    DLMM_POOLS.map((p, i) => ({
      address: p.address as `0x${string}`, abi: LB_PAIR_ABI, functionName: 'getBin' as const,
      args: activeIds[i] !== undefined ? [BigInt(activeIds[i]!)] as const : undefined,
    })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [JSON.stringify(activeIds)])
  const { data: dlmmPhase2 } = useReadContracts({ contracts: dlmmPhase2Contracts, query: { enabled: searchEnabled && activeIds.every(id => id !== undefined) } })

  return useMemo(() => {
    if (amountIn === 0n || tkIn === tkOut) return { best: null, vammOnly: null }

    // Build one uniform {reserve0, reserve1, token0Addr} per pool, regardless of type.
    const reservesByPool = new Map<string, { reserve0: bigint; reserve1: bigint; token0Addr: string }>()

    POOLS.forEach((p, i) => {
      const resD  = vammData?.[i * 2]
      const tok0D = vammData?.[i * 2 + 1]
      if (resD?.status !== 'success' || tok0D?.status !== 'success') return
      const [r0, r1] = resD.result as [bigint, bigint, number]
      reservesByPool.set(p.address.toLowerCase(), { reserve0: r0, reserve1: r1, token0Addr: (tok0D.result as string).toLowerCase() })
    })

    CL_POOLS.forEach((p, i) => {
      const tok0D = clData?.[i * 3]
      const gsD   = clData?.[i * 3 + 1]
      const liqD  = clData?.[i * 3 + 2]
      if (tok0D?.status !== 'success' || gsD?.status !== 'success' || liqD?.status !== 'success') return
      const sqrtPriceX96 = (gsD.result as readonly [bigint, number, number, number, number, boolean])[0]
      const liquidity = liqD.result as bigint
      if (sqrtPriceX96 === 0n || liquidity === 0n) return
      const virtualReserve0 = (liquidity * Q96) / sqrtPriceX96
      const virtualReserve1 = (liquidity * sqrtPriceX96) / Q96
      reservesByPool.set(p.address.toLowerCase(), { reserve0: virtualReserve0, reserve1: virtualReserve1, token0Addr: (tok0D.result as string).toLowerCase() })
    })

    DLMM_POOLS.forEach((p, i) => {
      const tokXD = dlmmPhase1?.[i * 2]
      const binD  = dlmmPhase2?.[i]
      if (tokXD?.status !== 'success' || binD?.status !== 'success') return
      const [reserveX, reserveY] = binD.result as readonly [bigint, bigint]
      reservesByPool.set(p.address.toLowerCase(), { reserve0: reserveX, reserve1: reserveY, token0Addr: (tokXD.result as string).toLowerCase() })
    })

    UNISWAP_POOLS.forEach((p, i) => {
      const resD  = uniswapData?.[i * 2]
      const tok0D = uniswapData?.[i * 2 + 1]
      if (resD?.status !== 'success' || tok0D?.status !== 'success') return
      const [r0, r1] = resD.result as [bigint, bigint, number]
      reservesByPool.set(p.address.toLowerCase(), { reserve0: r0, reserve1: r1, token0Addr: (tok0D.result as string).toLowerCase() })
    })

    const allPools: UnifiedPool[] = [
      ...POOLS.map(p => ({ address: p.address, name: p.name, token0: p.token0, token1: p.token1, fee: p.fee, poolType: 0, binStep: 0 })),
      ...CL_POOLS.map(p => ({ address: p.address, name: p.name, token0: p.token0, token1: p.token1, fee: p.fee, poolType: 1, binStep: 0 })),
      ...DLMM_POOLS.map(p => ({ address: p.address, name: p.name, token0: p.token0, token1: p.token1, fee: p.fee, poolType: 2, binStep: p.binStep })),
      ...UNISWAP_POOLS.map(p => ({ address: p.address, name: p.name, token0: p.token0, token1: p.token1, fee: p.fee, poolType: 3, binStep: 0 })),
    ]

    function reservesFor(pool: UnifiedPool, fromToken: string): { rIn: bigint; rOut: bigint } | null {
      const rec = reservesByPool.get(pool.address.toLowerCase())
      if (!rec) return null
      const fromAddr = TOKENS[fromToken as keyof typeof TOKENS]?.address?.toLowerCase() ?? ''
      const isFrom0  = rec.token0Addr === fromAddr
      return { rIn: isFrom0 ? rec.reserve0 : rec.reserve1, rOut: isFrom0 ? rec.reserve1 : rec.reserve0 }
    }

    // Exhaustive DFS over simple paths (no repeated tokens) up to MAX_HOPS,
    // keeping whichever complete path yields the highest final amountOut.
    // Reusable over any pool subset so the same search can be run once
    // unrestricted and once vAMM-only (see RoutingResult).
    function search(pools: UnifiedPool[], amt: bigint = amountIn): BestRoute | null {
      const adjacency = new Map<string, { pool: UnifiedPool; other: string }[]>()
      pools.forEach(p => {
        const add = (from: string, to: string) => {
          if (!adjacency.has(from)) adjacency.set(from, [])
          adjacency.get(from)!.push({ pool: p, other: to })
        }
        add(p.token0, p.token1)
        add(p.token1, p.token0)
      })

      let best: { steps: RouteStep[]; amountOut: bigint; midPriceProduct: number } | null = null

      function dfs(current: string, amount: bigint, midPriceAcc: number, steps: RouteStep[], visited: Set<string>): void {
        if (current === tkOut && steps.length > 0) {
          if (best === null || amount > best.amountOut) {
            best = { steps: [...steps], amountOut: amount, midPriceProduct: midPriceAcc }
          }
        }
        if (steps.length >= MAX_HOPS) return
        for (const edge of adjacency.get(current) ?? []) {
          if (visited.has(edge.other)) continue
          const r = reservesFor(edge.pool, current)
          if (!r) continue
          const fee = feeToBps(edge.pool.fee)
          const out = amtOut(amount, r.rIn, r.rOut, fee)
          if (out === 0n) continue
          const hopMidPrice = r.rIn > 0n ? Number(r.rOut) / Number(r.rIn) : 0
          visited.add(edge.other)
          dfs(edge.other, out, midPriceAcc * hopMidPrice, [
            ...steps,
            { poolAddress: edge.pool.address, tokenIn: current, tokenOut: edge.other, feeBps: fee, poolType: edge.pool.poolType, binStep: edge.pool.binStep },
          ], visited)
          visited.delete(edge.other)
        }
      }

      dfs(tkIn, amt, 1, [], new Set([tkIn]))
      if (!best) return null
      const b = best as { steps: RouteStep[]; amountOut: bigint; midPriceProduct: number }

      const execPrice   = Number(b.amountOut) / Number(amt)
      const midPrice    = b.midPriceProduct
      const priceImpact = midPrice > 0 ? Math.max(0, ((midPrice - execPrice) / midPrice) * 100) : 0
      const pathTokens  = [tkIn, ...b.steps.map(s => s.tokenOut)]

      return {
        steps: b.steps,
        amountOut: b.amountOut,
        priceImpact,
        label: pathTokens.join(' → '),
        via: b.steps.map(s => pools.find(p => p.address === s.poolAddress)?.name ?? s.poolAddress).join(' + '),
      }
    }

    const bestRoute = search(allPools)
    const vammOnly   = search(allPools.filter(p => p.poolType === 0))

    // Priority split: does a direct (single-hop) pool of our own exist for
    // this exact pair? Only vAMM/CL/DLMM (poolType 0/1/2) count as "ours" —
    // Uniswap pools (poolType 3) are never a priority target.
    const ownDirectPools = allPools.filter(p =>
      p.poolType !== 3 && ((p.token0 === tkIn && p.token1 === tkOut) || (p.token0 === tkOut && p.token1 === tkIn)),
    )
    let aeonPool: UnifiedPool | null = null
    let aeonBestAtFull = -1n
    for (const p of ownDirectPools) {
      const r = reservesFor(p, tkIn)
      if (!r) continue
      const out = amtOut(amountIn, r.rIn, r.rOut, feeToBps(p.fee))
      if (out > aeonBestAtFull) { aeonBestAtFull = out; aeonPool = p }
    }

    let best = bestRoute
    if (bestRoute && aeonPool) {
      const aeonReserves = reservesFor(aeonPool, tkIn)
      if (aeonReserves) {
        const aeonFee     = feeToBps(aeonPool.fee)
        const bestOut      = bestRoute.amountOut
        const toleranceBps = BigInt(Math.round(Math.max(0, slippagePct) * 100))
        const threshold    = bestOut - (bestOut * toleranceBps) / 10000n

        const blendedOut = (aeonAmt: bigint): bigint => {
          const aeonOut = amtOut(aeonAmt, aeonReserves.rIn, aeonReserves.rOut, aeonFee)
          const remainderAmt = amountIn - aeonAmt
          const remainderOut = remainderAmt > 0n ? (search(allPools, remainderAmt)?.amountOut ?? 0n) : 0n
          return aeonOut + remainderOut
        }

        let lo = 0n, hi = amountIn
        for (let i = 0; i < 40 && hi - lo > 1n; i++) {
          const mid = (lo + hi) / 2n
          if (blendedOut(mid) >= threshold) lo = mid; else hi = mid
        }
        const aeonAmt = lo

        if (aeonAmt > 0n) {
          let finalAeonAmt = aeonAmt
          let remainderAmt = amountIn - aeonAmt

          // The binary search above only guarantees hi-lo <= 1, which can
          // leave a dust-sized remainder (up to ~2^40 wei on an 18-decimal
          // amount) whose quoted output rounds down to exactly 0. A pool's
          // swap() explicitly reverts on a zero-output leg, so fold any
          // remainder that wouldn't actually produce output into the aeon
          // leg (rather than dropping it, or sending a doomed second leg).
          if (remainderAmt > 0n) {
            const dustCheck = search(allPools, remainderAmt)
            if (!dustCheck || dustCheck.amountOut === 0n) {
              finalAeonAmt = amountIn
              remainderAmt = 0n
            }
          }

          const aeonOut  = amtOut(finalAeonAmt, aeonReserves.rIn, aeonReserves.rOut, aeonFee)
          const aeonStep: RouteStep = { poolAddress: aeonPool.address, tokenIn: tkIn, tokenOut: tkOut, feeBps: aeonFee, poolType: aeonPool.poolType, binStep: aeonPool.binStep }

          if (remainderAmt === 0n) {
            // Whole trade fits within tolerance on our own pool alone.
            best = {
              steps: [aeonStep],
              amountOut: aeonOut,
              priceImpact: bestOut > 0n ? Math.max(0, Number(bestOut - aeonOut) / Number(bestOut) * 100) : 0,
              label: `${tkIn} → ${tkOut}`,
              via: aeonPool.name,
            }
          } else {
            const remainderRoute  = search(allPools, remainderAmt)
            const remainderSteps  = remainderRoute?.steps ?? []
            const remainderOut    = remainderRoute?.amountOut ?? 0n
            const blended         = aeonOut + remainderOut
            const aeonPct         = Math.round(Number(aeonAmt) * 100 / Number(amountIn))
            best = {
              steps: [aeonStep, ...remainderSteps],
              amountOut: blended,
              priceImpact: bestOut > 0n ? Math.max(0, Number(bestOut - blended) / Number(bestOut) * 100) : 0,
              label: `${tkIn} → ${tkOut}`,
              via: `${aeonPool.name} (${aeonPct}%) + ${remainderRoute?.via ?? '?'} (${100 - aeonPct}%)`,
              split: {
                aeonStep, aeonAmountIn: aeonAmt, aeonAmountOut: aeonOut,
                remainderSteps, remainderAmountIn: remainderAmt, remainderAmountOut: remainderOut,
              },
            }
          }
        }
      }
    }

    return { best, vammOnly }
  }, [vammData, clData, dlmmPhase1, dlmmPhase2, uniswapData, amountIn, tkIn, tkOut, slippagePct])
}
