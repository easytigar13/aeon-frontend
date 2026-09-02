// Multicall audit across ALL 40 listed tokens: per-epoch fees (discovered via
// poolEpochTokens, so every fee token is caught) + contract balances.
import { createPublicClient, http, parseAbi, formatUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS, TOKENS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'), batch: { multicall: true } })
const WEEK = 604800n
const PRICE = { AEON: 0.44, WETH: 2450, ETH: 2450, USDG: 1 } // only oracle-priced; others => token amount only

// addr(lowercase) -> {sym, dec}
const BYADDR = new Map()
for (const [sym, v] of Object.entries(TOKENS)) BYADDR.set(v.address.toLowerCase(), { sym, dec: v.decimals })
const ALLTOK = Object.entries(TOKENS).filter(([s])=>s!=='ETH').map(([sym,v])=>({sym,addr:v.address,dec:v.decimals}))

const VOTER = parseAbi(['function length() view returns (uint256)','function pools(uint256) view returns (address)','function weights(address) view returns (uint256)','function totalWeight() view returns (uint256)'])
const FEE = parseAbi(['function poolEpochTokens(address,uint256,uint256) view returns (address)','function poolTokenEpochFees(address,address,uint256) view returns (uint256)'])
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])

async function retry(fn,n=12){for(let i=0;i<n;i++){try{return await fn()}catch(e){if(i===n-1)throw e;const w=/rate limit|429|reset in/i.test(String(e?.message))?31000:2000;console.error(`  (rate-limited, wait ${w/1000}s, try ${i+1})`);await new Promise(r=>setTimeout(r,w))}}}
const mc = (c) => retry(()=>client.multicall({contracts:c,allowFailure:true}))
const fmt = (addr,raw)=>{const m=BYADDR.get(addr.toLowerCase());const dec=m?m.dec:18;const sym=m?m.sym:addr.slice(0,8);const n=Number(formatUnits(raw,dec));const p=PRICE[sym];return {sym,n,usd:p!=null?n*p:null}}

const run = async () => {
  const now=BigInt(Math.floor(Date.now()/1000)); const cur=(now/WEEK)*WEEK
  const epochs=[cur-WEEK, cur-2n*WEEK]
  const len=await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'length'}))
  const tw=await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'totalWeight'}))
  console.log('block',(await retry(()=>client.getBlockNumber())).toString(),'| pools',len.toString(),'| totalWeight',formatUnits(tw,18),'veAEON')
  const pools=(await mc(Array.from({length:Number(len)},(_,i)=>({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'pools',args:[BigInt(i)]})))).map(r=>r.result).filter(Boolean)

  // ---- FEES per epoch: discover tokens via poolEpochTokens[0..5] ----
  for (const e of epochs){
    // discover fee-token addresses
    const disc=[]; for(const p of pools) for(let ti=0n;ti<6n;ti++) disc.push({address:CONTRACTS.FeeDistributor,abi:FEE,functionName:'poolEpochTokens',args:[p,e,ti]})
    const dres=await mc(disc)
    const feeCalls=[]; const meta=[]
    dres.forEach((r,idx)=>{ if(r.status==='success'&&r.result&&r.result!=='0x0000000000000000000000000000000000000000'){ const pool=pools[Math.floor(idx/6)]; feeCalls.push({address:CONTRACTS.FeeDistributor,abi:FEE,functionName:'poolTokenEpochFees',args:[pool,r.result,e]}); meta.push(r.result) } })
    const fres= feeCalls.length? await mc(feeCalls):[]
    const tot={}; let usdKnown=0
    fres.forEach((r,i)=>{ if(r.status==='success'&&r.result>0n){ const {sym,n,usd}=fmt(meta[i],r.result); tot[sym]=(tot[sym]||0)+n; if(usd!=null)usdKnown+=usd } })
    console.log(`\n=== EPOCH ${e} (${new Date(Number(e)*1000).toISOString().slice(0,10)}) fees — ALL tokens ===`)
    const rows=Object.entries(tot).sort((a,b)=>(PRICE[b[0]]?b[1]*PRICE[b[0]]:0)-(PRICE[a[0]]?a[1]*PRICE[a[0]]:0))
    if(!rows.length)console.log('  (none)')
    for(const [sym,n] of rows){const p=PRICE[sym];console.log(`  ${sym.padEnd(9)} ${n.toLocaleString(undefined,{maximumFractionDigits:4})}${p!=null?'  ($'+(n*p).toFixed(2)+')':'  (unpriced)'}`)}
    console.log(`  priced subtotal: $${usdKnown.toFixed(2)}  (+ unpriced token amounts above)`)
  }

  // ---- CONTRACT BALANCES across ALL tokens ----
  const pots=[['FeeDistributor',CONTRACTS.FeeDistributor],['EmissionsEngine',CONTRACTS.EmissionsEngine],['BuybackEngine',CONTRACTS.BuybackEngine],['TheFurnace',CONTRACTS.TheFurnace],['MultiGaugeController',CONTRACTS.MultiGaugeController],['AeonVoter',CONTRACTS.AeonVoter]]
  console.log('\n=== CONTRACT BALANCES — ALL tokens (non-zero only) ===')
  const bcalls=[]; for(const [,addr] of pots) for(const t of ALLTOK) bcalls.push({address:t.addr,abi:ERC20,functionName:'balanceOf',args:[addr]})
  const bres=await mc(bcalls)
  let grandUsd=0
  pots.forEach((pot,pi)=>{ const parts=[]; ALLTOK.forEach((t,ti)=>{ const r=bres[pi*ALLTOK.length+ti]; if(r.status==='success'&&r.result>0n){const n=Number(formatUnits(r.result,t.dec));const p=PRICE[t.sym];if(p!=null)grandUsd+=n*p;parts.push(`${n.toLocaleString(undefined,{maximumFractionDigits:4})} ${t.sym}${p!=null?' ($'+(n*p).toFixed(2)+')':''}`)}}); console.log(pot[0].padEnd(20), parts.length?parts.join(' | '):'(empty)') })
  console.log('priced total across contracts: $'+grandUsd.toFixed(2)+'  (unpriced memecoin/stock amounts listed above)')
}
run().catch(e=>console.error('FAILED:',e?.message??e))
