import 'dotenv/config'
import { createPublicClient, http, formatUnits } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const FEEDIST = '0x40524d597e9e241b5B7C76D1b2e570A77933D412'
const ORACLE  = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const VOTER   = '0xB2E5CDe13ef4cC9e7caf1a56cC88DBBA820C5a90'
const c = createPublicClient({ transport: http(RPC) })
const CUR = 1785369600n

const VOTER_ABI = [{name:'length',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]},
  {name:'pools',type:'function',stateMutability:'view',inputs:[{type:'uint256'}],outputs:[{type:'address'}]},
  {name:'gauges',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'address'}]},
  {name:'isGauge',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'bool'}]}]
const POOL_ABI = [{name:'token0',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'address'}]},
  {name:'token1',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}]
const ERC20_ABI = [{name:'symbol',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'string'}]},
  {name:'decimals',type:'function',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]}]
const FEE_ABI = [{name:'poolTokenEpochFees',type:'function',stateMutability:'view',inputs:[{type:'address'},{type:'address'},{type:'uint256'}],outputs:[{type:'uint256'}]}]
const OR_ABI  = [{name:'getTokenPrice',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}]

const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(()=>null)

// get all pool addresses
const len = await rd(VOTER,VOTER_ABI,'length')
console.log(`Total pools in voter: ${len}`)
const poolAddrs = []
for (let i=0n; i<len; i++) { const p = await rd(VOTER,VOTER_ABI,'pools',[i]); if(p) poolAddrs.push(p) }

// cache token info
const tokenCache = {}
const getToken = async (addr) => {
  if (tokenCache[addr]) return tokenCache[addr]
  const [sym,dec] = await Promise.all([rd(addr,ERC20_ABI,'symbol'),rd(addr,ERC20_ABI,'decimals')])
  let price = 0
  try { const p = await rd(ORACLE,OR_ABI,'getTokenPrice',[addr]); if(p) price=Number(formatUnits(p,18)) } catch{}
  tokenCache[addr] = {sym:sym||addr.slice(0,8),dec:dec||18,price}
  return tokenCache[addr]
}

let grandTotal = 0
const rows = []

for (const pool of poolAddrs) {
  const [t0,t1] = await Promise.all([rd(pool,POOL_ABI,'token0'),rd(pool,POOL_ABI,'token1')])
  if (!t0||!t1) continue
  const [tk0,tk1] = await Promise.all([getToken(t0),getToken(t1)])
  let poolUsd = 0
  for (const [tAddr,tk] of [[t0,tk0],[t1,tk1]]) {
    const raw = await rd(FEEDIST,FEE_ABI,'poolTokenEpochFees',[pool,tAddr,CUR])
    if (raw && raw>0n) {
      const amt = Number(formatUnits(raw,tk.dec))
      const usd = amt*tk.price
      poolUsd += usd
    }
  }
  if (poolUsd > 0.01) {
    rows.push({name:`${tk0.sym}/${tk1.sym}`,pool,usd:poolUsd})
    grandTotal += poolUsd
  }
}

rows.sort((a,b)=>b.usd-a.usd)
console.log(`\n=== Current epoch (Jul30→Aug6) fees tagged in FeeDistributor ===`)
for (const r of rows) console.log(`  ${r.name.padEnd(20)} $${r.usd.toFixed(2).padStart(10)}`)
console.log(`\nGRAND TOTAL across all ${rows.length} pools with fees: $${grandTotal.toFixed(2)}`)
