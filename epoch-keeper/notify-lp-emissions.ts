import { createPublicClient, createWalletClient, http, fallback, parseAbi, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const PK = (process.env.DEPLOYER_PK ?? '') as `0x${string}`

if (!PK) {
  console.error('❌ Error: DEPLOYER_PK is not set in epoch-keeper/.env')
  process.exit(1)
}

const account = privateKeyToAccount(PK)
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })
const walletClient = createWalletClient({ account, chain: robinhoodChain, transport })

console.log(`🚀 Executing LP Gauge Emission Notification using account: ${account.address}`)

const GAUGE_ABI = parseAbi([
  'function notifyRewardAmount(uint256 amount)',
  'function rewardRate() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
])

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
  'function distributeAll()',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
])

async function notifyGauges() {
  try {
    const totalWeight = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
    })
    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })

    console.log(`📊 Total Voter Weight: ${totalWeight.toString()} across ${poolCount} pools`)

    // Call distributeAll to push gauge rewards
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'distributeAll', gas: 15_000_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      console.log('✅ AeonVoter.distributeAll() executed successfully')
    } catch (e: any) {
      console.log(`ℹ️ distributeAll info: ${e?.shortMessage ?? e?.message}`)
    }

    console.log('🎉 LP Gauge Emission Notification completed successfully.')
  } catch (err: any) {
    console.error('❌ LP Gauge Emission Notification failed:', err?.message ?? err)
  }
}

notifyGauges()
