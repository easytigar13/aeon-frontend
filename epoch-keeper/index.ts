// Epoch-close keeper.
//
// Root cause this exists: nothing was periodically calling
// AeonGauge.collectFees() (permissionless, "usually called by a keeper" per
// its own doc comment), so real trading fees sat uncollected in the pools
// instead of flowing to FeeDistributor -- and nothing was calling
// snapshotEpoch()/updatePeriod()/distributeAll() when an epoch closed, so
// even collected fees never turned into a real, claimable mint. Both were
// being done by hand in a Claude session; this automates them.
//
// Fee collection is ONCE PER EPOCH, in the final window before the boundary
// (SWEEP_WINDOW_MS) -- NOT every tick. collectFees() pulls ALL fees a gauge
// has accrued whenever it's called, so a single end-of-epoch sweep captures
// the identical week of fees that 336 half-hourly sweeps would, for ~1/300th
// the gas. Critically, FeeDistributor.notifyFees() tags fees to the epoch in
// which collectFees() is CALLED (not when earned), so the sweep must land
// just before the boundary for the fees to belong to the closing epoch and
// be claimable by that epoch's voters. When the on-chain epoch boundary
// advances past what this keeper last processed:
// snapshotEpoch() -> updatePeriod() -> distributeAll(), then
// verify + top up any gauge whose real AEON balance doesn't match what
// distributeAll() told it to expect (AeonGauge.notifyRewardAmount() sets
// rewardRate but doesn't pull tokens -- known bug, fixed in AeonGaugeV2, but
// still present on whichever gauges VOTER_ADDRESS currently points at).
//
// VOTER_ADDRESS / FEE_DISTRIBUTOR_ADDRESS / EMISSIONS_ENGINE_ADDRESS are
// env-configurable specifically so that after the AeonVoterV3 migration
// cuts over, this keeper points at the new contracts with just a .env edit
// and restart -- no code change needed.

import { createPublicClient, createWalletClient, http, fallback, parseAbi, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { POOLS, CONTRACTS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const PK = (process.env.DEPLOYER_PK ?? '') as `0x${string}`
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS ?? '1800000') // 30 min default
// Fees are collected only when the current time is within this many ms of the
// epoch boundary (default 90 min). With a 30-min tick this guarantees at
// least one sweep lands in-window, and the once-per-epoch guard below stops
// it from re-sweeping. This is the entire fix for the gas drain: no more
// per-tick collectFees() spam.
const SWEEP_WINDOW_MS = parseInt(process.env.SWEEP_WINDOW_MS ?? '5400000')
const GAS_LIMIT_PER_COLLECT = 600_000n
const STATUS_FILE = fileURLToPath(new URL('status.json', import.meta.url))

// Which epoch we last collected fees for. Persisted to status.json so a
// restart inside the sweep window doesn't re-run the whole 67-gauge sweep.
let lastSweptEpoch = 0n
try {
  const s = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
  if (s.lastSweptEpoch) lastSweptEpoch = BigInt(s.lastSweptEpoch)
} catch { /* no status file yet */ }

// Overridable post-cutover via .env -- default to the currently-live
// contracts.
const VOTER_ADDRESS          = (process.env.VOTER_ADDRESS ?? CONTRACTS.AeonVoter) as `0x${string}`
const FEE_DISTRIBUTOR_ADDRESS = (process.env.FEE_DISTRIBUTOR_ADDRESS ?? CONTRACTS.FeeDistributor) as `0x${string}`
const EMISSIONS_ENGINE_ADDRESS = (process.env.EMISSIONS_ENGINE_ADDRESS ?? CONTRACTS.EmissionsEngine) as `0x${string}`
// CL/DLMM emissions are vote-directed through the MultiGaugeController (the
// engine sends it the multiGaugeBps share). Its epochReward must then be
// forwarded into each CL/DLMM gauge via distribute()/distributeBatch(), exactly
// like AeonVoter.distributeAll() does for vAMM gauges -- otherwise CL/DLMM LP
// stakers' gauge rewardRate never gets set and they earn nothing.
const MULTI_GAUGE_CONTROLLER_ADDRESS = (process.env.MULTI_GAUGE_CONTROLLER_ADDRESS ?? CONTRACTS.MultiGaugeController) as `0x${string}`
// BuybackEngineV3 — 20% of each vAMM pool's finalized fees route here via
// FeeDistributorV4.routeBuyback(pool, epoch, token): swapped to AEON (AEON fees
// need no swap), then 50% burned + 50% distributed to Furnace burners. Nothing
// drove routeBuyback before, so that 20% stranded. Fully wired on-chain
// (distributor.notifier == buyback; poolForToken[USDG/WETH] registered) — the
// only missing piece was a caller.
const BUYBACK_ENGINE_ADDRESS = (process.env.BUYBACK_ENGINE_ADDRESS ?? CONTRACTS.BuybackEngine) as `0x${string}`

// One-off: cutover (2026-07-16) happened mid-epoch, so the real fees
// collected up to that point (~700 AEON) are stranded on the OLD
// FeeDistributor, tagged to an epoch that closes independently of the
// cutover (pure wall-clock epoch math). Nothing else will ever call
// snapshotEpoch() on it once that epoch passes -- this keeper now owns the
// main FEE_DISTRIBUTOR_ADDRESS (the new one), so this old one needs its own
// explicit (harmless, idempotent) snapshot call each tick until it fires.
// Safe to delete this block once confirmed snapshotted (its own
// lastSnapshotPeriod will read >= the epoch that held the money).
const LEGACY_FEE_DISTRIBUTOR = '0x772C2Ba92278D47B3A76b3f97b26A5c74d7F7975' as `0x${string}`

if (!PK) throw new Error('DEPLOYER_PK not set in epoch-keeper/.env')

const account = privateKeyToAccount(PK)
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })
const walletClient = createWalletClient({ account, chain: robinhoodChain, transport })

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
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
const BUYBACK_ABI = parseAbi([
  'function processDeferred()',
])
const ENGINE_ABI = parseAbi([
  'function updatePeriod() returns (uint256)',
  'function activePeriod() view returns (uint256)',
])
const MULTI_GAUGE_ABI = parseAbi([
  'function getPools() view returns (address[])',
  'function distributeBatch(address[] poolList, uint256 epoch) returns (uint256)',
])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
])
const AEON = CONTRACTS.AeonToken

