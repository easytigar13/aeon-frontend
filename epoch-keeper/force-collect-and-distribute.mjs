import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, POOLS } from '../src/config/contracts.ts'
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
  'function gauges(address) view returns (address)',
  'function isAlive(address) view returns (bool)',
  'function distributeAll()',
])

const GAUGE_ABI = parseAbi([
  'function collectFees()',
])

const FEE_DIST_ABI = parseAbi([
  'function snapshotEpoch()',
  'function lastSnapshotPeriod() view returns (uint256)',
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function routeBuyback(address pool, uint256 epoch, address token)',
])

const ENGINE_ABI = parseAbi([
  'function updatePeriod() returns (uint256)',
  'function activePeriod() view returns (uint256)',
])

const BUYBACK_ABI = parseAbi([
  'function processDeferred()',
])

const WEEK = 604800n

async function run() {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (now / WEEK) * WEEK
  const ethBal = await publicClient.getBalance({ address: account.address })

  console.log(`=================================================================`)
  console.log(`         AEON PROTOCOL FORCE COLLECT & DISTRIBUTE EXECUTION      `)
  console.log(`=================================================================`)
  console.log(`Executor Address: ${account.address}`)
  console.log(`Gas ETH Balance : ${formatUnits(ethBal, 18)} ETH`)
  console.log(`Current Epoch   : ${currentEpoch} (${new Date(Number(currentEpoch) * 1000).toISOString()})`)
  console.log(`-----------------------------------------------------------------\n`)

  if (ethBal === 0n) {
    console.error("ERROR: Executor wallet has 0 ETH for gas! Cannot execute on-chain transactions.")
    process.exit(1)
  }

  // STEP 1: FORCE SWEEP FEES ACROSS ALL GAUGES
  console.log(`=== STEP 1: SWEEPING FEES FROM ALL POOL VAULTS TO FEE DISTRIBUTOR ===`)
  const poolCount = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length' })
  let sweptCount = 0
  let skippedCount = 0
  let failCount = 0

  for (let i = 0n; i < poolCount; i++) {
    const pool = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i] })
    const gauge = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges', args: [pool] })

    if (!gauge || gauge === '0x0000000000000000000000000000000000000000') {
      skippedCount++
      continue
    }

    const isAlive = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'isAlive', args: [gauge] }).catch(() => false)
    if (!isAlive) {
      skippedCount++
      continue
    }

    const matchPool = POOLS.find(x => x.address.toLowerCase() === pool.toLowerCase())
    const poolName = matchPool ? matchPool.name : pool.slice(0, 10)

    try {
      // Simulate contract call first
      const sim = await publicClient.simulateContract({
        account,
        address: gauge,
        abi: GAUGE_ABI,
        functionName: 'collectFees',
        gas: 1_800_000n,
      })

      const hash = await walletClient.writeContract(sim.request)
      console.log(`  [OK] Swept fees for ${poolName.padEnd(18)} (Gauge: ${gauge}) | Tx: ${hash}`)
      await publicClient.waitForTransactionReceipt({ hash })
      sweptCount++
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e)
      if (msg.includes('nothing to collect') || msg.includes('zero') || msg.includes('revert')) {
        // Normal if pool has 0 fees accrued
        skippedCount++
      } else {
        console.log(`  [FAIL] ${poolName.padEnd(18)}: ${msg.slice(0, 120)}`)
        failCount++
      }
    }
  }

  console.log(`\nFee Sweep Summary: ${sweptCount} swept, ${skippedCount} skipped (empty/inactive), ${failCount} failed.\n`)

  // STEP 2: CHECK ACTIVE PERIOD AND TRIGGER EPOCH CLOSE / SNAPSHOT
  console.log(`=== STEP 2: CHECKING EPOCH SNAPSHOT & EMISSIONS ENGINE ===`)
  const activePeriod = await publicClient.readContract({ address: CONTRACTS.EmissionsEngine, abi: ENGINE_ABI, functionName: 'activePeriod' })
  const lastSnapshotPeriod = await publicClient.readContract({ address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'lastSnapshotPeriod' })

  console.log(`EmissionsEngine Active Period : ${activePeriod} (${new Date(Number(activePeriod) * 1000).toISOString()})`)
  console.log(`FeeDistributor Snapshot Period: ${lastSnapshotPeriod} (${new Date(Number(lastSnapshotPeriod) * 1000).toISOString()})`)

  // 2a. Snapshot fees on FeeDistributor
  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.FeeDistributor,
      abi: FEE_DIST_ABI,
      functionName: 'snapshotEpoch',
      gas: 500_000n,
    })
    console.log(`  [OK] FeeDistributor.snapshotEpoch() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] FeeDistributor.snapshotEpoch(): ${e?.shortMessage || e?.message || e}`)
  }

  // 2b. Check updatePeriod on EmissionsEngine
  if (currentEpoch > activePeriod) {
    console.log(`Epoch boundary has passed! Triggering updatePeriod() on EmissionsEngine...`)
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.EmissionsEngine,
        abi: ENGINE_ABI,
        functionName: 'updatePeriod',
        gas: 1_000_000n,
      })
      console.log(`  [OK] EmissionsEngine.updatePeriod() submitted | Tx: ${hash}`)
      await publicClient.waitForTransactionReceipt({ hash })
    } catch (e) {
      console.log(`  [FAIL] EmissionsEngine.updatePeriod(): ${e?.shortMessage || e?.message || e}`)
    }
  } else {
    console.log(`EmissionsEngine is already up to date for period ${activePeriod}. Next epoch mint triggers in ~${Number(activePeriod + WEEK - now) / 3600} hours.`)
  }

  // STEP 3: DISTRIBUTE EMISSIONS TO ALL GAUGES
  console.log(`\n=== STEP 3: DISTRIBUTING EMISSIONS TO VOTED GAUGES ===`)
  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.AeonVoter,
      abi: VOTER_ABI,
      functionName: 'distributeAll',
      gas: 15_000_000n,
    })
    console.log(`  [OK] AeonVoter.distributeAll() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] AeonVoter.distributeAll(): ${e?.shortMessage || e?.message || e}`)
  }

  // STEP 4: ROUTE BUYBACKS & PROCESS DEFERRED BURN REWARDS
  console.log(`\n=== STEP 4: ROUTING BUYBACKS & PROCESSING FURNACE BURN REWARDS ===`)
  const finalizedEpoch = activePeriod - WEEK
  let routedCount = 0

  for (let i = 0n; i < poolCount; i++) {
    const pool = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i] })
    for (let ti = 0n; ti < 4n; ti++) {
      let token
      try {
        token = await publicClient.readContract({
          address: CONTRACTS.FeeDistributor,
          abi: FEE_DIST_ABI,
          functionName: 'poolEpochTokens',
          args: [pool, finalizedEpoch, ti],
        })
      } catch { break }

      if (!token || token === '0x0000000000000000000000000000000000000000') break

      try {
        const hash = await walletClient.writeContract({
          address: CONTRACTS.FeeDistributor,
          abi: FEE_DIST_ABI,
          functionName: 'routeBuyback',
          args: [pool, finalizedEpoch, token],
          gas: 3_000_000n,
        })
        await publicClient.waitForTransactionReceipt({ hash })
        routedCount++
      } catch {}
    }
  }
  console.log(`  [OK] Routed buybacks for ${routedCount} fee streams.`)

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.BuybackEngine,
      abi: BUYBACK_ABI,
      functionName: 'processDeferred',
      gas: 6_000_000n,
    })
    console.log(`  [OK] BuybackEngine.processDeferred() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] BuybackEngine.processDeferred(): ${e?.shortMessage || e?.message || e}`)
  }

  console.log(`\n=================================================================`)
  console.log(`               FORCE COLLECT & DISTRIBUTE COMPLETE               `)
  console.log(`=================================================================`)
}

run().catch(e => console.error("EXECUTION FAILED:", e))
