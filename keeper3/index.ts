// ============================================================================
// NEW BOT v1 -- "dead simple" cross-DEX arbitrage DETECTOR (read-only).
//
// WETH -> token -> WETH cycles across Robinhood DEXes, surfaced ONLY when
// net-positive after gas. Step 1 of 2:
//   1) (this file) detect + clearly show real profitable cycles -- no keys,
//      no trading, zero fund risk. Proves whether edges actually exist.
//   2) once proven, wire atomic execution onto the same detection.
//
// Fully self-contained: no imports from ERZA/Mirajane/frontend. All addresses
// are pinned below. Compares each token's price on its AEON vAMM WETH pool vs
// the external Uniswap V3 pool and reports any round-trip that clears gas.
// ============================================================================

import { createPublicClient, createWalletClient, http, getAddress, formatEther, parseEther, encodePacked, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from 'fs'
import { fileURLToPath } from 'url'

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS ?? '15000')
const GAS_UNITS = BigInt(process.env.GAS_UNITS ?? '450000')
const TEST_SIZES_ETH = (process.env.TEST_SIZES ?? '0.001,0.005,0.02,0.05,0.1').split(',').map(s => parseEther(s.trim()))
const LOG_FILE = fileURLToPath(new URL('detect.log', import.meta.url))

// ---- Execution config (opt-in) --------------------------------------------
// DRY_RUN=true (default) => detect only, never trades. To go live the USER
// sets BOT_PK in keeper3/.env and DRY_RUN=false. BOT_PK is read here but NEVER
// logged/printed. Trades are atomic (one Uniswap V3 multi-hop tx) with an
// on-chain amountOutMinimum floor, so a bad/moved price just reverts -- the
// worst case is the gas for a reverted tx.
function readEnvKey(): string {
  if (process.env.BOT_PK) return process.env.BOT_PK
  try {
    const raw = fs.readFileSync(fileURLToPath(new URL('.env', import.meta.url)), 'utf-8')
    const m = raw.match(/^\s*BOT_PK\s*=\s*(.+?)\s*$/m)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  } catch { /* no .env */ }
  return ''
}
const BOT_PK = readEnvKey()
// Only thing you need to do: put BOT_PK in keeper3/.env. With a key present the
// bot trades automatically; with no key it stays in safe dry-run. You can still
// force dry-run WITH a key by setting DRY_RUN=true.
const DRY_RUN = !BOT_PK ? true : (process.env.DRY_RUN ?? 'false').toLowerCase() === 'true'
const MIN_PROFIT_WETH = parseEther(process.env.MIN_PROFIT_WETH ?? '0.0002') // safety buffer over gas
const V3_SWAP_ROUTER = getAddress('0xcaf681a66d020601342297493863e78c959e5cb2')

