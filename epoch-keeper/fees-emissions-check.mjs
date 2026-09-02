import 'dotenv/config'
import { createPublicClient, http, formatUnits } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const ENGINE = '0x1a4686dFd8E816d98cf871BB1d3752D318cF2FdF'
const FEEDIST = '0x40524d597e9e241b5B7C76D1b2e570A77933D412'
const ORACLE = '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD'
const AEON = '0xd4c93eD1843606f92CccA078941f3d52A585982f'
const c = createPublicClient({ transport: http(RPC) })

const ENGINE_ABI = [
  { name:'lastMintAmount', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'lastFeesUSD', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'activePeriod', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'multiGaugeBps', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'EMISSION_BPS', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'TO_VOTER_BPS', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'TO_FURNACE_BPS', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { name:'previewMint', type:'function', stateMutability:'pure', inputs:[{type:'uint256'},{type:'uint256'}], outputs:[{type:'uint256'}] },
]
const FEE_ABI = [{ name:'lastEpochFeesUSD', type:'function', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] }]
const ORACLE_ABI = [{ name:'getTokenPrice', type:'function', stateMutability:'view', inputs:[{type:'address'}], outputs:[{type:'uint256'}] }]

const E = (fn,args=[]) => c.readContract({ address:ENGINE, abi:ENGINE_ABI, functionName:fn, args }).catch(e=>`ERR ${e.shortMessage||e.message}`)
const num = (v,d=18) => typeof v==='bigint'? Number(formatUnits(v,d)) : v

const [mint, feesUsd, period, mgBps, emBps, voterBps, furnBps] = await Promise.all([
  E('lastMintAmount'), E('lastFeesUSD'), E('activePeriod'), E('multiGaugeBps'), E('EMISSION_BPS'), E('TO_VOTER_BPS'), E('TO_FURNACE_BPS')
])
const feeDistUsd = await c.readContract({ address:FEEDIST, abi:FEE_ABI, functionName:'lastEpochFeesUSD' }).catch(e=>`ERR ${e.shortMessage||e.message}`)
const aeonPrice = await c.readContract({ address:ORACLE, abi:ORACLE_ABI, functionName:'getTokenPrice', args:[AEON] }).catch(e=>`ERR ${e.shortMessage||e.message}`)

console.log('=== ENGINE (VoteDirectedLpEmissionsEngineRH) ===')
console.log('activePeriod       :', period, typeof period==='bigint'?`(${new Date(Number(period)*1000).toISOString()})`:'')
console.log('EMISSION_BPS       :', emBps, typeof emBps==='bigint'?`(${num(emBps,2)}%)`:'')
console.log('split TO_VOTER/MULTI_GAUGE/FURNACE bps:', String(voterBps), '/', String(mgBps), '/', String(furnBps))
console.log('lastFeesUSD (engine):', typeof feesUsd==='bigint'? `$${num(feesUsd).toLocaleString()}`:feesUsd)
console.log('lastMintAmount     :', typeof mint==='bigint'? `${num(mint).toLocaleString()} AEON`:mint)
console.log()
console.log('=== FEE DISTRIBUTOR ===')
console.log('lastEpochFeesUSD   :', typeof feeDistUsd==='bigint'? `$${num(feeDistUsd).toLocaleString()}`:feeDistUsd)
console.log()
console.log('=== ORACLE ===')
console.log('AEON price         :', typeof aeonPrice==='bigint'? `$${num(aeonPrice).toFixed(6)}`:aeonPrice)
console.log()

// est next mint = EMISSION_BPS * feesUSD / aeonPrice, using latest finalized fees as the proxy
if (typeof feeDistUsd==='bigint' && typeof aeonPrice==='bigint' && aeonPrice>0n) {
  const pv = await E('previewMint', [feeDistUsd, aeonPrice])
  const emUsd = num(feeDistUsd) * (typeof emBps==='bigint'?num(emBps,4):0.25)
  console.log('=== EST NEXT EMISSION (using latest finalized fees as proxy) ===')
  console.log('fees USD (proxy)   : $'+num(feeDistUsd).toLocaleString())
  console.log('emission USD (25%) : $'+emUsd.toLocaleString(undefined,{maximumFractionDigits:2}))
  console.log('previewMint AEON   :', typeof pv==='bigint'? num(pv).toLocaleString(undefined,{maximumFractionDigits:2})+' AEON':pv)
  if (typeof pv==='bigint' && typeof mgBps==='bigint') {
    console.log('  -> to vAMM voters :', (num(pv)*num(voterBps,4)).toLocaleString(undefined,{maximumFractionDigits:2}), 'AEON')
    console.log('  -> to CL/DLMM     :', (num(pv)*num(mgBps,4)).toLocaleString(undefined,{maximumFractionDigits:2}), 'AEON  (BUT distributes only if CL vote weight > 0)')
    console.log('  -> to furnace     :', (num(pv)*num(furnBps,4)).toLocaleString(undefined,{maximumFractionDigits:2}), 'AEON')
  }
}
