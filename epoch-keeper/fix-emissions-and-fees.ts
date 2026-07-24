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

console.log(`🚀 Executing LP Emissions & Voter Fee Indexing using account: ${account.address}`)

const WEEK = 604800n

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
  'function distributeAll()',
])

const GAUGE_ABI = parseAbi([
  'function notifyRewardAmount(uint256 amount)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
])

async function executeFix() {
  try {
    const totalWeight = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
    })
    console.log(`📊 Total Voter Weight: ${formatUnits(totalWeight, 18)}`)

    // 121.72 AEON calculated for $80.34 USD emission value (25% of $321.34)
    const aeonAmount = parseUnits('121.72', 18)
    const deployerAeon = await publicClient.readContract({
      address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    })

    console.log(`💼 Deployer AEON Balance: ${formatUnits(deployerAeon, 18)} AEON`)

    if (deployerAeon >= aeonAmount) {
      console.log(`🔄 Transferring ${formatUnits(aeonAmount, 18)} AEON to AeonVoter for LP gauge distribution...`)
      const tx1 = await walletClient.writeContract({
        address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'transfer', args: [CONTRACTS.AeonVoter, aeonAmount],
      })
      await publicClient.waitForTransactionReceipt({ hash: tx1 })
      console.log('✅ AEON transferred to AeonVoter successfully')
    }

    console.log('🔄 Executing distributeAll() to update LP gauge reward rates...')
    const tx2 = await walletClient.writeContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'distributeAll', gas: 15_000_000n,
    })
    await publicClient.waitForTransactionReceipt({ hash: tx2 })
    console.log('🎉 LP Gauge Emissions successfully updated!')
  } catch (err: any) {
    console.error('❌ Execution failed:', err?.message ?? err)
  }
}

executeFix()
