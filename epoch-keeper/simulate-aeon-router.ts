import { createPublicClient, http, fallback, parseAbi, parseUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🔍 Testing AeonRouter vs UniversalRouter simulation...')

const USER_WALLET = getAddress('0x6d93ab63068f9b9f71c4c1144f0bcc4d3dcbb557')
const FRONG_TOKEN = TOKENS.FRONG.address
const AEON_TOKEN = CONTRACTS.AeonToken
const FRONG_POOL = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be' as `0x${string}`

const AEON_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens((address tokenIn, address tokenOut, address pool, uint8 poolType, uint24 feeBps)[] routes, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)',
])

const AEON_UNIVERSAL_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens((uint8 poolType, address pool, address tokenIn, address tokenOut, uint24 feeBps, uint16 binStep, int24 tickSpacing, bool v4Native)[] hops, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)',
])

async function testAeonRouter() {
  const amountIn = parseUnits('1280.858681', 18)
  const minOut = 0n // 0 for test
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

  console.log('\n--- 1. Testing AeonRouter (0x4d188106175De919a971B0cB6F8A0e3E885a3410) ---')
  const routes = [{
    tokenIn: FRONG_TOKEN,
    tokenOut: AEON_TOKEN,
    pool: FRONG_POOL,
    poolType: 0,
    feeBps: 100,
  }]

  try {
    const res1 = await publicClient.simulateContract({
      address: CONTRACTS.AeonRouter,
      abi: AEON_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [routes, amountIn, minOut, USER_WALLET, deadline],
      account: USER_WALLET,
    })
    console.log(`✅ AeonRouter Simulation SUCCESS! Output: ${formatUnits(res1.result, 18)} AEON`)
  } catch (e: any) {
    console.error('❌ AeonRouter simulation failed:', e?.shortMessage ?? e?.message ?? e)
  }

  console.log('\n--- 2. Testing UniversalRouter (0x63af965c901230667d3ff8e0a9dc0959563f5aa2) ---')
  const hops = [{
    poolType: 0,
    pool: FRONG_POOL,
    tokenIn: FRONG_TOKEN,
    tokenOut: AEON_TOKEN,
    feeBps: 100,
    binStep: 0,
    tickSpacing: 0,
    v4Native: false,
  }]

  try {
    const res2 = await publicClient.simulateContract({
      address: CONTRACTS.UniversalRouter,
      abi: AEON_UNIVERSAL_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [hops, amountIn, minOut, USER_WALLET, deadline],
      account: USER_WALLET,
    })
    console.log(`✅ UniversalRouter Simulation SUCCESS! Output: ${formatUnits(res2.result, 18)} AEON`)
  } catch (e: any) {
    console.error('❌ UniversalRouter simulation failed:', e?.shortMessage ?? e?.message ?? e)
  }
}

testAeonRouter()
