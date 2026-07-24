import { createPublicClient, http, fallback, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

console.log('🚀 Generating per-pool breakdown for Voters and LPs...')

const GAUGE_ABI = parseAbi([
  'function rewardRate() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function periodFinish() view returns (uint256)',
])

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
])

const FEE_DIST_ABI = parseAbi([
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function poolTokenEpochFees(address,address,uint256) view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

const WEEK = 604800n

async function generateReport() {
  try {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const currentEpoch = (now / WEEK) * WEEK
    const closedEpoch = currentEpoch - WEEK

    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })
    const totalWeight = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
    })

    console.log(`\n======================================================`)
    console.log(`📊 PROTOCOL REWARD BREAKDOWN (Epoch: ${closedEpoch.toString()})`)
    console.log(`Total Voter Weight: ${formatUnits(totalWeight, 18)}`)
    console.log(`======================================================\n`)

    const activePools: any[] = []

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

      if (weight === 0n && gauge === '0x0000000000000000000000000000000000000000') continue

      let rewardRate = 0n
      let weeklyEmissionsAeon = 0
      if (gauge !== '0x0000000000000000000000000000000000000000') {
        try {
          rewardRate = await publicClient.readContract({
            address: gauge, abi: GAUGE_ABI, functionName: 'rewardRate',
          })
          weeklyEmissionsAeon = Number(formatUnits(rewardRate * WEEK, 18))
        } catch {}
      }

      const weightPct = totalWeight > 0n ? (Number(weight) / Number(totalWeight)) * 100 : 0

      // Check fee tokens collected for closed epoch
      const feeTokens: string[] = []
      for (let ti = 0n; ti < 4n; ti++) {
        try {
          const tokenAddr = await publicClient.readContract({
            address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'poolEpochTokens', args: [pool, closedEpoch, ti],
          }) as `0x${string}`
          if (tokenAddr && tokenAddr !== '0x0000000000000000000000000000000000000000') {
            const amount = await publicClient.readContract({
              address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'poolTokenEpochFees', args: [pool, tokenAddr, closedEpoch],
            })
            if (amount > 0n) {
              let sym = tokenAddr.slice(0, 6)
              let dec = 18
              try {
                sym = await publicClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'symbol' })
                dec = await publicClient.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: 'decimals' })
              } catch {}
              feeTokens.push(`${formatUnits(amount, dec)} ${sym}`)
            }
          }
        } catch { break }
      }

      if (weight > 0n || weeklyEmissionsAeon > 0 || feeTokens.length > 0) {
        activePools.push({
          pool,
          gauge,
          weightFmt: formatUnits(weight, 18),
          weightPct: weightPct.toFixed(2),
          weeklyEmissionsAeon: weeklyEmissionsAeon.toFixed(4),
          feeTokens: feeTokens.length > 0 ? feeTokens.join(', ') : 'None',
        })
      }
    }

    console.log(`Active Pools Found: ${activePools.length}\n`)
    console.table(activePools)
  } catch (err: any) {
    console.error('❌ Report generation failed:', err?.message ?? err)
  }
}

generateReport()
