import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS, POOLS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL),
  batch: { multicall: true }
})

const WEEK = 604800n

// Map address -> token metadata
const BY_ADDR = new Map()
for (const [sym, v] of Object.entries(TOKENS)) {
  if (v.address && v.address !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
    BY_ADDR.set(v.address.toLowerCase(), { sym: v.symbol, dec: v.decimals, name: v.name })
  }
}

const ALL_TOKENS = Object.entries(TOKENS)
  .filter(([s, v]) => v.address && v.address !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
  .map(([sym, v]) => ({ sym, addr: v.address, dec: v.decimals, name: v.name }))

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
])

const FEE_ABI = parseAbi([
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function poolTokenEpochFees(address,address,uint256) view returns (uint256)',
  'function lastEpochFeesUSD() view returns (uint256)',
  'function lastSnapshotPeriod() view returns (uint256)',
])

const ENGINE_ABI = parseAbi([
  'function activePeriod() view returns (uint256)',
  'function lastMintAmount() view returns (uint256)',
  'function lastFeesUSD() view returns (uint256)',
  'function multiGaugeBps() view returns (uint256)',
  'function EMISSION_BPS() view returns (uint256)',
  'function TO_VOTER_BPS() view returns (uint256)',
  'function TO_FURNACE_BPS() view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)'
])

async function retry(fn, n = 10) {
  for (let i = 0; i < n; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === n - 1) throw e
      const w = /rate limit|429|reset in/i.test(String(e?.message)) ? 25000 : 1500 * (i + 1)
      console.error(`  (RPC pause ${w / 1000}s, attempt ${i + 1})`)
      await new Promise(r => setTimeout(r, w))
    }
  }
}

const mc = (contracts) => retry(() => client.multicall({ contracts, allowFailure: true }))

function formatTokenAmt(addr, rawAmt) {
  const lower = addr.toLowerCase()
  const meta = BY_ADDR.get(lower)
  const dec = meta ? meta.dec : 18
  const sym = meta ? meta.sym : `${addr.slice(0, 6)}...${addr.slice(-4)}`
  const formatted = formatUnits(rawAmt, dec)
  return { sym, dec, rawAmt, formatted, name: meta ? meta.name : 'Unknown Token' }
}

