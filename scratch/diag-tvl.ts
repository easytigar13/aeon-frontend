import { createPublicClient, http, formatUnits, getAddress } from 'viem'
import { TOKENS } from '../src/config/contracts.ts'

const pub = createPublicClient({
  transport: http('https://rpc.robinhood.com'),
})

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'blockTimestampLast', type: 'uint32' }] },
] as const

async function diag() {
  const pools = [
    { name: 'vAMM WETH/AEON', address: '0xD215650cb628113A64D938164Ee5CD72293F9ea6', t0: TOKENS.WETH, t1: TOKENS.AEON },
    { name: 'vAMM USDG/AEON', address: '0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288', t0: TOKENS.USDG, t1: TOKENS.AEON },
    { name: 'CL WETH/AEON', address: '0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e', t0: TOKENS.WETH, t1: TOKENS.AEON },
    { name: 'CL USDG/AEON', address: '0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6', t0: TOKENS.USDG, t1: TOKENS.AEON },
    { name: 'UniV2 WETH/USDG', address: '0x8803c117ccae7B5146297876c2A25DF135141C4d', t0: TOKENS.WETH, t1: TOKENS.USDG },
  ]

  for (const p of pools) {
    const addr = getAddress(p.address)
    const b0 = await pub.readContract({ address: p.t0.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }).catch(e => e.message)
    const b1 = await pub.readContract({ address: p.t1.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [addr] }).catch(e => e.message)
    const res = await pub.readContract({ address: addr, abi: PAIR_ABI, functionName: 'getReserves' }).catch(e => e.message)
    console.log(`Pool ${p.name} @ ${addr}:`)
    console.log(`  b0 (${p.t0.symbol}):`, typeof b0 === 'bigint' ? formatUnits(b0, p.t0.decimals) : b0)
    console.log(`  b1 (${p.t1.symbol}):`, typeof b1 === 'bigint' ? formatUnits(b1, p.t1.decimals) : b1)
    console.log(`  getReserves:`, res)
  }
}

diag().catch(console.error)
