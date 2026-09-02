import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const PK = process.env.DEPLOYER_PK

if (!PK) {
  console.error("DEPLOYER_PK not found in .env")
  process.exit(1)
}

const account = privateKeyToAccount(PK)
const publicClient = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: robinhoodChain, transport: http(RPC_URL) })

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
])

const FEE_DIST_ABI = parseAbi([
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function routeBuyback(address pool, uint256 epoch, address token)',
  'function lastSnapshotPeriod() view returns (uint256)',
])

const BUYBACK_ABI = parseAbi([
  'function processDeferred()',
])

const WEEK = 604800n

async function run() {
  const nonce = await publicClient.getTransactionCount({ address: account.address })
  const poolCount = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length' })
  const activePeriod = await publicClient.readContract({ address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'lastSnapshotPeriod' })
  const finalizedEpoch = activePeriod - WEEK

  console.log(`Discovering fee tokens for epoch ${finalizedEpoch} across ${poolCount} pools...`)

  const poolCalls = Array.from({ length: Number(poolCount) }, (_, i) => ({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [BigInt(i)]
  }))
  const poolRes = await publicClient.multicall({ contracts: poolCalls, allowFailure: true })
  const pools = poolRes.map(r => r.result).filter(Boolean)

  const discCalls = []
  pools.forEach(p => {
    for (let ti = 0n; ti < 4n; ti++) {
      discCalls.push({
        address: CONTRACTS.FeeDistributor,
        abi: FEE_DIST_ABI,
        functionName: 'poolEpochTokens',
        args: [p, finalizedEpoch, ti]
      })
    }
  })

  const discRes = await publicClient.multicall({ contracts: discCalls, allowFailure: true })
  const buybackTargets = []

  discRes.forEach((r, idx) => {
    if (r.status === 'success' && r.result && r.result !== '0x0000000000000000000000000000000000000000') {
      const pool = pools[Math.floor(idx / 4)]
      buybackTargets.push({ pool, token: r.result })
    }
  })

  console.log(`Found ${buybackTargets.length} active fee tokens to route for buyback.`)

  let txNonce = nonce
  for (const { pool, token } of buybackTargets) {
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.FeeDistributor,
        abi: FEE_DIST_ABI,
        functionName: 'routeBuyback',
        args: [pool, finalizedEpoch, token],
        gas: 3_000_000n,
        nonce: txNonce++,
      })
      console.log(`  [OK] routeBuyback(${pool.slice(0, 10)}, ${token.slice(0, 10)}) | Tx: ${hash}`)
      await publicClient.waitForTransactionReceipt({ hash })
    } catch (e) {
      console.log(`  [INFO] routeBuyback: ${e?.shortMessage || e?.message || e}`)
    }
  }

  console.log(`Executing BuybackEngine.processDeferred()...`)
  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.BuybackEngine,
      abi: BUYBACK_ABI,
      functionName: 'processDeferred',
      gas: 6_000_000n,
      nonce: txNonce++,
    })
    console.log(`  [OK] BuybackEngine.processDeferred() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] BuybackEngine.processDeferred(): ${e?.shortMessage || e?.message || e}`)
  }

  console.log(`Buyback process complete!`)
}

run().catch(e => console.error(e))
