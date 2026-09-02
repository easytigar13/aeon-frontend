import { createPublicClient, http, fallback, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const POOL_ADDR = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be' as `0x${string}`

const POOL_FULL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function stable() view returns (bool)',
  'function fee() view returns (uint256)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)',
])

async function inspectPool() {
  try {
    console.log(`🔍 Inspecting FRONG/AEON Pool Contract (${POOL_ADDR}):`)
    const t0 = await publicClient.readContract({ address: POOL_ADDR, abi: POOL_FULL_ABI, functionName: 'token0' })
    const t1 = await publicClient.readContract({ address: POOL_ADDR, abi: POOL_FULL_ABI, functionName: 'token1' })
    let isStable = false
    try {
      isStable = await publicClient.readContract({ address: POOL_ADDR, abi: POOL_FULL_ABI, functionName: 'stable' })
    } catch {}

    const res = await publicClient.readContract({ address: POOL_ADDR, abi: POOL_FULL_ABI, functionName: 'getReserves' })

    console.log(`- token0: ${t0}`)
    console.log(`- token1: ${t1}`)
    console.log(`- stable: ${isStable}`)
    console.log(`- reserve0: ${formatUnits(res[0], 18)}`)
    console.log(`- reserve1: ${formatUnits(res[1], 18)}`)

    // Try pool.getAmountOut directly
    try {
      const out = await publicClient.readContract({
        address: POOL_ADDR, abi: POOL_FULL_ABI, functionName: 'getAmountOut',
        args: [1280858681000000000000n, t0],
      })
      console.log(`✅ Direct pool.getAmountOut: ${formatUnits(out, 18)}`)
    } catch (e: any) {
      console.log(`❌ Direct pool.getAmountOut failed: ${e?.shortMessage ?? e?.message}`)
    }
  } catch (err: any) {
    console.error('❌ Pool inspection failed:', err?.message ?? err)
  }
}

inspectPool()
