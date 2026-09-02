import { createPublicClient, http, fallback, parseAbi, formatUnits, parseUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const REAL_WALLET = getAddress('0x6D93abF1E85698bE8D42A45C334A081B15913a08')
const FRONG_TOKEN = TOKENS.FRONG.address
const UNIVERSAL_ROUTER = CONTRACTS.UniversalRouter
const AEON_ROUTER = CONTRACTS.AeonRouter

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

const AEON_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens((address tokenIn, address tokenOut, address pool, uint8 poolType, uint24 feeBps)[] routes, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)',
])

const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens((uint8 poolType, address pool, address tokenIn, address tokenOut, uint24 feeBps, uint16 binStep, int24 tickSpacing, bool v4Native)[] hops, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)',
])

async function checkRealWallet() {
  console.log(`🔍 Checking Real User Wallet: ${REAL_WALLET}`)

  const bal = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [REAL_WALLET] })
  const allowUni = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [REAL_WALLET, UNIVERSAL_ROUTER] })
  const allowAeon = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [REAL_WALLET, AEON_ROUTER] })

  console.log(`- FRONG Balance: ${formatUnits(bal, 18)} FRONG`)
  console.log(`- Allowance to UniversalRouter (${UNIVERSAL_ROUTER}): ${formatUnits(allowUni, 18)} FRONG`)
  console.log(`- Allowance to AeonRouter (${AEON_ROUTER}): ${formatUnits(allowAeon, 18)} FRONG`)

  const amountIn = parseUnits('1280.858681', 18)
  const minOut = parseUnits('18.731738', 18)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)
  const pool = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be' as `0x${string}`

  // Simulate on UniversalRouter
  console.log('\n--- Simulating UniversalRouter with REAL WALLET ---')
  try {
    const hops = [{
      poolType: 0,
      pool: pool,
      tokenIn: FRONG_TOKEN,
      tokenOut: CONTRACTS.AeonToken,
      feeBps: 100,
      binStep: 0,
      tickSpacing: 0,
      v4Native: false,
    }]
    const res = await publicClient.simulateContract({
      address: UNIVERSAL_ROUTER,
      abi: UNIVERSAL_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [hops, amountIn, minOut, REAL_WALLET, deadline],
      account: REAL_WALLET,
    })
    console.log(`✅ UniversalRouter Simulation SUCCESS! Output: ${formatUnits(res.result, 18)} AEON`)
  } catch (e: any) {
    console.error('❌ UniversalRouter Simulation Failed:')
    console.error(e?.shortMessage ?? e?.message ?? e)
  }

  // Simulate on AeonRouter
  console.log('\n--- Simulating AeonRouter with REAL WALLET ---')
  try {
    const routes = [{
      tokenIn: FRONG_TOKEN,
      tokenOut: CONTRACTS.AeonToken,
      pool: pool,
      poolType: 0,
      feeBps: 100,
    }]
    const res = await publicClient.simulateContract({
      address: AEON_ROUTER,
      abi: AEON_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [routes, amountIn, minOut, REAL_WALLET, deadline],
      account: REAL_WALLET,
    })
    console.log(`✅ AeonRouter Simulation SUCCESS! Output: ${formatUnits(res.result, 18)} AEON`)
  } catch (e: any) {
    console.error('❌ AeonRouter Simulation Failed:')
    console.error(e?.shortMessage ?? e?.message ?? e)
  }
}

checkRealWallet()
