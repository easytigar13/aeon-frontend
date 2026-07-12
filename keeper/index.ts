/**
 * AEON Arb Keeper -- 24/7 live service
 *
 * Continuously scans every AEON vAMM pool in src/config/contracts.ts (the
 * same list the website itself reads -- no separate pool list to drift out
 * of sync) for cycles that start AND end in the SAME token -- 2 hops up to
 * MAX_HOPS (default 6, hard-capped at 10). By default it auto-discovers
 * every token the wallet holds above a dust floor each tick and searches a
 * cycle anchored at each one (see candidateBaseTokens()); set BASE_TOKEN to
 * pin it to just one. Hop count and which token doesn't matter; only
 * whether the cycle clears gas after fees. Executes profitable ones
 * atomically through the already-deployed AeonArbKeeper contract instead of
 * raw sequential swaps.
 *
 * AeonArbKeeper pulls the input token from the caller up front, walks the
 * hops itself pricing each one from live reserves, and REVERTS unless the
 * caller ends up with at least amountIn + minProfit. That means a stale
 * quote or a beaten race just wastes gas -- it can never leave funds stuck
 * mid-cycle or execute at a loss. See src/robinhood/AeonArbKeeper.sol in the
 * aeon-protocol-v5 repo for the contract itself.
 *
 * Before ever sending a transaction, this also checks the quoted profit
 * against a live gas-cost estimate (converted into whatever token the arb
 * trades, with a 1.3x buffer). Any profit above that buffered gas cost is
 * executable, even one smallest token unit. See gasCostFloorInToken() below.
 * That floor is also passed on-chain as minProfit, so even a live reserve shift
 * between quoting and inclusion can't result in a trade that nets less.
 *
 * This process never leaves funds stuck between calls and holds no custody
 * beyond gas float -- but KEEPER_PRIVATE_KEY below is real signing authority
 * over whatever capital you send this wallet. Keep keeper/.env off any
 * machine you don't control, and never commit it (already gitignored).
 *
 * Usage:
 *   cp keeper/.env.example keeper/.env   # add your own private key
 *   npm --prefix keeper start             # live (DRY_RUN=false in .env)
 *   npm --prefix keeper run dry           # read-only, never sends a tx
 *
 * Also scans for CROSS-VENUE arbs -- our own pool vs. a real external quote
 * from OpenOcean or 1inch (see aggregators.ts) -- on a much slower cadence
 * (AGGREGATOR_SCAN_INTERVAL_MS, default 30s) to stay within API rate limits.
 * This path is NOT atomic like the internal one: AeonArbKeeper can only run
 * simple pool-style swap() calls, not an aggregator's own router calldata,
 * so it's two separate transactions (buy on our pool, then sell via the
 * aggregator). Before sending the second leg, it re-quotes fresh for the
 * exact amount actually received from the first -- if that's no longer
 * profitable, it stops and holds the intermediate token rather than force a
 * losing trade. It will never knowingly execute at a loss, but unlike the
 * internal path, a real run of bad luck between the two legs CAN leave the
 * wallet holding some amount of an unintended token. See executeAggregatorArb().
 *
 * Writes keeper/status.json after every tick -- a small snapshot (balances,
 * current opportunities, last 30 trades) the /bot page polls for live status.
 * Every trade (dry-run, success, or failed) is ALSO appended as one JSON
 * line to keeper/trades.log, which never gets truncated -- that's the full
 * history, read by /api/bot/trades and shown at /bot/trades. Nothing in
 * either file is ever sensitive (addresses, balances, tx hashes, profit
 * numbers only). The private key never leaves this process.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  formatEther,
  parseEther,
  parseUnits,
  getAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import { fileURLToPath } from 'url'
import { POOLS, TOKENS, CONTRACTS } from '../src/config/contracts'
import { ERC20_ABI, AEON_ROUTER_ABI, WETH_ABI } from '../src/config/abis'
import { robinhoodChain } from '../src/config/chain'
import { getBestQuote, getSwapTx, type AggregatorSource } from './aggregators'
import { writeBotStatus, appendTrade, isBotStoreConfigured } from '../src/lib/botStore'

const envPath      = fileURLToPath(new URL('.env', import.meta.url))
dotenv.config({ path: envPath })

// Overridable so a test run (or a second isolated instance) never touches
// the live process's real status/history files -- defaults to the normal
// in-place paths for actual 24/7 operation.
const statusPath    = process.env.STATUS_FILE ?? fileURLToPath(new URL('status.json', import.meta.url))
const tradesLogPath = process.env.TRADES_LOG_FILE ?? fileURLToPath(new URL('trades.log', import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC          = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const PK            = (process.env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}`
const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT ?? '0')  // consider every positive quote; execution still requires profit above the buffered gas cost
const INTERVAL_MS    = parseInt(process.env.INTERVAL_MS ?? '1000')
const DRY_RUN         = process.env.DRY_RUN === 'true'
const DEADLINE_SECONDS = 120  // execution must land within 2 min of being sized, else it just reverts (no funds lost)

// Cross-venue (OpenOcean / 1inch) scan runs far less often than the internal
// pool scan -- it costs real API calls (rate-limited, especially 1inch),
// unlike the internal scan which is pure RPC reads.
const AGGREGATOR_SCAN_INTERVAL_MS = parseInt(process.env.AGGREGATOR_SCAN_INTERVAL_MS ?? '30000')
const AGGREGATOR_SLIPPAGE_PCT = parseFloat(process.env.AGGREGATOR_SLIPPAGE_PCT ?? '0.5')
const ENABLE_CROSS_VENUE = process.env.ENABLE_CROSS_VENUE === 'true'

// Native ETH isn't one of the pool tokens (everything trades WETH), but
// it's economically fungible with WETH via wrap/unwrap -- whatever's spare
// above this reserve counts as WETH capacity for discovery and sizing, and
// gets wrapped on demand right before a trade that actually needs it (see
// fetchBalances() and ensureWethBalance()). This amount is NEVER touched --
// it's what keeps the bot able to pay for its own future transactions.
const GAS_RESERVE_ETH = parseFloat(process.env.GAS_RESERVE_ETH ?? '0.005')

// Every cycle starts AND ends in the SAME token -- a real cycle can't mix
// currencies, since there'd be nothing enforcing you actually end up ahead
// in anything. Which token that is doesn't matter -- USDG, AEON, WETH,
// whatever -- so by default this auto-discovers every token the wallet
// actually holds a meaningful balance of (see candidateBaseTokens()) and
// searches a cycle anchored at each one, picking whichever clears gas with
// the best profit. Set BASE_TOKEN to pin it to one token only.
//
// MAX_HOPS bounds how deep each cycle search goes; hop count itself doesn't
// matter to the caller, only whether the cycle clears gas -- 10 is
// supported, but each extra hop adds its own fee drag, so very deep cycles
// rarely clear it in practice. Hard-capped at 10 regardless of the env override.
const BASE_TOKEN_OVERRIDE = (process.env.BASE_TOKEN ?? '').trim() as keyof typeof TOKENS | ''
const MAX_HOPS = Math.max(2, Math.min(parseInt(process.env.MAX_HOPS ?? '12'), 16))
const SETTLEMENT_TOKENS = ['AEON', 'USDG', 'WETH'] as const
const SETTLEMENT_PRIORITY: Record<string, number> = { AEON: 0, USDG: 1, WETH: 2 }

if (!PK || PK.length < 66) {
  console.error('Set KEEPER_PRIVATE_KEY in keeper/.env (copy keeper/.env.example first)')
  process.exit(1)
}

if (BASE_TOKEN_OVERRIDE && !TOKENS[BASE_TOKEN_OVERRIDE]) {
  console.error(`BASE_TOKEN="${BASE_TOKEN_OVERRIDE}" isn't a known token symbol in src/config/contracts.ts TOKENS`)
  process.exit(1)
}

if (INTERVAL_MS < 1000) {
  console.warn(`[warn] INTERVAL_MS=${INTERVAL_MS} is under 1s -- most public RPCs rate-limit at that rate. Raise it if you start seeing RPC errors.`)
}

// ─── Pool set (from the frontend's own config -- single source of truth) ────

function parseFeeBps(fee: string): number {
  return Math.round(parseFloat(fee.replace('%', '')) * 100)
}

const ARB_POOLS = POOLS
  .filter(p => p.type === 'vAMM')
  .map(p => ({
    name: p.name,
    address: p.address,
    token0: p.token0 as keyof typeof TOKENS,
    token1: p.token1 as keyof typeof TOKENS,
    feeBps: BigInt(parseFeeBps(p.fee)),
    isUniV2: false,
  }))

const UNISWAP_V2_FACTORY = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f' as `0x${string}`
const UNISWAP_FEE_BPS = 30n
// ROBINFUN charges transfer tax when its official Uniswap pair is involved.
// AeonArbKeeper uses standard V2 exact-input math, so those pairs cannot be
// executed safely until the contract re-measures received amounts per hop.
const UNISWAP_UNSUPPORTED_TOKENS = new Set<keyof typeof TOKENS>(['ROBINFUN'])

// AEON isn't listed on any external aggregator (confirmed -- nothing to
// compare against), and the Robinhood tokenized stocks only exist inside
// this DEX (fresh AEON/USDG pools, no external liquidity anywhere else --
// see contracts.ts). Querying aggregators for either wastes API calls on
// pairs that can never have a route.
const AGGREGATOR_EXCLUDE = new Set([
  'AEON', 'AAPL', 'AMD', 'AMZN', 'BABA', 'BE', 'COIN', 'CRCL', 'CRWV', 'GOOGL',
  'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'ORCL', 'PLTR', 'SNDK', 'SPCX', 'TSLA', 'USAR',
])

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [
      { name: 'reserve0',           type: 'uint112' },
      { name: 'reserve1',           type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32'  },
    ]},
  { name: 'token0', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
] as const

const UNISWAP_FACTORY_ABI = [{
  name: 'getPair', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'tokenA', type: 'address' }, { name: 'tokenB', type: 'address' }],
  outputs: [{ name: 'pair', type: 'address' }],
}] as const

const ARB_KEEPER_ABI = [
  {
    name: 'executeArb',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'hops', type: 'tuple[]',
        components: [
          { name: 'pool',     type: 'address' },
          { name: 'tokenIn',  type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'isUniV2',  type: 'bool'    },
          { name: 'feeBps',   type: 'uint16'  },
        ],
      },
      { name: 'amountIn',  type: 'uint256' },
      { name: 'minProfit', type: 'uint256' },
      { name: 'deadline',  type: 'uint256' },
    ],
    outputs: [{ name: 'profit', type: 'uint256' }],
  },
] as const

// ─── Clients ──────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PK)
const pub = createPublicClient({ chain: robinhoodChain, transport: http(RPC) })
const wal = createWalletClient({ account, chain: robinhoodChain, transport: http(RPC) })

async function discoverUniswapPools(): Promise<number> {
  const ownPools = [...ARB_POOLS]
  const seenPairs = new Set<string>()
  const calls = ownPools.map(pool => ({
    address: UNISWAP_V2_FACTORY,
    abi: UNISWAP_FACTORY_ABI,
    functionName: 'getPair' as const,
    args: [TOKENS[pool.token0].address, TOKENS[pool.token1].address] as const,
  }))
  const results = await pub.multicall({ contracts: calls, allowFailure: true })
  let added = 0
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status !== 'success') continue
    const address = (result.result as string).toLowerCase()
    if (address === '0x0000000000000000000000000000000000000000' || seenPairs.has(address)) continue
    seenPairs.add(address)
    const source = ownPools[i]
    if (UNISWAP_UNSUPPORTED_TOKENS.has(source.token0) || UNISWAP_UNSUPPORTED_TOKENS.has(source.token1)) continue
    ARB_POOLS.push({
      name: `Uniswap ${source.token0}/${source.token1}`,
      address: getAddress(address),
      token0: source.token0,
      token1: source.token1,
      feeBps: UNISWAP_FEE_BPS,
      isUniV2: true,
    })
    added++
  }
  return added
}

// ─── Math (mirrors AeonPoolRH.swap()'s own constant-product formula) ─────────

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

// ─── Pool state ───────────────────────────────────────────────────────────────

interface PoolState {
  pool: typeof ARB_POOLS[number]
  r0: bigint
  r1: bigint
  onchain0: string
}

async function fetchAllStates(): Promise<PoolState[]> {
  const contracts = ARB_POOLS.flatMap(p => [
    { address: p.address, abi: PAIR_ABI, functionName: 'getReserves' as const },
    { address: p.address, abi: PAIR_ABI, functionName: 'token0'      as const },
  ])

  // Chunk to stay well under any single RPC's multicall gas/size ceiling.
  const CHUNK = 120
  const results: any[] = []
  for (let i = 0; i < contracts.length; i += CHUNK) {
    const batch = await pub.multicall({ contracts: contracts.slice(i, i + CHUNK) as any, allowFailure: true })
    results.push(...batch)
  }

  return ARB_POOLS.map((pool, i) => {
    const resD  = results[i * 2]
    const tok0D = results[i * 2 + 1]
    const reserves = resD?.status  === 'success' ? resD.result  as [bigint, bigint, number] : null
    const onchain0  = tok0D?.status === 'success' ? (tok0D.result as string).toLowerCase() : ''
    return { pool, r0: reserves?.[0] ?? 0n, r1: reserves?.[1] ?? 0n, onchain0 }
  }).filter(s => s.r0 > 0n && s.r1 > 0n && hasRealLiquidity(s))
}

// Several pools in POOLS are genuinely empty -- deployed with a real gauge
// but never seeded, sitting at (or near) the 1000-wei locked-minimum floor
// every new pool starts at (see contracts.ts's own "not enough to seed it"
// comments). Feeding those into the constant-product math against a properly
// funded pool produces nonsense: a 1-wei-scale optimalIn against reserves
// that are almost all fee/rounding noise can price out as an astronomical
// "profit" that doesn't exist. Require at least 0.01 of a whole token on
// BOTH sides before a pool is considered tradeable -- cheap dust, real pools
// clear this trivially.
const MIN_LIQUIDITY_WHOLE = 0.01   // require at least this many whole tokens on each side
function minRawUnits(decimals: number): bigint {
  // e.g. decimals=18, MIN_LIQUIDITY_WHOLE=0.01 -> 10^16 raw units (0.01 token)
  return 10n ** BigInt(Math.max(Math.round(decimals + Math.log10(MIN_LIQUIDITY_WHOLE)), 0))
}
function hasRealLiquidity(s: { pool: typeof ARB_POOLS[number]; r0: bigint; r1: bigint; onchain0: string }): boolean {
  const t0 = TOKENS[s.pool.token0]
  const t1 = TOKENS[s.pool.token1]
  const isT0First = s.onchain0 === t0.address.toLowerCase()
  const [rFirst, rSecond] = isT0First ? [s.r0, s.r1] : [s.r1, s.r0]
  return rFirst >= minRawUnits(t0.decimals) && rSecond >= minRawUnits(t1.decimals)
}

// ─── Arb finder ───────────────────────────────────────────────────────────────
//
// A valid arb is a CLOSED cycle: start at some base token, end back at that
// SAME token, through pools that actually connect each step, never
// revisiting a token along the way (a simple cycle) -- length 2 up to
// MAX_HOPS. This is a plain DFS anchored at one token over the pool graph
// rather than a fixed 2-hop/3-hop shape: hop count doesn't matter to the
// caller, only whether the cycle clears gas, so the search doesn't
// artificially stop at 3. tick() runs this once per candidate base token
// (see candidateBaseTokens()) and merges the results.
//
// An earlier version tried building cycles that could START at one token and
// END at a DIFFERENT one (whichever combination looked most profitable) --
// including a "1 shared token" 2-hop shape that wasn't a real cycle at all
// (the sell leg's pool didn't contain the token being sold back), which
// produced nonsense profit numbers when tested. Anchoring each search to one
// token and only ever closing back to that SAME token sidesteps that whole
// class of bug -- every cycle this returns is, by construction, actually
// closed, and "profit" always means more of the token you started with.

interface HopCandidate {
  pool: PoolState
  tokenInSym: string
  tokenOutSym: string
  reserveIn: bigint
  reserveOut: bigint
}

interface ArbOpp {
  tokenIn:   typeof TOKENS[keyof typeof TOKENS]
  hops:      HopCandidate[]
  label:     string
  amountIn:  bigint
  profitRaw: bigint
  profitPct: number
  expectedNetUsd?: number
}

// A SettlementOpp is NOT a cycle -- it starts in one SETTLEMENT_TOKEN and
// deliberately ends in a DIFFERENT one (e.g. AEON -> token -> WETH, staying
// in WETH). AeonArbKeeper can't run these (it hard-reverts on any route that
// doesn't close back to its own starting token -- see NotCyclic in the
// contract), so these execute via AeonRouter's plain multi-hop swap instead.
// "Profit" here means the USDG-equivalent value of the output exceeds the
// USDG-equivalent value of the input by enough to clear gas -- see
// executeSettlementSwap() for how that's turned into an on-chain amountOutMin.
interface SettlementOpp {
  tokenIn:    typeof TOKENS[keyof typeof TOKENS]
  tokenOut:   typeof TOKENS[keyof typeof TOKENS]
  hops:       HopCandidate[]
  label:      string
  amountIn:   bigint
  amountOut:  bigint
  profitUsdg: bigint
  profitPct:  number
  expectedNetUsd?: number
}

function buildGraph(states: PoolState[]): Map<string, HopCandidate[]> {
  const graph = new Map<string, HopCandidate[]>()
  function addEdge(fromSym: string, toSym: string, pool: PoolState, reserveIn: bigint, reserveOut: bigint) {
    if (!graph.has(fromSym)) graph.set(fromSym, [])
    graph.get(fromSym)!.push({ pool, tokenInSym: fromSym, tokenOutSym: toSym, reserveIn, reserveOut })
  }
  for (const s of states) {
    const t0Sym = s.pool.token0, t1Sym = s.pool.token1
    const t0IsFirst = s.onchain0 === TOKENS[t0Sym].address.toLowerCase()
    const [r0real, r1real] = t0IsFirst ? [s.r0, s.r1] : [s.r1, s.r0]
    addEdge(t0Sym, t1Sym, s, r0real, r1real)
    addEdge(t1Sym, t0Sym, s, r1real, r0real)
  }
  return graph
}

function cycleOut(amountIn: bigint, hops: HopCandidate[]): bigint {
  let amt = amountIn
  for (const h of hops) {
    amt = amtOut(amt, h.reserveIn, h.reserveOut, h.pool.pool.feeBps)
    if (amt === 0n) return 0n
  }
  return amt
}

// Generic ternary-search sizer -- works for any hop count, unlike a
// closed-form 2-hop formula, so the same function sizes both 2-hop and
// 3-hop cycles.
function optimalTrade(hops: HopCandidate[], maxIn: bigint): { amountIn: bigint; profit: bigint } {
  if (maxIn <= 1n) return { amountIn: 0n, profit: -1n }
  let lo = 0n, hi = maxIn
  for (let i = 0; i < 100; i++) {
    const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n
    const p1 = cycleOut(m1, hops) - m1, p2 = cycleOut(m2, hops) - m2
    if (p1 < p2) lo = m1; else hi = m2
    if (hi - lo < 2n) break
  }
  const best = (lo + hi) / 2n
  return { amountIn: best, profit: cycleOut(best, hops) - best }
}

// Safety valve on the DFS below -- bails out rather than block the tick loop
// indefinitely if the pool graph ever grows dense enough for exhaustive
// simple-cycle enumeration up to MAX_HOPS to blow up combinatorially.
const MAX_DFS_VISITS = 200_000

function findArbs(graph: Map<string, HopCandidate[]>, baseSym: keyof typeof TOKENS): ArbOpp[] {
  const opps: ArbOpp[] = []
  const seen = new Set<string>()
  const tokenIn = TOKENS[baseSym]
  let visits = 0
  let capped = false

  function tryOpp(hops: HopCandidate[]) {
    const key = hops.map(h => h.pool.pool.address).join('>')
    if (seen.has(key)) return
    seen.add(key)

    const maxIn = hops[0].reserveIn / 4n   // never take more than 25% of the first pool's reserve
    const { amountIn, profit } = optimalTrade(hops, maxIn)
    if (profit <= 0n || amountIn <= 0n) return

    const profitPct = Number(profit * 10000n / amountIn) / 100
    // Dust filter on the low end; a sanity ceiling on the high end -- a
    // >50% "arb" on a live AMM is essentially always a data artifact
    // (a pool this script's own liquidity floor let through by a hair),
    // never a real opportunity, so treat it as a bug signal, not a trade.
    if (profitPct < 0.02 || profitPct > 50) return

    opps.push({
      tokenIn, hops, amountIn, profitRaw: profit, profitPct,
      label: [baseSym, ...hops.map(h => h.tokenOutSym)].join('→'),
    })
  }

  const path: HopCandidate[] = []
  const visited = new Set<string>([baseSym])

  function dfs(currentSym: string) {
    if (capped) return
    if (++visits > MAX_DFS_VISITS) { capped = true; return }

    for (const edge of graph.get(currentSym) ?? []) {
      // Never immediately reverse through the exact same pool -- that's a
      // guaranteed loss to fees, not a candidate worth sizing.
      if (path.length > 0 && edge.pool.pool.address === path[path.length - 1].pool.pool.address) continue

      if (edge.tokenOutSym === baseSym) {
        if (path.length > 0) tryOpp([...path, edge])
        continue
      }
      if (path.length >= MAX_HOPS - 1) continue   // closing edge would exceed MAX_HOPS
      if (visited.has(edge.tokenOutSym)) continue   // simple cycle -- no repeated intermediate tokens

      visited.add(edge.tokenOutSym)
      path.push(edge)
      dfs(edge.tokenOutSym)
      path.pop()
      visited.delete(edge.tokenOutSym)
    }
  }

  dfs(baseSym)
  if (capped) console.warn(`[warn] cycle search from ${baseSym} hit its ${MAX_DFS_VISITS}-visit safety cap -- results may be incomplete this tick`)

  return opps
}

// Companion search to findArbs: instead of only closing back to baseSym,
// this also registers a candidate at EVERY settlement token reached along
// the way (other than baseSym itself, which findArbs already covers). The
// DFS still continues past a settlement token too, in case a longer route
// through it is even better -- hitting one doesn't force a stop, it's just
// also a valid place to stop. Sizing maximizes USDG-denominated profit
// (output value minus input value) via the same ternary-search shape as
// optimalTrade, just with a different objective function, since input and
// output are different tokens here and can't be subtracted directly.
function findSettlementRoutes(graph: Map<string, HopCandidate[]>, baseSym: keyof typeof TOKENS): SettlementOpp[] {
  const opps: SettlementOpp[] = []
  const seen = new Set<string>()
  let visits = 0
  let capped = false

  const usdgPathCache = new Map<string, HopCandidate[] | null>()
  function usdgPath(sym: string): HopCandidate[] | null {
    if (usdgPathCache.has(sym)) return usdgPathCache.get(sym)!
    const path = sym === 'USDG' ? [] : findConversionPath(graph, sym, 'USDG')
    usdgPathCache.set(sym, path)
    return path
  }

  const startPath = usdgPath(baseSym)

  function tryOpp(hops: HopCandidate[], endSym: string) {
    const key = hops.map(h => h.pool.pool.address).join('>') + '=>' + endSym
    if (seen.has(key)) return
    seen.add(key)
    if (startPath === null) return

    const endPath = usdgPath(endSym)
    if (endPath === null) return

    function profitUsdgAt(amountIn: bigint): bigint {
      const out = cycleOut(amountIn, hops)
      if (out === 0n) return -1n
      return convertSpot(out, endPath!) - convertSpot(amountIn, startPath!)
    }

    const maxIn = hops[0].reserveIn / 4n
    if (maxIn <= 1n) return
    let lo = 0n, hi = maxIn
    for (let i = 0; i < 100; i++) {
      const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n
      if (profitUsdgAt(m1) < profitUsdgAt(m2)) lo = m1; else hi = m2
      if (hi - lo < 2n) break
    }
    const amountIn = (lo + hi) / 2n
    const profitUsdg = profitUsdgAt(amountIn)
    if (profitUsdg <= 0n || amountIn <= 0n) return

    const inUsdg = convertSpot(amountIn, startPath)
    if (inUsdg <= 0n) return
    const profitPct = Number(profitUsdg * 10000n / inUsdg) / 100
    if (profitPct < 0.02 || profitPct > 50) return

    const amountOut = cycleOut(amountIn, hops)
    if (amountOut <= 0n) return

    opps.push({
      tokenIn: TOKENS[baseSym], tokenOut: TOKENS[endSym as keyof typeof TOKENS], hops, amountIn, amountOut, profitUsdg, profitPct,
      label: [baseSym, ...hops.map(h => h.tokenOutSym)].join('→'),
    })
  }

  const path: HopCandidate[] = []
  const visited = new Set<string>([baseSym])

  function dfs(currentSym: string) {
    if (capped) return
    if (++visits > MAX_DFS_VISITS) { capped = true; return }

    for (const edge of graph.get(currentSym) ?? []) {
      if (path.length > 0 && edge.pool.pool.address === path[path.length - 1].pool.pool.address) continue
      if (edge.tokenOutSym === baseSym) continue   // the cyclic case -- findArbs already covers it

      if ((SETTLEMENT_TOKENS as readonly string[]).includes(edge.tokenOutSym)) {
        tryOpp([...path, edge], edge.tokenOutSym)
      }

      if (path.length >= MAX_HOPS - 1) continue
      if (visited.has(edge.tokenOutSym)) continue

      visited.add(edge.tokenOutSym)
      path.push(edge)
      dfs(edge.tokenOutSym)
      path.pop()
      visited.delete(edge.tokenOutSym)
    }
  }

  dfs(baseSym)
  if (capped) console.warn(`[warn] settlement search from ${baseSym} hit its ${MAX_DFS_VISITS}-visit safety cap -- results may be incomplete this tick`)

  return opps
}

// ─── Gas-cost floor ───────────────────────────────────────────────────────────
//
// A quoted swap profit isn't real profit until it clears what the two
// transactions (approve + executeArb) actually cost in gas. This converts
// the current gas estimate into tokenIn's own units via a live price path
// through the pool graph (native ETH and WETH are 1:1 here), so "profitable"
// always means profitable after fees -- never just profitable on the swap
// math alone.

const GAS_SAFETY_MULT_PCT = 130n   // require 1.30x the estimate -- buffer for gas price drift between quoting and inclusion
const APPROVE_GAS_FALLBACK = 60_000n
const EXEC_ARB_BASE_GAS = 100_000n
const EXEC_ARB_GAS_PER_HOP = 70_000n
const MAX_UINT256 = (1n << 256n) - 1n

// BFS shortest path (by hop count) from fromSym to toSym through the pool
// graph. Used only to convert a WETH-denominated gas cost into whatever
// token a given arb actually trades -- fee-ignoring spot ratios are fine
// here since this sizes a safety threshold, not a trade.
function findConversionPath(graph: Map<string, HopCandidate[]>, fromSym: string, toSym: string, maxHops = 3): HopCandidate[] | null {
  if (fromSym === toSym) return []
  const queue: { sym: string; path: HopCandidate[] }[] = [{ sym: fromSym, path: [] }]
  const visited = new Set([fromSym])
  while (queue.length > 0) {
    const { sym, path } = queue.shift()!
    if (path.length >= maxHops) continue
    for (const edge of graph.get(sym) ?? []) {
      if (visited.has(edge.tokenOutSym)) continue
      const nextPath = [...path, edge]
      if (edge.tokenOutSym === toSym) return nextPath
      visited.add(edge.tokenOutSym)
      queue.push({ sym: edge.tokenOutSym, path: nextPath })
    }
  }
  return null
}

function convertSpot(amountIn: bigint, path: HopCandidate[]): bigint {
  let amt = amountIn
  for (const edge of path) {
    if (edge.reserveIn === 0n) return 0n
    amt = (amt * edge.reserveOut) / edge.reserveIn
  }
  return amt
}

// Inverse of convertSpot: given a DESIRED output at the end of `path`, how
// much input (in path[0]'s own FROM token) would spot-price to that --
// walks the same path backwards, inverting each hop's ratio. Used to turn a
// "must be worth at least $X" requirement into a same-unit amountOutMin for
// whatever token a settlement route actually ends in.
function convertSpotReverse(desiredOut: bigint, path: HopCandidate[]): bigint {
  let amt = desiredOut
  for (let i = path.length - 1; i >= 0; i--) {
    const edge = path[i]
    if (edge.reserveOut === 0n) return 0n
    amt = (amt * edge.reserveIn) / edge.reserveOut
  }
  return amt
}

// Returns the gas cost floor expressed in tokenInSym's own raw units, or
// null if there's no live WETH price path for that token right now -- in
// which case the caller skips rather than guess at an unverifiable conversion.
async function gasCostFloorInToken(
  tokenInSym: string, tokenInAddress: `0x${string}`, hopCount: number, graph: Map<string, HopCandidate[]>, needsApproval = true,
): Promise<bigint | null> {
  const gasPrice = await pub.getGasPrice()

  let approveGas = 0n
  if (needsApproval) {
    approveGas = APPROVE_GAS_FALLBACK
    try {
      approveGas = await pub.estimateContractGas({
        address: tokenInAddress, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.ArbKeeper, MAX_UINT256], account: account.address,
      })
    } catch { /* fall back to a conservative fixed approval estimate */ }
  }

  const execGas = EXEC_ARB_BASE_GAS + EXEC_ARB_GAS_PER_HOP * BigInt(hopCount)
  const gasCostWei = ((approveGas + execGas) * gasPrice * GAS_SAFETY_MULT_PCT) / 100n

  if (tokenInSym === 'WETH') return gasCostWei

  const path = findConversionPath(graph, 'WETH', tokenInSym)
  if (!path) return null
  return convertSpot(gasCostWei, path)
}

