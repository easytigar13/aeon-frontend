import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, POOLS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL),
  batch: { multicall: true }
})

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
])

const POOL_ABI = parseAbi([
  'function poolFees() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

async function run() {
  const len = await client.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'length' })
  const poolCalls = Array.from({ length: Number(len) }, (_, i) => ({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [BigInt(i)]
  }))
  const poolRes = await client.multicall({ contracts: poolCalls, allowFailure: true })
  const pools = poolRes.map(r => r.result).filter(Boolean)

  console.log(`Scanning ${pools.length} pools for companion poolFees vaults...`)

  const metaCalls = []
  pools.forEach(p => {
    metaCalls.push(
      { address: p, abi: POOL_ABI, functionName: 'poolFees' },
      { address: p, abi: POOL_ABI, functionName: 'token0' },
      { address: p, abi: POOL_ABI, functionName: 'token1' }
    )
  })

  const metaRes = await client.multicall({ contracts: metaCalls, allowFailure: true })

  const poolMeta = pools.map((p, i) => ({
    pool: p,
    feesVault: metaRes[i * 3]?.result,
    t0: metaRes[i * 3 + 1]?.result,
    t1: metaRes[i * 3 + 2]?.result,
  })).filter(m => m.feesVault && m.feesVault !== '0x0000000000000000000000000000000000000000')

  console.log(`Found ${poolMeta.length} pools with active companion fee vaults. Checking balances...`)

  const balCalls = []
  poolMeta.forEach(m => {
    balCalls.push(
      { address: m.t0, abi: ERC20_ABI, functionName: 'balanceOf', args: [m.feesVault] },
      { address: m.t1, abi: ERC20_ABI, functionName: 'balanceOf', args: [m.feesVault] },
      { address: m.t0, abi: ERC20_ABI, functionName: 'symbol' },
      { address: m.t1, abi: ERC20_ABI, functionName: 'symbol' },
      { address: m.t0, abi: ERC20_ABI, functionName: 'decimals' },
      { address: m.t1, abi: ERC20_ABI, functionName: 'decimals' },
    )
  })

  const balRes = await client.multicall({ contracts: balCalls, allowFailure: true })

  const accrued = []
  poolMeta.forEach((m, i) => {
    const b0 = balRes[i * 6]?.result || 0n
    const b1 = balRes[i * 6 + 1]?.result || 0n
    const s0 = balRes[i * 6 + 2]?.result || 'T0'
    const s1 = balRes[i * 6 + 3]?.result || 'T1'
    const d0 = balRes[i * 6 + 4]?.result || 18
    const d1 = balRes[i * 6 + 5]?.result || 18

    if (b0 > 0n || b1 > 0n) {
      const matchPool = POOLS.find(x => x.address.toLowerCase() === m.pool.toLowerCase())
      const name = matchPool ? matchPool.name : `${s0}/${s1}`
      const details = []
      if (b0 > 0n) details.push(`${formatUnits(b0, d0)} ${s0}`)
      if (b1 > 0n) details.push(`${formatUnits(b1, d1)} ${s1}`)
      accrued.push({ name, pool: m.pool, feesVault: m.feesVault, details: details.join(' + ') })
    }
  })

  console.log(`\n=== CURRENT UNCOLLECTED FEES SITTING IN POOL VAULTS ===`)
  if (accrued.length === 0) {
    console.log('  (All accrued pool fees have been swept into FeeDistributor; 0 unswept fees in pool vaults right now)')
  } else {
    accrued.forEach(a => console.log(`  - ${a.name.padEnd(20)} (${a.feesVault}): ${a.details}`))
  }
}

run().catch(e => console.error("FAILED:", e))
