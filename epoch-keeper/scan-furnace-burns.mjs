import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const c = createPublicClient({ transport: http(RPC) })
const FURNACE = '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A'

const ABI = parseAbi([
  'function burnedByToken(uint256) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function earned(uint256) view returns (uint256)',
  'function totalBurned() view returns (uint256)',
])
const rd = (fn,args=[]) => c.readContract({address:FURNACE,abi:ABI,functionName:fn,args}).catch(()=>null)

const total = await rd('totalBurned')
console.log('totalBurned:', formatUnits(total||0n,18), 'AEON\n')
console.log('tokenId  burned(AEON)      share    owner')
for (let id=1n; id<=20n; id++){
  const b = await rd('burnedByToken',[id])
  if (!b || b===0n) continue
  const owner = await rd('ownerOf',[id])
  const pct = total>0n ? (Number(b*10000n/total)/100).toFixed(2)+'%' : '?'
  console.log(String(id).padStart(4), formatUnits(b,18).padStart(16), pct.padStart(8), ' ', owner)
}