// Robinhood Chain (Arbitrum Orbit L3)
const robinhoodChain = {
  id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const

const WETH = getAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')

// Tokens that have BOTH an AEON vAMM WETH pool and (checked at runtime) an
// external Uniswap V3 WETH pool -- the only ones arbitrageable between venues.
interface Target { symbol: string; token: Address; vamm: Address; vammFeeBps: bigint; v3Fees: number[] }
const NONE = getAddress('0x0000000000000000000000000000000000000000') // no AEON vAMM WETH pool -> V3-only
const SEED: Omit<Target, 'v3Fees'>[] = [
  // Have a direct AEON vAMM WETH pool -> can arb AEON vAMM vs Uniswap V3:
  { symbol: 'AEON',     token: getAddress('0xd4c93eD1843606f92CccA078941f3d52A585982f'), vamm: getAddress('0xD215650cb628113A64D938164Ee5CD72293F9ea6'), vammFeeBps: 100n },
  { symbol: 'CASHCAT',  token: getAddress('0x020bfC650A365f8BB26819deAAbF3E21291018b4'), vamm: getAddress('0x3DC6b6c354fB1e9CFdaA8A36ff845728f7176f4e'), vammFeeBps: 100n },
  { symbol: 'USDG',     token: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'), vamm: getAddress('0x2732E1312e5Bba5729534E9d94D44c090b200F14'), vammFeeBps: 30n },
  { symbol: 'ROBINFUN', token: getAddress('0x56A98Db16Cf501b686c14BA00a5DeC02E87083FA'), vamm: getAddress('0x625fcD4CA1cA34Eb8ac74883748419De037d78DF'), vammFeeBps: 100n },
  // No direct WETH vAMM pool -> scanned across Uniswap V3 tiers only (bot skips
  // any with no external V3 pool and says so in the log):
  { symbol: 'VIRTUAL',  token: getAddress('0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31'), vamm: NONE, vammFeeBps: 0n },
  { symbol: 'INDEX',    token: getAddress('0x56910D4409F3a0C78C64DD8D0545FF0705389870'), vamm: NONE, vammFeeBps: 0n },
  { symbol: 'TENDIES',  token: getAddress('0x45242320DBB855EeA8Fd36804C6487E10E97FCF9'), vamm: NONE, vammFeeBps: 0n },
  { symbol: 'NASDAQ',   token: getAddress('0x2E897ABb6BF1d77c61eB3fa6c093ae71DE0Efd2D'), vamm: NONE, vammFeeBps: 0n },
  { symbol: 'SHERWOOD', token: getAddress('0xB3b78ca800C5327a21F03f0636d9A08A103787fD'), vamm: NONE, vammFeeBps: 0n },
  { symbol: 'HOODIE',   token: getAddress('0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3'), vamm: NONE, vammFeeBps: 0n },
  // User-added addresses (V3-only; bot auto-skips if no external pool):
  { symbol: '0x2103fa', token: getAddress('0x2103faA9D1762e27a716C61718b3aCf3Ec1F9bf1'), vamm: NONE, vammFeeBps: 0n },
  { symbol: '0x39dBED', token: getAddress('0x39dBED3a2bd333467115dE45665cC57F813C4571'), vamm: NONE, vammFeeBps: 0n },
]

// ---- Uniswap V3 (external) ----
const V3_QUOTER = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const V3_FACTORY = getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa')
const V3_FEE_TIERS = [100, 500, 3000, 10_000] as const
const V3_QUOTER_ABI = [{
  name: 'quoteExactInputSingle', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
  ] }],
  outputs: [ { name: 'amountOut', type: 'uint256' }, { name: 's', type: 'uint160' }, { name: 't', type: 'uint32' }, { name: 'g', type: 'uint256' } ],
}] as const
const V3_FACTORY_ABI = [{
  name: 'getPool', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'a', type: 'address' }, { name: 'b', type: 'address' }, { name: 'fee', type: 'uint24' }],
  outputs: [{ type: 'address' }],
}] as const