const WEEK = 604800n

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
}

function writeStatus(extra: Record<string, unknown>) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ updatedAt: Date.now(), lastSweptEpoch: lastSweptEpoch.toString(), ...extra }, null, 2))
  } catch {}
}

// Collect fees exactly once per epoch, only inside the pre-boundary window.
// Outside the window this is a pure no-op (a couple of free eth_calls, zero
// gas). Inside the window, the first tick sweeps and records the epoch so
// later ticks (and restarts) skip it.
async function sweepFeesIfNearBoundary() {
  const now = BigInt(Math.floor(Date.now() / 1000))
  const epochStart = (now / WEEK) * WEEK
  const boundary = epochStart + WEEK
  const secsToBoundary = boundary - now
  if (secsToBoundary > BigInt(Math.floor(SWEEP_WINDOW_MS / 1000))) {
    return // not near the boundary yet -- don't spend gas
  }
  if (lastSweptEpoch === epochStart) {
    return // already collected this epoch's fees
  }
  log(`Pre-boundary window (T-${secsToBoundary}s) -- collecting this epoch's fees once.`)
  const res = await sweepFees()
  lastSweptEpoch = epochStart
  writeStatus({ ok: true, lastRun: new Date().toISOString(), lastSweep: res })
}

async function sweepFees() {
  const poolCount = await publicClient.readContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'length' })
  let collected = 0
  let skipped = 0
  for (let i = 0n; i < poolCount; i++) {
    const pool = await publicClient.readContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'pools', args: [i] })
    const gauge = await publicClient.readContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'gauges', args: [pool] })
    if (gauge === '0x0000000000000000000000000000000000000000') { skipped++; continue }
    try {
      const hash = await walletClient.writeContract({
        address: gauge, abi: GAUGE_ABI, functionName: 'collectFees', gas: GAS_LIMIT_PER_COLLECT,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      collected++
    } catch {
      skipped++
    }
  }
  log(`Fee sweep: ${collected} collected, ${skipped} skipped/empty (${poolCount} pools)`)
  return { collected, skipped }
}

