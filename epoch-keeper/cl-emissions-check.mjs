import 'dotenv/config'
import { createPublicClient, http, formatUnits } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const CTRL = '0x4D49C36197bF806dc5f65267a847b3A7a4ab1335'
const client = createPublicClient({ transport: http(RPC) })

const ABI = [
  { name:'currentEpoch', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'votingEpoch', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'getPools', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'address[]'}] },
  { name:'totalWeight', type:'function', stateMutability:'view', inputs:[{type:'uint256'}], outputs:[{type:'uint256'}] },
  { name:'weights', type:'function', stateMutability:'view', inputs:[{type:'uint256'},{type:'address'}], outputs:[{type:'uint256'}] },
  { name:'claimable', type:'function', stateMutability:'view', inputs:[{type:'address'},{type:'uint256'}], outputs:[{type:'uint256'}] },
]
const NAMES = {
  '0x3c8090c3cb3a45a677a6492acb5ad5253f9a686e':'AEON/ETH','0xe2503a27a33dacdbeec821557fe8747800cf6ff6':'AEON/USDG',
  '0x96b5de75c08971f41de6bde917fb0a8d0eb450f3':'ETH/USDG','0xbcd1bf0d9f25503ddfed0b663827811637b27b80':'CASHCAT/AEON',
  '0x9ebd1c556967d8e3f6f1c043d57eb7762047d60d':'CASHCAT/USDG','0x09e729d9e077eb1ad10adccde4d18c143035fe04':'CASHCAT/ETH',
  '0x9ea50b0d2f7f65c9026e499e514d53e7d1e75185':'NASDAQ/AEON','0x7d6a6e87ae038f213ffd7f65f738e782b1715cbe':'SHERWOOD/AEON',
  '0xcc2cfed37161bd79cdcba5d323583801933b0643':'HOODIE/AEON',
}
const rd = (fn, args=[]) => client.readContract({ address: CTRL, abi: ABI, functionName: fn, args })

const cur = await rd('currentEpoch')
const vot = await rd('votingEpoch')
console.log(`controller ${CTRL}`)
console.log(`currentEpoch=${cur}  votingEpoch=${vot}`)
const toDate = e => new Date(Number(e)*1000).toISOString()
console.log(`  currentEpoch date ~ ${toDate(cur)}`)
console.log(`  votingEpoch  date ~ ${toDate(vot)}\n`)

const pools = await rd('getPools')
console.log(`registered pools in MultiGaugeController: ${pools.length}`)

for (const epoch of [vot, cur]) {
  const tw = await rd('totalWeight', [epoch])
  console.log(`\n=== epoch ${epoch} (${toDate(epoch)}) — totalWeight ${formatUnits(tw,18)} ===`)
  if (pools.length === 0) { console.log('  (no pools registered)'); continue }
  for (const p of pools) {
    const w = await rd('weights', [epoch, p])
    let claim = 0n; try { claim = await rd('claimable', [p, epoch]) } catch {}
    const pct = tw > 0n ? (Number(w*10000n/tw)/100).toFixed(2)+'%' : '—'
    const nm = NAMES[p.toLowerCase()] || p.slice(0,10)
    if (w > 0n || claim > 0n) console.log(`  ${nm.padEnd(14)} weight=${formatUnits(w,18).padStart(14)} (${pct})  claimableAEON=${formatUnits(claim,18)}`)
  }
  const anyVotes = tw > 0n
  console.log(anyVotes ? '  -> pools above have votes; they WILL receive emissions when distributed' : '  -> ZERO total weight this epoch: NO CL emissions')
}
