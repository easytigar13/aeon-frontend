'use client'
import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

export interface RouteStep {
  poolAddress: `0x${string}`
  tokenIn:  string   // TOKENS key (never 'AVAX' — use 'WAVAX')
  tokenOut: string
  feeBps:   bigint
  poolType: number   // 0=vAMM, 1=CL, 2=DLMM
}

export interface BestRoute {
  steps:        RouteStep[]
  amountOut:    bigint
  priceImpact:  number   // percent, single-hop only (0 for multi-hop)
  label:        string   // e.g. "AEON → WAVAX → USDC"
  via:          string   // pool name(s)
}

// Hub tokens we route through for 2-hop
const HUBS = ['WAVAX', 'USDC', 'AEON'] as const

function feeToBps(fee: string): bigint {
  return BigInt(Math.round(parseFloat(fee) * 100))
}

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

// All pools connecting two token keys
function poolsBetween(a: string, b: string) {
  return POOLS.filter(p =>
    (p.token0 === a && p.token1 === b) ||
    (p.token0 === b && p.token1 === a)
  )
}

// Collect unique pools relevant to a (tkIn, tkOut) pair
// De-dup by address+type so different pool types at the same address are all considered
function candidatePools(tkIn: string, tkOut: string) {
  const direct = poolsBetween(tkIn, tkOut)
  const hop: typeof POOLS[number][] = []
  for (const hub of HUBS) {
    if (hub === tkIn || hub === tkOut) continue
    poolsBetween(tkIn, hub).forEach(p => hop.push(p))
    poolsBetween(hub, tkOut).forEach(p => hop.push(p))
  }
  const seen = new Set<string>()
  return [...direct, ...hop].filter(p => {
    const key = p.address + '|' + p.type
    return seen.has(key) ? false : (seen.add(key), true)
  })
}

export function useRouting(
  tokenInKey:  string,
  tokenOutKey: string,
  amountIn:    bigint,
): BestRoute | null {
  // Normalise AVAX → WAVAX for pool graph
  const tkIn  = tokenInKey  === 'AVAX' ? 'WAVAX' : tokenInKey
  const tkOut = tokenOutKey === 'AVAX' ? 'WAVAX' : tokenOutKey

  const pools = useMemo(() => {
    if (tkIn === tkOut) return []
    return candidatePools(tkIn, tkOut)
  }, [tkIn, tkOut])

  // Batch-read reserves + token0 for every candidate pool
  const contracts = useMemo(() =>
    pools.flatMap(p => [
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
      { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0'      as const },
    ]),
  [pools])

  const { data } = useReadContracts({
    contracts,
    query: { refetchInterval: 10000, enabled: pools.length > 0 && amountIn > 0n },
  })

  const poolTypeNum = (t: string) => t === 'CL' ? 1 : t === 'DLMM' ? 2 : 0

  return useMemo(() => {
    if (!data || amountIn === 0n || tkIn === tkOut) return null

    // Build helper: get (rIn, rOut) for a pool viewed from tkA→tkB
    function reserves(poolAddr: string, poolType: string, tkA: string): { rIn: bigint; rOut: bigint } | null {
      const idx = pools.findIndex(p => p.address === poolAddr && p.type === poolType)
      if (idx < 0) return null
      const resD  = data?.[idx * 2]
      const tok0D = data?.[idx * 2 + 1]
      if (resD?.status !== 'success' || tok0D?.status !== 'success') return null
      const [r0, r1] = resD.result  as [bigint, bigint, number]
      const token0   = tok0D.result as string
      const tkAAddr  = TOKENS[tkA as keyof typeof TOKENS]?.address?.toLowerCase() ?? ''
      const isA0     = token0.toLowerCase() === tkAAddr
      return { rIn: isA0 ? r0 : r1, rOut: isA0 ? r1 : r0 }
    }

    let bestOut = 0n
    let best: BestRoute | null = null

    // 1 – Direct routes
    for (const pool of poolsBetween(tkIn, tkOut)) {
      const r = reserves(pool.address, pool.type, tkIn)
      if (!r) continue
      const fee = feeToBps(pool.fee)
      const out = amtOut(amountIn, r.rIn, r.rOut, fee)
      if (out > bestOut) {
        bestOut = out
        const midPrice  = r.rIn > 0n ? Number(r.rOut) / Number(r.rIn) : 0
        const execPrice = Number(amountIn) > 0 ? Number(out) / Number(amountIn) : 0
        const impact    = midPrice > 0 ? Math.max(0, ((midPrice - execPrice) / midPrice) * 100) : 0
        best = {
          steps: [{ poolAddress: pool.address, tokenIn: tkIn, tokenOut: tkOut, feeBps: fee, poolType: poolTypeNum(pool.type) }],
          amountOut: out,
          priceImpact: impact,
          label: `${tkIn} → ${tkOut}`,
          via: pool.name,
        }
      }
    }

    // 2 – 2-hop routes through hubs
    for (const hub of HUBS) {
      if (hub === tkIn || hub === tkOut) continue
      for (const p1 of poolsBetween(tkIn, hub)) {
        const r1 = reserves(p1.address, p1.type, tkIn)
        if (!r1) continue
        const mid = amtOut(amountIn, r1.rIn, r1.rOut, feeToBps(p1.fee))
        if (mid === 0n) continue

        for (const p2 of poolsBetween(hub, tkOut)) {
          const r2 = reserves(p2.address, p2.type, hub)
          if (!r2) continue
          const out = amtOut(mid, r2.rIn, r2.rOut, feeToBps(p2.fee))
          if (out > bestOut) {
            bestOut = out
            // Approximate combined price impact: product of both hops
            const impact1 = r1.rIn > 0n ? Math.max(0, (1 - Number(mid) * Number(r1.rIn) / (Number(amountIn) * Number(r1.rOut))) * 100) : 0
            const impact2 = r2.rIn > 0n ? Math.max(0, (1 - Number(out) * Number(r2.rIn) / (Number(mid) * Number(r2.rOut))) * 100) : 0
            best = {
              steps: [
                { poolAddress: p1.address, tokenIn: tkIn, tokenOut: hub,   feeBps: feeToBps(p1.fee), poolType: poolTypeNum(p1.type) },
                { poolAddress: p2.address, tokenIn: hub,  tokenOut: tkOut, feeBps: feeToBps(p2.fee), poolType: poolTypeNum(p2.type) },
              ],
              amountOut: out,
              priceImpact: impact1 + impact2,
              label: `${tkIn} → ${hub} → ${tkOut}`,
              via: `${p1.name} + ${p2.name}`,
            }
          }
        }
      }
    }

    return best
  }, [data, amountIn, tkIn, tkOut, pools])
}
