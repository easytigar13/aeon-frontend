import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const VOTER   = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const c = createPublicClient({ transport: http(RPC) })

const VOTER_ABI = parseAbi(['function length() view returns (uint256)','function pools(uint256) view returns (address)','function gauges(address) view returns (address)'])
const POOL_ABI = parseAbi(['function token0() view returns (address)','function token1() view returns (address)','function fees0() view returns (uint256)','function fees1() view returns (uint256)','function claimFees() view returns (uint256,uint256)'])
const GAUGE_ABI = parseAbi(['function fees0() view returns (uint256)','function fees1() view returns (uint256)','function claimFees() view returns (uint256,uint256)'])
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

for (const pool of poolAddrs) {
  const [t0,t1,gauge] = await Promise.all([rd(pool,POOL_ABI,'token0'),rd(pool,POOL_ABI,'token1'),rd(VOTER,VOTER_ABI,'gauges',[pool])])
  if (!t0||!t1) continue
  const [tk0,tk1] = await Promise.all([getToken(t0),getToken(t1)])

  // try claimFees (static call shows pending amounts) on pool and gauge
  let f0=0n, f1=0n
  const poolFees = await rd(pool,POOL_ABI,'claimFees')
  if (poolFees) { f0+=poolFees[0]; f1+=poolFees[1] }
  if (gauge && gauge!='0x0000000000000000000000000000000000000000') {
    const gFees = await rd(gauge,GAUGE_ABI,'claimFees')
    if (gFees) { f0+=gFees[0]; f1+=gFees[1] }
  }

  const amt0 = Number(formatUnits(f0,tk0.dec))
  const amt1 = Number(formatUnits(f1,tk1.dec))
  const usd0 = amt0*tk0.price, usd1 = amt1*tk1.price
  const poolUsd = usd0+usd1
  if (poolUsd > 0.01) {
    rows.push({name:`${tk0.sym}/${tk1.sym}`,usd:poolUsd,d:`${tk0.sym} ${amt0.toFixed(4)}($${usd0.toFixed(2)}) + ${tk1.sym} ${amt1.toFixed(4)}($${usd1.toFixed(2)})`})
    grandTotal += poolUsd
  }
}

rows.sort((a,b)=>b.usd-a.usd)
console.log(`=== Accrued (unswept) fees in pool+gauge contracts ===`)
for (const r of rows) console.log(`  ${r.name.padEnd(22)} $${r.usd.toFixed(2).padStart(9)}   ${r.d}`)
console.log(`\nTOTAL unswept: $${grandTotal.toFixed(2)}`)
