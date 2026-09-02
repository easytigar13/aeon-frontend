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
  'function distributeAll()',
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

const MULTI_GAUGE_ABI = parseAbi([
  'function getPools() view returns (address[])',
  'function distributeBatch(address[] poolList, uint256 epoch) returns (uint256)',
])

const WEEK = 604800n

async function run() {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (now / WEEK) * WEEK
  const ethBal = await publicClient.getBalance({ address: account.address })
  let nonce = await publicClient.getTransactionCount({ address: account.address })

  console.log(`=================================================================`)
  console.log(`            AEON PROTOCOL FORCE DISTRIBUTE EXECUTION             `)
  console.log(`=================================================================`)
  console.log(`Executor Address: ${account.address}`)
  console.log(`Gas ETH Balance : ${formatUnits(ethBal, 18)} ETH`)
  console.log(`Starting Nonce  : ${nonce}`)
  console.log(`Current Epoch   : ${currentEpoch} (${new Date(Number(currentEpoch) * 1000).toISOString()})`)
  console.log(`-----------------------------------------------------------------\n`)

  // 1. FeeDistributor snapshot
  console.log(`=== 1. FeeDistributor.snapshotEpoch() ===`)
  const lastSnapshotPeriod = await publicClient.readContract({ address: CONTRACTS.FeeDistributor, abi: FEE_DIST_ABI, functionName: 'lastSnapshotPeriod' })
  console.log(`FeeDistributor Snapshot Period: ${lastSnapshotPeriod} (${new Date(Number(lastSnapshotPeriod) * 1000).toISOString()})`)

  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.FeeDistributor,
      abi: FEE_DIST_ABI,
      functionName: 'snapshotEpoch',
      gas: 500_000n,
      nonce: nonce++,
    })
    console.log(`  [OK] FeeDistributor.snapshotEpoch() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] FeeDistributor.snapshotEpoch(): ${e?.shortMessage || e?.message || e}`)
  }

  // 2. EmissionsEngine updatePeriod
  console.log(`\n=== 2. EmissionsEngine.updatePeriod() ===`)
  const activePeriod = await publicClient.readContract({ address: CONTRACTS.EmissionsEngine, abi: ENGINE_ABI, functionName: 'activePeriod' })
  console.log(`EmissionsEngine Active Period : ${activePeriod} (${new Date(Number(activePeriod) * 1000).toISOString()})`)

  if (currentEpoch > activePeriod) {
    console.log(`Epoch boundary passed! Triggering updatePeriod()...`)
    try {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.EmissionsEngine,
        abi: ENGINE_ABI,
        functionName: 'updatePeriod',
        gas: 1_000_000n,
        nonce: nonce++,
      })
      console.log(`  [OK] EmissionsEngine.updatePeriod() submitted | Tx: ${hash}`)
      await publicClient.waitForTransactionReceipt({ hash })
    } catch (e) {
      console.log(`  [FAIL] EmissionsEngine.updatePeriod(): ${e?.shortMessage || e?.message || e}`)
    }
  } else {
    console.log(`EmissionsEngine active period is current (${activePeriod}). Next epoch mint activates in ~${(Number(activePeriod + WEEK - now) / 3600).toFixed(1)} hours.`)
  }

  // 3. AeonVoter distributeAll
  console.log(`\n=== 3. AeonVoter.distributeAll() ===`)
  try {
    const hash = await walletClient.writeContract({
      address: CONTRACTS.AeonVoter,
      abi: VOTER_ABI,
      functionName: 'distributeAll',
      gas: 15_000_000n,
      nonce: nonce++,
    })
    console.log(`  [OK] AeonVoter.distributeAll() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] AeonVoter.distributeAll(): ${e?.shortMessage || e?.message || e}`)
  }

  // 3b. MultiGaugeController distributeBatch
  console.log(`\n=== 3b. MultiGaugeController.distributeBatch() ===`)
  try {
    const mgPools = await publicClient.readContract({
      address: CONTRACTS.MultiGaugeController,
      abi: MULTI_GAUGE_ABI,
      functionName: 'getPools'
    })
    if (mgPools && mgPools.length > 0) {
      const hash = await walletClient.writeContract({
        address: CONTRACTS.MultiGaugeController,
        abi: MULTI_GAUGE_ABI,
        functionName: 'distributeBatch',
        args: [mgPools, activePeriod],
        gas: 10_000_000n,
        nonce: nonce++,
      })
      console.log(`  [OK] MultiGaugeController.distributeBatch() submitted (${mgPools.length} pools) | Tx: ${hash}`)
      await publicClient.waitForTransactionReceipt({ hash })
    }
  } catch (e) {
    console.log(`  [INFO] MultiGaugeController.distributeBatch(): ${e?.shortMessage || e?.message || e}`)
  }

  // 4. BuybackEngine routeBuyback & processDeferred
  console.log(`\n=== 4. BuybackEngine.routeBuyback() & processDeferred() ===`)
  const poolCount = await publicClient.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length' })
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
          nonce: nonce++,
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
      nonce: nonce++,
    })
    console.log(`  [OK] BuybackEngine.processDeferred() submitted | Tx: ${hash}`)
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (e) {
    console.log(`  [INFO] BuybackEngine.processDeferred(): ${e?.shortMessage || e?.message || e}`)
  }

  console.log(`\n=================================================================`)
  console.log(`               FORCE DISTRIBUTE COMPLETE                         `)
  console.log(`=================================================================`)
}

run().catch(e => console.error("EXECUTION FAILED:", e))
