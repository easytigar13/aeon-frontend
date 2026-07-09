// GET /api/dexscreener/events?fromBlock=:number&toBlock=:number
// DEX Screener Adapter spec: https://docs.dexscreener.com/
//
// Reserves: per spec, "If there are multiple swap events on the same block
// and reserves cannot be determined after each individual event then it's
// acceptable for only the last event to contain the reserves prop" -- we
// use that escape hatch rather than reconstructing intra-block deltas from
// Sync events. Reserves are fetched via getReserves() pinned to that exact
// block height, attached only to the last (pool, block) log by
// (transactionIndex, logIndex).
//
// priceNative for a swap is the swap's own effective execution price
// (assetOut / assetIn, expressed as asset1-per-asset0), not the post-swap
// pool price -- this is what actually happened in that trade.
//
// maker is the transaction's `from` address (the EOA that submitted it),
// not the pool event's own `sender`/`to` params, since those are usually
// the router/helper contract rather than the real user.
import { NextResponse } from 'next/server'
import { formatUnits, getAddress } from 'viem'
import {
  client, CORS, VAMM_POOL_ADDRESSES, SWAP_EVENT, MINT_EVENT, BURN_EVENT,
  getPoolMetaBatch, getDecimalsBatch,
} from '@/lib/dexscreener/shared'
import { PAIR_ABI } from '@/config/abis'

// Loosely typed on purpose -- the three source event shapes (Swap/Mint/Burn)
// don't unify cleanly under viem's strict per-event Log<> generic, and every
// call site below already does an explicit `as {...}` cast on `args` before
// use, so there's no runtime safety lost by not fighting the type system here.
interface TaggedLog {
  address: `0x${string}`
  blockNumber: bigint
  transactionHash: `0x${string}`
  transactionIndex: number
  logIndex: number
  args: Record<string, unknown>
  _kind: 'swap' | 'join' | 'exit'
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const fromBlockRaw = url.searchParams.get('fromBlock')
  const toBlockRaw = url.searchParams.get('toBlock')
  if (!fromBlockRaw || !toBlockRaw) {
    return NextResponse.json({ error: 'fromBlock and toBlock are required' }, { status: 400, headers: CORS })
  }
  const fromBlock = BigInt(fromBlockRaw)
  const toBlock = BigInt(toBlockRaw)
  if (VAMM_POOL_ADDRESSES.length === 0) {
    return NextResponse.json({ events: [] }, { headers: CORS })
  }

  const [swapLogs, mintLogs, burnLogs] = await Promise.all([
    client.getLogs({ address: VAMM_POOL_ADDRESSES, event: SWAP_EVENT, fromBlock, toBlock }),
    client.getLogs({ address: VAMM_POOL_ADDRESSES, event: MINT_EVENT, fromBlock, toBlock }),
    client.getLogs({ address: VAMM_POOL_ADDRESSES, event: BURN_EVENT, fromBlock, toBlock }),
  ])

  const allLogs: TaggedLog[] = [
    ...swapLogs.map(l => ({ ...l, _kind: 'swap' as const })),
    ...mintLogs.map(l => ({ ...l, _kind: 'join' as const })),
    ...burnLogs.map(l => ({ ...l, _kind: 'exit' as const })),
  ]

  if (allLogs.length === 0) {
    return NextResponse.json({ events: [] }, { headers: CORS })
  }

  // Pool meta (token0/token1) + decimals, batched and cached.
  const poolAddrs = [...new Set(allLogs.map(l => l.address.toLowerCase()))] as `0x${string}`[]
  const metaByPool = await getPoolMetaBatch(poolAddrs)
  const tokenAddrs = [...new Set(Object.values(metaByPool).flatMap(m => [m.token0, m.token1]))]
  const decimalsByToken = await getDecimalsBatch(tokenAddrs)

  // Which (pool, block) pair does each log belong to, and which log is the
  // LAST one in that (pool, block) group (by txnIndex, then logIndex) --
  // that's the one that gets `reserves` attached.
  const groupKey = (poolAddr: string, blockNumber: bigint) => `${poolAddr.toLowerCase()}-${blockNumber}`
  const lastInGroup = new Map<string, TaggedLog>()
  for (const log of allLogs) {
    const key = groupKey(log.address, log.blockNumber!)
    const current = lastInGroup.get(key)
    if (!current
      || log.transactionIndex! > current.transactionIndex!
      || (log.transactionIndex === current.transactionIndex && log.logIndex! > current.logIndex!)
    ) {
      lastInGroup.set(key, log)
    }
  }
  const winnerLogKeys = new Set([...lastInGroup.values()].map(l => `${l.transactionHash}-${l.logIndex}`))

