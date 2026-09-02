import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const VOTER = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const FURNACE = '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A'
const c = createPublicClient({ transport: http(RPC) })

const VOTER_ABI = parseAbi([
  'function totalWeight() view returns (uint256)',
  'function usedWeights(address) view returns (uint256)',
  'function votes(address, address) view returns (uint256)',
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function lastVoted(address) view returns (uint256)',
])
const POOL_ABI = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)'])
const ERC20_ABI = parseAbi(['function symbol() view returns (string)'])
const rd = (addr, abi, fn, args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(()=>null)

const [totalWeight, furnaceUsed, furnaceLastVoted] = await Promise.all([
  rd(VOTER, VOTER_ABI, 'totalWeight'),
  rd(VOTER, VOTER_ABI, 'usedWeights', [FURNACE]),
  rd(VOTER, VOTER_ABI, 'lastVoted', [FURNACE]),
])

console.log('=== VOTER STATE ===')
console.log('totalWeight       :', formatUnits(totalWeight||0n, 18), 'veAEON')
console.log('furnace usedWeight:', formatUnits(furnaceUsed||0n, 18), 'veAEON')
console.log('furnace lastVoted :', furnaceLastVoted ? new Date(Number(furnaceLastVoted)*1000).toISOString() : 'never')

const len = await rd(VOTER, VOTER_ABI, 'length')
console.log(`\nPools furnace voted for (out of ${len} total):`)
let anyVotes = false
for (let i=0n; i<len; i++) {
  const pool = await rd(VOTER, VOTER_ABI, 'pools', [i])
  if (!pool) continue
  const v = await rd(VOTER, VOTER_ABI, 'votes', [FURNACE, pool])
  if (v && v > 0n) {
    anyVotes = true
    const [t0, t1] = await Promise.all([rd(pool, POOL_ABI, 'token0'), rd(pool, POOL_ABI, 'token1')])
    const [s0, s1] = await Promise.all([rd(t0, ERC20_ABI, 'symbol'), rd(t1, ERC20_ABI, 'symbol')])
    const pct = totalWeight > 0n ? (Number(v * 10000n / totalWeight) / 100).toFixed(2) : '?'
    console.log(`  ${(s0+'/'+s1).padEnd(22)} ${formatUnits(v,18).padStart(16)} veAEON  (${pct}% of total)`)
  }
}
if (!anyVotes) console.log('  NONE — furnace has not voted this epoch')
