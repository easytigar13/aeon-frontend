import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, POOLS, TOKENS } from '../src/config/contracts.ts'
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
  'function gauges(address) view returns (address)',
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
  const pools = []
  for (let i = 0n; i < len; i++) {
    const p = await client.readContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'pools', args: [i] })
    if (p) pools.push(p)
  }

  console.log(`Checking accrued unswept fees in companion poolFees vaults across ${pools.length} pools...`)
  let totalAccruedUsdEstimate = 0
  const foundFees = []

  for (const pool of pools) {
    try {
      const feesVault = await client.readContract({ address: pool, abi: POOL_ABI, functionName: 'poolFees' }).catch(() => null)
      const t0 = await client.readContract({ address: pool, abi: POOL_ABI, functionName: 'token0' }).catch(() => null)
      const t1 = await client.readContract({ address: pool, abi: POOL_ABI, functionName: 'token1' }).catch(() => null)

      if (feesVault && feesVault !== '0x0000000000000000000000000000000000000000') {
        const [b0, b1, s0, s1, d0, d1] = await Promise.all([
          client.readContract({ address: t0, abi: ERC20_ABI, functionName: 'balanceOf', args: [feesVault] }).catch(() => 0n),
          client.readContract({ address: t1, abi: ERC20_ABI, functionName: 'balanceOf', args: [feesVault] }).catch(() => 0n),
          client.readContract({ address: t0, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'T0'),
          client.readContract({ address: t1, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'T1'),
          client.readContract({ address: t0, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
          client.readContract({ address: t1, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
        ])

        const matchPool = POOLS.find(x => x.address.toLowerCase() === pool.toLowerCase())
        const poolName = matchPool ? matchPool.name : `${s0}/${s1}`

        if (b0 > 0n || b1 > 0n) {
          const amt0Str = b0 > 0n ? `${formatUnits(b0, d0)} ${s0}` : ''
          const amt1Str = b1 > 0n ? `${formatUnits(b1, d1)} ${s1}` : ''
          foundFees.push({ poolName, pool, feesVault, details: [amt0Str, amt1Str].filter(Boolean).join(' + ') })
        }
      }
    } catch {}
  }

  if (foundFees.length === 0) {
    console.log('No unswept fees currently sitting in poolFees vaults.')
  } else {
    console.log(`Found unswept fees in ${foundFees.length} poolFees vaults:`)
    foundFees.forEach(f => console.log(`  - ${f.poolName.padEnd(20)} (${f.feesVault}): ${f.details}`))
  }
}

run().catch(e => console.error(e))
