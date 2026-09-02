import { getAddress, parseAbiItem, type Address, type Hex } from 'viem'

export const UNISWAP_V4 = {
  poolManager: getAddress('0x8366a39cc670b4001a1121b8f6a443a643e40951'),
  quoter: getAddress('0x8dc178efb8111bb0973dd9d722ebeff267c98f94'),
  universalRouter: getAddress('0x8876789976decbfcbbbe364623c63652db8c0904'),
  permit2: getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3'),
  stateView: getAddress('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'),
} as const

export const NATIVE_CURRENCY = '0x0000000000000000000000000000000000000000' as Address
const POOL_MANAGER_DEPLOY_BLOCK = 9070n

export const UNISWAP_V4_INITIALIZE_EVENT = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
)

export const UNISWAP_V4_QUOTER_ABI = [{
  name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'poolKey', type: 'tuple', components: [
      { name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ] },
    { name: 'zeroForOne', type: 'bool' }, { name: 'exactAmount', type: 'uint128' },
    { name: 'hookData', type: 'bytes' },
  ] }],
  outputs: [{ name: 'amountOut', type: 'uint256' }, { name: 'gasEstimate', type: 'uint256' }],
}] as const

export const UNISWAP_V4_STATE_VIEW_ABI = [
  { name: 'getSlot0', type: 'function', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' },
  ] },
  { name: 'getLiquidity', type: 'function', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'liquidity', type: 'uint128' }] },
] as const

export interface UniswapV4PoolRef {
  id: Hex
  token0: Address
  token1: Address
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
  native: boolean
  volume24: number
}

type DexPair = {
  pairAddress?: string
  labels?: string[]
  baseToken?: { address?: string }
  quoteToken?: { address?: string }
  volume?: { h24?: number }
}

export async function discoverUniswapV4Pools(
  client: any,
  tokens: Address[],
  weth: Address,
  minVolumeUsd: number,
): Promise<UniswapV4PoolRef[]> {
  const allowed = new Set(tokens.map(t => t.toLowerCase()))
  const candidates = new Map<string, { id: Hex; volume24: number }>()

  for (const token of tokens) {
    try {
      const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`)
      const pairs = await response.json() as DexPair[]
      for (const pair of pairs) {
        if (!pair.labels?.includes('v4') || !pair.pairAddress || pair.pairAddress.length !== 66) continue
        const volume24 = Number(pair.volume?.h24 ?? 0)
        if (volume24 < minVolumeUsd) continue
        const a = (pair.baseToken?.address ?? '').toLowerCase()
        const b = (pair.quoteToken?.address ?? '').toLowerCase()
        const aOk = allowed.has(a) || a === NATIVE_CURRENCY
        const bOk = allowed.has(b) || b === NATIVE_CURRENCY
        if (!aOk || !bOk) continue
        candidates.set(pair.pairAddress.toLowerCase(), { id: pair.pairAddress as Hex, volume24 })
      }
    } catch { /* keep the live bot running if the indexer is temporarily unavailable */ }
  }

  const refs: UniswapV4PoolRef[] = []
  for (const candidate of candidates.values()) {
    try {
      const logs = await client.getLogs({
        address: UNISWAP_V4.poolManager,
        event: UNISWAP_V4_INITIALIZE_EVENT,
        args: { id: candidate.id },
        fromBlock: POOL_MANAGER_DEPLOY_BLOCK,
        toBlock: 'latest',
      })
      const args = logs[0]?.args
      if (!args?.currency0 || !args?.currency1 || args.fee === undefined || args.tickSpacing === undefined || !args.hooks) continue
      const currency0 = getAddress(args.currency0)
      const currency1 = getAddress(args.currency1)
      const native = currency0 === NATIVE_CURRENCY
      const token0 = native ? weth : currency0
      const token1 = currency1
      if (!allowed.has(token0.toLowerCase()) || !allowed.has(token1.toLowerCase())) continue
      refs.push({
        id: candidate.id,
        token0, token1, currency0, currency1,
        fee: Number(args.fee), tickSpacing: Number(args.tickSpacing), hooks: getAddress(args.hooks),
        native, volume24: candidate.volume24,
      })
    } catch { /* invalid/spam pools are ignored */ }
  }
  return refs
}

export async function quoteUniswapV4ExactInput(
  client: any,
  pool: UniswapV4PoolRef,
  tokenIn: Address,
  amountIn: bigint,
): Promise<{ amountOut: bigint; gasEstimate: bigint } | null> {
  if (amountIn <= 0n) return null
  const zeroForOne = tokenIn.toLowerCase() === pool.token0.toLowerCase()
  try {
    const { result } = await client.simulateContract({
      address: UNISWAP_V4.quoter,
      abi: UNISWAP_V4_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: { currency0: pool.currency0, currency1: pool.currency1, fee: pool.fee, tickSpacing: pool.tickSpacing, hooks: pool.hooks },
        zeroForOne, exactAmount: amountIn, hookData: '0x',
      }],
    })
    const [amountOut, gasEstimate] = result as readonly [bigint, bigint]
    return amountOut > 0n ? { amountOut, gasEstimate } : null
  } catch {
    return null
  }
}
