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

console.log(`🚀 Direct Gauge Reward Rate Activation using account: ${account.address}`)

const GAUGE_ABI = parseAbi([
  'function notifyRewardAmount(uint256 amount)',
  'function rewardRate() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
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
  'function mint(address,uint256)',
])

async function fundGauges() {
  try {
    const totalWeight = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
    })
    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })

    console.log(`📊 Total Voter Weight: ${formatUnits(totalWeight, 18)} across ${poolCount} pools`)

    // Total weekly emission budget: 121.72 AEON
    const totalWeeklyEmissions = parseUnits('121.72', 18)

    // Check deployer AEON balance
    let deployerBal = await publicClient.readContract({
      address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    })
    console.log(`💼 Deployer AEON Balance: ${formatUnits(deployerBal, 18)} AEON`)

    if (deployerBal < totalWeeklyEmissions) {
      console.log('🔄 Attempting to mint AEON for emission budget...')
      try {
        const txMint = await walletClient.writeContract({
          address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'mint', args: [account.address, totalWeeklyEmissions],
        })
        await publicClient.waitForTransactionReceipt({ hash: txMint })
        deployerBal = await publicClient.readContract({
          address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
        })
        console.log(`✅ Minted! Deployer AEON Balance is now: ${formatUnits(deployerBal, 18)} AEON`)
      } catch (e: any) {
        console.log(`ℹ️ Mint info: ${e?.shortMessage ?? e?.message}`)
      }
    }

    // Now distribute to each gauge proportionally by weight
    for (let i = 0n; i < poolCount; i++) {
      const pool = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i],
      })
      const gauge = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges', args: [pool],
      })
      const weight = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'weights', args: [pool],
      })

      if (gauge === '0x0000000000000000000000000000000000000000' || weight === 0n) continue

      const gaugeShare = (totalWeeklyEmissions * weight) / totalWeight
      if (gaugeShare === 0n) continue

      console.log(`🎯 Funding Gauge ${gauge.slice(0, 8)}... (${formatUnits(gaugeShare, 18)} AEON)`)

      // Transfer AEON directly to gauge
      const txTransfer = await walletClient.writeContract({
        address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'transfer', args: [gauge, gaugeShare],
      })
      await publicClient.waitForTransactionReceipt({ hash: txTransfer })

      // Call notifyRewardAmount on gauge
      const txNotify = await walletClient.writeContract({
        address: gauge, abi: GAUGE_ABI, functionName: 'notifyRewardAmount', args: [gaugeShare], gas: 500_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash: txNotify })

      const newRate = await publicClient.readContract({
        address: gauge, abi: GAUGE_ABI, functionName: 'rewardRate',
      })
      console.log(`  ✅ Activated! rewardRate: ${formatUnits(newRate * 604800n, 18)} AEON/week`)
    }

    console.log('🎉 All LP Gauge Reward Rates successfully activated on-chain!')
  } catch (err: any) {
    console.error('❌ Gauge funding failed:', err?.message ?? err)
  }
}

fundGauges()
