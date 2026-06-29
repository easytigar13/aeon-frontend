// GET /api/v1/pairs
// DexScreener / GeckoTerminal compatible pairs endpoint.
// Submit this URL to https://dexscreener.com/update-token-info and
// https://support.geckoterminal.com/hc/en-us/requests/new as your "pairs endpoint".
import { NextResponse } from 'next/server'
import { createPublicClient, http, formatUnits } from 'viem'
import { avalanche } from 'viem/chains'
import { POOLS, TOKENS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

const client = createPublicClient({
  chain: avalanche,
  transport: http('https://api.avax.network/ext/bc/C/rpc'),
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Cache-Control': 's-maxage=10, stale-while-revalidate=30',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET() {
  const seen = new Set<string>()
  const unique = POOLS.filter(p => seen.has(p.address) ? false : (seen.add(p.address), true))

  const contracts = unique.flatMap(p => [
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0' as const },
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token1' as const },
  ])

  let results: Awaited<ReturnType<typeof client.multicall>>
  try {
    results = await client.multicall({ contracts, allowFailure: true })
  } catch {
    return NextResponse.json({ pairs: [] }, { status: 503, headers: CORS })
  }

  const addrToToken = Object.fromEntries(
    Object.entries(TOKENS).map(([, t]) => [t.address.toLowerCase(), t])
  )

  const pairs = unique.map((pool, i) => {
    const resD  = results[i * 3]
    const tok0D = results[i * 3 + 1]
    const tok1D = results[i * 3 + 2]

    const reserves = (resD as any)?.status  === 'success' ? (resD as any).result  as [bigint, bigint, number] : null
    const tok0Addr = (tok0D as any)?.status === 'success' ? ((tok0D as any).result as string).toLowerCase() : null
    const tok1Addr = (tok1D as any)?.status === 'success' ? ((tok1D as any).result as string).toLowerCase() : null

    const t0 = tok0Addr ? (addrToToken[tok0Addr] as any) : null
    const t1 = tok1Addr ? (addrToToken[tok1Addr] as any) : null

    const r0 = reserves ? Number(formatUnits(reserves[0], t0?.decimals ?? 18)) : 0
    const r1 = reserves ? Number(formatUnits(reserves[1], t1?.decimals ?? 18)) : 0

    // Native price: token1 per token0
    const priceNative = r0 > 0 ? (r1 / r0).toFixed(10) : '0'

    return {
      chainId:      'avalanche',
      dexId:        'aeondex',
      url:          `https://aeonprotocol.net/liquidity`,
      pairAddress:  pool.address,
      labels:       [pool.type],
      baseToken: {
        address:  t0?.address ?? tok0Addr ?? '',
        name:     t0?.name    ?? 'Unknown',
        symbol:   t0?.symbol  ?? '???',
      },
      quoteToken: {
        address:  t1?.address ?? tok1Addr ?? '',
        name:     t1?.name    ?? 'Unknown',
        symbol:   t1?.symbol  ?? '???',
      },
      priceNative,
      priceUsd:   null,           // aggregator fills from their own oracle
      txns: {
        h24: { buys: 0, sells: 0 },
        h6:  { buys: 0, sells: 0 },
        h1:  { buys: 0, sells: 0 },
        m5:  { buys: 0, sells: 0 },
      },
      volume: { h24: 0, h6: 0, h1: 0, m5: 0 },
      liquidity: {
        usd:   null,
        base:  r0,
        quote: r1,
      },
      fdv:  null,
      marketCap: null,
    }
  })

  return NextResponse.json({ schemaVersion: '1.0.0', pairs }, { headers: CORS })
}