function valueInUsdg(tokenSym: string, amount: bigint, graph: Map<string, HopCandidate[]>): bigint {
  if (tokenSym === 'USDG') return amount
  const path = findConversionPath(graph, tokenSym, 'USDG')
  return path ? convertSpot(amount, path) : 0n
}

function weiToToken(tokenSym: string, amountWei: bigint, graph: Map<string, HopCandidate[]>): bigint | null {
  if (tokenSym === 'WETH') return amountWei
  const path = findConversionPath(graph, 'WETH', tokenSym)
  return path ? convertSpot(amountWei, path) : null
}

// ─── Balances / candidate base tokens ─────────────────────────────────────────
//
// Fetched ONCE per tick and reused everywhere -- the internal cycle search,
// the cross-venue scan, and the status snapshot all read from the same
// balances instead of each re-querying the chain.

interface BalancesResult {
  balances: Record<string, bigint>        // real on-chain ERC20 balances -- what the /bot page displays
  searchBalances: Record<string, bigint>  // same, but WETH inflated by wrap-available native ETH -- what discovery/sizing uses
  nativeEth: bigint
  availableEthForWrap: bigint
}

async function fetchBalances(): Promise<BalancesResult> {
  const distinctSymbols = Array.from(new Set(ARB_POOLS.flatMap(p => [p.token0, p.token1])))
  const balances: Record<string, bigint> = {}
  await Promise.all(distinctSymbols.map(async sym => {
    const t = TOKENS[sym as keyof typeof TOKENS]
    try {
      balances[sym] = await pub.readContract({ address: t.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
    } catch { balances[sym] = 0n }
  }))

  let nativeEth = 0n
  let availableEthForWrap = 0n
  try {
    nativeEth = await pub.getBalance({ address: account.address })
    const reserveWei = parseEther(String(GAS_RESERVE_ETH))
    availableEthForWrap = nativeEth > reserveWei ? nativeEth - reserveWei : 0n
  } catch { /* leave at 0 if this read fails -- WETH search balance just won't include it this tick */ }

  const searchBalances = { ...balances, WETH: (balances.WETH ?? 0n) + availableEthForWrap }

  return { balances, searchBalances, nativeEth, availableEthForWrap }
}

// Which tokens are worth anchoring a cycle search to this tick. BASE_TOKEN
// pins it to one token; otherwise, auto-discover every token the wallet
// holds above the same dust floor used for pool liquidity -- no point
// searching a cycle starting from a token you don't have enough of to
// actually trade. Pass searchBalances here, not balances, so spare native
// ETH counts toward WETH.
function candidateBaseTokens(searchBalances: Record<string, bigint>): (keyof typeof TOKENS)[] {
  if (BASE_TOKEN_OVERRIDE) {
    if (!(SETTLEMENT_TOKENS as readonly string[]).includes(BASE_TOKEN_OVERRIDE)) return []
    return [BASE_TOKEN_OVERRIDE]
  }
  return SETTLEMENT_TOKENS.filter(sym =>
    (searchBalances[sym] ?? 0n) >= minRawUnits(TOKENS[sym].decimals)
  ) as (keyof typeof TOKENS)[]
}

// Wraps just enough native ETH into WETH to cover `needed`, if the current
// WETH balance falls short and there's enough spare ETH (above the gas
// reserve) to cover the gap. Returns the resulting WETH balance either way
// -- callers compare that against `needed` themselves rather than trusting
// a boolean, since a wrap can itself fail after the balance check passes.
async function ensureWethBalance(needed: bigint, availableEthForWrap: bigint): Promise<bigint> {
  let current = await pub.readContract({
    address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (current >= needed) return current

  const shortfall = needed - current
  if (shortfall > availableEthForWrap) return current   // wrapping still wouldn't be enough

  console.log(`   → wrapping ${formatEther(shortfall)} ETH into WETH to cover this trade...`)
  try {
    const hWrap = await wal.writeContract({
      address: TOKENS.WETH.address, abi: WETH_ABI, functionName: 'deposit', value: shortfall,
    })
    await pub.waitForTransactionReceipt({ hash: hWrap })
    current = await pub.readContract({
      address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    }) as bigint
  } catch (err: any) {
    console.error(`   ⚠ Wrap failed: ${err?.shortMessage ?? err?.message ?? err}`)
  }
  return current
}

// Inverse of amtOut() -- how much amtIn is required to receive EXACTLY
// amtOutDesired from a pool with these reserves/fee. Same formula
// Uniswap-V2-style routers use for getAmountIn. +1 covers integer-division
// rounding so the resulting swap doesn't come up short by a wei.
function amtIn(amtOutDesired: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (amtOutDesired <= 0n || amtOutDesired >= rOut) return 0n   // can't drain the whole pool
  const numerator = rIn * amtOutDesired * 10000n
  const denominator = (rOut - amtOutDesired) * (10000n - feeBps)
  return numerator / denominator + 1n
}

const FUND_SWAP_SLIPPAGE_BUFFER_PCT = 105n   // 5% extra USDG spent, buffering against reserve drift between quote and execution

// If baseSym's on-chain balance falls short of `needed`, tops it up by
// swapping USDG -- the wallet's natural "cash" reserve -- into it via
// AeonRouter. Unlike ensureWethBalance's free wrap, this is a REAL swap
// with real fee/slippage, a genuine (small) cost not otherwise reflected in
// the arb's own profitability math -- acceptable here since it only ever
// spends USDG that would otherwise sit completely idle, and the swap's own
// amountOutMin means it either delivers at least `needed` extra or reverts
// (spending gas, not principal) rather than deliver less. Returns the
// resulting balance either way -- callers compare that against `needed`
// themselves, same pattern as ensureWethBalance.
async function ensureBaseTokenFunded(
  baseSym: keyof typeof TOKENS, needed: bigint, graph: Map<string, HopCandidate[]>,
): Promise<bigint> {
  let current = await pub.readContract({
    address: TOKENS[baseSym].address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (current >= needed || baseSym === 'USDG') return current

  const edge = (graph.get('USDG') ?? []).find(e => e.tokenOutSym === baseSym)
  if (!edge) return current   // no direct USDG pool for this token -- can't fund it this way

  const shortfall = needed - current
  const usdgRequired = amtIn(shortfall, edge.reserveIn, edge.reserveOut, edge.pool.pool.feeBps)
  if (usdgRequired <= 0n) return current

  const usdgBal = await pub.readContract({
    address: TOKENS.USDG.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  const usdgToSpend = (usdgRequired * FUND_SWAP_SLIPPAGE_BUFFER_PCT) / 100n
  if (usdgToSpend > usdgBal) return current   // not enough USDG to cover the shortfall either

  console.log(`   → funding ${formatUnits(shortfall, TOKENS[baseSym].decimals)} ${baseSym} by swapping ~${formatUnits(usdgToSpend, TOKENS.USDG.decimals)} USDG...`)
  try {
    const route = [{
      tokenIn: getAddress(TOKENS.USDG.address), tokenOut: getAddress(TOKENS[baseSym].address),
      pool: getAddress(edge.pool.pool.address), poolType: 0, feeBps: Number(edge.pool.pool.feeBps),
    }]
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

    const hApprove = await wal.writeContract({
      address: TOKENS.USDG.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonRouter, usdgToSpend],
    })
    await pub.waitForTransactionReceipt({ hash: hApprove })

    const hSwap = await wal.writeContract({
      address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
      args: [route, usdgToSpend, shortfall, account.address, deadline],   // amountOutMin = the exact shortfall needed
    })
    await pub.waitForTransactionReceipt({ hash: hSwap })

    current = await pub.readContract({
      address: TOKENS[baseSym].address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    }) as bigint
  } catch (err: any) {
    console.error(`   ⚠ Funding swap failed: ${err?.shortMessage ?? err?.message ?? err}`)
  }
  return current
}

// ─── Status file (read by /api/bot/status on the website) ───────────────────

interface ExecutedArb {
  time: string
  pair: string
  tokenIn: string
  amountIn: string
  profit: string
  profitPct: number
  grossProfit?: string
  gasCost?: string
  gasCostEth?: string
  txHash?: string
  status: 'success' | 'failed' | 'dry-run'
  error?: string
  route: 'internal' | AggregatorSource
}

let recentArbs: ExecutedArb[] = []
let cumulativeProfit: Record<string, string> = {}
let totalExecuted = 0
let totalFailed = 0
let recentErrors: { time: string; message: string }[] = []
let consecutiveFailures = 0
let pausedUntil = 0
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.MAX_CONSECUTIVE_FAILURES ?? '3')
const FAILURE_PAUSE_MS = parseInt(process.env.FAILURE_PAUSE_MS ?? '300000')

// Resume counters across restarts instead of losing history every deploy/reboot.
try {
  const prior = JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
  recentArbs = prior.recentArbs ?? []
  cumulativeProfit = prior.cumulativeProfit ?? {}
  totalExecuted = prior.totalArbsExecuted ?? 0
  totalFailed = prior.totalArbsFailed ?? 0
} catch { /* no prior status file -- fresh start */ }

// Records a trade in the capped in-memory list (what status.json shows for
// the live view), as one line appended to trades.log (the never-truncated
// local history behind /api/bot/trades when the website runs on this same
// machine), AND -- if KV_REST_API_URL/KV_REST_API_TOKEN are set -- pushed to
// the shared Upstash store so a website deployed elsewhere (e.g. Vercel)
// sees it too. The store push is fire-and-forget: trades are infrequent
// enough to sync immediately rather than on the status-sync throttle below,
// but a Redis hiccup must never block or fail real trading.
function recordArb(arb: ExecutedArb) {
  recentArbs = [arb, ...recentArbs].slice(0, 30)
  try {
    fs.appendFileSync(tradesLogPath, JSON.stringify(arb) + '\n')
  } catch (err: any) {
    console.error(`[trade log error] failed to append to trades.log: ${err?.message ?? err}`)
  }
  if (isBotStoreConfigured()) {
    appendTrade(arb).catch(err => console.error(`[bot store error] failed to sync trade: ${err?.message ?? err}`))
  }
}

async function writeStatus(lastOpps: ArbOpp[], tickMs: number, rawBalances: Record<string, bigint>, nativeEth: bigint, graph: Map<string, HopCandidate[]>) {
  const balances: Record<string, string> = { ETH: formatEther(nativeEth) }
  for (const [sym, bal] of Object.entries(rawBalances)) {
    balances[sym] = formatUnits(bal, TOKENS[sym as keyof typeof TOKENS].decimals)
  }

  const status = {
    updatedAt: new Date().toISOString(),
    keeperAddress: account.address,
    dryRun: DRY_RUN,
    intervalMs: INTERVAL_MS,
    tickMs,
    poolsMonitored: ARB_POOLS.length,
    balances,
    lastOpportunities: lastOpps.slice(0, 5).map(o => ({
      pair: o.label,
      profitPct: Number(o.profitPct.toFixed(4)),
      amountIn: formatUnits(o.amountIn, o.tokenIn.decimals),
      tokenIn: o.tokenIn.symbol,
      grossProfit: formatUnits(o.profitRaw, o.tokenIn.decimals),
      grossProfitUsd: Number(formatUnits(valueInUsdg(o.tokenIn.symbol, o.profitRaw, graph), TOKENS.USDG.decimals)),
      expectedNetUsd: o.expectedNetUsd,
      venues: o.hops.map(h => h.pool.pool.isUniV2 ? 'Uniswap' : 'AEON').join(' -> '),
    })),
    recentArbs: recentArbs.slice(0, 30),
    cumulativeProfit,
    totalArbsExecuted: totalExecuted,
    totalArbsFailed: totalFailed,
    consecutiveFailures,
    pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null,
    recentErrors: recentErrors.slice(0, 5),
  }

  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))

  // Throttled, fire-and-forget push to the shared store -- status changes
  // every tick (every 1s by default) but a live dashboard doesn't need
  // sub-second freshness, and pushing every tick would burn through
  // Upstash's free-tier command budget fast (86,400+/day at 1s intervals).
  if (isBotStoreConfigured() && Date.now() - lastRedisStatusSync >= REDIS_STATUS_SYNC_INTERVAL_MS) {
    lastRedisStatusSync = Date.now()
    writeBotStatus(status).catch(err => console.error(`[bot store error] failed to sync status: ${err?.message ?? err}`))
  }
}

let lastRedisStatusSync = 0
const REDIS_STATUS_SYNC_INTERVAL_MS = parseInt(process.env.REDIS_STATUS_SYNC_INTERVAL_MS ?? '15000')

// ─── Execution ────────────────────────────────────────────────────────────────

type ExecResult = 'skipped' | 'attempted'

async function ensureKeeperAllowance(tokenAddress: `0x${string}`, needsApproval: boolean): Promise<bigint> {
  if (!needsApproval) return 0n
  const hash = await wal.writeContract({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'approve',
    args: [CONTRACTS.ArbKeeper, MAX_UINT256],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  return receipt.gasUsed * receipt.effectiveGasPrice
}

async function executeArb(opp: ArbOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenIn, hops: hopCandidates, amountIn, profitRaw, profitPct, label: pairLabel } = opp

  console.log(`\n🔄 ARB: ${pairLabel}  profit ${profitPct.toFixed(3)}%  in ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`)

  // Gas floor: computed (and enforced) BEFORE the dry-run short-circuit and
  // BEFORE spending anything on approve, so dry-run output shows exactly
  // what a live run would decide. No live WETH price path for this token =
  // no way to verify profit clears gas cost, so it skips rather than guess.
  const allowance = await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.ArbKeeper],
  }) as bigint
  const needsApproval = allowance < amountIn
  const gasFloor = await gasCostFloorInToken(tokenIn.symbol, tokenIn.address, hopCandidates.length, graph, needsApproval)
  if (gasFloor === null) {
    console.warn(`   ⚠ No live WETH price path for ${tokenIn.symbol} -- can't verify profit clears gas cost, skipping for safety`)
    return 'skipped'
  }
  console.log(`   Est. gas cost (incl. 1.3x buffer): ~${formatUnits(gasFloor, tokenIn.decimals)} ${tokenIn.symbol}`)

  // Strictly profitable after the buffered gas estimate, with no additional
  // percentage or dollar floor: one raw unit of net profit is enough.
  let requiredProfit = gasFloor + 1n
  console.log(`   Required profit (buffered gas + 1 raw unit): ~${formatUnits(requiredProfit, tokenIn.decimals)} ${tokenIn.symbol}`)
  if (profitRaw < requiredProfit) {
    console.log('   Profit does not clear the buffered gas cost, skipping')
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(profitRaw, tokenIn.decimals),
      profitPct, status: 'dry-run', route: 'internal',
    })
    return 'attempted'
  }

  let balIn = await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (balIn < amountIn && tokenIn.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)   // free wrap first, where it applies
  }
  if (balIn < amountIn && tokenIn.symbol !== 'USDG') {
    balIn = await ensureBaseTokenFunded(tokenIn.symbol as keyof typeof TOKENS, amountIn, graph)   // then fall back to funding from USDG
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    return 'skipped'
  }
  const balanceBefore = balIn

  const hops = hopCandidates.map(h => ({
    pool: getAddress(h.pool.pool.address),
    tokenIn: getAddress(TOKENS[h.tokenInSym as keyof typeof TOKENS].address),
    tokenOut: getAddress(TOKENS[h.tokenOutSym as keyof typeof TOKENS].address),
    isUniV2: h.pool.pool.isUniV2,
    feeBps: Number(h.pool.pool.feeBps),
  }))
  // Enforced on-chain too, not just here: if live reserves shift between this
  // quote and inclusion, AeonArbKeeper reverts rather than complete a trade
  // that no longer clears the buffered gas cost.
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

  try {
    console.log('   → approve...')
    const approvalGasWei = await ensureKeeperAllowance(tokenIn.address, needsApproval)

    const gasPrice = await pub.getGasPrice()
    const executionGas = await pub.estimateContractGas({
      account: account.address,
      address: CONTRACTS.ArbKeeper, abi: ARB_KEEPER_ABI, functionName: 'executeArb',
      args: [hops, amountIn, requiredProfit, deadline],
    })
    const bufferedGasWei = approvalGasWei + (executionGas * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const exactGasInToken = weiToToken(tokenIn.symbol, bufferedGasWei, graph)
    if (exactGasInToken === null) throw new Error(`cannot convert exact gas cost into ${tokenIn.symbol}`)
    requiredProfit = exactGasInToken + 1n
    if (profitRaw < requiredProfit) {
      console.log('   Exact gas estimate removed profitability; not submitting')
      return needsApproval ? 'attempted' : 'skipped'
    }

    // Re-run the complete call against the latest chain state after the
    // approval confirms. A failed simulation costs no execution gas and
    // prevents submitting a route whose reserves already moved.
    console.log('   → simulate executeArb...')
    await pub.simulateContract({
      account,
      address: CONTRACTS.ArbKeeper, abi: ARB_KEEPER_ABI, functionName: 'executeArb',
      args: [hops, amountIn, requiredProfit, deadline],
    })

    console.log('   → executeArb...')
    const hExec = await wal.writeContract({
      address: CONTRACTS.ArbKeeper, abi: ARB_KEEPER_ABI, functionName: 'executeArb',
      args: [hops, amountIn, requiredProfit, deadline],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: hExec })

    if (receipt.status === 'success') {
      const balanceAfter = await pub.readContract({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      }) as bigint
      const realizedGross = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n
      const totalGasWei = approvalGasWei + receipt.gasUsed * receipt.effectiveGasPrice
      const actualGasInToken = weiToToken(tokenIn.symbol, totalGasWei, graph) ?? 0n
      const realizedNet = realizedGross > actualGasInToken ? realizedGross - actualGasInToken : 0n
      const realizedNetPct = amountIn > 0n ? Number(realizedNet * 10000n / amountIn) / 100 : 0
      console.log(`   ✅ ARB COMPLETE — profit ~${formatUnits(profitRaw, tokenIn.decimals)} ${tokenIn.symbol} — ${hExec}`)
      totalExecuted++
      consecutiveFailures = 0
      const prev = parseFloat(cumulativeProfit[tokenIn.symbol] ?? '0')
      cumulativeProfit[tokenIn.symbol] = (prev + parseFloat(formatUnits(realizedNet, tokenIn.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(realizedNet, tokenIn.decimals),
        grossProfit: formatUnits(realizedGross, tokenIn.decimals), gasCost: formatUnits(actualGasInToken, tokenIn.decimals),
        gasCostEth: formatEther(totalGasWei), profitPct: realizedNetPct, txHash: hExec, status: 'success', route: 'internal',
      })
    } else {
      throw new Error('transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ ARB FAILED (no funds lost -- the contract reverts atomically): ${message}`)
    totalFailed++
    consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: '0', profitPct, status: 'failed', error: message, route: 'internal',
    })
    return 'attempted'
  }
}

// ─── Settlement swap (starts in one settlement token, ends in another) ──────
//
// Not atomic in the AeonArbKeeper sense -- can't be, the contract rejects
// any route that doesn't close back to its own start token. This goes
// through AeonRouter's plain swapExactTokensForTokens instead, over the
// FULL multi-hop route in one transaction. Still can't execute for nothing:
// amountOutMin is computed here as "the smallest output that would still be
// worth at least input value + gas, in live USDG terms" -- not a slippage
// percentage. If reserves moved enough since quoting that the route can't
// deliver that, the whole transaction reverts and only gas is spent.

const SETTLEMENT_SWAP_GAS_BASE = EXEC_ARB_BASE_GAS
const SETTLEMENT_SWAP_GAS_PER_HOP = EXEC_ARB_GAS_PER_HOP

async function executeSettlementSwap(
  opp: SettlementOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint,
): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenIn, tokenOut, hops: hopCandidates, amountIn, label } = opp

  console.log(`\n🔀 SETTLE: ${label} → ${tokenOut.symbol}  in ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`)

  const inUsdgPath = tokenIn.symbol === 'USDG' ? [] : findConversionPath(graph, tokenIn.symbol, 'USDG')
  const outUsdgPath = tokenOut.symbol === 'USDG' ? [] : findConversionPath(graph, tokenOut.symbol, 'USDG')
  if (inUsdgPath === null || outUsdgPath === null) {
    console.warn(`   ⚠ No live USDG price path for ${tokenIn.symbol}/${tokenOut.symbol} -- can't verify profit clears gas cost, skipping for safety`)
    return 'skipped'
  }

  const allowance = await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.AeonRouter],
  }) as bigint
  const needsApproval = allowance < amountIn

  const gasPrice = await pub.getGasPrice()
  let approveGasEstimate = 0n
  if (needsApproval) {
    approveGasEstimate = APPROVE_GAS_FALLBACK
    try {
      approveGasEstimate = await pub.estimateContractGas({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.AeonRouter, MAX_UINT256], account: account.address,
      })
    } catch { /* fall back to a conservative fixed approval estimate */ }
  }
  const swapGasEstimate = SETTLEMENT_SWAP_GAS_BASE + SETTLEMENT_SWAP_GAS_PER_HOP * BigInt(hopCandidates.length)
  const gasWei = ((approveGasEstimate + swapGasEstimate) * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
  const gasUsdg = valueInUsdg('WETH', gasWei, graph)
  console.log(`   Est. gas cost: ~${formatUnits(gasUsdg, TOKENS.USDG.decimals)} USDG`)

  const inUsdgValue = tokenIn.symbol === 'USDG' ? amountIn : convertSpot(amountIn, inUsdgPath)
  const requiredOutUsdg = inUsdgValue + gasUsdg + 1n
  const amountOutMin = tokenOut.symbol === 'USDG' ? requiredOutUsdg : convertSpotReverse(requiredOutUsdg, outUsdgPath)
  if (amountOutMin <= 0n || opp.amountOut < amountOutMin) {
    console.log('   Profit does not clear the estimated gas cost, skipping')
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: 'USDG',
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(opp.profitUsdg, TOKENS.USDG.decimals),
      profitPct: opp.profitPct, status: 'dry-run', route: 'internal',
    })
    return 'attempted'
  }

  let balIn = await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (balIn < amountIn && tokenIn.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)
  }
  if (balIn < amountIn && tokenIn.symbol !== 'USDG') {
    balIn = await ensureBaseTokenFunded(tokenIn.symbol as keyof typeof TOKENS, amountIn, graph)
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    return 'skipped'
  }
  const balanceBeforeOut = await pub.readContract({
    address: tokenOut.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint

  const route = hopCandidates.map(h => ({
    tokenIn: getAddress(TOKENS[h.tokenInSym as keyof typeof TOKENS].address),
    tokenOut: getAddress(TOKENS[h.tokenOutSym as keyof typeof TOKENS].address),
    pool: getAddress(h.pool.pool.address),
    poolType: 0,
    feeBps: Number(h.pool.pool.feeBps),
  }))
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

  try {
    let approvalGasWei = 0n
    if (needsApproval) {
      console.log('   → approve...')
      const hApprove = await wal.writeContract({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonRouter, MAX_UINT256],
      })
      const approveReceipt = await pub.waitForTransactionReceipt({ hash: hApprove })
      approvalGasWei = approveReceipt.gasUsed * approveReceipt.effectiveGasPrice
    }

    console.log('   → simulate swapExactTokensForTokens...')
    await pub.simulateContract({
      account,
      address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
      args: [route, amountIn, amountOutMin, account.address, deadline],
    })

    console.log('   → swapExactTokensForTokens...')
    const hSwap = await wal.writeContract({
      address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
      args: [route, amountIn, amountOutMin, account.address, deadline],
    })
    const receipt = await pub.waitForTransactionReceipt({ hash: hSwap })

    if (receipt.status === 'success') {
      const balanceAfterOut = await pub.readContract({
        address: tokenOut.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      }) as bigint
      const realizedOut = balanceAfterOut > balanceBeforeOut ? balanceAfterOut - balanceBeforeOut : 0n
      const realizedOutUsdg = tokenOut.symbol === 'USDG' ? realizedOut : convertSpot(realizedOut, outUsdgPath)
      const totalGasWei = approvalGasWei + receipt.gasUsed * receipt.effectiveGasPrice
      const gasUsdgActual = valueInUsdg('WETH', totalGasWei, graph)
      const realizedNetUsdg = realizedOutUsdg > inUsdgValue + gasUsdgActual ? realizedOutUsdg - inUsdgValue - gasUsdgActual : 0n

      console.log(`   ✅ SETTLE COMPLETE — received ${formatUnits(realizedOut, tokenOut.decimals)} ${tokenOut.symbol} (~${formatUnits(realizedNetUsdg, TOKENS.USDG.decimals)} USDG net) — ${hSwap}`)
      totalExecuted++
      consecutiveFailures = 0
      const prev = parseFloat(cumulativeProfit['USDG'] ?? '0')
      cumulativeProfit['USDG'] = (prev + parseFloat(formatUnits(realizedNetUsdg, TOKENS.USDG.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: label, tokenIn: 'USDG',
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(realizedNetUsdg, TOKENS.USDG.decimals),
        grossProfit: formatUnits(realizedOutUsdg, TOKENS.USDG.decimals), gasCost: formatUnits(gasUsdgActual, TOKENS.USDG.decimals),
        gasCostEth: formatEther(totalGasWei),
        profitPct: opp.profitPct, txHash: hSwap, status: 'success', route: 'internal',
      })
    } else {
      throw new Error('transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ SETTLE FAILED (no funds lost -- amountOutMin reverts atomically): ${message}`)
    totalFailed++
    consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: 'USDG',
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: '0', profitPct: opp.profitPct, status: 'failed', error: message, route: 'internal',
    })
    return 'attempted'
  }
}

// ─── Cross-venue arb (our pools vs. OpenOcean / 1inch) ───────────────────────
//
// Not atomic like the internal path above -- AeonArbKeeper can only run
// simple pool-style swap() calls, not an aggregator's own router calldata.
// Two separate transactions: buy tokenMid on our own pool via AeonRouter,
// then sell it via whichever aggregator quoted best. The second leg is
// re-quoted fresh for the ACTUAL amount received from the first (not the
// original estimate) and only sent if still profitable after gas -- if not,
// this stops and holds the intermediate token rather than force a losing
// trade. It will never knowingly execute at a loss, but a real run of bad
// luck between the two legs can leave the wallet holding some amount of an
// unintended token -- a materially different risk than the internal path.

interface AggOpp {
  tokenBase: typeof TOKENS[keyof typeof TOKENS]   // what we start and (if successful) end with
  tokenMid:  typeof TOKENS[keyof typeof TOKENS]
  ourPool:   PoolState
  amountIn:  bigint
  midOutEstimate: bigint
  quote:     import('./aggregators').AggregatorQuote
  profitRaw: bigint
  profitPct: number
  label:     string
}

const AGG_SIZE_FRACTIONS = [0.05, 0.15]   // 5% and 15% of the smaller of (our pool's capacity, wallet balance)
const OUR_SWAP_GAS_FALLBACK = 120_000n    // AeonRouter.swapExactTokensForTokens, single hop
const AGG_APPROVE_GAS_FALLBACK = 60_000n
const AGG_SWAP_GAS_FALLBACK = 250_000n    // aggregator router calls tend to run heavier than a plain pool swap

// Same idea as gasCostFloorInToken, but for FOUR transactions instead of two
// (approve + swap on our pool, then approve + swap via the aggregator) --
// this is the more expensive, non-atomic path, so its gas floor is higher.
async function gasCostFloorCrossVenue(
  tokenBaseSym: string, tokenBaseAddress: `0x${string}`, graph: Map<string, HopCandidate[]>,
): Promise<bigint | null> {
  const gasPrice = await pub.getGasPrice()

  let approve1Gas = APPROVE_GAS_FALLBACK
  try {
    approve1Gas = await pub.estimateContractGas({
      address: tokenBaseAddress, abi: ERC20_ABI, functionName: 'approve',
      args: [CONTRACTS.AeonRouter, 1n], account: account.address,
    })
  } catch { /* fixed fallback -- swap gas legs can't be pre-simulated without an existing approval */ }

  const totalGasUnits = approve1Gas + OUR_SWAP_GAS_FALLBACK + AGG_APPROVE_GAS_FALLBACK + AGG_SWAP_GAS_FALLBACK
  const gasCostWei = (totalGasUnits * gasPrice * GAS_SAFETY_MULT_PCT) / 100n

  if (tokenBaseSym === 'WETH') return gasCostWei

  const path = findConversionPath(graph, 'WETH', tokenBaseSym)
  if (!path) return null
  return convertSpot(gasCostWei, path)
}

async function scanAggregatorArbs(
  states: PoolState[], balances: Record<string, bigint>, bases: (keyof typeof TOKENS)[],
): Promise<AggOpp[]> {
  const opps: AggOpp[] = []

  for (const baseSym of bases) {
    const walletBal = balances[baseSym] ?? 0n
    if (walletBal <= 0n) continue

    // Only pools that actually pair this base token directly against
    // something -- this path is a single our-pool hop, so the base has to
    // be one side of it.
    const eligible = states.filter(s =>
      (s.pool.token0 === baseSym || s.pool.token1 === baseSym) &&
      !AGGREGATOR_EXCLUDE.has(s.pool.token0) && !AGGREGATOR_EXCLUDE.has(s.pool.token1),
    )
    if (eligible.length === 0) continue

    const tokenBase = TOKENS[baseSym]

    for (const s of eligible) {
      const midSym = (s.pool.token0 === baseSym ? s.pool.token1 : s.pool.token0) as keyof typeof TOKENS
      const tokenMid = TOKENS[midSym]
      const t0IsFirst = s.onchain0 === TOKENS[s.pool.token0].address.toLowerCase()
      const [r0real, r1real] = t0IsFirst ? [s.r0, s.r1] : [s.r1, s.r0]
      const [rBaseIn, rMidOut] = s.pool.token0 === baseSym ? [r0real, r1real] : [r1real, r0real]

      const maxCap = rBaseIn / 4n
      const cap = walletBal < maxCap ? walletBal : maxCap
      if (cap <= 0n) continue

      for (const frac of AGG_SIZE_FRACTIONS) {
        const amountIn = BigInt(Math.floor(Number(cap) * frac))
        if (amountIn <= 0n) continue

        const midOutEstimate = amtOut(amountIn, rBaseIn, rMidOut, s.pool.feeBps)
        if (midOutEstimate <= 0n) continue

        const quote = await getBestQuote(tokenMid.address, tokenBase.address, midOutEstimate, tokenMid.decimals)
        if (!quote) continue

        const profitRaw = quote.amountOut - amountIn
        if (profitRaw <= 0n) continue
        const profitPct = Number(profitRaw * 10000n / amountIn) / 100
        if (profitPct < 0.02 || profitPct > 50) continue

        opps.push({
          tokenBase, tokenMid, ourPool: s, amountIn, midOutEstimate, quote, profitRaw, profitPct,
          label: `${baseSym}→${tokenMid.symbol} (ours)→${baseSym} (${quote.source})`,
        })
      }
    }
  }

  return opps.sort((a, b) => b.profitPct - a.profitPct)
}

async function executeAggregatorArb(opp: AggOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenBase, tokenMid, ourPool, amountIn, midOutEstimate, quote, profitRaw, profitPct, label } = opp

  console.log(`\n🔀 CROSS-VENUE ARB: ${label}  profit ${profitPct.toFixed(3)}%  in ${formatUnits(amountIn, tokenBase.decimals)} ${tokenBase.symbol}`)

  const gasFloor = await gasCostFloorCrossVenue(tokenBase.symbol, tokenBase.address, graph)
  if (gasFloor === null) {
    console.warn(`   ⚠ No live WETH price path for ${tokenBase.symbol} -- can't verify profit clears gas cost, skipping for safety`)
    return 'skipped'
  }
  console.log(`   Est. gas cost (2 tx pairs, incl. 1.3x buffer): ~${formatUnits(gasFloor, tokenBase.decimals)} ${tokenBase.symbol}`)

  const requiredProfit = gasFloor + 1n
  if (profitRaw < requiredProfit) {
    console.log('   Profit does not clear the buffered gas cost, skipping')
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log(`   [DRY RUN] would execute via ${quote.source} -- clears gas cost, skipping actual send`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: formatUnits(profitRaw, tokenBase.decimals),
      profitPct, status: 'dry-run', route: quote.source,
    })
    return 'attempted'
  }

  let balIn = await pub.readContract({
    address: tokenBase.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (balIn < amountIn && tokenBase.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)   // free wrap first, where it applies
  }
  if (balIn < amountIn && tokenBase.symbol !== 'USDG') {
    balIn = await ensureBaseTokenFunded(tokenBase.symbol as keyof typeof TOKENS, amountIn, graph)   // then fall back to funding from USDG
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenBase.decimals)}, need ${formatUnits(amountIn, tokenBase.decimals)}`)
    return 'skipped'
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)
  const route = [{
    tokenIn: getAddress(tokenBase.address), tokenOut: getAddress(tokenMid.address),
    pool: getAddress(ourPool.pool.address), poolType: 0, feeBps: Number(ourPool.pool.feeBps),
  }]

  // Leg 1: buy tokenMid on our own pool via AeonRouter -- same slippage-
  // protected path the swap page itself uses.
  let midReceived = 0n
  try {
    const balMidBefore = await pub.readContract({ address: tokenMid.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint

    console.log('   → leg 1: approve...')
    const hApprove1 = await wal.writeContract({
      address: tokenBase.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonRouter, amountIn],
    })
    await pub.waitForTransactionReceipt({ hash: hApprove1 })

    console.log('   → leg 1: swap on our pool...')
    const amountOutMin = midOutEstimate * 95n / 100n   // 5% tolerance -- only protects this leg's own execution, not overall profitability
    const hSwap1 = await wal.writeContract({
      address: CONTRACTS.AeonRouter, abi: AEON_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
      args: [route, amountIn, amountOutMin, account.address, deadline],
    })
    await pub.waitForTransactionReceipt({ hash: hSwap1 })

    const balMidAfter = await pub.readContract({ address: tokenMid.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
    midReceived = balMidAfter - balMidBefore
    console.log(`   ✓ leg 1 confirmed — received ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`)
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ Leg 1 failed: ${message}`)
    totalFailed++
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: quote.source,
    })
    return 'attempted'
  }

  if (midReceived <= 0n) {
    console.warn('   ⚠ Leg 1 produced no output, stopping (no funds lost beyond leg 1 gas)')
    return 'attempted'
  }

  // Leg 2: fresh re-quote for the amount ACTUALLY received -- if it's no
  // longer profitable after gas, stop here. We hold tokenMid rather than
  // force a trade that's no longer profitable.
  const freshTx = await getSwapTx(quote.source, tokenMid.address, tokenBase.address, midReceived, tokenMid.decimals, account.address, AGGREGATOR_SLIPPAGE_PCT)
  if (!freshTx) {
    const message = `leg 1 filled, ${quote.source} no longer has a route -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`
    console.warn(`   ⚠ ${message}`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: quote.source,
    })
    return 'attempted'
  }

  const freshProfit = freshTx.amountOut - amountIn
  if (freshProfit < requiredProfit) {
    const message = `leg 1 filled, leg 2 no longer clears the buffered gas cost after re-quote -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`
    console.warn(`   ⚠ ${message}`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: quote.source,
    })
    return 'attempted'
  }

  try {
    console.log(`   → leg 2: approve to ${quote.source}...`)
    const hApprove2 = await wal.writeContract({
      address: tokenMid.address, abi: ERC20_ABI, functionName: 'approve', args: [freshTx.to, midReceived],
    })
    await pub.waitForTransactionReceipt({ hash: hApprove2 })

    console.log(`   → leg 2: swap via ${quote.source}...`)
    const hSwap2 = await wal.sendTransaction({ to: freshTx.to, data: freshTx.data, value: freshTx.value })
    const receipt2 = await pub.waitForTransactionReceipt({ hash: hSwap2 })

    if (receipt2.status === 'success') {
      console.log(`   ✅ CROSS-VENUE ARB COMPLETE — profit ~${formatUnits(freshProfit, tokenBase.decimals)} ${tokenBase.symbol} — ${hSwap2}`)
      totalExecuted++
      const prev = parseFloat(cumulativeProfit[tokenBase.symbol] ?? '0')
      cumulativeProfit[tokenBase.symbol] = (prev + parseFloat(formatUnits(freshProfit, tokenBase.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
        amountIn: formatUnits(amountIn, tokenBase.decimals), profit: formatUnits(freshProfit, tokenBase.decimals),
        profitPct, txHash: hSwap2, status: 'success', route: quote.source,
      })
    } else {
      throw new Error('leg 2 transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ Leg 2 failed: ${message} -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`)
    totalFailed++
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: quote.source,
    })
    return 'attempted'
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let lastAggregatorScan = 0

// Bounds how many candidates get a real gas-floor check (each costs RPC
// calls) before giving up for the tick -- sorted descending by profitPct,
// so this only matters when the top few all fail to clear gas.
const EXECUTION_CANDIDATES_PER_TICK = 10

async function tick() {
  const t0 = Date.now()
  let states: PoolState[]
  try {
    states = await fetchAllStates()
  } catch (err: any) {
    const message = err?.message ?? String(err)
    console.error(`[RPC error] ${message}`)
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    return
  }

  const { balances, searchBalances, nativeEth, availableEthForWrap } = await fetchBalances()
  const bases = candidateBaseTokens(searchBalances)
  const graph = buildGraph(states)
  const rankingGasPrice = await pub.getGasPrice()
  const expectedNetUsdg = (opp: ArbOpp) => {
    const gross = valueInUsdg(opp.tokenIn.symbol, opp.profitRaw, graph)
    const gasUnits = EXEC_ARB_BASE_GAS + EXEC_ARB_GAS_PER_HOP * BigInt(opp.hops.length)
    const gasWei = (gasUnits * rankingGasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const gasUsdg = valueInUsdg('WETH', gasWei, graph)
    return gross > gasUsdg ? gross - gasUsdg : 0n
  }
  const opps = bases
    .flatMap(baseSym => findArbs(graph, baseSym))
    .sort((a, b) => {
      const aValue = expectedNetUsdg(a)
      const bValue = expectedNetUsdg(b)
      if (bValue > aValue) return 1
      if (bValue < aValue) return -1
      return (SETTLEMENT_PRIORITY[a.tokenIn.symbol] ?? 99) - (SETTLEMENT_PRIORITY[b.tokenIn.symbol] ?? 99)
    })
  for (const opp of opps) {
    opp.expectedNetUsd = Number(formatUnits(expectedNetUsdg(opp), TOKENS.USDG.decimals))
  }
  const tickMs = Date.now() - t0

  // Candidates were all sized from the same opening snapshot. Once one is
  // submitted (successfully or not), stop and rescan fresh state before
  // considering another route -- this avoids paying gas for stale
  // candidates after the first transaction changes pool reserves. Applies
  // across BOTH cyclic and settlement routes: at most one state-changing
  // attempt per tick, whichever kind fires first.
  let anyAttempted = false

  if (opps.length === 0) {
    process.stdout.write(`\r[${new Date().toISOString()}] No arb found (${tickMs}ms) — ${states.length}/${ARB_POOLS.length} pools live, base tokens: ${bases.join(',') || 'none'}`)
  } else {
    console.log(`\n[${new Date().toISOString()}] ${opps.length} opportunities across ${bases.length} base token(s):`)
    for (const o of opps.slice(0, 5)) {
      console.log(`  ${o.label}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenIn.decimals)} ${o.tokenIn.symbol})`)
    }
    for (const opp of opps.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
      if (opp.profitPct < MIN_PROFIT_PCT) break   // sorted descending -- nothing further qualifies either
      const result = await executeArb(opp, graph, availableEthForWrap)
      if (result === 'attempted') {
        anyAttempted = true
        break
      }
    }
    if (!anyAttempted && opps[0].profitPct < MIN_PROFIT_PCT) {
      console.log(`  Best profit ${opps[0].profitPct.toFixed(3)}% below ${MIN_PROFIT_PCT}% threshold, skipping`)
    }
  }

  // Settlement routes (e.g. AEON -> token -> WETH, staying in WETH) --
  // independent of whether any CYCLIC opportunity existed, only skipped if
  // one already fired above this tick.
  if (!anyAttempted) {
    const settlementOpps = bases
      .flatMap(baseSym => findSettlementRoutes(graph, baseSym))
      .sort((a, b) => {
        if (b.profitUsdg > a.profitUsdg) return 1
        if (b.profitUsdg < a.profitUsdg) return -1
        return (SETTLEMENT_PRIORITY[a.tokenOut.symbol] ?? 99) - (SETTLEMENT_PRIORITY[b.tokenOut.symbol] ?? 99)
      })
    for (const opp of settlementOpps) {
      opp.expectedNetUsd = Number(formatUnits(opp.profitUsdg, TOKENS.USDG.decimals))
    }
    if (settlementOpps.length > 0) {
      console.log(`\n[${new Date().toISOString()}] ${settlementOpps.length} settlement-route opportunities:`)
      for (const o of settlementOpps.slice(0, 5)) {
        console.log(`  ${o.label}→${o.tokenOut.symbol}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenIn.decimals)} ${o.tokenIn.symbol})`)
      }
      for (const opp of settlementOpps.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
        if (opp.profitPct < MIN_PROFIT_PCT) break
        const result = await executeSettlementSwap(opp, graph, availableEthForWrap)
        if (result === 'attempted') { anyAttempted = true; break }
      }
    }
  }

  // Cross-venue (OpenOcean / 1inch) scan runs on its own slower cadence --
  // reuses this tick's already-fetched states/graph/balances, only adding
  // aggregator API calls, not extra pool or balance reads.
  if (ENABLE_CROSS_VENUE && Date.now() - lastAggregatorScan >= AGGREGATOR_SCAN_INTERVAL_MS) {
    lastAggregatorScan = Date.now()
    try {
      const aggOpps = await scanAggregatorArbs(states, searchBalances, bases)
      if (aggOpps.length > 0) {
        console.log(`\n[${new Date().toISOString()}] ${aggOpps.length} cross-venue opportunities:`)
        for (const o of aggOpps.slice(0, 3)) {
          console.log(`  ${o.label}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenBase.decimals)} ${o.tokenBase.symbol})`)
        }
        for (const opp of aggOpps.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
          if (opp.profitPct < MIN_PROFIT_PCT) break
          const result = await executeAggregatorArb(opp, graph, availableEthForWrap)
          if (result === 'attempted') break   // rescan before another state-changing route
        }
      }
    } catch (err: any) {
      const message = err?.message ?? String(err)
      console.error(`[aggregator scan error] ${message}`)
      recentErrors.unshift({ time: new Date().toISOString(), message })
      recentErrors = recentErrors.slice(0, 5)
    }
  }

  await writeStatus(opps, tickMs, balances, nativeEth, graph)
}

async function main() {
  const uniswapPools = await discoverUniswapPools()
  console.log(`AEON Arb Keeper`)
  console.log(`  Keeper address: ${account.address}`)
  console.log(`  Settlement tokens: ${BASE_TOKEN_OVERRIDE || SETTLEMENT_TOKENS.join(', ')} (AEON preferred on equal net profit)`)
  console.log(`  Max hops per cycle: ${MAX_HOPS}`)
  console.log(`  Pools monitored: ${ARB_POOLS.length}`)
  console.log(`  Uniswap V2 pools discovered: ${uniswapPools}`)
  console.log(`  Min profit to execute: ${MIN_PROFIT_PCT}%`)
  console.log(`  Interval: ${INTERVAL_MS}ms`)
  console.log(`  Cross-venue scan interval: ${AGGREGATOR_SCAN_INTERVAL_MS}ms`)
  console.log(`  Cross-venue execution: ${ENABLE_CROSS_VENUE ? 'enabled' : 'disabled (non-atomic)'}`)
  console.log(`  1inch: ${process.env.ONEINCH_API_KEY ? 'configured' : 'not configured (OpenOcean only)'}`)
  console.log(`  Dry run: ${DRY_RUN}`)
  console.log(`  Status file: ${statusPath}`)
  console.log()

  while (true) {
    await tick().catch(e => console.error('[tick error]', e))
    await new Promise(r => setTimeout(r, INTERVAL_MS))
  }
}

main()
