'use client'
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

export interface RouteStep {
  poolAddress: `0x${string}`
  tokenIn:  string   // TOKENS key (never 'ETH' — use 'WETH')
  tokenOut: string
  feeBps:   bigint
  poolType: number   // 0=vAMM — the only type AeonRouterRH can execute; see MAX_HOPS comment
}

export interface BestRoute {
  steps:        RouteStep[]
  amountOut:    bigint
  priceImpact:  number   // percent, computed across the whole path (not just the first hop)
  label:        string   // e.g. "AEON → WETH → USDG"
  via:          string   // pool name(s)
}

// Exhaustive path search over every vAMM pool (not a fixed hub list), so this
// stays correct as pools are added rather than only finding routes through
// whichever tokens happen to be hardcoded here. vAMM-only: AeonRouterRH.sol's
// swapExactTokensForTokens reverts UnsupportedPoolType() for anything but
// poolType 0 — it calls AeonPoolRH's own swap(amount0Out, amount1Out, to)
// directly, which has nothing in common with Algebra's swap-callback pattern
// (CL) or Trader Joe's bin-based swap (DLMM). Routing "through" a CL/DLMM
// pool would produce a quote the router can't actually broadcast, so those
// pool types are deliberately excluded here, not missed.
const MAX_HOPS = 3

function feeToBps(fee: string): bigint {
  return BigInt(Math.round(parseFloat(fee) * 100))
}

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

type Pool = typeof POOLS[number]

export function useRouting(
  tokenInKey:  string,
  tokenOutKey: string,
  amountIn:    bigint,
): BestRoute | null {
  // Normalise ETH → WETH for pool graph
  const tkIn  = tokenInKey  === 'ETH' ? 'WETH' : tokenInKey
  const tkOut = tokenOutKey === 'ETH' ? 'WETH' : tokenOutKey

  // Read reserves + token0 for every vAMM pool — an exhaustive path search
  // can use any pool as an intermediate hop, not just ones directly touching
  // tkIn/tkOut, so scoping this down defeats the point.
  const contracts = useMemo(() =>
    POOLS.flatMap(p => [
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0'      as const },
    ]),
  [])

  const { data } = useReadContracts({
    contracts,
    query: { refetchInterval: 10000, enabled: amountIn > 0n && tkIn !== tkOut },
  })

  return useMemo(() => {
    if (!data || amountIn === 0n || tkIn === tkOut) return null

    function reservesFor(poolIdx: number, fromToken: string): { rIn: bigint; rOut: bigint } | null {
      const resD  = data?.[poolIdx * 2]
      const tok0D = data?.[poolIdx * 2 + 1]
      if (resD?.status !== 'success' || tok0D?.status !== 'success') return null
      const [r0, r1] = resD.result as [bigint, bigint, number]
      const token0    = (tok0D.result as string).toLowerCase()
      const fromAddr  = TOKENS[fromToken as keyof typeof TOKENS]?.address?.toLowerCase() ?? ''
      const isFrom0   = token0 === fromAddr
      return { rIn: isFrom0 ? r0 : r1, rOut: isFrom0 ? r1 : r0 }
    }

    // token -> outgoing edges (every pool touching it, in both directions)
    const adjacency = new Map<string, { poolIdx: number; pool: Pool; other: string }[]>()
    POOLS.forEach((p, poolIdx) => {
      const add = (from: string, to: string) => {
        if (!adjacency.has(from)) adjacency.set(from, [])
        adjacency.get(from)!.push({ poolIdx, pool: p, other: to })
      }
      add(p.token0, p.token1)
      add(p.token1, p.token0)
    })

    let best: { steps: RouteStep[]; amountOut: bigint; midPriceProduct: number } | null = null

    // DFS over simple paths (no repeated tokens) up to MAX_HOPS, keeping
    // whichever complete path yields the highest final amountOut — this is
    // the actual optimization target, not hop count.
    function dfs(current: string, amount: bigint, midPriceAcc: number, steps: RouteStep[], visited: Set<string>): void {
      if (current === tkOut && steps.length > 0) {
        if (best === null || amount > best.amountOut) {
          best = { steps: [...steps], amountOut: amount, midPriceProduct: midPriceAcc }
        }
      }
      if (steps.length >= MAX_HOPS) return
      for (const edge of adjacency.get(current) ?? []) {
        if (visited.has(edge.other)) continue
        const r = reservesFor(edge.poolIdx, current)
        if (!r) continue
        const fee = feeToBps(edge.pool.fee)
        const out = amtOut(amount, r.rIn, r.rOut, fee)
        if (out === 0n) continue
        const hopMidPrice = r.rIn > 0n ? Number(r.rOut) / Number(r.rIn) : 0
        visited.add(edge.other)
        dfs(edge.other, out, midPriceAcc * hopMidPrice, [
          ...steps,
          { poolAddress: edge.pool.address, tokenIn: current, tokenOut: edge.other, feeBps: fee, poolType: 0 },
        ], visited)
        visited.delete(edge.other)
      }
    }

    dfs(tkIn, amountIn, 1, [], new Set([tkIn]))
    if (!best) return null
    const b = best as { steps: RouteStep[]; amountOut: bigint; midPriceProduct: number }

    const execPrice   = Number(b.amountOut) / Number(amountIn)
    const midPrice    = b.midPriceProduct
    const priceImpact = midPrice > 0 ? Math.max(0, ((midPrice - execPrice) / midPrice) * 100) : 0
    const pathTokens  = [tkIn, ...b.steps.map(s => s.tokenOut)]

    return {
      steps: b.steps,
      amountOut: b.amountOut,
      priceImpact,
      label: pathTokens.join(' → '),
      via: b.steps.map(s => POOLS.find(p => p.address === s.poolAddress)?.name ?? s.poolAddress).join(' + '),
    }
  }, [data, amountIn, tkIn, tkOut])
}
