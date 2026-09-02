import { createPublicClient, http, fallback, parseAbi, parseUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🔍 Simulating FRONG -> AEON swap transaction on Robinhood Chain...')

const USER_WALLET = getAddress('0x6d93ab63068f9b9f71c4c1144f0bcc4d3dcbb557') // From screenshot (bottom right in Rabby: 0x6d93ab...313a08)
const FRONG_TOKEN = TOKENS.FRONG.address
const AEON_TOKEN = CONTRACTS.AeonToken
const ROUTER = CONTRACTS.UniversalRouter
const FRONG_POOL = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be' as `0x${string}`

const AEON_UNIVERSAL_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens((uint8 poolType, address pool, address tokenIn, address tokenOut, uint24 feeBps, uint16 binStep, int24 tickSpacing, bool v4Native)[] hops, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

async function simulate() {
  try {
    const amountIn = parseUnits('1280.858681', 18)
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200)

    // Check FRONG balance & allowance for user
    const bal = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'balanceOf', args: [USER_WALLET] })
    const allow = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'allowance', args: [USER_WALLET, ROUTER] })

    console.log(`User FRONG Balance: ${bal.toString()}`)
    console.log(`User FRONG Allowance to Router: ${allow.toString()}`)

    const hops = [{
      poolType: 0,
      pool: FRONG_POOL,
      tokenIn: FRONG_TOKEN,
      tokenOut: AEON_TOKEN,
      feeBps: 100, // 1%
      binStep: 0,
      tickSpacing: 0,
      v4Native: false,
    }]

    // 0.5% slippage -> min output ~ 18.73 AEON
    const minOut = parseUnits('18.731738', 18)

    console.log('Simulating swapExactTokensForTokens call...')
    const result = await publicClient.simulateContract({
      address: ROUTER,
      abi: AEON_UNIVERSAL_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [hops, amountIn, minOut, USER_WALLET, deadline],
      account: USER_WALLET,
    })

    console.log(`✅ Simulation Success! Result: ${result.result.toString()}`)
  } catch (err: any) {
    console.error('❌ Simulation Error details:')
    console.error(err?.shortMessage ?? err?.message ?? err)
    if (err?.cause) {
      console.error('Cause:', err.cause)
    }
  }
}

simulate()