  // Fetch reserves for exactly the (pool, block) pairs that need them, each
  // pinned to that specific historical block height.
  const reserveTargets = [...lastInGroup.values()]
  const reserveResults = await Promise.all(reserveTargets.map(async log => {
    try {
      const [r0, r1] = await client.readContract({
        address: getAddress(log.address), abi: PAIR_ABI, functionName: 'getReserves',
        blockNumber: log.blockNumber!,
      }) as [bigint, bigint, number]
      return { key: groupKey(log.address, log.blockNumber!), r0, r1 }
    } catch {
      return null
    }
  }))
  const reservesByGroup = new Map<string, { r0: bigint; r1: bigint }>()
  for (const r of reserveResults) {
    if (r) reservesByGroup.set(r.key, { r0: r.r0, r1: r.r1 })
  }

  // maker = tx.from, batched over unique tx hashes.
  const uniqueTxHashes = [...new Set(allLogs.map(l => l.transactionHash!))]
  const txFromResults = await Promise.all(uniqueTxHashes.map(async hash => {
    try {
      const tx = await client.getTransaction({ hash })
      return { hash, from: tx.from }
    } catch {
      return { hash, from: undefined }
    }
  }))
  const makerByTx = new Map(txFromResults.map(t => [t.hash, t.from]))

  // Block timestamps, batched over unique block numbers in this range.
  const uniqueBlocks = [...new Set(allLogs.map(l => l.blockNumber!))]
  const blockResults = await Promise.all(uniqueBlocks.map(async bn => {
    const block = await client.getBlock({ blockNumber: bn })
    return { bn, timestamp: Number(block.timestamp) }
  }))
  const timestampByBlock = new Map(blockResults.map(b => [b.bn, b.timestamp]))

  const events = allLogs.map(log => {
    const poolAddr = log.address.toLowerCase()
    const meta = metaByPool[poolAddr]
    if (!meta) return null
    const dec0 = decimalsByToken[meta.token0.toLowerCase()] ?? 18
    const dec1 = decimalsByToken[meta.token1.toLowerCase()] ?? 18

    const isWinner = winnerLogKeys.has(`${log.transactionHash}-${log.logIndex}`)
    const rawReserves = isWinner ? reservesByGroup.get(groupKey(log.address, log.blockNumber!)) : undefined
    const reserves = rawReserves
      ? { asset0: formatUnits(rawReserves.r0, dec0), asset1: formatUnits(rawReserves.r1, dec1) }
      : undefined

    const base = {
      block: {
        blockNumber: Number(log.blockNumber),
        blockTimestamp: timestampByBlock.get(log.blockNumber!) ?? 0,
      },
      txnId: log.transactionHash,
      txnIndex: log.transactionIndex,
      eventIndex: log.logIndex,
      maker: makerByTx.get(log.transactionHash!) ?? getAddress(poolAddr),
      pairId: getAddress(poolAddr),
    }

    if (log._kind === 'swap') {
      const args = log.args as { amount0In: bigint; amount1In: bigint; amount0Out: bigint; amount1Out: bigint }
      const asset0In = formatUnits(args.amount0In, dec0)
      const asset1In = formatUnits(args.amount1In, dec1)
      const asset0Out = formatUnits(args.amount0Out, dec0)
      const asset1Out = formatUnits(args.amount1Out, dec1)
      const sellingAsset0 = args.amount0In > 0n
      const priceNative = sellingAsset0
        ? (Number(asset1Out) / Number(asset0In)).toString()
        : (Number(asset1In) / Number(asset0Out)).toString()

      return {
        ...base,
        eventType: 'swap' as const,
        ...(args.amount0In > 0n ? { asset0In } : {}),
        ...(args.amount1In > 0n ? { asset1In } : {}),
        ...(args.amount0Out > 0n ? { asset0Out } : {}),
        ...(args.amount1Out > 0n ? { asset1Out } : {}),
        priceNative,
        ...(reserves ? { reserves } : {}),
      }
    }

    const args = log.args as { amount0: bigint; amount1: bigint }
    return {
      ...base,
      eventType: log._kind as 'join' | 'exit',
      amount0: formatUnits(args.amount0, dec0),
      amount1: formatUnits(args.amount1, dec1),
      ...(reserves ? { reserves } : {}),
    }
  }).filter((e): e is NonNullable<typeof e> => e !== null)

  events.sort((a, b) =>
    a.block.blockNumber - b.block.blockNumber
    || a.txnIndex - b.txnIndex
    || a.eventIndex - b.eventIndex,
  )

  return NextResponse.json({ events }, { headers: CORS })
}