// ---- AEON vAMM (UniV2-style) ----
const PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [ { type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' } ] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

const ERC20_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const
// Uniswap V3 SwapRouter02 exactInput (no deadline arg on 02).
const V3_ROUTER_ABI = [{
  name: 'exactInput', type: 'function', stateMutability: 'payable',
  inputs: [{ name: 'params', type: 'tuple', components: [
    { name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' },
    { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
  ] }],
  outputs: [{ name: 'amountOut', type: 'uint256' }],
}] as const

const ZERO = '0x0000000000000000000000000000000000000000'
const pub = createPublicClient({ chain: robinhoodChain, transport: http(RPC_URL) })
const account = BOT_PK ? privateKeyToAccount(BOT_PK as `0x${string}`) : null
const wallet = account ? createWalletClient({ account, chain: robinhoodChain, transport: http(RPC_URL) }) : null
let wethApproved = false

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { fs.appendFileSync(LOG_FILE, line + '\n') } catch { /* ignore */ }
}

function vammOut(amountIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn <= 0n || rOut <= 0n || amountIn <= 0n) return 0n
  const inAfterFee = amountIn * (10_000n - feeBps)
  return (inAfterFee * rOut) / (rIn * 10_000n + inAfterFee)
}

type Venue = { kind: 'v3'; fee: number } | { kind: 'vamm'; pool: Address; feeBps: bigint }
function label(v: Venue): string { return v.kind === 'v3' ? `UniV3 ${v.fee / 10_000}%` : 'AEON vAMM' }

async function quote(v: Venue, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint | null> {
  try {
    if (v.kind === 'v3') {
      const r = await pub.readContract({ address: V3_QUOTER, abi: V3_QUOTER_ABI, functionName: 'quoteExactInputSingle',
        args: [{ tokenIn, tokenOut, amountIn, fee: v.fee, sqrtPriceLimitX96: 0n }] }) as readonly [bigint, bigint, number, bigint]
      return r[0]
    }
    const [res, token0] = await Promise.all([
      pub.readContract({ address: v.pool, abi: PAIR_ABI, functionName: 'getReserves' }) as Promise<readonly [bigint, bigint, number]>,
      pub.readContract({ address: v.pool, abi: PAIR_ABI, functionName: 'token0' }) as Promise<Address>,
    ])
    const inIs0 = token0.toLowerCase() === tokenIn.toLowerCase()
    return vammOut(amountIn, inIs0 ? res[0] : res[1], inIs0 ? res[1] : res[0], v.feeBps)
  } catch { return null }
}

interface Opp {
  symbol: string; route: string; sizeEth: string; netEth: number; netUsd: number; grossEth: number
  size: bigint; token: Address; netWei: bigint
  // Present only when BOTH legs are Uniswap V3 -> atomically executable via one multi-hop tx.
  v3?: { feeA: number; feeB: number }
}

async function scan(t: Target, gasCostWeth: bigint, ethUsd: number): Promise<Opp | null> {
  const venues: Venue[] = [
    ...(t.vamm !== NONE ? [{ kind: 'vamm', pool: t.vamm, feeBps: t.vammFeeBps } as Venue] : []),
    ...t.v3Fees.map(fee => ({ kind: 'v3', fee } as Venue)),
  ]
  let best: Opp | null = null
  for (const size of TEST_SIZES_ETH) {
    for (const a of venues) {
      const tokenAmt = await quote(a, WETH, t.token, size)
      if (!tokenAmt || tokenAmt <= 0n) continue
      for (const b of venues) {
        if (a === b) continue
        const back = await quote(b, t.token, WETH, tokenAmt)
        if (!back || back <= 0n) continue
        const net = back - size - gasCostWeth
        if (net <= 0n) continue
        const netEth = Number(formatEther(net))
        if (!best || netEth > best.netEth) best = {
          symbol: t.symbol, route: `WETH -(${label(a)})-> ${t.symbol} -(${label(b)})-> WETH`,
          sizeEth: formatEther(size), netEth, netUsd: netEth * ethUsd, grossEth: Number(formatEther(back - size)),
          size, token: t.token, netWei: net,
          v3: (a.kind === 'v3' && b.kind === 'v3') ? { feeA: a.fee, feeB: b.fee } : undefined,
        }
      }
    }
  }
  return best
}

// Atomic execution: buy WETH->token on fee tier A and sell token->WETH on fee
// tier B in a SINGLE Uniswap V3 multi-hop tx. amountOutMinimum = principal +
// safety margin is enforced on-chain, so if the price moved the tx reverts and
// only gas is lost -- the bot can never end a trade holding the mid token or
// down more than gas. Only runs when !DRY_RUN and a key is loaded.
async function executeArb(o: Opp): Promise<void> {
  if (!wallet || !account || !o.v3) return
  try {
    const bal = await pub.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
    if (bal < o.size) { log(`SKIP trade: WETH balance ${formatEther(bal)} < size ${formatEther(o.size)} -- fund the bot wallet with WETH.`); return }
    if (!wethApproved) {
      const allow = await pub.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, V3_SWAP_ROUTER] }) as bigint
      if (allow < o.size) {
        const h = await wallet.writeContract({ address: WETH, abi: ERC20_ABI, functionName: 'approve', args: [V3_SWAP_ROUTER, (1n << 255n)] })
        await pub.waitForTransactionReceipt({ hash: h })
        log('WETH approved to V3 router')
      }
      wethApproved = true
    }
    const path = encodePacked(['address', 'uint24', 'address', 'uint24', 'address'], [WETH, o.v3.feeA, o.token, o.v3.feeB, WETH])
    const minOut = o.size + MIN_PROFIT_WETH
    const h = await wallet.writeContract({
      address: V3_SWAP_ROUTER, abi: V3_ROUTER_ABI, functionName: 'exactInput',
      args: [{ path, recipient: account.address, amountIn: o.size, amountOutMinimum: minOut }],
    })
    log(`TRADE SENT ${o.symbol} size ${o.sizeEth} WETH tiers ${o.v3.feeA}/${o.v3.feeB} minOut ${formatEther(minOut)} -- ${h}`)
    const rcpt = await pub.waitForTransactionReceipt({ hash: h })
    log(`TRADE ${rcpt.status === 'success' ? 'CONFIRMED' : 'REVERTED'} ${o.symbol} -- ${h}`)
  } catch (e: any) {
    log(`TRADE FAILED ${o.symbol}: ${e?.shortMessage ?? e?.message ?? e}`)
  }
}

