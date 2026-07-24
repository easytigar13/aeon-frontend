import { createPublicClient, http, fallback, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS, POOLS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🔍 Checking live on-chain balances across all protocol contracts...')

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const TARGET_TOKENS = [
  { symbol: 'AEON', address: CONTRACTS.AeonToken, decimals: 18 },
  { symbol: 'WETH', address: TOKENS.WETH.address, decimals: 18 },
  { symbol: 'USDG', address: TOKENS.USDG.address, decimals: 6 },
  { symbol: 'VIRTUAL', address: TOKENS.VIRTUAL.address, decimals: 18 },
  { symbol: 'ROBINFUN', address: TOKENS.ROBINFUN.address, decimals: 18 },
  { symbol: 'CASHCAT', address: TOKENS.CASHCAT.address, decimals: 18 },
]

async function checkBalances() {
  try {
    console.log(`\n======================================================`)
    console.log(`🏦 FEE DISTRIBUTOR BALANCE (${CONTRACTS.FeeDistributor})`)
    console.log(`======================================================`)

    for (const t of TARGET_TOKENS) {
      const bal = await publicClient.readContract({
        address: t.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [CONTRACTS.FeeDistributor],
      })
      if (bal > 0n) {
        console.log(`  - ${t.symbol}: ${formatUnits(bal, t.decimals)}`)
      }
    }

    console.log(`\n======================================================`)
    console.log(`🏦 LEGACY FEE DISTRIBUTOR BALANCE (${CONTRACTS.FeeDistributor})`)
    console.log(`======================================================`)

    const LEGACY_FD = '0x772C2Ba92278D47B3A76b3f97b26A5c74d7F7975' as `0x${string}`
    for (const t of TARGET_TOKENS) {
      const bal = await publicClient.readContract({
        address: t.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [LEGACY_FD],
      })
      if (bal > 0n) {
        console.log(`  - ${t.symbol}: ${formatUnits(bal, t.decimals)}`)
      }
    }

    console.log(`\n======================================================`)
    console.log(`🏦 BUYBACK ENGINE BALANCE (${CONTRACTS.BuybackEngine})`)
    console.log(`======================================================`)

    for (const t of TARGET_TOKENS) {
      const bal = await publicClient.readContract({
        address: t.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [CONTRACTS.BuybackEngine],
      })
      if (bal > 0n) {
        console.log(`  - ${t.symbol}: ${formatUnits(bal, t.decimals)}`)
      }
    }

  } catch (err: any) {
    console.error('❌ Check failed:', err?.message ?? err)
  }
}

checkBalances()
