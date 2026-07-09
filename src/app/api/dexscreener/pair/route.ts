// GET /api/dexscreener/pair?id=:address
// DEX Screener Adapter spec: https://docs.dexscreener.com/
//
// createdAtBlockNumber/Timestamp/TxnId are resolved from the factory's
// PoolCreated event (indexed by token0/token1, so this is a targeted
// lookup, not a full-history scan). 3 of our pools (AEON/ETH, AEON/USDG,
// ETH/USDG) were deployed directly rather than through a factory
// createPool() call, so no PoolCreated event exists for them -- those
// fields are simply omitted, which the spec explicitly allows ("If
// unavailable DEX Screener can bet set to assume pair creation date is the
// same date as its first ever event").
import { NextResponse } from 'next/server'
import { isAddress, getAddress } from 'viem'
import { client, CORS, DEX_KEY, isVammPool, getPoolMeta, POOL_CREATED_EVENT, FACTORIES } from '@/lib/dexscreener/shared'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

async function findCreationInfo(token0: `0x${string}`, token1: `0x${string}`) {
  for (const factory of FACTORIES) {
    const logs = await client.getLogs({
      address: factory,
      event: POOL_CREATED_EVENT,
      args: { token0, token1 },
      fromBlock: 0n,
      toBlock: 'latest',
    })
    if (logs.length > 0) {
      const log = logs[0]
      const block = await client.getBlock({ blockNumber: log.blockNumber })
      return {
        createdAtBlockNumber: Number(log.blockNumber),
        createdAtBlockTimestamp: Number(block.timestamp),
        createdAtTxnId: log.transactionHash,
      }
    }
  }
  return null
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !isAddress(id)) {
    return NextResponse.json({ error: 'invalid or missing id' }, { status: 400, headers: CORS })
  }
  if (!isVammPool(id)) {
    return NextResponse.json({ error: 'unknown pair' }, { status: 404, headers: CORS })
  }
  const poolAddr = getAddress(id)

  const meta = await getPoolMeta(poolAddr)
  if (!meta) {
    return NextResponse.json({ error: 'failed to read pool metadata' }, { status: 502, headers: CORS })
  }

  const creation = await findCreationInfo(meta.token0, meta.token1)

  return NextResponse.json(
    {
      pair: {
        id: poolAddr,
        dexKey: DEX_KEY,
        asset0Id: meta.token0,
        asset1Id: meta.token1,
        feeBps: meta.feeBps,
        ...(creation ?? {}),
      },
    },
    { headers: CORS },
  )
}
