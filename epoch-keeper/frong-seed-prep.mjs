import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const c = createPublicClient({ transport: http(RPC) })

const FRONG_AEON = '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be'
const FRONG   = '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47'
const AEON    = '0xd4c93eD1843606f92CccA078941f3d52A585982f'
const WETH    = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const BUYBACK = '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4'
const ADMIN   = '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc'

const POOL_ABI = parseAbi(['function getReserves() view returns (uint112,uint112,uint32)','function token0() view returns (address)'])
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)'])
const OR_ABI = parseAbi(['function getTokenPrice(address) view returns (uint256)'])
const BB_ABI = parseAbi(['function governor() view returns (address)'])
const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(e=>'ERR:'+(e.shortMessage||e.message))

const [r, t0, aeonPrice, wethPrice] = await Promise.all([
  rd(FRONG_AEON, POOL_ABI, 'getReserves'),
  rd(FRONG_AEON, POOL_ABI, 'token0'),
  rd(ORACLE, OR_ABI, 'getTokenPrice', [AEON]),
  rd(ORACLE, OR_ABI, 'getTokenPrice', [WETH]),
])
const aeonP = Number(formatUnits(aeonPrice,18))
const wethP = Number(formatUnits(wethPrice,18))
// reserves: figure FRONG & AEON sides
const t0isFrong = (t0.toLowerCase() === FRONG.toLowerCase())
const rFrong = t0isFrong ? r[0] : r[1]
const rAeon  = t0isFrong ? r[1] : r[0]
const frongAmt = Number(formatUnits(rFrong,18))
const aeonAmt  = Number(formatUnits(rAeon,18))
// price of FRONG in USD = (AEON reserve / FRONG reserve) * AEON price
const frongP = (aeonAmt / frongAmt) * aeonP
console.log('=== PRICES ===')
console.log('AEON  : $'+aeonP.toFixed(6))
console.log('WETH  : $'+wethP.toFixed(2))
console.log('FRONG : $'+frongP.toFixed(8), `(from FRONG/AEON pool: ${frongAmt.toFixed(2)} FRONG / ${aeonAmt.toFixed(2)} AEON)`)

console.log('\n=== $5-a-side seed amounts ===')
const wethFor5  = 5 / wethP
const frongFor5 = 5 / frongP
console.log('WETH  : '+wethFor5.toFixed(8)+'  (= $5)')
console.log('FRONG : '+frongFor5.toFixed(4)+'  (= $5)')

console.log('\n=== ADMIN WALLET '+ADMIN+' balances ===')
const [balFrong, balWeth, balAeon] = await Promise.all([
  rd(FRONG, ERC20, 'balanceOf', [ADMIN]),
  rd(WETH, ERC20, 'balanceOf', [ADMIN]),
  rd(AEON, ERC20, 'balanceOf', [ADMIN]),
])
console.log('FRONG :', typeof balFrong==='bigint'?formatUnits(balFrong,18):balFrong, `(need ${frongFor5.toFixed(2)})`)
console.log('WETH  :', typeof balWeth==='bigint'?formatUnits(balWeth,18):balWeth, `(need ${wethFor5.toFixed(6)})`)
console.log('AEON  :', typeof balAeon==='bigint'?formatUnits(balAeon,18):balAeon)

const gov = await rd(BUYBACK, BB_ABI, 'governor')
console.log('\nbuyback governor :', gov, gov.toLowerCase?.()===ADMIN.toLowerCase()?'(= admin ✓)':'(NOT admin!)')
