// GET /api/v1/pools
// Machine-readable pool list for DEX aggregators (1inch, Odos, Paraswap, custom bots).
// Returns live reserves + token metadata for every unique AeonDEX pool.
import { NextResponse } from 'next/server'
import { createPublicClient, http, formatUnits } from 'viem'
import { robinhoodChain } from '@/config/wagmi'
import { POOLS, TOKENS, CONTRACTS, CHAIN_ID } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http('https://rpc.mainnet.chain.robinhood.com'),
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
  // De-dup pools by address (vAMM/CL/DLMM share addresses)
  const seen = new Set<string>()
  const unique = POOLS.filter(p => seen.has(p.address) ? false : (seen.add(p.address), true))

  // Batch read reserves + token0 for all pools
  const contracts = unique.flatMap(p => [
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0' as const },
    { address: p.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token1' as const },
  ])

  let results: Awaited<ReturnType<typeof client.multicall>>
  try {
    results = await client.multicall({ contracts, allowFailure: true })
  } catch {
    return NextResponse.json({ error: 'RPC unavailable' }, { status: 503, headers: CORS })
  }

  const addrToToken = Object.fromEntries(
    Object.entries(TOKENS).map(([, t]) => [t.address.toLowerCase(), t])
  )

  const pools = unique.map((pool, i) => {
    const resD  = results[i * 3]
    const tok0D = results[i * 3 + 1]
    const tok1D = results[i * 3 + 2]

    const reserves = (resD as any)?.status  === 'success' ? (resD as any).result  as [bigint, bigint, number] : null
    const tok0Addr = (tok0D as any)?.status === 'success' ? ((tok0D as any).result as string).toLowerCase() : null
    const tok1Addr = (tok1D as any)?.status === 'success' ? ((tok1D as any).result as string).toLowerCase() : null

    const token0 = tok0Addr ? addrToToken[tok0Addr] : null
    const token1 = tok1Addr ? addrToToken[tok1Addr] : null

    const feeBps = Math.round(parseFloat(pool.fee) * 100)   // "0.3%" → 30

    return {
      address:   pool.address,
      type:      pool.type,
      fee_bps:   feeBps,
      token0: token0 ? {
        address:  (token0 as any).address,
        symbol:   (token0 as any).symbol,
        decimals: (token0 as any).decimals,
        name:     (token0 as any).name,
      } : { address: tok0Addr },
      token1: token1 ? {
        address:  (token1 as any).address,
        symbol:   (token1 as any).symbol,
        decimals: (token1 as any).decimals,
        name:     (token1 as any).name,
      } : { address: tok1Addr },
      reserve0:  reserves ? reserves[0].toString() : '0',
      reserve1:  reserves ? reserves[1].toString() : '0',
      // Human-readable for convenience
      reserve0_human: reserves && token0
        ? formatUnits(reserves[0], (token0 as any).decimals)
        : null,
      reserve1_human: reserves && token1
        ? formatUnits(reserves[1], (token1 as any).decimals)
        : null,
    }
  })

  return NextResponse.json(
    {
      chain_id:  CHAIN_ID,
      dex:       'AeonDEX',
      factory:   CONTRACTS.AeonFactory,
      router:    CONTRACTS.AeonRouter,
      pair_type: 'UniswapV2-compatible',
      swap_selector: '0x022c0d9f',   // swap(uint256,uint256,address,bytes)
      updated_at: new Date().toISOString(),
      pool_count: pools.length,
      pools,
    },
    { headers: CORS }
  )
}