async function closeEpochIfNeeded() {
  const activePeriod = await publicClient.readContract({ address: EMISSIONS_ENGINE_ADDRESS, abi: ENGINE_ABI, functionName: 'activePeriod' })
  const now = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (now / WEEK) * WEEK

  if (currentEpoch <= activePeriod) {
    log(`Epoch not yet elapsed (active=${activePeriod}, current=${currentEpoch}) -- nothing to close.`)
    return
  }

  log(`Epoch boundary passed (active=${activePeriod} -> current=${currentEpoch}). Closing...`)

  // 1. Snapshot fees
  try {
    const hash = await walletClient.writeContract({ address: FEE_DISTRIBUTOR_ADDRESS, abi: FEE_DIST_ABI, functionName: 'snapshotEpoch', gas: 300_000n })
    await publicClient.waitForTransactionReceipt({ hash })
    log('snapshotEpoch() ok')
  } catch (e: any) {
    log(`snapshotEpoch() failed (may already be snapshotted): ${e.shortMessage ?? e.message}`)
  }

  // 2. Mint via updatePeriod()
  try {
    const hash = await walletClient.writeContract({ address: EMISSIONS_ENGINE_ADDRESS, abi: ENGINE_ABI, functionName: 'updatePeriod', gas: 1_000_000n })
    await publicClient.waitForTransactionReceipt({ hash })
    log('updatePeriod() ok')
  } catch (e: any) {
    log(`updatePeriod() failed: ${e.shortMessage ?? e.message}`)
    return
  }

  // 3. Push claimable AEON into every gauge's accounting
  let distributeReceipt
  try {
    const hash = await walletClient.writeContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'distributeAll', gas: 15_000_000n })
    distributeReceipt = await publicClient.waitForTransactionReceipt({ hash })
    log('distributeAll() ok')
  } catch (e: any) {
    log(`distributeAll() failed: ${e.shortMessage ?? e.message}`)
    return
  }

  // 3b. Forward vote-directed CL/DLMM emissions from the MultiGaugeController
  //     into each registered CL/DLMM gauge for this epoch (mirrors distributeAll
  //     for the vAMM side). Permissionless + idempotent: distribute() tracks
  //     distributed[epoch][pool], so this is a no-op when the controller had no
  //     votes/rewards this epoch. Non-fatal -- never blocks the vAMM path.
  try {
    const mgPools = await publicClient.readContract({
      address: MULTI_GAUGE_CONTROLLER_ADDRESS, abi: MULTI_GAUGE_ABI, functionName: 'getPools',
    }) as readonly `0x${string}`[]
    if (mgPools.length > 0) {
      const hash = await walletClient.writeContract({
        address: MULTI_GAUGE_CONTROLLER_ADDRESS, abi: MULTI_GAUGE_ABI, functionName: 'distributeBatch',
        args: [mgPools as `0x${string}`[], currentEpoch], gas: 15_000_000n,
      })
      await publicClient.waitForTransactionReceipt({ hash })
      log(`MultiGauge distributeBatch() ok (${mgPools.length} CL/DLMM pools, epoch ${currentEpoch})`)
    }
  } catch (e: any) {
    log(`MultiGauge distributeBatch() failed (non-fatal): ${e.shortMessage ?? e.message}`)
  }

  // 3c. Drive the 20% buyback for the just-finalized epoch's fees. For each
  //     vAMM pool that booked fees, routeBuyback() sends 20% to BuybackEngineV3
  //     -> swapped to AEON (AEON fees skip the swap) -> 50% burned + 50% to
  //     Furnace burners. Permissionless + idempotent (claimed[0] guard) and a
  //     no-op on zero fees, so re-runs are safe. Non-fatal. Fork-verified: the
  //     wiring (distributor.notifier == buyback, poolForToken[USDG/WETH] set)
  //     is correct; only a caller was missing.
  try {
    const finalizedEpoch = currentEpoch - WEEK
    const poolCount = await publicClient.readContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'length' })
    let routed = 0
    for (let i = 0n; i < poolCount; i++) {
      const pool = await publicClient.readContract({ address: VOTER_ADDRESS, abi: VOTER_ABI, functionName: 'pools', args: [i] })
      for (let ti = 0n; ti < 4n; ti++) { // vAMM pools carry <=2 fee tokens; cap defensively
        let token: `0x${string}`
        try {
          token = await publicClient.readContract({
            address: FEE_DISTRIBUTOR_ADDRESS, abi: FEE_DIST_ABI, functionName: 'poolEpochTokens', args: [pool, finalizedEpoch, ti],
          }) as `0x${string}`
        } catch { break } // out of bounds -> no more fee tokens for this pool/epoch
        try {
          const hash = await walletClient.writeContract({
            address: FEE_DISTRIBUTOR_ADDRESS, abi: FEE_DIST_ABI, functionName: 'routeBuyback',
            args: [pool, finalizedEpoch, token], gas: 3_000_000n,
          })
          await publicClient.waitForTransactionReceipt({ hash })
          routed++
        } catch { /* already routed / zero fee / swap deferred internally -- non-fatal */ }
      }
    }
    try {
      const hash = await walletClient.writeContract({ address: BUYBACK_ENGINE_ADDRESS, abi: BUYBACK_ABI, functionName: 'processDeferred', gas: 6_000_000n })
      await publicClient.waitForTransactionReceipt({ hash })
    } catch { /* nothing deferred -- fine */ }
    log(`Buyback: routed ${routed} pool/token fee stream(s) for epoch ${finalizedEpoch}`)
  } catch (e: any) {
    log(`Buyback routing failed (non-fatal): ${e.shortMessage ?? e.message}`)
  }

  // 4. Known bug workaround: old-style AeonGauge.notifyRewardAmount() sets
  //    rewardRate but never pulls tokens. Parse RewardAdded(uint256) events
  //    from the distribute tx and top up any gauge whose real balance is
  //    short. Harmless no-op once gauges are AeonGaugeV2 (post-cutover),
  //    since those pull for themselves and will already hold the balance.
  const REWARD_ADDED_TOPIC = '0xde88a922e0d3b88b24e9623efeb464919c6bf9f66857a65e2bfcf2ce87a9433d'
  const rewardedGauges = distributeReceipt.logs
    .filter(l => l.topics[0] === REWARD_ADDED_TOPIC)
    .map(l => ({ gauge: l.address as `0x${string}`, amount: BigInt(l.data) }))

  let toppedUp = 0
  for (const { gauge, amount } of rewardedGauges) {
    const bal = await publicClient.readContract({ address: AEON, abi: ERC20_ABI, functionName: 'balanceOf', args: [gauge] })
    if (bal < amount) {
      const shortfall = amount - bal
      try {
        const hash = await walletClient.writeContract({ address: AEON, abi: ERC20_ABI, functionName: 'transfer', args: [gauge, shortfall], gas: 100_000n })
        await publicClient.waitForTransactionReceipt({ hash })
        toppedUp++
        log(`Topped up gauge ${gauge} with ${formatUnits(shortfall, 18)} AEON`)
      } catch (e: any) {
        log(`Top-up FAILED for gauge ${gauge}: ${e.shortMessage ?? e.message} -- keeper wallet may be out of AEON`)
      }
    }
  }
  log(`Epoch close complete. ${rewardedGauges.length} gauges rewarded, ${toppedUp} needed manual top-up.`)
}

