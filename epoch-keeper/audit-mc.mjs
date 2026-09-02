// Multicall3-batched audit: last-2-epoch fees, pot balances, votes.
import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'), batch: { multicall: true } })
const WEEK = 604800n
const P = { AEON: 0.44, WETH: 2450, USDG: 1 }
const AEON = CONTRACTS.AeonToken, WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const TOKS = [['AEON',AEON,18],['WETH',WETH,18],['USDG',USDG,6]]

const VOTER = parseAbi(['function length() view returns (uint256)','function pools(uint256) view returns (address)','function weights(address) view returns (uint256)','function totalWeight() view returns (uint256)'])
const FEE = parseAbi(['function poolTokenEpochFees(address,address,uint256) view returns (uint256)'])
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])

async function retry(fn, n=10){for(let i=0;i<n;i++){try{return await fn()}catch(e){if(i===n-1)throw e;const w=/rate limit|429|reset in/i.test(String(e?.message))?31000:2000;console.error(`  (rate-limited, waiting ${w/1000}s, try ${i+1})`);await new Promise(r=>setTimeout(r,w))}}}
const mc = (contracts) => retry(() => client.multicall({ contracts, allowFailure: true }))

const run = async () => {
  const now = BigInt(Math.floor(Date.now()/1000))
  const cur = (now/WEEK)*WEEK
  const epochs = [cur - WEEK, cur - 2n*WEEK]
  const len = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'length'}))
  const tw = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'totalWeight'}))
  console.log('block', (await retry(()=>client.getBlockNumber())).toString())
  console.log('epochs:', epochs.map(e=>e+' ('+new Date(Number(e)*1000).toISOString().slice(0,10)+')').join(', '))
  console.log('voter pools:', len.toString(), '| totalWeight:', formatUnits(tw,18), 'veAEON')

  // pools
  const pools = (await mc(Array.from({length:Number(len)},(_,i)=>({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'pools',args:[BigInt(i)]})))).map(r=>r.result).filter(Boolean)
  // weights
  const weights = (await mc(pools.map(p=>({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'weights',args:[p]})))).map(r=>r.result??0n)
  const poolsWithVotes = weights.filter(w=>w>0n).length

  // fees: pool x epoch x token
  for (const e of epochs){
    const calls = []
    for (const p of pools) for (const [,t] of TOKS) calls.push({address:CONTRACTS.FeeDistributor,abi:FEE,functionName:'poolTokenEpochFees',args:[p,t,e]})
    const res = await mc(calls)
    const tot = { AEON:0, WETH:0, USDG:0 }
    res.forEach((r,idx)=>{ if(r.status==='success'&&r.result>0n){ const [sym,,dec]=TOKS[idx%3]; tot[sym]+=Number(formatUnits(r.result,dec)) }})
    const usd = tot.AEON*P.AEON + tot.WETH*P.WETH + tot.USDG*P.USDG
    console.log(`\nepoch ${e} (${new Date(Number(e)*1000).toISOString().slice(0,10)}) fees claimable in FeeDistributor:`)
    console.log(`  AEON ${tot.AEON.toFixed(4)} ($${(tot.AEON*P.AEON).toFixed(2)}) | WETH ${tot.WETH.toFixed(6)} ($${(tot.WETH*P.WETH).toFixed(2)}) | USDG ${tot.USDG.toFixed(4)} ($${tot.USDG.toFixed(2)})`)
    console.log(`  => TOTAL $${usd.toFixed(2)}`)
  }

  // pot balances
  console.log('\n=== POT balances now (undistributed sitting in contracts) ===')
  const pots = [['FeeDistributor',CONTRACTS.FeeDistributor],['EmissionsEngine',CONTRACTS.EmissionsEngine],['BuybackEngine',CONTRACTS.BuybackEngine],['TheFurnace',CONTRACTS.TheFurnace],['MultiGaugeController',CONTRACTS.MultiGaugeController],['AeonVoter',CONTRACTS.AeonVoter]]
  const bcalls = []
  for (const [,addr] of pots) for (const [,t] of TOKS) bcalls.push({address:t,abi:ERC20,functionName:'balanceOf',args:[addr]})
  const bres = await mc(bcalls)
  let grand=0
  pots.forEach((pot,pi)=>{ const parts=[]; TOKS.forEach(([sym,,dec],ti)=>{ const r=bres[pi*3+ti]; if(r.status==='success'&&r.result>0n){const n=Number(formatUnits(r.result,dec));grand+=n*P[sym];parts.push(`${n.toFixed(4)} ${sym} ($${(n*P[sym]).toFixed(2)})`)}}); console.log(pot[0].padEnd(20), parts.length?parts.join(' | '):'(empty)') })
  console.log('POT TOTAL (undistributed): $'+grand.toFixed(2))
  console.log('\nvotes: '+poolsWithVotes+' pools have votes / '+len.toString()+' | totalWeight '+formatUnits(tw,18)+' veAEON')
}
run().catch(e=>console.error('FAILED:', e?.message??e))