let universe: Target[] = []

async function tick() {
  try {
    if (universe.length === 0) {
      log('Building universe (checking Uniswap V3 pools for each seed token)...')
      for (const s of SEED) {
        const v3Fees: number[] = []
        for (const fee of V3_FEE_TIERS) {
          try {
            const pool = await pub.readContract({ address: V3_FACTORY, abi: V3_FACTORY_ABI, functionName: 'getPool', args: [WETH, s.token, fee] }) as Address
            if (pool && pool !== ZERO) v3Fees.push(fee)
          } catch { /* skip */ }
        }
        if (v3Fees.length > 0) universe.push({ ...s, v3Fees })
        log(`  ${s.symbol}: ${v3Fees.length ? `V3 tiers [${v3Fees.join(', ')}] -> arbitrageable` : 'no external V3 pool -> skipped'}`)
      }
      if (universe.length === 0) { log('No dual-venue tokens. Nothing to arb.'); return }
    }
    const gasCostWeth = (await pub.getGasPrice()) * GAS_UNITS
    const ethUsd = 1920
    const opps: Opp[] = []
    for (const t of universe) { const o = await scan(t, gasCostWeth, ethUsd); if (o) opps.push(o) }
    opps.sort((a, b) => b.netEth - a.netEth)
    const gasEth = Number(formatEther(gasCostWeth))
    if (opps.length === 0) log(`No profitable cycles this tick (gas ~${gasEth.toFixed(6)} WETH/round-trip, ${universe.length} tokens scanned).`)
    else {
      log(`PROFITABLE (net-of-gas) x${opps.length}:`)
      for (const o of opps.slice(0, 10)) log(`  +${o.netEth.toFixed(6)} WETH ($${o.netUsd.toFixed(4)}) | ${o.route} | in ${o.sizeEth} WETH | gross ${o.grossEth.toFixed(6)}`)
      if (!DRY_RUN && wallet) {
        const exec = opps.find(o => o.v3 && o.netWei >= MIN_PROFIT_WETH)
        if (exec) await executeArb(exec)
        else log('  (best cycle is not atomically V3-executable or below margin -- not trading it)')
      } else if (!DRY_RUN && !wallet) {
        log('  DRY_RUN=false but no BOT_PK loaded -- set your key in keeper3/.env to trade.')
      }
    }
  } catch (e: any) { log(`tick error: ${e?.shortMessage ?? e?.message ?? e}`) }
}

log(`Arb bot starting. RPC=${RPC_URL} interval=${INTERVAL_MS}ms`)
log(`MODE: ${DRY_RUN ? 'DRY-RUN (detect only, no trades)' : (wallet ? `LIVE TRADING as ${account!.address} (min profit ${formatEther(MIN_PROFIT_WETH)} WETH)` : 'DRY-RUN forced -- DRY_RUN=false but no BOT_PK set')}`)
tick()
setInterval(tick, INTERVAL_MS)
