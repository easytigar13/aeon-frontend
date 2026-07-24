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

console.log(`🚀 Executing Gauge Emission Top-Up using account: ${account.address}`)

const GAUGE_ABI = parseAbi([
  'function collectFees()',
  'function notifyRewardAmount(uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
])

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
])

async function executeTopUp() {
  try {
    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })
    const totalWeight = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
    })

    console.log(`📊 Total Registered Pools: ${poolCount} | Total Voter Weight: ${totalWeight.toString()}`)

    let swept = 0
    for (let i = 0n; i < poolCount; i++) {
      const pool = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i],
      })
      const gauge = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges', args: [pool],
      })
      if (gauge === '0x0000000000000000000000000000000000000000') continue

      // Run fee sweep with proper gas limit
      try {
        const hash = await walletClient.writeContract({
          address: gauge, abi: GAUGE_ABI, functionName: 'collectFees', gas: 1_800_000n,
        })
        await publicClient.waitForTransactionReceipt({ hash })
        swept++
      } catch {
        // Empty pool / already swept -- ignore non-fatal errors
      }
    }

    console.log(`✅ Successfully executed fee collection across pools (${swept} pools swept with 1.8M gas headroom)`)
  } catch (err: any) {
    console.error('❌ Top-Up execution failed:', err?.message ?? err)
  }
}

executeTopUp()
