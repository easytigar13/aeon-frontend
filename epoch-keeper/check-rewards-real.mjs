import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const c = createPublicClient({ transport: http(RPC) })

const FURNACE = '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A'
const BUYBACK = '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4'
const BOT     = '0x32A3FC106f77300524Dc2dC4D5E672EF08615391'
const AEON    = '0xd4c93eD1843606f92CccA078941f3d52A585982f'
const FRONG   = '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47'
const WETH    = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const USDG    = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const CASHCAT = '0x020bfC650A365f8BB26819deAAbF3E21291018b4'

const FURNACE_ABI = parseAbi([
  'function addressToTokenId(address) view returns (uint256)',
  'function burnedByToken(uint256) view returns (uint256)',
  'function earned(uint256) view returns (uint256)',
  'function totalBurned() view returns (uint256)',
  'function rewardPerTokenStored() view returns (uint256)',
  'function votingPowerOf(address) view returns (uint256)',
])
const BUYBACK_ABI = parseAbi([
  'function totalAeonBurned() view returns (uint256)',
  'function totalAeonToFurnace() view returns (uint256)',
  'function poolForToken(address) view returns (address)',
  'function deferredQueue(address) view returns (uint256)',
])
const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(e=>'ERR:'+(e.shortMessage||e.message))

const tokenId = await rd(FURNACE, FURNACE_ABI, 'addressToTokenId', [BOT])
console.log('=== BOT FURNACE POSITION ===')
console.log('bot address     :', BOT)
console.log('furnace tokenId :', tokenId)
if (typeof tokenId === 'bigint' && tokenId > 0n) {
  const [burned, earned] = await Promise.all([
    rd(FURNACE, FURNACE_ABI, 'burnedByToken', [tokenId]),
    rd(FURNACE, FURNACE_ABI, 'earned', [tokenId]),
  ])
  console.log('AEON burned (voting power):', typeof burned==='bigint'?formatUnits(burned,18):burned)
  console.log('earned (claimable AEON)   :', typeof earned==='bigint'?formatUnits(earned,18):earned)
} else {
  console.log('  -> tokenId 0 = never burned AEON = NOT eligible for furnace rewards')
}

const [totalBurned, rpts] = await Promise.all([
  rd(FURNACE, FURNACE_ABI, 'totalBurned'),
  rd(FURNACE, FURNACE_ABI, 'rewardPerTokenStored'),
])
console.log('\n=== FURNACE GLOBAL ===')
console.log('totalBurned          :', typeof totalBurned==='bigint'?formatUnits(totalBurned,18)+' AEON':totalBurned)
console.log('rewardPerTokenStored :', typeof rpts==='bigint'?rpts.toString():rpts, '(0 = no rewards ever distributed)')

const [tBurned, tFurnace] = await Promise.all([
  rd(BUYBACK, BUYBACK_ABI, 'totalAeonBurned'),
  rd(BUYBACK, BUYBACK_ABI, 'totalAeonToFurnace'),
])
console.log('\n=== BUYBACK ENGINE TOTALS ===')
console.log('totalAeonBurned    :', typeof tBurned==='bigint'?formatUnits(tBurned,18)+' AEON':tBurned)
console.log('totalAeonToFurnace :', typeof tFurnace==='bigint'?formatUnits(tFurnace,18)+' AEON':tFurnace)

console.log('\n=== BUYBACK poolForToken (must be set or fees get deferred, no burn) ===')
for (const [sym,addr] of [['WETH',WETH],['USDG',USDG],['CASHCAT',CASHCAT],['FRONG',FRONG]]) {
  const [pool, deferred] = await Promise.all([
    rd(BUYBACK, BUYBACK_ABI, 'poolForToken', [addr]),
    rd(BUYBACK, BUYBACK_ABI, 'deferredQueue', [addr]),
  ])
  const set = (typeof pool==='string' && pool !== '0x0000000000000000000000000000000000000000')
  console.log(`  ${sym.padEnd(8)} pool=${pool}  ${set?'[SET]':'[NOT SET -> deferred, no burn]'}  deferredQueue=${typeof deferred==='bigint'?formatUnits(deferred,18):deferred}`)
}
