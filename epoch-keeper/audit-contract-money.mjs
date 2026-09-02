// Read-only audit: token + native ETH balances held by every major AEON
// contract. No keys, no writes. Backoff on rate-limit.
import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { robinhoodChain } from '../src/config/chain.ts'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })
const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) })
const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])

const TOKENS = [
  { sym: 'AEON', addr: '0xd4c93eD1843606f92CccA078941f3d52A585982f', dec: 18 },
  { sym: 'WETH', addr: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', dec: 18 },
  { sym: 'USDG', addr: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', dec: 6  },
]
const CONTRACTS = [
  { name: 'FeeDistributor',       addr: '0x40524d597e9e241b5B7C76D1b2e570A77933D412' },
  { name: 'BuybackEngine',        addr: '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4' },
  { name: 'TheFurnace',           addr: '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A' },
  { name: 'EmissionsEngine',      addr: '0x1a4686dFd8E816d98cf871BB1d3752D318cF2FdF' },
  { name: 'MultiGaugeController', addr: '0x4D49C36197bF806dc5f65267a847b3A7a4ab1335' },
  { name: 'AeonVoter',            addr: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb' },
  { name: 'ArbKeeper',            addr: '0xdce1773a806cdf172f76f94d8828971d580cd472' },
  { name: 'NativeArbExecutor',    addr: '0x871fa5908dcd02df2993056666b324cd6078e6b1' },
]

async function withRetry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await fn() }
    catch (e) {
      const msg = String(e?.message ?? e)
      if (i === tries - 1) throw e
      const wait = /rate limit|429|limit will reset/i.test(msg) ? 3000 : 1200
      await new Promise(r => setTimeout(r, wait * (i + 1)))
    }
  }
}

const run = async () => {
  console.log('block:', (await withRetry(() => client.getBlockNumber())).toString())
  const totals = { AEON: 0, WETH: 0, USDG: 0, ETH: 0 }
  for (const c of CONTRACTS) {
    const parts = []
    for (const t of TOKENS) {
      const bal = await withRetry(() => client.readContract({ address: t.addr, abi: ERC20, functionName: 'balanceOf', args: [c.addr] }))
      const n = Number(formatUnits(bal, t.dec))
      totals[t.sym] += n
      if (n > 0) parts.push(`${n.toLocaleString(undefined,{maximumFractionDigits:4})} ${t.sym}`)
    }
    const eth = Number(formatUnits(await withRetry(() => client.getBalance({ address: c.addr })), 18))
    totals.ETH += eth
    if (eth > 0) parts.push(`${eth.toFixed(6)} ETH`)
    console.log(`${c.name.padEnd(22)} ${parts.length ? parts.join(' | ') : '(empty)'}`)
  }
  console.log('\n=== TOTALS across contracts ===')
  for (const [k, v] of Object.entries(totals)) console.log(`${k.padEnd(6)} ${v.toLocaleString(undefined,{maximumFractionDigits:4})}`)
}
run().catch(e => console.error('FAILED:', e?.message ?? e))
