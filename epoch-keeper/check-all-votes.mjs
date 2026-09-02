import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const VOTER = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const c = createPublicClient({ transport: http(RPC) })

const VOTER_ABI = parseAbi([
  'function totalWeight() view returns (uint256)',
  'function weights(address) view returns (uint256)',
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
])
const POOL_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)'])
const ERC20_ABI = parseAbi(['function symbol() view returns (string)'])
const rd = (addr, abi, fn, args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(()=>null)

const totalWeight = await rd(VOTER, VOTER_ABI, 'totalWeight')
const len = await rd(VOTER, VOTER_ABI, 'length')
console.log(`Total veAEON voting weight: ${formatUnits(totalWeight||0n,18)}`)
console.log(`Scanning ${len} pools...\n`)

const rows = []
for (let i=0n; i<len; i++) {
  const pool = await rd(VOTER, VOTER_ABI, 'pools', [i])
  if (!pool) continue
  const w = await rd(VOTER, VOTER_ABI, 'weights', [pool])
  if (!w || w === 0n) continue
  const [t0, t1] = await Promise.all([rd(pool, POOL_ABI, 'token0'), rd(pool, POOL_ABI, 'token1')])
  const [s0, s1] = await Promise.all([rd(t0, ERC20_ABI, 'symbol'), rd(t1, ERC20_ABI, 'symbol')])
  const pct = totalWeight > 0n ? (Number(w * 10000n / totalWeight) / 100).toFixed(2) : '0'
  rows.push({ name: `${s0}/${s1}`, weight: w, pct })
}

rows.sort((a,b) => (b.weight > a.weight ? 1 : -1))
console.log('=== CURRENT VOTE DISTRIBUTION ===')
for (const r of rows) {
  const bar = '█'.repeat(Math.round(Number(r.pct)/2))
  console.log(`  ${r.name.padEnd(22)} ${formatUnits(r.weight,18).padStart(12)} veAEON  ${r.pct.padStart(6)}%  ${bar}`)
}
const voted = rows.reduce((s,r)=>s+r.weight, 0n)
const unvoted = (totalWeight||0n) - voted
console.log(`\nVoted  : ${formatUnits(voted,18)} veAEON`)
console.log(`Unvoted: ${formatUnits(unvoted,18)} veAEON`)
