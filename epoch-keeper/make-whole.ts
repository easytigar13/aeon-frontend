import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits } from 'viem'
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

console.log(`🚀 Executing Make-Whole remediation script using account: ${account.address}`)

const WEEK = 604800n

const GAUGE_ABI = parseAbi([
  'function notifyRewardAmount(uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
  'function earned(address) view returns (uint256)',
  'function rewardRate() view returns (uint256)',
])

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
  'function distributeAll()',
])

const ENGINE_ABI = parseAbi([
  'function activePeriod() view returns (uint256)',
  'function updatePeriod() returns (uint256)',
])

const FEE_DIST_ABI = parseAbi([
  'function lastEpochFeesUSD() view returns (uint256)',
  'function snapshotEpoch()',
])

async function runMakeWhole() {
  try {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const currentEpoch = (now / WEEK) * WEEK
    const closedEpoch = currentEpoch - WEEK

    console.log(`📅 Current Epoch: ${currentEpoch} | Closed Epoch: ${closedEpoch}`)

    // 1. Check FeeDistributor status
    const lastFeesUsdRaw = await publicClient.readContract({
      address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'lastEpochFeesUSD',
    })
    console.log(`💵 FeeDistributor lastEpochFeesUSD: $${formatUnits(lastFeesUsdRaw, 18)}`)

    // 2. Read pools and gauge balances
    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })
    console.log(`📊 Total Registered Pools: ${poolCount}`)

    let gaugesWithActiveRate = 0
    for (let i = 0n; i < poolCount; i++) {
      const pool = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i],
      })
      const gauge = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges', args: [pool],
      })
      if (gauge === '0x0000000000000000000000000000000000000000') continue

      const rewardRate = await publicClient.readContract({
        address: gauge, abi: GAUGE_ABI, functionName: 'rewardRate',
      })
      if (rewardRate > 0n) {
        gaugesWithActiveRate++
      }
    }

    console.log(`✅ Gauges actively emitting rewards: ${gaugesWithActiveRate} / ${poolCount}`)
    console.log('🎉 Make-Whole evaluation completed successfully.')
  } catch (err: any) {
    console.error('❌ Error during Make-Whole execution:', err?.message ?? err)
  }
}

runMakeWhole()
