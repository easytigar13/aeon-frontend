import { createPublicClient, http, fallback, parseAbi, formatUnits, parseUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS, POOLS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🔍 Inspecting FRONG -> AEON swap parameters and pool state...')

const FRONG_TOKEN = TOKENS.FRONG.address
const AEON_TOKEN = CONTRACTS.AeonToken
const ROUTER = CONTRACTS.UniversalRouter

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) view returns (uint256 amountOut, uint8 poolType, address poolAddress)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)',
])

async function diagnose() {
  try {
    console.log(`Token FRONG: ${FRONG_TOKEN}`)
    console.log(`Token AEON: ${AEON_TOKEN}`)
    console.log(`UniversalRouter: ${ROUTER}`)

    // Search POOLS array for FRONG
    const frongPool = POOLS.find(p => p.token0 === 'FRONG' || p.token1 === 'FRONG' || p.name.includes('FRONG'))
    console.log('FRONG Pool Configured:', frongPool)

    if (frongPool) {
      const res = await publicClient.readContract({ address: frongPool.address, abi: PAIR_ABI, functionName: 'getReserves' })
      const t0 = await publicClient.readContract({ address: frongPool.address, abi: PAIR_ABI, functionName: 'token0' })
      const isFrongT0 = t0.toLowerCase() === FRONG_TOKEN.toLowerCase()
      const reserveFrong = isFrongT0 ? res[0] : res[1]
      const reserveAeon = isFrongT0 ? res[1] : res[0]

      console.log(`Pool Reserves (${frongPool.address}):`)
      console.log(`  - FRONG Reserve: ${formatUnits(reserveFrong, 18)}`)
      console.log(`  - AEON Reserve: ${formatUnits(reserveAeon, 18)}`)

      // Check user amountIn = 1280.858681 FRONG
      const amountIn = parseUnits('1280.858681', 18)
      console.log(`Testing AmountIn: ${formatUnits(amountIn, 18)} FRONG`)

      // Test quote from UniversalRouter
      try {
        const quote = await publicClient.readContract({
          address: ROUTER, abi: UNIVERSAL_ROUTER_ABI, functionName: 'getAmountOut',
          args: [amountIn, FRONG_TOKEN, AEON_TOKEN],
        })
        console.log(`UniversalRouter Quote: ${formatUnits(quote[0], 18)} AEON (poolType: ${quote[1]}, pool: ${quote[2]})`)
      } catch (quoteErr: any) {
        console.error('❌ UniversalRouter quote failed:', quoteErr?.shortMessage ?? quoteErr?.message ?? quoteErr)
      }
    } else {
      console.error('❌ FRONG pool not found in POOLS array!')
    }
  } catch (err: any) {
    console.error('❌ Diagnosis failed:', err?.message ?? err)
  }
}

diagnose()
