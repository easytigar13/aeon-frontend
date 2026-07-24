import { createPublicClient, createWalletClient, http, fallback, parseAbi } from 'viem'
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

console.log(`🚀 Triggering 20% Buyback & Furnace Burn Redistribution using account: ${account.address}`)

const WEEK = 604800n

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
])

const FEE_DIST_ABI = parseAbi([
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function routeBuyback(address pool, uint256 epoch, address token)',
])

const BUYBACK_ABI = parseAbi([
  'function processDeferred()',
])

async function executeBuyback() {
  try {
    const now = BigInt(Math.floor(Date.now() / 1000))
    const currentEpoch = (now / WEEK) * WEEK
    const finalizedEpoch = currentEpoch - WEEK

    console.log(`📅 Finalized Epoch for Buyback: ${finalizedEpoch.toString()}`)

    const poolCount = await publicClient.readContract({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length',
    })

    let routed = 0
    for (let i = 0n; i < poolCount; i++) {
      const pool = await publicClient.readContract({
        address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i],
      })
      for (let ti = 0n; ti < 4n; ti++) {
        let token: `0x${string}`
        try {
          token = await publicClient.readContract({
            address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'poolEpochTokens', args: [pool, finalizedEpoch, ti],
          }) as `0x${string}`
        } catch { break }

        if (!token || token === '0x0000000000000000000000000000000000000000') continue

        try {
          const hash = await walletClient.writeContract({
            address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'routeBuyback',
            args: [pool, finalizedEpoch, token], gas: 3_000_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash })
          console.log(`  ✓ Routed buyback for pool ${pool.slice(0, 8)}... (${token})`)
          routed++
        } catch { /* already routed or zero fees */ }
      }
    }

    console.log(`✅ Routed buyback for ${routed} pool token streams.`)

    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.BuybackEngine, abi: BUYBACK_ABI, functionName: 'processDeferred', gas: 6_000_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      console.log('🔥 Executed BuybackEngine.processDeferred() — 50% burned + 50% to Furnace burners!')
    } catch (e: any) {
      console.log(`ℹ️ Buyback processDeferred status: ${e?.shortMessage ?? e?.message}`)
    }

    console.log('🎉 Buyback & Burn Redistribution completed successfully.')
  } catch (err: any) {
    console.error('❌ Buyback execution failed:', err?.message ?? err)
  }
}

executeBuyback()