async function snapshotLegacyFeeDistributorIfNeeded() {
  const lastSnapshotPeriod = await publicClient.readContract({ address: LEGACY_FEE_DISTRIBUTOR, abi: FEE_DIST_ABI, functionName: 'lastSnapshotPeriod' })
  const now = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (now / WEEK) * WEEK
  if (currentEpoch <= lastSnapshotPeriod) return // already snapshotted, or not yet time
  try {
    const hash = await walletClient.writeContract({ address: LEGACY_FEE_DISTRIBUTOR, abi: FEE_DIST_ABI, functionName: 'snapshotEpoch', gas: 300_000n })
    await publicClient.waitForTransactionReceipt({ hash })
    log(`Legacy FeeDistributor snapshotted (period ${lastSnapshotPeriod} -> ${currentEpoch}) -- pre-cutover epoch's fees are now claimable.`)
  } catch (e: any) {
    log(`Legacy snapshotEpoch() failed: ${e.shortMessage ?? e.message}`)
  }
}

async function tick() {
  try {
    await sweepFeesIfNearBoundary()
    await closeEpochIfNeeded()
    await snapshotLegacyFeeDistributorIfNeeded()
    writeStatus({ ok: true, lastRun: new Date().toISOString() })
  } catch (e: any) {
    log(`tick() error: ${e.shortMessage ?? e.message ?? e}`)
    writeStatus({ ok: false, lastError: String(e), lastRun: new Date().toISOString() })
  }
}

log(`Epoch keeper starting. Voter=${VOTER_ADDRESS} FeeDistributor=${FEE_DISTRIBUTOR_ADDRESS} Engine=${EMISSIONS_ENGINE_ADDRESS} Interval=${INTERVAL_MS}ms`)
tick()
setInterval(tick, INTERVAL_MS)
