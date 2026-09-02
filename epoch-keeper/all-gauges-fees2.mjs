import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const FEEDIST = '0x40524d597e9e241b5B7C76D1b2e570A77933D412'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const VOTER   = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const c = createPublicClient({ transport: http(RPC) })
const CUR = 1785369600n

const VOTER_ABI = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
])
const POOL_ABI = parseAbi(['function token0() view returns (address)','function token1() view returns (address)'])
const ERC20_ABI = parseAbi(['function symbol() view returns (string)','function decimals() view returns (uint8)'])
const FEE_ABI = parseAbi(['function poolTokenEpochFees(address,address,uint256) view returns (uint256)'])
const OR_ABI  = parseAbi(['function getTokenPrice(address) view returns (uint256)'])

const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(()=>null)

const len = await rd(VOTER,VOTER_ABI,'length')
console.log(`Total pools in voter: ${len}`)
const poolAddrs = []
for (let i=0n; i<len; i++) { const p = await rd(VOTER,VOTER_ABI,'pools',[i]); if(p) poolAddrs.push(p) }
console.log(`Fetched ${poolAddrs.length} pool addresses`)

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
  const [t0,t1] = await Promise.all([rd(pool,POOL_ABI,'token0'),rd(pool,POOL_ABI,'token1')])
  if (!t0||!t1) continue
  const [tk0,tk1] = await Promise.all([getToken(t0),getToken(t1)])
  let poolUsd = 0
  let details = []
  for (const [tAddr,tk] of [[t0,tk0],[t1,tk1]]) {
    const raw = await rd(FEEDIST,FEE_ABI,'poolTokenEpochFees',[pool,tAddr,CUR])
    if (raw && raw>0n) {
      const amt = Number(formatUnits(raw,tk.dec))
      const usd = amt*tk.price
      poolUsd += usd
      details.push(`${tk.sym} ${amt.toFixed(4)} ($${usd.toFixed(2)})`)
    }
  }
  if (poolUsd > 0.01) {
    rows.push({name:`${tk0.sym}/${tk1.sym}`,pool,usd:poolUsd,details})
    grandTotal += poolUsd
  }
}

rows.sort((a,b)=>b.usd-a.usd)
console.log(`\n=== Current epoch (Jul30→Aug6) fees tagged across ALL pools ===`)
for (const r of rows) console.log(`  ${r.name.padEnd(22)} $${r.usd.toFixed(2).padStart(9)}   ${r.details.join('  ')}`)
console.log(`\nGRAND TOTAL (${rows.length} pools with fees): $${grandTotal.toFixed(2)}`)
