import { getAddress, type Address } from 'viem'

export const UNISWAP_V3 = {
  factory: getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'),
  quoterV2: getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'),
  swapRouter02: getAddress('0xcaf681a66d020601342297493863e78c959e5cb2'),
} as const

export const UNISWAP_V3_FEE_TIERS = [100, 500, 3000, 10_000] as const

export const UNISWAP_V3_FACTORY_ABI = [{
  name: 'getPool', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }, { name: 'fee', type: 'uint24' }],
  outputs: [{ name: 'pool', type: 'address' }],
}] as const

export const UNISWAP_V3_POOL_ABI = [
  { name: 'factory', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'fee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'liquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { name: 'slot0', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' },
    { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' },
    { name: 'unlocked', type: 'bool' },
  ] },
] as const

export const UNISWAP_V3_QUOTER_ABI = [{
  name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' },
    { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }],
  outputs: [
    { name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' },
  ],
}] as const

export interface UniswapV3PoolRef {
  address: Address
  token0: Address
  token1: Address
  fee: number
  liquidity: bigint
}

// Kept deliberately client-agnostic because the keeper and test harness use
// different viem client generics while exposing the same methods.
export async function discoverUniswapV3Pools(
  client: any,
  tokens: Address[],
): Promise<UniswapV3PoolRef[]> {
  const refs: UniswapV3PoolRef[] = []
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      for (const fee of UNISWAP_V3_FEE_TIERS) {
        const raw = await client.readContract({
          address: UNISWAP_V3.factory, abi: UNISWAP_V3_FACTORY_ABI,
          functionName: 'getPool', args: [tokens[i], tokens[j], fee],
        }) as Address
        if (/^0x0{40}$/i.test(raw)) continue
        const address = getAddress(raw)
        const liquidity = await client.readContract({
          address, abi: UNISWAP_V3_POOL_ABI, functionName: 'liquidity',
        }) as bigint
        if (liquidity === 0n) continue
        refs.push({ address, token0: tokens[i], token1: tokens[j], fee, liquidity })
      }
    }
  }
  return refs
}

export async function quoteUniswapV3ExactInput(
  client: any,
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  amountIn: bigint,
): Promise<{ amountOut: bigint; gasEstimate: bigint } | null> {
  if (amountIn <= 0n) return null
  try {
    const { result } = await client.simulateContract({
      address: UNISWAP_V3.quoterV2,
      abi: UNISWAP_V3_QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    })
    const [amountOut, , , gasEstimate] = result as readonly [bigint, bigint, number, bigint]
    return amountOut > 0n ? { amountOut, gasEstimate } : null
  } catch {
    return null
  }
}
