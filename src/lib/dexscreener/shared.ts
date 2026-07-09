// Shared client + pool registry for the DEX Screener Adapter routes under
// /api/dexscreener/*. Implements the spec at
// https://docs.dexscreener.com/ (v1.1, Dec 2023): /latest-block, /asset,
// /pair, /events.
//
// Scope: vAMM pools only. AeonPoolRH emits standard Uniswap V2-shaped
// Swap/Mint/Burn/Sync events (verified directly against the Solidity
// source), which map cleanly onto the adapter's SwapEvent/JoinExitEvent
// schema. CL (Algebra) and DLMM (Trader Joe) pools use fundamentally
// different event shapes (tick-range mints, signed swap amounts, bin-based
// liquidity) that don't map onto this same schema without a separate
// translation layer -- not implemented here, left as a documented gap
// rather than force-fit low-value/inaccurate CL+DLMM data into the adapter.
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { robinhoodChain } from '@/config/chain'
import { POOLS, CONTRACTS } from '@/config/contracts'
import { PAIR_ABI, ERC20_ABI } from '@/config/abis'

export const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com'

export const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL),
})

export const DEX_KEY = 'aeon'

// Every unique vAMM pool address currently listed on the site. Dedup since
// the same address can't appear twice for our purposes here.
export const VAMM_POOL_ADDRESSES = [...new Set(
  POOLS.filter(p => p.type === 'vAMM').map(p => p.address.toLowerCase()),
)] as `0x${string}`[]

export function isVammPool(id: string): id is `0x${string}` {
  return VAMM_POOL_ADDRESSES.includes(id.toLowerCase() as `0x${string}`)
}

export const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)',
)
export const MINT_EVENT = parseAbiItem(
  'event Mint(address indexed sender, uint256 amount0, uint256 amount1)',
)
export const BURN_EVENT = parseAbiItem(
  'event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)',
)

// PoolCreated(address indexed token0, address indexed token1, uint24 feeBps, address pool)
export const POOL_CREATED_EVENT = parseAbiItem(
  'event PoolCreated(address indexed token0, address indexed token1, uint24 feeBps, address pool)',
)
export const FACTORIES = [CONTRACTS.AeonFactory, CONTRACTS.AeonFactoryV2] as const

export interface PoolMeta {
  token0: `0x${string}`
  token1: `0x${string}`
  feeBps: number
}

// Immutable per-pool data (token0/token1/feeBps never change once deployed)
// -- safe to cache for the life of the server process.
const metaCache = new Map<string, PoolMeta>()

export async function getPoolMeta(poolAddr: `0x${string}`): Promise<PoolMeta | null> {
  const key = poolAddr.toLowerCase()
  const cached = metaCache.get(key)
  if (cached) return cached

  const results = await client.multicall({
    contracts: [
      { address: poolAddr, abi: PAIR_ABI, functionName: 'token0' },
      { address: poolAddr, abi: PAIR_ABI, functionName: 'token1' },
      { address: poolAddr, abi: PAIR_ABI, functionName: 'feeBps' },
    ],
    allowFailure: true,
  })
  if (results.some(r => r.status !== 'success')) return null

  const meta: PoolMeta = {
    token0: getAddress(results[0].result as string),
    token1: getAddress(results[1].result as string),
    feeBps: Number(results[2].result),
  }
  metaCache.set(key, meta)
  return meta
}

export async function getPoolMetaBatch(poolAddrs: `0x${string}`[]): Promise<Record<string, PoolMeta>> {
  const out: Record<string, PoolMeta> = {}
  await Promise.all(poolAddrs.map(async addr => {
    const meta = await getPoolMeta(addr)
    if (meta) out[addr.toLowerCase()] = meta
  }))
  return out
}

// Token decimals never change -- cache indefinitely, same as pool meta.
const decimalsCache = new Map<string, number>()

export async function getDecimalsBatch(tokenAddrs: `0x${string}`[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const uncached = tokenAddrs.filter(a => {
    const cached = decimalsCache.get(a.toLowerCase())
    if (cached !== undefined) { out[a.toLowerCase()] = cached; return false }
    return true
  })
  if (uncached.length === 0) return out

  const results = await client.multicall({
    contracts: uncached.map(address => ({ address, abi: ERC20_ABI, functionName: 'decimals' as const })),
    allowFailure: true,
  })
  uncached.forEach((addr, i) => {
    const r = results[i]
    const dec = r.status === 'success' ? Number(r.result) : 18
    decimalsCache.set(addr.toLowerCase(), dec)
    out[addr.toLowerCase()] = dec
  })
  return out
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
}
