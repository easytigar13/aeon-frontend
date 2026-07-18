import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem'
import { TOKENS } from '../src/config/contracts'
import {
  UNISWAP_V3,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_FEE_TIERS,
  UNISWAP_V3_POOL_ABI,
} from './uniswap-v3'
import {
  UNISWAP_V4,
  UNISWAP_V4_INITIALIZE_EVENT,
  UNISWAP_V4_STATE_VIEW_ABI,
} from './uniswap-v4'

const addressArg = process.argv[2]
if (!addressArg) throw new Error('Usage: npx tsx inspect-token-pools.ts <token-address>')

const token = getAddress(addressArg)
const rpc = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({ transport: http(rpc) })
const ZERO = '0x0000000000000000000000000000000000000000'
const V2_FACTORY = getAddress('0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f')
const erc20MetadataAbi = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const
const v2FactoryAbi = [{
  name: 'getPair', type: 'function', stateMutability: 'view',
  inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'address' }],
}] as const
const v2PairAbi = [
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] },
] as const

const [name, symbol, decimals] = await Promise.all([
  client.readContract({ address: token, abi: erc20MetadataAbi, functionName: 'name' }),
  client.readContract({ address: token, abi: erc20MetadataAbi, functionName: 'symbol' }),
  client.readContract({ address: token, abi: erc20MetadataAbi, functionName: 'decimals' }),
])
console.log(JSON.stringify({ token, name, symbol, decimals: Number(decimals) }))

const known = Object.entries(TOKENS)
  .filter(([key, value]) => key !== 'ETH' && value.address.toLowerCase() !== token.toLowerCase())
  .map(([key, value]) => ({ symbol: key, address: getAddress(value.address) }))

for (const quote of known) {
  const pair = await client.readContract({
    address: V2_FACTORY, abi: v2FactoryAbi, functionName: 'getPair', args: [token, quote.address],
  }) as Address
  if (pair.toLowerCase() === ZERO) continue
  const [token0, token1, reserves] = await Promise.all([
    client.readContract({ address: pair, abi: v2PairAbi, functionName: 'token0' }),
    client.readContract({ address: pair, abi: v2PairAbi, functionName: 'token1' }),
    client.readContract({ address: pair, abi: v2PairAbi, functionName: 'getReserves' }),
  ])
  console.log(JSON.stringify({ kind: 'uniV2', quote: quote.symbol, pair: getAddress(pair), token0, token1, reserves: [reserves[0].toString(), reserves[1].toString()] }))
}

for (const quote of known) {
  for (const fee of UNISWAP_V3_FEE_TIERS) {
    const pool = await client.readContract({
      address: UNISWAP_V3.factory, abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool', args: [token, quote.address, fee],
    }) as Address
    if (pool.toLowerCase() === ZERO) continue
    const liquidity = await client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'liquidity' })
    console.log(JSON.stringify({ kind: 'uniV3', quote: quote.symbol, fee, pool: getAddress(pool), liquidity: liquidity.toString() }))
  }
}

type DexPair = { pairAddress?: string; labels?: string[] }
const pairs = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`).then(r => r.json()) as DexPair[]
for (const pair of pairs) {
  if (!pair.labels?.includes('v4') || !pair.pairAddress || pair.pairAddress.length !== 66) continue
  const id = pair.pairAddress as Hex
  const logs = await client.getLogs({
    address: UNISWAP_V4.poolManager, event: UNISWAP_V4_INITIALIZE_EVENT,
    args: { id }, fromBlock: 9070n, toBlock: 'latest',
  })
  const args = logs[0]?.args
  if (!args?.currency0 || !args.currency1 || args.fee === undefined || args.tickSpacing === undefined || !args.hooks) continue
  const liquidity = await client.readContract({
    address: UNISWAP_V4.stateView, abi: UNISWAP_V4_STATE_VIEW_ABI,
    functionName: 'getLiquidity', args: [id],
  })
  console.log(JSON.stringify({
    kind: 'uniV4', id, currency0: args.currency0, currency1: args.currency1,
    fee: Number(args.fee), tickSpacing: Number(args.tickSpacing), hooks: args.hooks,
    liquidity: liquidity.toString(),
  }))
}
