import 'dotenv/config'
import { createPublicClient, http, formatUnits } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const FEEDIST = '0x40524d597e9e241b5B7C76D1b2e570A77933D412'
const ORACLE = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const c = createPublicClient({ transport: http(RPC) })
const CUR = 1785369600n   // active epoch (Jul 30 -> closes Aug 6)
const PREV = 1784764800n  // one epoch earlier (Jul 23)

const T = {
  WETH:['0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',18], USDG:['0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',6],
  AEON:['0xd4c93eD1843606f92CccA078941f3d52A585982f',18], CASHCAT:['0x020bfC650A365f8BB26819deAAbF3E21291018b4',18],
  FRONG:['0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',18], VIRTUAL:['0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31',18],
}
// pool -> [tokenSymA, tokenSymB]
const POOLS = [
  ['0xD215650cb628113A64D938164Ee5CD72293F9ea6', ['WETH','AEON'],  'vAMM WETH/AEON'],
  ['0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288', ['USDG','AEON'],  'vAMM USDG/AEON'],
  ['0x22d76bf4e8d2c1DfCca7de6c9dC46Ec2a8Ed7Eb7', ['CASHCAT','AEON'],'vAMM CASHCAT/AEON'],
  ['0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e', ['WETH','AEON'],  'CL WETH/AEON'],
  ['0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6', ['USDG','AEON'],  'CL USDG/AEON'],
]
const FEE_ABI = [{name:'poolTokenEpochFees',type:'function',stateMutability:'view',inputs:[{type:'address'},{type:'address'},{type:'uint256'}],outputs:[{type:'uint256'}]}]
const OR_ABI = [{name:'getTokenPrice',type:'function',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]}]

const price = {}
for (const [sym,[addr]] of Object.entries(T)) {
  try { const p = await c.readContract({address:ORACLE,abi:OR_ABI,functionName:'getTokenPrice',args:[addr]}); price[sym]=Number(formatUnits(p,18)) }
  catch { price[sym]=0 }
}
console.log('oracle prices:', Object.entries(price).map(([k,v])=>`${k}=$${v.toFixed(4)}`).join('  '))

for (const [label,epoch] of [['CURRENT (Jul30, closes Aug6)',CUR],['PREV (Jul23)',PREV]]) {
  let total = 0
  console.log(`\n=== ${label} epoch ${epoch} — poolTokenEpochFees ===`)
  for (const [pool,[a,b],name] of POOLS) {
    for (const sym of [a,b]) {
      const [addr,dec] = T[sym]
      let raw = 0n
      try { raw = await c.readContract({address:FEEDIST,abi:FEE_ABI,functionName:'poolTokenEpochFees',args:[pool,addr,epoch]}) } catch {}
      if (raw > 0n) {
        const amt = Number(formatUnits(raw,dec)); const usd = amt*(price[sym]||0)
        total += usd
        console.log(`  ${name.padEnd(20)} ${sym.padEnd(8)} ${amt.toFixed(4).padStart(14)}  $${usd.toFixed(2)}`)
      }
    }
  }
  console.log(`  subtotal (these ${POOLS.length} pools): $${total.toFixed(2)}`)
}
