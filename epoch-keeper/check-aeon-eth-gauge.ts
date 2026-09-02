import { createPublicClient, http, fallback, parseAbi, formatUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const GAUGE_ABI = parseAbi([
  'function rewardRate() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
])

const GAUGE_AEON_ETH = getAddress('0xbA44AAa52ba84B3c1E0F77D37a702664568b53DE')

async function inspectGauge() {
  try {
    console.log(`🔍 Inspecting AEON/ETH Gauge: ${GAUGE_AEON_ETH}`)
    const rate = await publicClient.readContract({ address: GAUGE_AEON_ETH, abi: GAUGE_ABI, functionName: 'rewardRate' })
    const total = await publicClient.readContract({ address: GAUGE_AEON_ETH, abi: GAUGE_ABI, functionName: 'totalSupply' })
    const finish = await publicClient.readContract({ address: GAUGE_AEON_ETH, abi: GAUGE_ABI, functionName: 'periodFinish' })

    const now = BigInt(Math.floor(Date.now() / 1000))

    console.log(`- rewardRate: ${rate.toString()} (${formatUnits(rate * 604800n, 18)} AEON/week)`)
    console.log(`- totalSupply: ${formatUnits(total, 18)}`)
    console.log(`- periodFinish: ${finish.toString()} (now: ${now.toString()}, active: ${finish > now})`)
  } catch (err: any) {
    console.error('❌ Error inspecting gauge:', err?.message ?? err)
  }
}

inspectGauge()
