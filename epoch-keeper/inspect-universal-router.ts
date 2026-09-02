import { createPublicClient, http, fallback, parseAbi, formatUnits, parseUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🔍 Inspecting UniversalRouter functions...')

const ROUTER = CONTRACTS.UniversalRouter
const FRONG_TOKEN = TOKENS.FRONG.address
const AEON_TOKEN = CONTRACTS.AeonToken

const ROUTER_FULL_ABI = parseAbi([
  'function pools(address tokenA, address tokenB) view returns (address)',
  'function poolType(address tokenA, address tokenB) view returns (uint8)',
])

const AEON_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable)[] routes) view returns (uint256[] amounts)',
])

async function checkRouter() {
  try {
    // 1. Check if UniversalRouter has FRONG/AEON registered in pools mapping
    try {
      const p = await publicClient.readContract({
        address: ROUTER, abi: ROUTER_FULL_ABI, functionName: 'pools', args: [FRONG_TOKEN, AEON_TOKEN],
      })
      console.log(`UniversalRouter.pools(FRONG, AEON): ${p}`)
    } catch (e: any) {
      console.log(`UniversalRouter.pools: ${e?.shortMessage ?? e?.message}`)
    }

    // 2. Check AeonRouter (0x4d188106175De919a971B0cB6F8A0e3E885a3410)
    console.log(`\n🔍 Checking AeonRouter (${CONTRACTS.AeonRouter}):`)
    try {
      const routes = [{ from: FRONG_TOKEN, to: AEON_TOKEN, stable: false }]
      const amountIn = parseUnits('1280.858681', 18)
      const amounts = await publicClient.readContract({
        address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'getAmountsOut',
        args: [amountIn, routes],
      })
      console.log(`✅ AeonRouter Quote: ${formatUnits(amounts[amounts.length - 1], 18)} AEON`)
    } catch (e: any) {
      console.log(`❌ AeonRouter getAmountsOut failed: ${e?.shortMessage ?? e?.message}`)
    }

  } catch (err: any) {
    console.error('❌ Check failed:', err?.message ?? err)
  }
}

checkRouter()
