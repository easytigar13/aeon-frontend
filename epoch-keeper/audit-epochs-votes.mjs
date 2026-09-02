// Read-only: last-2-epoch fees per pool, contract "pot" balances, and voting.
import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { CONTRACTS } from '../src/config/contracts.ts'
import { robinhoodChain } from '../src/config/chain.ts'
dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com') })
const WEEK = 604800n
const PRICES = { AEON: 0.44, WETH: 2450, USDG: 1 } // USDG=$1, AEON/ETH ~ DexScreener

const VOTER = parseAbi([
  'function length() view returns (uint256)',
  'function pools(uint256) view returns (address)',
  'function gauges(address) view returns (address)',
  'function weights(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
])
const FEE = parseAbi([
  'function poolEpochTokens(address,uint256,uint256) view returns (address)',
  'function poolTokenEpochFees(address,address,uint256) view returns (uint256)',
])
const ERC20 = parseAbi(['function symbol() view returns (string)','function decimals() view returns (uint8)','function balanceOf(address) view returns (uint256)'])

async function retry(fn, n=6){for(let i=0;i<n;i++){try{return await fn()}catch(e){if(i===n-1)throw e;await new Promise(r=>setTimeout(r,1500*(i+1)))}}}
const symDec = new Map()
async function meta(addr){if(symDec.has(addr))return symDec.get(addr);let m={sym:addr.slice(0,6),dec:18};try{m.sym=await retry(()=>client.readContract({address:addr,abi:ERC20,functionName:'symbol'}));m.dec=await retry(()=>client.readContract({address:addr,abi:ERC20,functionName:'decimals'}))}catch{};symDec.set(addr,m);return m}

const run = async () => {
  const now = BigInt(Math.floor(Date.now()/1000))
  const cur = (now/WEEK)*WEEK
  const epochs = [cur - WEEK, cur - 2n*WEEK] // last 2 closed epochs
  console.log('block', (await retry(()=>client.getBlockNumber())).toString())
  console.log('epochs (closed):', epochs.map(e=>e.toString()+' ('+new Date(Number(e)*1000).toISOString().slice(0,10)+')').join(', '))

  const poolCount = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'length'}))
  const totalWeight = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'totalWeight'}))
  console.log('voter pools:', poolCount.toString(), '| totalWeight:', formatUnits(totalWeight,18))

  const feeTotals = {} // epoch -> {sym: amount}
  for (const e of epochs) feeTotals[e]={}
  let poolsWithVotes = 0

  for (let i=0n;i<poolCount;i++){
    const pool = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'pools',args:[i]}))
    const w = await retry(()=>client.readContract({address:CONTRACTS.AeonVoter,abi:VOTER,functionName:'weights',args:[pool]}))
    if (w>0n) poolsWithVotes++
    for (const e of epochs){
      for (let ti=0n;ti<4n;ti++){
        let tok
        try{ tok = await retry(()=>client.readContract({address:CONTRACTS.FeeDistributor,abi:FEE,functionName:'poolEpochTokens',args:[pool,e,ti]})) }catch{break}
        if(!tok||tok==='0x0000000000000000000000000000000000000000')break
        const amt = await retry(()=>client.readContract({address:CONTRACTS.FeeDistributor,abi:FEE,functionName:'poolTokenEpochFees',args:[pool,tok,e]}))
        if(amt>0n){const m=await meta(tok);const n=Number(formatUnits(amt,m.dec));feeTotals[e][m.sym]=(feeTotals[e][m.sym]||0)+n}
      }
    }
    if(i%10n===0n)process.stdout.write('.')
  }
  console.log('')
  console.log('pools with votes:', poolsWithVotes, '/', poolCount.toString())
  for (const e of epochs){
    const parts=Object.entries(feeTotals[e]).map(([s,n])=>`${n.toLocaleString(undefined,{maximumFractionDigits:4})} ${s} ($${(n*(PRICES[s]||0)).toFixed(2)})`)
    console.log(`epoch ${e} fees:`, parts.length?parts.join(' | '):'none')
  }

  console.log('\n=== POT balances now (undistributed) ===')
  const pots=[['FeeDistributor',CONTRACTS.FeeDistributor],['EmissionsEngine',CONTRACTS.EmissionsEngine],['BuybackEngine',CONTRACTS.BuybackEngine],['TheFurnace',CONTRACTS.TheFurnace],['MultiGaugeController',CONTRACTS.MultiGaugeController]]
  const toks=[['AEON',CONTRACTS.AeonToken,18],['WETH','0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',18],['USDG','0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',6]]
  for(const [nm,addr] of pots){const parts=[];for(const [s,t,d] of toks){const b=await retry(()=>client.readContract({address:t,abi:ERC20,functionName:'balanceOf',args:[addr]}));const n=Number(formatUnits(b,d));if(n>0)parts.push(`${n.toFixed(4)} ${s} ($${(n*PRICES[s]).toFixed(2)})`)}console.log(nm.padEnd(20),parts.length?parts.join(' | '):'(empty)')}
}
run().catch(e=>console.error('FAILED:',e?.message??e))
