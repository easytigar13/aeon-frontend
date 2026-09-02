import { createPublicClient, http, fallback, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const EMISSIONS_ENGINE_ABI = parseAbi([
  'function activePeriod() view returns (uint256)',
  'function lastFeesUSD() view returns (uint256)',
  'function updatePeriod() returns (uint256)',
])

async function checkEmissionsEngine() {
  try {
    console.log(`🔍 Inspecting EmissionsEngine: ${CONTRACTS.EmissionsEngine}`)
    const active = await publicClient.readContract({ address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'activePeriod' })
    const lastFees = await publicClient.readContract({ address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'lastFeesUSD' })
    const now = BigInt(Math.floor(Date.now() / 1000))

    console.log(`- activePeriod: ${active.toString()} (now: ${now.toString()})`)
    console.log(`- lastFeesUSD: $${formatUnits(lastFees, 18)}`)
  } catch (err: any) {
    console.error('❌ EmissionsEngine check failed:', err?.message ?? err)
  }
}

checkEmissionsEngine()