async function run() {
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (nowSec / WEEK) * WEEK
  const blockNum = await retry(() => client.getBlockNumber())

  console.log(`=================================================================`)
  console.log(`               AEON PROTOCOL COMPREHENSIVE AUDIT                 `)
  console.log(`=================================================================`)
  console.log(`Current Block: ${blockNum}`)
  console.log(`Current Time : ${new Date(Number(nowSec) * 1000).toISOString()}`)
  console.log(`Current Epoch: ${currentEpoch} (${new Date(Number(currentEpoch) * 1000).toISOString()})`)
  console.log(`-----------------------------------------------------------------\n`)

  // 1. ENGINE & FEE DISTRIBUTOR STATE
  console.log(`=== 1. ENGINE & FEE DISTRIBUTOR TIMELINE STATUS ===`)
  const activePeriod = await retry(() => client.readContract({ address: CONTRACTS.EmissionsEngine, abi: ENGINE_ABI, functionName: 'activePeriod' }))
  const lastMintAmount = await retry(() => client.readContract({ address: CONTRACTS.EmissionsEngine, abi: ENGINE_ABI, functionName: 'lastMintAmount' }))
  const lastFeesUSD = await retry(() => client.readContract({ address: CONTRACTS.EmissionsEngine, abi: ENGINE_ABI, functionName: 'lastFeesUSD' }))
  const lastSnapshotPeriod = await retry(() => client.readContract({ address: CONTRACTS.FeeDistributor, abi: FEE_ABI, functionName: 'lastSnapshotPeriod' }))
  const lastEpochFeesUSD = await retry(() => client.readContract({ address: CONTRACTS.FeeDistributor, abi: FEE_ABI, functionName: 'lastEpochFeesUSD' }))

  console.log(`EmissionsEngine Active Period : ${activePeriod} (${new Date(Number(activePeriod) * 1000).toISOString()})`)
  console.log(`FeeDistributor Snapshot Period: ${lastSnapshotPeriod} (${new Date(Number(lastSnapshotPeriod) * 1000).toISOString()})`)
  
  const missedEpochsCount = Number((currentEpoch - activePeriod) / WEEK)
  console.log(`UNRELEASED / MISSED EPOCHS: ${missedEpochsCount} week(s) behind current active wall-clock epoch!`)
  console.log(`Last Recorded Mint Amount    : ${formatUnits(lastMintAmount, 18)} AEON`)
  console.log(`Last Recorded Engine Fees USD: $${formatUnits(lastFeesUSD, 18)}`)
  console.log(`Last FeeDistributor Fees USD : $${formatUnits(lastEpochFeesUSD, 18)}`)
  console.log(`\n`)

  // 2. RECENT 5 EPOCHS BREAKDOWN (Current + last 4 weeks)
  const epochsToAudit = [
    currentEpoch,
    currentEpoch - WEEK,
    currentEpoch - 2n * WEEK,
    currentEpoch - 3n * WEEK,
    currentEpoch - 4n * WEEK,
  ]

  const poolCount = await retry(() => client.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length' }))
  const totalWeight = await retry(() => client.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight' }))
  console.log(`=== 2. VOTER & FEES PER EPOCH (LAST 4-5 WEEKS) ===`)
  console.log(`Total Voter Pools: ${poolCount}`)
  console.log(`Total veAEON Weight: ${formatUnits(totalWeight, 18)} veAEON\n`)

  // Get pools
  const poolCalls = Array.from({ length: Number(poolCount) }, (_, i) => ({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [BigInt(i)]
  }))
  const poolResults = await mc(poolCalls)
  const pools = poolResults.map(r => r.result).filter(Boolean)

  // Audit epoch fees token by token
  for (const ep of epochsToAudit) {
    const statusLabel = ep === activePeriod ? 'ACTIVE PERIOD ON ENGINE' : (ep < activePeriod ? 'PROCESSED' : 'UNRELEASED / PENDING')
    console.log(`--- EPOCH ${ep} (${new Date(Number(ep) * 1000).toISOString().slice(0, 10)}) [${statusLabel}] ---`)

    const discoverCalls = []
    for (const p of pools) {
      for (let ti = 0n; ti < 6n; ti++) {
        discoverCalls.push({
          address: CONTRACTS.FeeDistributor,
          abi: FEE_ABI,
          functionName: 'poolEpochTokens',
          args: [p, ep, ti]
        })
      }
    }
    const discoverRes = await mc(discoverCalls)
    const feeCalls = []
    const feeMeta = []

    discoverRes.forEach((r, idx) => {
      if (r.status === 'success' && r.result && r.result !== '0x0000000000000000000000000000000000000000') {
        const pool = pools[Math.floor(idx / 6)]
        feeCalls.push({
          address: CONTRACTS.FeeDistributor,
          abi: FEE_ABI,
          functionName: 'poolTokenEpochFees',
          args: [pool, r.result, ep]
        })
        feeMeta.push({ pool, token: r.result })
      }
    })

    const feeRes = feeCalls.length ? await mc(feeCalls) : []
    const epochTokenTotals = new Map()

    feeRes.forEach((r, idx) => {
      if (r.status === 'success' && r.result > 0n) {
        const { token } = feeMeta[idx]
        const existing = epochTokenTotals.get(token.toLowerCase()) || 0n
        epochTokenTotals.set(token.toLowerCase(), existing + r.result)
      }
    })

    if (epochTokenTotals.size === 0) {
      console.log(`  (No fees booked in FeeDistributor for epoch ${ep})`)
    } else {
      console.log(`  Fees booked by token in FeeDistributor:`)
      for (const [tokenAddr, rawAmount] of epochTokenTotals.entries()) {
        const info = formatTokenAmt(tokenAddr, rawAmount)
        console.log(`    - ${info.sym.padEnd(10)}: ${info.formatted} (${info.name} - address: ${tokenAddr})`)
      }
    }
    console.log(``)
  }

  // 3. VOTES PER POOL (veAEON WEIGHTS)
  console.log(`=== 3. VOTER POOL WEIGHTS (VOTING STATUS) ===`)
  const weightCalls = pools.map(p => ({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'weights', args: [p]
  }))
  const weightRes = await mc(weightCalls)
  let poolsWithVotesCount = 0
  pools.forEach((p, i) => {
    const w = weightRes[i]?.result || 0n
    if (w > 0n) {
      poolsWithVotesCount++
      const matchPool = POOLS.find(x => x.address.toLowerCase() === p.toLowerCase())
      const name = matchPool ? matchPool.name : `Pool ${p.slice(0, 8)}`
      console.log(`  - ${name.padEnd(20)} (${p}): ${formatUnits(w, 18)} veAEON`)
    }
  })
  console.log(`Total Pools with active veAEON votes: ${poolsWithVotesCount} / ${pools.length}\n`)

  // 4. CONTRACT BALANCES (ALL TOKENS, UNDISTRIBUTED POTS)
  console.log(`=== 4. PROTOCOL CONTRACT BALANCES (ALL TOKENS) ===`)
  const contractsToAudit = [
    ['FeeDistributor', CONTRACTS.FeeDistributor],
    ['EmissionsEngine', CONTRACTS.EmissionsEngine],
    ['BuybackEngine', CONTRACTS.BuybackEngine],
    ['TheFurnace', CONTRACTS.TheFurnace],
    ['MultiGaugeController', CONTRACTS.MultiGaugeController],
    ['AeonVoter', CONTRACTS.AeonVoter],
    ['MinterProxy', CONTRACTS.MinterProxy],
    ['ProtocolBurnRewardDistributor', CONTRACTS.ProtocolBurnRewardDistributor],
  ]

  const balCalls = []
  for (const [, cAddr] of contractsToAudit) {
    for (const tok of ALL_TOKENS) {
      balCalls.push({
        address: tok.addr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [cAddr]
      })
    }
  }

  const balRes = await mc(balCalls)
  
  contractsToAudit.forEach(([name, cAddr], ci) => {
    console.log(`>>> Contract: ${name} (${cAddr})`)
    let foundNonZero = false
    ALL_TOKENS.forEach((tok, ti) => {
      const r = balRes[ci * ALL_TOKENS.length + ti]
      if (r && r.status === 'success' && r.result > 0n) {
        foundNonZero = true
        const formatted = formatUnits(r.result, tok.dec)
        console.log(`    - ${tok.sym.padEnd(10)} (${tok.name}): ${formatted} tokens (Raw: ${r.result.toString()})`)
      }
    })
    if (!foundNonZero) {
      console.log(`    (No token balances held)`)
    }
    console.log(``)
  })

  // 5. GAUGE BALANCES & ACCRUED FEES IN POOLS
  console.log(`=== 5. LIVE GAUGE BALANCES (AEON & FEE TOKENS IN GAUGES) ===`)
  const gaugeCalls = pools.map(p => ({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges', args: [p]
  }))
  const gaugeRes = await mc(gaugeCalls)
  const activeGauges = []
  pools.forEach((p, i) => {
    const g = gaugeRes[i]?.result
    if (g && g !== '0x0000000000000000000000000000000000000000') {
      const matchPool = POOLS.find(x => x.address.toLowerCase() === p.toLowerCase())
      activeGauges.push({ pool: p, gauge: g, name: matchPool ? matchPool.name : p.slice(0, 8) })
    }
  })

  console.log(`Found ${activeGauges.length} active vAMM gauges. Auditing token balances in gauges...`)
  const gBalCalls = []
  for (const gInfo of activeGauges) {
    for (const tok of ALL_TOKENS) {
      gBalCalls.push({
        address: tok.addr,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [gInfo.gauge]
      })
    }
  }
  const gBalRes = await mc(gBalCalls)

  activeGauges.forEach((gInfo, gi) => {
    const nonZeroToks = []
    ALL_TOKENS.forEach((tok, ti) => {
      const r = gBalRes[gi * ALL_TOKENS.length + ti]
      if (r && r.status === 'success' && r.result > 0n) {
        nonZeroToks.push({ sym: tok.sym, name: tok.name, formatted: formatUnits(r.result, tok.dec), raw: r.result.toString() })
      }
    })
    if (nonZeroToks.length > 0) {
      console.log(`  Gauge for ${gInfo.name.padEnd(16)} (${gInfo.gauge}):`)
      nonZeroToks.forEach(t => {
        console.log(`    - ${t.sym.padEnd(10)} (${t.name}): ${t.formatted}`)
      })
    }
  })

  console.log(`\n=================================================================`)
  console.log(`                     AUDIT COMPLETE                              `)
  console.log(`=================================================================`)
}

run().catch(e => console.error("AUDIT FAILED:", e))
