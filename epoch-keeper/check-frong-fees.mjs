import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const FEEDIST = '0x40524d597e9e241b5B7C76D1b2e570A77933D412'
const VOTER   = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const c = createPublicClient({ transport: http(RPC) })

const FRONG_AEON = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be'
const FRONG = '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47'
const AEON  = '0xd4c93eD1843606f92CccA078941f3d52A585982f'
const WETH  = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'

const FEE_ABI  = parseAbi(['function poolTokenEpochFees(address,address,uint256) view returns (uint256)'])
const VOTER_ABI = parseAbi(['function gauges(address) view returns (address)', 'function isGauge(address) view returns (bool)'])
const OR_ABI   = parseAbi(['function getTokenPrice(address) view returns (uint256)'])
const POOL_ABI = parseAbi(['function reserve0() view returns (uint256)', 'function reserve1() view returns (uint256)', 'function stable() view returns (bool)'])
const GAUGE_ABI = parseAbi(['function isAlive() view returns (bool)'])

const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(e=>'ERR:'+e.shortMessage)

const [gauge, frong_price, aeon_price, weth_price] = await Promise.all([
  rd(VOTER, VOTER_ABI, 'gauges', [FRONG_AEON]),
  rd(ORACLE, OR_ABI, 'getTokenPrice', [FRONG]),
  rd(ORACLE, OR_ABI, 'getTokenPrice', [AEON]),
  rd(ORACLE, OR_ABI, 'getTokenPrice', [WETH]),
])

console.log('=== FRONG/AEON pool:', FRONG_AEON, '===')
console.log('Gauge:', gauge)
const isAlive = await rd(gauge, GAUGE_ABI, 'isAlive')
const isGauge = await rd(VOTER, VOTER_ABI, 'isGauge', [gauge])
console.log('isAlive:', isAlive, '  isGauge:', isGauge)
console.log('FRONG price: $' + (typeof frong_price==='bigint' ? Number(formatUnits(frong_price,18)).toFixed(6) : frong_price))
console.log('AEON  price: $' + (typeof aeon_price==='bigint'  ? Number(formatUnits(aeon_price,18)).toFixed(6)  : aeon_price))

const CUR  = 1785369600n
const PREV = 1784764800n

for (const [label, epoch] of [['CURRENT (Aug6 epoch)', CUR], ['PREV (Jul30 epoch)', PREV]]) {
  const [f0, f1] = await Promise.all([
    rd(FEEDIST, FEE_ABI, 'poolTokenEpochFees', [FRONG_AEON, FRONG, epoch]),
    rd(FEEDIST, FEE_ABI, 'poolTokenEpochFees', [FRONG_AEON, AEON, epoch]),
  ])
  const frong_amt = typeof f0==='bigint' ? Number(formatUnits(f0,18)) : 0
  const aeon_amt  = typeof f1==='bigint' ? Number(formatUnits(f1,18)) : 0
  const frong_usd = frong_amt * (typeof frong_price==='bigint' ? Number(formatUnits(frong_price,18)) : 0)
  const aeon_usd  = aeon_amt  * (typeof aeon_price==='bigint'  ? Number(formatUnits(aeon_price,18))  : 0)
  console.log(`\n${label}:`)
  console.log(`  FRONG: ${frong_amt.toFixed(4)} ($${frong_usd.toFixed(2)})`)
  console.log(`  AEON:  ${aeon_amt.toFixed(4)}  ($${aeon_usd.toFixed(2)})`)
}
