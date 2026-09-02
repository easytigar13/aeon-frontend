import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const VOTER   = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const c = createPublicClient({ transport: http(RPC) })

const VOTER_ABI = parseAbi(['function length() view returns (uint256)','function pools(uint256) view returns (address)'])
const POOL_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fees0() view returns (uint256)',
  'function fees1() view returns (uint256)',
  'function index0() view returns (uint256)',
  'function index1() view returns (uint256)',
])
const ERC20_ABI = parseAbi(['function symbol() view returns (string)','function decimals() view returns (uint8)'])
const OR_ABI  = parseAbi(['function getTokenPrice(address) view returns (uint256)'])

const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(()=>null)

const len = await rd(VOTER,VOTER_ABI,'length')
const poolAddrs = []
for (let i=0n; i<len; i++) { const p = await rd(VOTER,VOTER_ABI,'pools',[i]); if(p) poolAddrs.push(p) }

const tokenCache = {}
const getToken = async (addr) => {
  const key = addr.toLowerCase()
  if (tokenCache[key]) return tokenCache[key]
  const [sym,dec] = await Promise.all([rd(addr,ERC20_ABI,'symbol'),rd(addr,ERC20_ABI,'decimals')])
  let price = 0
  const p = await rd(ORACLE,OR_ABI,'getTokenPrice',[addr])
  if(p && p>0n) price=Number(formatUnits(p,18))
  tokenCache[key] = {sym:sym||addr.slice(0,8),dec:Number(dec||18),price}
  return tokenCache[key]
}

let grandTotal = 0
const rows = []

// check first 10 pools raw to understand the data structure
const WETH_AEON = '0xD215650cb628113A64D938164Ee5CD72293F9ea6'
const t0 = await rd(WETH_AEON,POOL_ABI,'token0')
const t1 = await rd(WETH_AEON,POOL_ABI,'token1')
const f0 = await rd(WETH_AEON,POOL_ABI,'fees0')
const f1 = await rd(WETH_AEON,POOL_ABI,'fees1')
const idx0 = await rd(WETH_AEON,POOL_ABI,'index0')
const idx1 = await rd(WETH_AEON,POOL_ABI,'index1')
const [tk0,tk1] = await Promise.all([getToken(t0),getToken(t1)])
console.log(`WETH/AEON pool direct check:`)
console.log(`  token0=${tk0.sym}  fees0=${f0} (${Number(formatUnits(f0||0n,tk0.dec)).toFixed(6)}) index0=${idx0}`)
console.log(`  token1=${tk1.sym}  fees1=${f1} (${Number(formatUnits(f1||0n,tk1.dec)).toFixed(6)}) index1=${idx1}`)

for (const pool of poolAddrs) {
  const [t0,t1] = await Promise.all([rd(pool,POOL_ABI,'token0'),rd(pool,POOL_ABI,'token1')])
  if (!t0||!t1) continue
  const [tk0,tk1] = await Promise.all([getToken(t0),getToken(t1)])
  const [f0,f1] = await Promise.all([rd(pool,POOL_ABI,'fees0'),rd(pool,POOL_ABI,'fees1')])

  const amt0 = Number(formatUnits(f0||0n,tk0.dec))
  const amt1 = Number(formatUnits(f1||0n,tk1.dec))
  const usd0 = amt0*tk0.price, usd1 = amt1*tk1.price
  const poolUsd = usd0+usd1
  if (poolUsd > 0.01) {
    rows.push({name:`${tk0.sym}/${tk1.sym}`,usd:poolUsd,d:`${tk0.sym} ${amt0.toFixed(4)}($${usd0.toFixed(2)}) + ${tk1.sym} ${amt1.toFixed(4)}($${usd1.toFixed(2)})`})
    grandTotal += poolUsd
  }
}

rows.sort((a,b)=>b.usd-a.usd)
console.log(`\n=== Unswept fees in pool contracts (fees0/fees1 on pool itself) ===`)
for (const r of rows) console.log(`  ${r.name.padEnd(22)} $${r.usd.toFixed(2).padStart(9)}   ${r.d}`)
console.log(`\nTOTAL unswept pool fees: $${grandTotal.toFixed(2)}`)
