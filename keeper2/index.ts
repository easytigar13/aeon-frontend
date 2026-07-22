/**
 * ERZA external arb keeper -- 24/7 live service
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
  fallback,
  http,
  webSocket,
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
import { POOLS, TOKENS, CONTRACTS, CL_GAUGES, DLMM_GAUGES, UNISWAP_POOLS, ALGEBRA_CONTRACTS, DLMM_CONTRACTS } from '../src/config/contracts'
import { ERC20_ABI, AEON_ROUTER_ABI, AEON_UNIVERSAL_ROUTER_ABI, AEON_NATIVE_ARB_EXECUTOR_ABI, AEON_FACTORY_ABI, ALGEBRA_POOL_ABI, ALGEBRA_QUOTER_ABI, LB_PAIR_ABI, LB_ROUTER_ABI, WETH_ABI, MULTI_GAUGE_CONTROLLER_ABI } from '../src/config/abis'
import { robinhoodChain } from '../src/config/chain'
import { getBestQuote, getSwapTx, type AggregatorSource } from './aggregators'
import { writeBotStatus, appendTrade, isBotStoreConfigured } from '../src/lib/botStore'
import { discoverUniswapV3Pools, quoteUniswapV3ExactInput, UNISWAP_V3, UNISWAP_V3_FACTORY_ABI, UNISWAP_V3_POOL_ABI, type UniswapV3PoolRef } from './uniswap-v3'
import { discoverUniswapV4Pools, quoteUniswapV4ExactInput, UNISWAP_V4, UNISWAP_V4_STATE_VIEW_ABI, UNISWAP_V4_INITIALIZE_EVENT, NATIVE_CURRENCY, type UniswapV4PoolRef } from './uniswap-v4'

// A second PM2 process can run this exact, current implementation with its
// own wallet/config instead of drifting on a stale copy of index.ts.
const envPath      = fileURLToPath(new URL(process.env.KEEPER_ENV_FILE ?? '.env', import.meta.url))
dotenv.config({ path: envPath })

// Overridable so a test run (or a second isolated instance) never touches
// the live process's real status/history files -- defaults to the normal
// in-place paths for actual 24/7 operation.
const statusPath    = process.env.STATUS_FILE ?? fileURLToPath(new URL('status.json', import.meta.url))
const tradesLogPath = process.env.TRADES_LOG_FILE ?? fileURLToPath(new URL('trades.log', import.meta.url))

// ─── Config ──────────────────────────────────────────────────────────────────

const PRIMARY_RPC  = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const SUBMIT_RPC   = process.env.SUBMIT_RPC_URL ?? 'https://sequencer.mainnet.chain.robinhood.com'
const RPC_URLS     = Array.from(new Set([
  ...((process.env.RPC_URLS ?? '').split(',').map(url => url.trim()).filter(Boolean)),
  PRIMARY_RPC,
  // NOTE: the Blockscout proxy (robinhoodchain.blockscout.com) was removed
  // from the default fallback -- it rate-limits (429) and lags the chain, and
  // under aggressive polling the primary would time out and thrash to it,
  // ballooning tick time to ~20s (stale quotes -> nothing executes). Add your
  // own extra endpoint via RPC_URLS= if you have a fast one. For a cross-venue
  // bot this hard: point RPC_URL at a dedicated/private node.
]))

function safeErrorMessage(error: unknown): string {
  const candidate = error as { shortMessage?: unknown; message?: unknown } | null
  return String(candidate?.shortMessage ?? candidate?.message ?? error)
    .replace(/((?:https?|wss):\/\/[^\s"'`]+\/v2\/)[^\s"'`]+/gi, '$1<redacted>')
    .replace(/([?&](?:api[-_]?key|key)=)[^&\s"'`]+/gi, '$1<redacted>')
}

const PK            = (process.env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}`
const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT ?? '0')  // consider every positive quote; execution still requires profit above the buffered gas cost
const INTERVAL_MS    = parseInt(process.env.INTERVAL_MS ?? '1000')
const DRY_RUN         = process.env.DRY_RUN === 'true'
const DEADLINE_SECONDS = 120  // execution must land within 2 min of being sized, else it just reverts (no funds lost)
const configuredBalanceUsageBps = BigInt(process.env.MAX_BALANCE_USAGE_BPS ?? '9900')
const MAX_BALANCE_USAGE_BPS = configuredBalanceUsageBps < 1n ? 1n : configuredBalanceUsageBps > 10_000n ? 10_000n : configuredBalanceUsageBps
const ROUTE_FAILURE_THRESHOLD = parseInt(process.env.ROUTE_FAILURE_THRESHOLD ?? '2')
const ROUTE_COOLDOWN_MS = parseInt(process.env.ROUTE_COOLDOWN_MS ?? '60000')
const ROUTE_MAX_COOLDOWN_MS = parseInt(process.env.ROUTE_MAX_COOLDOWN_MS ?? '900000')
const STALE_QUOTE_RETRY_MS = Math.max(250, parseInt(process.env.STALE_QUOTE_RETRY_MS ?? '1000'))
const PENDING_TX_TIMEOUT_MS = parseInt(process.env.PENDING_TX_TIMEOUT_MS ?? '6000')
const REPLACEMENT_GAS_BUMP_BPS = BigInt(process.env.REPLACEMENT_GAS_BUMP_BPS ?? '1250')
// Robinhood Chain competitors consistently submit EIP-1559 transactions with
// a max-fee cap around 2x the current gas price. The cap is not what is paid;
// it gives the sequencer room to include the transaction if base fees move
// between signing and inclusion. Keep priority fee at zero, matching the L2.
const TX_FEE_HEADROOM_BPS = BigInt(process.env.TX_FEE_HEADROOM_BPS ?? '20000')
const TX_GAS_LIMIT_HEADROOM_BPS = BigInt(process.env.TX_GAS_LIMIT_HEADROOM_BPS ?? '12000')

type KeeperRole = 'mirajane' | 'aeon-only' | 'external-only' | 'external-first' | 'general'
// This entry point belongs exclusively to ERZA. She trades EVERYWHERE: all
// external Robinhood DEXes AND AEON DEX (a route may use an AEON hop as long
// as it also uses an external venue). WETH->token->WETH arb, taken only when
// net-of-gas positive. AEON DEX is included, not excluded.
const KEEPER_ROLE = 'external-first' as KeeperRole
// Keep the existing Redis namespace so the dashboard retains Bot 2's history.
const BOT_ID = (process.env.BOT_ID ?? 'aeon').trim() || 'aeon'

// Cross-venue (OpenOcean / 1inch) scan runs far less often than the internal
// pool scan -- it costs real API calls (rate-limited, especially 1inch),
// unlike the internal scan which is pure RPC reads.
const AGGREGATOR_SCAN_INTERVAL_MS = parseInt(process.env.AGGREGATOR_SCAN_INTERVAL_MS ?? '30000')
const AGGREGATOR_SLIPPAGE_PCT = parseFloat(process.env.AGGREGATOR_SLIPPAGE_PCT ?? '0.5')
// ERZA uses only routes that the atomic executor can complete in one
// transaction. Aggregator two-transaction paths remain disabled.
const ENABLE_CROSS_VENUE = false
// Every executable arbitrage must close in exactly the asset it started in.
// This makes the profit invariant exact: amountOut must exceed amountIn plus
// the gas floor in that same token. Do not make this depend on deployment
// configuration; a missing/stale environment variable must never silently
// re-enable cross-settlement valuation.
const SAME_TOKEN_ONLY = true
const ATOMIC_ONLY = true

// Re-run idempotent venue discovery so newly created pools and pools that
// cross the external-volume threshold become routeable without a restart.
const POOL_REFRESH_INTERVAL_MS = parseInt(process.env.POOL_REFRESH_INTERVAL_MS ?? '600000')
const MULTI_GAUGE_DISTRIBUTION_INTERVAL_MS = parseInt(process.env.MULTI_GAUGE_DISTRIBUTION_INTERVAL_MS ?? '900000')
const EVENT_DRIVEN_SCANNING = process.env.EVENT_DRIVEN_SCANNING !== 'false'
// Logs are the fast path; this periodic full refresh is the safety net for
// unusual pool implementations, missed RPC log ranges, and shallow reorgs.
const FULL_STATE_REFRESH_MS = Math.max(5_000, parseInt(process.env.FULL_STATE_REFRESH_MS ?? (
  KEEPER_ROLE === 'external-only' || KEEPER_ROLE === 'external-first' ? '120000' : '30000'
)))
// Even with unchanged pools, a lower base fee can turn an existing gross edge
// into a net-profitable trade. Re-rank cached state periodically for gas only.
const GAS_ONLY_RECHECK_MS = Math.max(1_000, parseInt(process.env.GAS_ONLY_RECHECK_MS ?? (
  KEEPER_ROLE === 'external-only' || KEEPER_ROLE === 'external-first' ? '120000' : '5000'
)))
// Prefer an explicitly configured WebSocket endpoint. When the first private
// reader is an Alchemy HTTPS URL, its WSS twin uses the same app key and is a
// safe automatic default. The HTTP pool remains authoritative for state
// reads/backfill; WebSocket is only the low-latency wake-up channel.
const WS_RPC_URL = (
  process.env.WS_RPC_URL
    ?? RPC_URLS.find(url => /\.alchemy\.com\//i.test(url))?.replace(/^http/i, 'ws')
    ?? ''
).trim()
const WEBSOCKET_SCANNING = process.env.WEBSOCKET_SCANNING !== 'false' && /^wss:\/\//i.test(WS_RPC_URL)
const WS_FALLBACK_POLL_MS = Math.max(500, parseInt(process.env.WS_FALLBACK_POLL_MS ?? '3000'))
const WS_RECONNECT_BASE_MS = Math.max(250, parseInt(process.env.WS_RECONNECT_BASE_MS ?? '1000'))
// A rejected handshake consumes provider throughput too. Back off to five
// minutes under a sustained 429/non-101 response while HTTP polling keeps the
// keeper live; a tight reconnect storm can otherwise prevent the quota from
// recovering at all.
const WS_RECONNECT_MAX_MS = Math.max(WS_RECONNECT_BASE_MS, parseInt(process.env.WS_RECONNECT_MAX_MS ?? '300000'))

// Native ETH isn't one of the pool tokens (everything trades WETH), but
// it's economically fungible with WETH via wrap/unwrap -- whatever's spare
// above the reserve counts as WETH capacity for discovery and sizing, and
// gets wrapped on demand right before a trade that actually needs it (see
// fetchBalances() and ensureWethBalance()). This is just a configured
// FLOOR, not the actual reserve used -- computeMinGasReserveWei() (see
// fetchBalances()) takes the larger of this and 3x a live, current-gas-price
// worst-case transaction cost, every tick, so the real reserve never
// silently falls behind if gas prices rise. Either way, the reserve is
// NEVER touched -- it's what keeps the bot able to pay for its own future
// transactions no matter what.
const GAS_RESERVE_ETH = parseFloat(process.env.GAS_RESERVE_ETH ?? '0.002')
// A refill targets 120% of the live reserve so the unwrap transaction and the
// next arb do not immediately put the wallet below the floor again.
const GAS_REFILL_TARGET_BPS = BigInt(process.env.GAS_REFILL_TARGET_BPS ?? '12000')
const GAS_REFILL_RETRY_MS = parseInt(process.env.GAS_REFILL_RETRY_MS ?? '30000')

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
// ERZA settles exclusively in WETH. Native ETH above the protected gas
// reserve is wrapped on demand, so the economic start/end asset is ETH while
// every AMM hop remains ERC-20 compatible and exactly measurable on-chain.
const BASE_TOKEN_OVERRIDE = 'WETH' as const
const MAX_HOPS = Math.max(2, Math.min(parseInt(process.env.MAX_HOPS ?? '12'), 16))
const SETTLEMENT_TOKENS = ['WETH'] as const
const SETTLEMENT_PRIORITY: Record<string, number> = { WETH: 0 }

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

// 'vAMM'/'uniV2' are constant-product (x*y=k); 'CL' is AEON's own Algebra
// Integral fork (concentrated liquidity, tick-based); 'DLMM' is AEON's own
// Trader Joe Liquidity Book fork (bin-based). All four route through the
// same DFS/ternary-search sizing below via PoolState's r0/r1/effFeeBps --
// only pool discovery, state-fetching, and on-chain execution differ by kind.
type PoolKind = 'vAMM' | 'uniV2' | 'uniV3' | 'uniV4' | 'CL' | 'DLMM'

const AEON_POOL_KINDS = new Set<PoolKind>(['vAMM', 'CL', 'DLMM'])
function isAeonPoolKind(kind: PoolKind): boolean {
  return AEON_POOL_KINDS.has(kind)
}

function isErzaAeonBridgePool(pool: PoolConfig): boolean {
  return isAeonPoolKind(pool.kind) && (pool.token0 === 'WETH' || pool.token1 === 'WETH')
}

function routeAllowedForRole(hops: HopCandidate[]): boolean {
  if (KEEPER_ROLE === 'aeon-only') return hops.every(hop => isAeonPoolKind(hop.pool.pool.kind))
  if (KEEPER_ROLE === 'external-only') return hops.every(hop => !isAeonPoolKind(hop.pool.pool.kind))
  if (KEEPER_ROLE === 'external-first') return hops.some(hop => !isAeonPoolKind(hop.pool.pool.kind))
  // Mirajane owns external price discovery. AEON-only cycles belong to Bot 2,
  // while mixed routes remain valid because they contain an external venue.
  if (KEEPER_ROLE === 'mirajane') return hops.some(hop => !isAeonPoolKind(hop.pool.pool.kind))
  return true
}

interface PoolConfig {
  name: string
  address: `0x${string}`
  token0: keyof typeof TOKENS
  token1: keyof typeof TOKENS
  feeBps: bigint
  isUniV2: boolean
  kind: PoolKind
  binStep?: number   // DLMM only -- identifies which pair-at-this-bin-step on-chain
  v3Fee?: number     // Uniswap V3 fee tier in parts per million
  v4PoolId?: `0x${string}`
  v4Fee?: number
  v4TickSpacing?: number
  v4Hooks?: `0x${string}`
  v4Native?: boolean
}

const ARB_POOLS: PoolConfig[] = POOLS
  .filter(p => p.type === 'vAMM')
  .map(p => ({
    name: p.name,
    address: p.address,
    token0: p.token0 as keyof typeof TOKENS,
    token1: p.token1 as keyof typeof TOKENS,
    feeBps: BigInt(parseFeeBps(p.fee)),
    isUniV2: false,
    kind: 'vAMM' as const,
  }))

const UNISWAP_V2_FACTORY = '0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f' as `0x${string}`
const UNISWAP_FEE_BPS = 30n
// ROBINFUN charges transfer tax when its official Uniswap pair is involved.
// AeonArbKeeper uses standard V2 exact-input math, so those pairs cannot be
// executed safely until the contract re-measures received amounts per hop.
const UNISWAP_UNSUPPORTED_TOKENS = new Set<keyof typeof TOKENS>(['ROBINFUN'])
// Seed explicitly verified V2-compatible pools, including factories outside
// the primary discovery factory. Dynamic discovery below de-duplicates these
// by address when it encounters the same pair.
for (const p of UNISWAP_POOLS) {
  const token0 = p.token0 as keyof typeof TOKENS
  const token1 = p.token1 as keyof typeof TOKENS
  if (!(token0 in TOKENS) || !(token1 in TOKENS)) continue
  if (UNISWAP_UNSUPPORTED_TOKENS.has(token0) || UNISWAP_UNSUPPORTED_TOKENS.has(token1)) continue
  if (ARB_POOLS.some(existing => existing.address.toLowerCase() === p.address.toLowerCase())) continue
  ARB_POOLS.push({
    name: p.name,
    address: p.address,
    token0,
    token1,
    feeBps: BigInt(parseFeeBps(p.fee)),
    isUniV2: true,
    kind: 'uniV2',
  })
}
// Hard pool allowlist. When POOL_ALLOWLIST is set (comma-separated pool
// addresses), Mirajane trades ONLY these pools: all remote Uniswap
// V2/V3/V4 discovery is skipped, and ARB_POOLS is filtered down to exactly
// this set after every refresh. This is what makes it "stupidly fast" -- a
// tiny, fixed pool graph with zero external-discovery latency. Cycles still
// only ever settle in AEON/ETH/USDG (SETTLEMENT_TOKENS), unchanged.
const POOL_ALLOWLIST = new Set(
  (process.env.POOL_ALLOWLIST ?? '')
    .split(',').map(a => a.trim().toLowerCase()).filter(Boolean),
)
const POOL_ALLOWLIST_ACTIVE = POOL_ALLOWLIST.size > 0

function applyPoolAllowlist() {
  if (!POOL_ALLOWLIST_ACTIVE) return
  for (let i = ARB_POOLS.length - 1; i >= 0; i--) {
    if (!POOL_ALLOWLIST.has(ARB_POOLS[i].address.toLowerCase())) ARB_POOLS.splice(i, 1)
  }
}

// ERZA trades everywhere: light $500/day volume floor to skip truly-dead
// pools, but otherwise every discovered external pool is eligible. The real
// gate is the net-of-gas profit check at execution (ETH in -> ETH out).
const MIN_EXTERNAL_VOLUME_USD = parseFloat(process.env.MIN_EXTERNAL_VOLUME_USD ?? '500')
// Explicit user-requested external token pins. A pool containing one of these
// tokens bypasses the general DexScreener liquidity/indexing preference and
// remains eligible for canonical V2/V3/V4 validation. ROBINFUN deliberately
// remains excluded because its transfer behavior is incompatible with the
// current atomic executor; force-adding an incompatible token would only burn
// gas on guaranteed reverts.
// VIRTUAL and VEX removed: their pin kept ERZA regenerating a dead
// WETH->USDG->VEX->VIRTUAL->WETH route every cycle (net-negative). Unpinned,
// they're subject to the normal $500 floor like everything else.
const MANUAL_EXTERNAL_TOKENS = new Set<keyof typeof TOKENS>([
  'CASHCAT', 'INDEX', 'TENDIES', 'MARIAN', 'JUGGERNAUT',
  'VAULTS', 'SLEEP', 'SHERWOOD', 'HOODIE', 'NASDAQ',
])
const MANUAL_EXTERNAL_TOKEN_ADDRESSES = new Set(
  [...MANUAL_EXTERNAL_TOKENS].map(symbol => TOKENS[symbol].address.toLowerCase()),
)
const uniswapV3Refs = new Map<string, UniswapV3PoolRef>()
const uniswapV4Refs = new Map<string, UniswapV4PoolRef>()

type RuntimeToken = typeof TOKENS[keyof typeof TOKENS]
type RuntimeTokenKey = keyof typeof TOKENS
const runtimeTokens = TOKENS as unknown as Record<string, RuntimeToken>

type DexScreenerToken = { address?: string; name?: string; symbol?: string }
type DexScreenerPair = {
  chainId?: string
  dexId?: string
  pairAddress?: string
  labels?: string[]
  baseToken?: DexScreenerToken
  quoteToken?: DexScreenerToken
  liquidity?: { usd?: number }
  volume?: { h24?: number }
}

// ERZA is a chain-wide external searcher, not a hand-maintained token bot.
// Crawl every useful Uniswap market reachable from the WETH/USDG component,
// register ERC-20 metadata on-chain, then validate each pool against the
// canonical V2/V3/V4 deployment before it enters the executable graph.
// There is deliberately no 24h-volume threshold: a quiet pool can still be
// mispriced. A small TVL floor only prevents spam/dust contracts from making
// the graph unbounded; it is far below the wallet's practical trade depth.
const EXTERNAL_MIN_LIQUIDITY_USD = Math.max(0, parseFloat(process.env.EXTERNAL_MIN_LIQUIDITY_USD ?? '1000'))
const EXTERNAL_DISCOVERY_DEPTH = Math.max(1, Math.min(4, parseInt(process.env.EXTERNAL_DISCOVERY_DEPTH ?? '2')))
const EXTERNAL_DISCOVERY_MAX_TOKENS = Math.max(25, Math.min(1000, parseInt(process.env.EXTERNAL_DISCOVERY_MAX_TOKENS ?? '300')))
const EXTERNAL_DISCOVERY_MAX_POOLS = Math.max(50, Math.min(3000, parseInt(process.env.EXTERNAL_DISCOVERY_MAX_POOLS ?? '1200')))
const DEXSCREENER_REQUEST_GAP_MS = Math.max(200, parseInt(process.env.DEXSCREENER_REQUEST_GAP_MS ?? '220'))
const V4_POOL_MANAGER_DEPLOY_BLOCK = 9070n
const ERC20_METADATA_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

const waitMs = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function runtimeTokenByAddress(): Map<string, RuntimeTokenKey> {
  return new Map(Object.entries(runtimeTokens).map(([key, token]) => [token.address.toLowerCase(), key as RuntimeTokenKey]))
}

function runtimeTokenKey(rawSymbol: string, address: string, addressMap: Map<string, RuntimeTokenKey>): RuntimeTokenKey {
  let base = rawSymbol.normalize('NFKD').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 18)
  if (!base) base = 'TOKEN'
  if (!/^[A-Z]/.test(base)) base = `T${base}`
  let key = base
  const existing = runtimeTokens[key]
  if (existing && existing.address.toLowerCase() !== address.toLowerCase()) {
    key = `${base.slice(0, 12)}${address.slice(2, 8).toUpperCase()}`
  }
  while (runtimeTokens[key] && runtimeTokens[key].address.toLowerCase() !== address.toLowerCase()) {
    key = `${base.slice(0, 10)}${address.slice(2, 10).toUpperCase()}`
  }
  addressMap.set(address.toLowerCase(), key as RuntimeTokenKey)
  return key as RuntimeTokenKey
}

async function registerRuntimeTokens(candidates: Map<string, DexScreenerToken>): Promise<number> {
  const addressMap = runtimeTokenByAddress()
  const unknown = [...candidates.entries()]
    .filter(([address]) => !addressMap.has(address) && address !== NATIVE_CURRENCY.toLowerCase())
    .slice(0, Math.max(0, EXTERNAL_DISCOVERY_MAX_TOKENS - addressMap.size))
  if (unknown.length === 0) return 0

  const metadata = await chunkedMulticall(unknown.flatMap(([address]) => {
    const token = getAddress(address)
    return [
      { address: token, abi: ERC20_METADATA_ABI, functionName: 'name' as const },
      { address: token, abi: ERC20_METADATA_ABI, functionName: 'symbol' as const },
      { address: token, abi: ERC20_METADATA_ABI, functionName: 'decimals' as const },
    ]
  }))
  let added = 0
  for (let i = 0; i < unknown.length; i++) {
    const [address, indexed] = unknown[i]
    const nameResult = metadata[i * 3]
    const symbolResult = metadata[i * 3 + 1]
    const decimalsResult = metadata[i * 3 + 2]
    if (symbolResult?.status !== 'success' || decimalsResult?.status !== 'success') continue
    const decimals = Number(decimalsResult.result)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    const rawSymbol = String(symbolResult.result || indexed.symbol || 'TOKEN').trim()
    const key = runtimeTokenKey(rawSymbol, address, addressMap)
    if (runtimeTokens[key]) continue
    runtimeTokens[key] = {
      address: getAddress(address),
      symbol: key,
      decimals,
      name: nameResult?.status === 'success' ? String(nameResult.result) : String(indexed.name || rawSymbol),
    } as RuntimeToken
    added++
  }
  return added
}

async function fetchDexScreenerPairs(token: string): Promise<DexScreenerPair[]> {
  try {
    const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return []
    const body = await response.json()
    return Array.isArray(body) ? body as DexScreenerPair[] : []
  } catch {
    return []
  }
}

async function crawlRobinhoodUniswapPairs(): Promise<DexScreenerPair[]> {
  const knownSeeds = Object.entries(runtimeTokens)
    .filter(([key]) => key !== 'ETH' && (MANUAL_EXTERNAL_TOKENS.has(key as keyof typeof TOKENS) || !AGGREGATOR_EXCLUDE.has(key)))
    .map(([, token]) => token.address.toLowerCase())
  const queue = Array.from(new Set([
    TOKENS.WETH.address.toLowerCase(),
    TOKENS.USDG.address.toLowerCase(),
    ...knownSeeds,
  ])).map(address => ({ address, depth: 0 }))
  const queried = new Set<string>()
  const pairs = new Map<string, DexScreenerPair>()
  const tokenCandidates = new Map<string, DexScreenerToken>()

  while (queue.length > 0 && queried.size < EXTERNAL_DISCOVERY_MAX_TOKENS && pairs.size < EXTERNAL_DISCOVERY_MAX_POOLS) {
    const current = queue.shift()!
    if (queried.has(current.address)) continue
    queried.add(current.address)
    const found = await fetchDexScreenerPairs(current.address)
    for (const pair of found) {
      if (String(pair.chainId ?? 'robinhood').toLowerCase() !== 'robinhood') continue
      if (String(pair.dexId ?? '').toLowerCase() !== 'uniswap') continue
      const kind = pair.labels?.find(label => ['v2', 'v3', 'v4'].includes(label.toLowerCase()))?.toLowerCase()
      if (!kind || !pair.pairAddress) continue
      const pairTokenAddresses = [pair.baseToken?.address, pair.quoteToken?.address]
        .map(address => String(address ?? '').toLowerCase())
      const isManuallyPinned = pairTokenAddresses.some(address => MANUAL_EXTERNAL_TOKEN_ADDRESSES.has(address))
      if (!isManuallyPinned && Number(pair.liquidity?.usd ?? 0) < EXTERNAL_MIN_LIQUIDITY_USD) continue
      const poolKey = `${kind}:${pair.pairAddress.toLowerCase()}`
      if (!pairs.has(poolKey)) pairs.set(poolKey, pair)

      for (const token of [pair.baseToken, pair.quoteToken]) {
        const address = String(token?.address ?? '').toLowerCase()
        if (!/^0x[0-9a-f]{40}$/.test(address) || address === NATIVE_CURRENCY.toLowerCase()) continue
        tokenCandidates.set(address, token ?? { address })
        if (current.depth < EXTERNAL_DISCOVERY_DEPTH && !queried.has(address)) {
          queue.push({ address, depth: current.depth + 1 })
        }
      }
      if (pairs.size >= EXTERNAL_DISCOVERY_MAX_POOLS) break
    }
    if (queue.length > 0) await waitMs(DEXSCREENER_REQUEST_GAP_MS)
  }

  const addedTokens = await registerRuntimeTokens(tokenCandidates)
  console.log(`[erza universe] indexed ${pairs.size} Uniswap markets across ${queried.size} token queries; +${addedTokens} runtime tokens`)
  return [...pairs.values()]
}

// Use an independent curated seed so ERZA starts with known external venues
// immediately, then expands it through live V2/V3/V4 discovery. The copied
// manifest is deliberately owned by keeper2; Mirajane's pool file and process
// are never read or mutated by ERZA.
const MIRAJANE_MODE = KEEPER_ROLE === 'mirajane'
const ERZA_MODE = KEEPER_ROLE === 'external-only' || KEEPER_ROLE === 'external-first'
function loadCuratedPools(filename: string, externalOnly: boolean) {
  const path = fileURLToPath(new URL(filename, import.meta.url))
  const { poolConfigs, v4Refs } = JSON.parse(fs.readFileSync(path, 'utf-8'))
  ARB_POOLS.splice(0, ARB_POOLS.length) // drop the default POOLS-derived set
  for (const p of poolConfigs) {
    if (externalOnly && isAeonPoolKind(p.kind as PoolKind)) continue
    // Curated V3 manifests historically stored feeBps=0 and relied on the
    // exact quoter to catch the discrepancy. That made the fast search invent
    // gross edges which disappeared at preflight. Always derive the AMM-model
    // fee from the canonical V3 fee tier, even when an older manifest is read.
    const modeledFeeBps = p.kind === 'uniV3' && p.v3Fee !== undefined
      ? Math.ceil(Number(p.v3Fee) / 100)
      : Number(p.feeBps)
    ARB_POOLS.push({
      name: p.name, address: p.address as `0x${string}`,
      token0: p.token0 as keyof typeof TOKENS, token1: p.token1 as keyof typeof TOKENS,
      feeBps: BigInt(modeledFeeBps), isUniV2: !!p.isUniV2, kind: p.kind as PoolKind,
      ...(p.v3Fee !== undefined ? { v3Fee: p.v3Fee } : {}),
      ...(p.v4PoolId ? {
        v4PoolId: p.v4PoolId as `0x${string}`, v4Fee: p.v4Fee, v4TickSpacing: p.v4TickSpacing,
        v4Hooks: p.v4Hooks as `0x${string}`, v4Native: p.v4Native,
      } : {}),
    })
  }
  for (const r of v4Refs) uniswapV4Refs.set((r.id as string).toLowerCase(), r as UniswapV4PoolRef)
}
if (MIRAJANE_MODE) loadCuratedPools('mirajane-pools.json', false)
if (ERZA_MODE) {
  loadCuratedPools('erza-pools.json', true)
  // Keep the external curated graph as ERZA's fast startup set, then append
  // the known AEON vAMM seed for optional mixed routes. Live factory/CL/DLMM
  // expansion runs in the normal background discovery refresh.
  for (const p of POOLS.filter(pool => pool.type === 'vAMM')) {
    if (p.token0 !== 'WETH' && p.token1 !== 'WETH') continue
    if (ARB_POOLS.some(existing => existing.address.toLowerCase() === p.address.toLowerCase())) continue
    ARB_POOLS.push({
      name: p.name,
      address: p.address,
      token0: p.token0 as keyof typeof TOKENS,
      token1: p.token1 as keyof typeof TOKENS,
      feeBps: BigInt(parseFeeBps(p.fee)),
      isUniV2: false,
      kind: 'vAMM',
    })
  }
}

let mirajaneV3Validated = false

// Mirajane's V3 execution path is pinned to the canonical Uniswap V3
// factory/router. A pool from a different V3-style deployment can expose
// the same slot0/liquidity interface and look profitable to the scanner,
// but the router will execute against the canonical factory's pool instead.
// Validate that quote and execution therefore address the exact same pool
// before allowing a configured V3 edge into the graph.
async function validateMirajaneV3Pools(): Promise<void> {
  if ((!MIRAJANE_MODE && !ERZA_MODE) || mirajaneV3Validated) return

  const rejected = new Set<string>()
  const pools = ARB_POOLS.filter(p => p.kind === 'uniV3')
  const metadata = await chunkedMulticall(pools.flatMap(pool => {
    const address = getAddress(pool.address)
    return [
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'factory' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'fee' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'token0' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'token1' as const },
    ]
  }))
  const canonicalCalls: any[] = []
  const resolved: { pool: PoolConfig; address: `0x${string}`; actualFactory: `0x${string}`; actualToken0: `0x${string}`; actualToken1: `0x${string}`; actualFee: number }[] = []
  for (let i = 0; i < pools.length; i++) {
    const values = metadata.slice(i * 4, i * 4 + 4)
    if (values.some(value => value?.status !== 'success')) {
      rejected.add(pools[i].address.toLowerCase())
      continue
    }
    const actualFactory = getAddress(values[0].result as `0x${string}`)
    const actualFee = Number(values[1].result)
    const actualToken0 = getAddress(values[2].result as `0x${string}`)
    const actualToken1 = getAddress(values[3].result as `0x${string}`)
    resolved.push({ pool: pools[i], address: getAddress(pools[i].address), actualFactory, actualToken0, actualToken1, actualFee })
    canonicalCalls.push({
      address: UNISWAP_V3.factory, abi: UNISWAP_V3_FACTORY_ABI,
      functionName: 'getPool' as const, args: [actualToken0, actualToken1, actualFee] as const,
    })
  }
  const canonicalResults = await chunkedMulticall(canonicalCalls)
  for (let i = 0; i < resolved.length; i++) {
    const { pool, address, actualFactory, actualToken0, actualToken1, actualFee } = resolved[i]
    const expectedTokens = new Set([
      getAddress(TOKENS[pool.token0].address).toLowerCase(),
      getAddress(TOKENS[pool.token1].address).toLowerCase(),
    ])
    const tokenPairMatches = expectedTokens.has(actualToken0.toLowerCase())
      && expectedTokens.has(actualToken1.toLowerCase())
    const canonical = canonicalResults[i]?.status === 'success'
      ? getAddress(canonicalResults[i].result as `0x${string}`)
      : ZERO_ADDRESS
    const reason = actualFactory.toLowerCase() !== UNISWAP_V3.factory.toLowerCase()
      ? `factory ${actualFactory}`
      : !tokenPairMatches
        ? 'configured token pair does not match pool token0/token1'
        : actualFee !== pool.v3Fee
          ? `configured fee ${pool.v3Fee ?? 'missing'} != on-chain fee ${actualFee}`
          : canonical.toLowerCase() !== address.toLowerCase()
            ? `canonical pool is ${canonical}`
            : null

    if (reason) {
      rejected.add(address.toLowerCase())
      console.warn(`[${ERZA_MODE ? 'erza' : 'mirajane'}] rejecting non-canonical V3 pool ${pool.name} ${address}: ${reason}`)
    } else {
      // The generated manifest historically stored zero here. Correct it from
      // the pool itself so approximate ranking includes the real V3 fee too.
      pool.feeBps = (BigInt(actualFee) + 99n) / 100n
    }
  }

  for (let i = ARB_POOLS.length - 1; i >= 0; i--) {
    if (rejected.has(ARB_POOLS[i].address.toLowerCase())) ARB_POOLS.splice(i, 1)
  }
  mirajaneV3Validated = true
  console.log(`[${ERZA_MODE ? 'erza' : 'mirajane'}] canonical V3 validation complete: ${rejected.size} rejected, ${ARB_POOLS.filter(p => p.kind === 'uniV3').length} retained`)
}

async function discoverHighVolumeUniswapV3Pools(): Promise<number> {
  const symbols = (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).filter(sym =>
    sym !== 'ETH' && (MANUAL_EXTERNAL_TOKENS.has(sym) || sym === 'WETH' || sym === 'USDG' || !AGGREGATOR_EXCLUDE.has(String(sym))),
  )
  const refs = await discoverUniswapV3Pools(pub, symbols.map(sym => getAddress(TOKENS[sym].address)))
  const addressToSymbol = new Map(symbols.map(sym => [TOKENS[sym].address.toLowerCase(), sym]))
  let added = 0
  for (const ref of refs) {
    const token0 = addressToSymbol.get(ref.token0.toLowerCase())
    const token1 = addressToSymbol.get(ref.token1.toLowerCase())
    if (!token0 || !token1) continue
    let volume24 = 0
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/robinhood/${ref.address}`)
      const body = await response.json() as { pairs?: { volume?: { h24?: number } }[] }
      volume24 = Number(body.pairs?.[0]?.volume?.h24 ?? 0)
    } catch { continue }
    if (volume24 < MIN_EXTERNAL_VOLUME_USD) continue
    if (uniswapV3Refs.has(ref.address.toLowerCase())) continue
    uniswapV3Refs.set(ref.address.toLowerCase(), ref)
    ARB_POOLS.push({
      name: `UniV3 ${token0}/${token1} ${ref.fee}`,
      address: ref.address, token0, token1,
      feeBps: (BigInt(ref.fee) + 99n) / 100n,
      isUniV2: false, kind: 'uniV3', v3Fee: ref.fee,
    })
    added++
  }
  return added
}

async function discoverHighVolumeUniswapV4Pools(): Promise<number> {
  const symbols = (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).filter(sym =>
    sym !== 'ETH' && (MANUAL_EXTERNAL_TOKENS.has(sym) || sym === 'WETH' || sym === 'USDG' || !AGGREGATOR_EXCLUDE.has(String(sym))),
  )
  const weth = getAddress(TOKENS.WETH.address)
  const refs = await discoverUniswapV4Pools(pub, symbols.map(sym => getAddress(TOKENS[sym].address)), weth, MIN_EXTERNAL_VOLUME_USD)
  const addressToSymbol = new Map(symbols.map(sym => [TOKENS[sym].address.toLowerCase(), sym]))
  let added = 0
  for (const ref of refs) {
    const token0 = addressToSymbol.get(ref.token0.toLowerCase())
    const token1 = addressToSymbol.get(ref.token1.toLowerCase())
    if (!token0 || !token1) continue
    if (uniswapV4Refs.has(ref.id.toLowerCase())) continue
    uniswapV4Refs.set(ref.id.toLowerCase(), ref)
    ARB_POOLS.push({
      name: `UniV4 ${token0}/${token1} ${ref.fee}`,
      address: UNISWAP_V4.poolManager, token0, token1,
      feeBps: (BigInt(ref.fee) + 99n) / 100n,
      isUniV2: false, kind: 'uniV4',
      v4PoolId: ref.id, v4Fee: ref.fee, v4TickSpacing: ref.tickSpacing, v4Hooks: ref.hooks, v4Native: ref.native,
    })
    added++
  }
  return added
}

const CANONICAL_V2_PAIR_ABI = [
  { name: 'factory', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' },
  ] },
] as const

function poolAlreadyTracked(kind: PoolKind, address: string, v4PoolId?: string): boolean {
  if (kind === 'uniV4') {
    return !!v4PoolId && ARB_POOLS.some(pool => pool.kind === 'uniV4' && pool.v4PoolId?.toLowerCase() === v4PoolId.toLowerCase())
  }
  return ARB_POOLS.some(pool => pool.address.toLowerCase() === address.toLowerCase())
}

function dexPairKind(pair: DexScreenerPair): 'v2' | 'v3' | 'v4' | null {
  for (const label of pair.labels ?? []) {
    const normalized = label.toLowerCase()
    if (normalized === 'v2' || normalized === 'v3' || normalized === 'v4') return normalized
  }
  return null
}

async function addDiscoveredV2Pools(pairs: DexScreenerPair[]): Promise<number> {
  const candidates = pairs.filter(pair => dexPairKind(pair) === 'v2' && /^0x[0-9a-fA-F]{40}$/.test(pair.pairAddress ?? ''))
    .filter(pair => !poolAlreadyTracked('uniV2', pair.pairAddress!))
    .slice(0, EXTERNAL_DISCOVERY_MAX_POOLS)
  if (candidates.length === 0) return 0

  const metadata = await chunkedMulticall(candidates.flatMap(pair => {
    const address = getAddress(pair.pairAddress!)
    return [
      { address, abi: CANONICAL_V2_PAIR_ABI, functionName: 'factory' as const },
      { address, abi: CANONICAL_V2_PAIR_ABI, functionName: 'token0' as const },
      { address, abi: CANONICAL_V2_PAIR_ABI, functionName: 'token1' as const },
      { address, abi: CANONICAL_V2_PAIR_ABI, functionName: 'getReserves' as const },
    ]
  }))
  const addressMap = runtimeTokenByAddress()
  let added = 0
  for (let i = 0; i < candidates.length; i++) {
    const values = metadata.slice(i * 4, i * 4 + 4)
    if (values.some(value => value?.status !== 'success')) continue
    if (String(values[0].result).toLowerCase() !== UNISWAP_V2_FACTORY.toLowerCase()) continue
    const token0 = addressMap.get(String(values[1].result).toLowerCase())
    const token1 = addressMap.get(String(values[2].result).toLowerCase())
    const reserves = values[3].result as readonly [bigint, bigint, number]
    if (!token0 || !token1 || reserves[0] <= 0n || reserves[1] <= 0n) continue
    if (UNISWAP_UNSUPPORTED_TOKENS.has(token0) || UNISWAP_UNSUPPORTED_TOKENS.has(token1)) continue
    const address = getAddress(candidates[i].pairAddress!)
    if (poolAlreadyTracked('uniV2', address)) continue
    ARB_POOLS.push({
      name: `UniV2 ${token0}/${token1}`,
      address,
      token0,
      token1,
      feeBps: UNISWAP_FEE_BPS,
      isUniV2: true,
      kind: 'uniV2',
    })
    added++
  }
  return added
}

async function addDiscoveredV3Pools(pairs: DexScreenerPair[]): Promise<number> {
  const candidates = pairs.filter(pair => dexPairKind(pair) === 'v3' && /^0x[0-9a-fA-F]{40}$/.test(pair.pairAddress ?? ''))
    .filter(pair => !poolAlreadyTracked('uniV3', pair.pairAddress!))
    .slice(0, EXTERNAL_DISCOVERY_MAX_POOLS)
  if (candidates.length === 0) return 0

  const metadata = await chunkedMulticall(candidates.flatMap(pair => {
    const address = getAddress(pair.pairAddress!)
    return [
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'factory' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'fee' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'token0' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'token1' as const },
      { address, abi: UNISWAP_V3_POOL_ABI, functionName: 'liquidity' as const },
    ]
  }))
  const addressMap = runtimeTokenByAddress()
  let added = 0
  for (let i = 0; i < candidates.length; i++) {
    const values = metadata.slice(i * 5, i * 5 + 5)
    if (values.some(value => value?.status !== 'success')) continue
    if (String(values[0].result).toLowerCase() !== UNISWAP_V3.factory.toLowerCase()) continue
    const fee = Number(values[1].result)
    const token0 = addressMap.get(String(values[2].result).toLowerCase())
    const token1 = addressMap.get(String(values[3].result).toLowerCase())
    const liquidity = BigInt(values[4].result as bigint)
    if (!token0 || !token1 || liquidity <= 0n) continue
    const address = getAddress(candidates[i].pairAddress!)
    if (poolAlreadyTracked('uniV3', address)) continue
    const ref: UniswapV3PoolRef = {
      address,
      token0: getAddress(runtimeTokens[token0].address),
      token1: getAddress(runtimeTokens[token1].address),
      fee,
      liquidity,
    }
    uniswapV3Refs.set(address.toLowerCase(), ref)
    ARB_POOLS.push({
      name: `UniV3 ${token0}/${token1} ${fee}`,
      address,
      token0,
      token1,
      feeBps: (BigInt(fee) + 99n) / 100n,
      isUniV2: false,
      kind: 'uniV3',
      v3Fee: fee,
    })
    added++
  }
  return added
}

async function addDiscoveredV4Pools(pairs: DexScreenerPair[]): Promise<number> {
  const candidates = pairs.filter(pair => dexPairKind(pair) === 'v4' && /^0x[0-9a-fA-F]{64}$/.test(pair.pairAddress ?? ''))
    .filter(pair => !poolAlreadyTracked('uniV4', UNISWAP_V4.poolManager, pair.pairAddress))
    .slice(0, EXTERNAL_DISCOVERY_MAX_POOLS)
  if (candidates.length === 0) return 0

  const logs: any[] = []
  for (let i = 0; i < candidates.length; i += 40) {
    const ids = candidates.slice(i, i + 40).map(pair => pair.pairAddress as `0x${string}`)
    try {
      const batch = await pub.getLogs({
        address: UNISWAP_V4.poolManager,
        event: UNISWAP_V4_INITIALIZE_EVENT,
        args: { id: ids },
        fromBlock: V4_POOL_MANAGER_DEPLOY_BLOCK,
        toBlock: 'latest',
      } as any)
      logs.push(...batch)
    } catch { /* an individual bad/indexer-limited batch must not stop V2/V3 coverage */ }
  }
  const byId = new Map(logs.map(log => [String(log.args?.id ?? '').toLowerCase(), log.args]))
  const resolved = candidates.map(pair => ({ pair, args: byId.get(pair.pairAddress!.toLowerCase()) })).filter(item => !!item.args)
  const liquidity = await chunkedMulticall(resolved.map(item => ({
    address: UNISWAP_V4.stateView,
    abi: UNISWAP_V4_STATE_VIEW_ABI,
    functionName: 'getLiquidity' as const,
    args: [item.pair.pairAddress as `0x${string}`] as const,
  })))
  const addressMap = runtimeTokenByAddress()
  let added = 0
  for (let i = 0; i < resolved.length; i++) {
    const result = liquidity[i]
    const args = resolved[i].args as any
    if (result?.status !== 'success' || BigInt(result.result as bigint) <= 0n) continue
    // Unknown hooks may change accounting or require hookData the executor
    // does not possess. Existing explicitly certified hooked pools remain in
    // the curated seed; dynamic chain-wide discovery admits unhooked V4 only.
    if (String(args.hooks).toLowerCase() !== NATIVE_CURRENCY.toLowerCase()) continue
    const currency0 = getAddress(args.currency0)
    const currency1 = getAddress(args.currency1)
    const native = currency0.toLowerCase() === NATIVE_CURRENCY.toLowerCase()
    const token0Address = native ? getAddress(TOKENS.WETH.address) : currency0
    const token0 = addressMap.get(token0Address.toLowerCase())
    const token1 = addressMap.get(currency1.toLowerCase())
    if (!token0 || !token1) continue
    const id = resolved[i].pair.pairAddress as `0x${string}`
    if (poolAlreadyTracked('uniV4', UNISWAP_V4.poolManager, id)) continue
    const ref: UniswapV4PoolRef = {
      id,
      token0: token0Address,
      token1: currency1,
      currency0,
      currency1,
      fee: Number(args.fee),
      tickSpacing: Number(args.tickSpacing),
      hooks: getAddress(args.hooks),
      native,
      volume24: Number(resolved[i].pair.volume?.h24 ?? 0),
    }
    uniswapV4Refs.set(id.toLowerCase(), ref)
    ARB_POOLS.push({
      name: `UniV4 ${token0}/${token1} ${ref.fee}`,
      address: UNISWAP_V4.poolManager,
      token0,
      token1,
      feeBps: (BigInt(ref.fee) + 99n) / 100n,
      isUniV2: false,
      kind: 'uniV4',
      v4PoolId: id,
      v4Fee: ref.fee,
      v4TickSpacing: ref.tickSpacing,
      v4Hooks: ref.hooks,
      v4Native: native,
    })
    added++
  }
  return added
}

async function discoverRobinhoodUniswapUniverse(): Promise<{ v2: number; v3: number; v4: number }> {
  const pairs = await crawlRobinhoodUniswapPairs()
  const v2 = await addDiscoveredV2Pools(pairs)
  const v3 = await addDiscoveredV3Pools(pairs)
  const v4 = await addDiscoveredV4Pools(pairs)
  return { v2, v3, v4 }
}

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
  { name: 'token1', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
  { name: 'feeBps', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint24' }] },
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
// Keep per-endpoint failure detection short: discovery performs hundreds of
// reads, so an unhealthy primary must fail over in seconds, not multiply an
// 8s timeout across the entire pool set.
const rpcTransport = fallback(RPC_URLS.map(url => http(url, { timeout: 8_000, retryCount: 1 }))) as unknown as ReturnType<typeof http>
const pub = createPublicClient({ chain: robinhoodChain, transport: rpcTransport })
const wsTransport = WEBSOCKET_SCANNING
  ? webSocket(WS_RPC_URL, {
      keepAlive: true,
      // The keeper owns exponential reconnection below. Disabling the
      // transport's nested retry loop avoids multiplying a single provider
      // 429 into several immediate failed handshakes.
      reconnect: false,
      retryCount: 0,
      timeout: 8_000,
    })
  : null
const wsPub = wsTransport ? createPublicClient({ chain: robinhoodChain, transport: wsTransport }) : null

// Nonce reads stay on the full JSON-RPC endpoint. Signed raw transactions go
// directly to Robinhood's sequencer endpoint, avoiding an extra provider hop.
// The sequencer intentionally exposes eth_sendRawTransaction only, so every
// transaction is fully prepared (nonce, fees and gas) from `pub` before send.
const walletReadTransport = http(PRIMARY_RPC, { timeout: 8_000, retryCount: 1 })
const submissionTransport = http(SUBMIT_RPC, { timeout: 8_000, retryCount: 1 })
const walletRpc = createPublicClient({ chain: robinhoodChain, transport: walletReadTransport })
const wal = createWalletClient({ account, chain: robinhoodChain, transport: submissionTransport })
const providerWal = createWalletClient({ account, chain: robinhoodChain, transport: walletReadTransport })

async function submitPreparedContract(request: any): Promise<`0x${string}`> {
  try {
    return await wal.writeContract(request)
  } catch (error: any) {
    const message = String(error?.shortMessage ?? error?.message ?? error).toLowerCase()
    const transportFailure = message.includes('http request') || message.includes('fetch failed')
      || message.includes('timeout') || message.includes('not available') || message.includes('method')
    if (SUBMIT_RPC === PRIMARY_RPC || !transportFailure) throw error
    console.warn('   Direct sequencer transport unavailable; broadcasting through the primary RPC fallback')
    return providerWal.writeContract(request)
  }
}

function enforcePoolUniverseForRole() {
  if (KEEPER_ROLE !== 'aeon-only' && KEEPER_ROLE !== 'external-only' && KEEPER_ROLE !== 'external-first') return
  for (let i = ARB_POOLS.length - 1; i >= 0; i--) {
    const isAeonPool = isAeonPoolKind(ARB_POOLS[i].kind)
    if (
      (KEEPER_ROLE === 'aeon-only' && !isAeonPool)
      || (KEEPER_ROLE === 'external-only' && isAeonPool)
      || (KEEPER_ROLE === 'external-first' && isAeonPool && !isErzaAeonBridgePool(ARB_POOLS[i]))
    ) ARB_POOLS.splice(i, 1)
  }
}

// Do not rely on the website's static pool manifest for the defender. Read
// both AEON factories so every compatible, known-token vAMM pool becomes
// tradeable automatically after it is created. Directly deployed legacy
// pools remain covered by the static seed and are de-duplicated here.
async function discoverAeonVammPools(): Promise<number> {
  const factories = [CONTRACTS.AeonFactory, CONTRACTS.AeonFactoryV2]
  const lengths = await pub.multicall({
    contracts: factories.map(address => ({ address, abi: AEON_FACTORY_ABI, functionName: 'allPoolsLength' as const })),
    allowFailure: true,
  })
  const poolCalls: any[] = []
  for (let fi = 0; fi < factories.length; fi++) {
    const lengthResult = lengths[fi]
    if (lengthResult?.status !== 'success') continue
    const length = Number(lengthResult.result)
    for (let i = 0; i < length; i++) {
      poolCalls.push({ address: factories[fi], abi: AEON_FACTORY_ABI, functionName: 'allPools' as const, args: [BigInt(i)] as const })
    }
  }
  if (poolCalls.length === 0) return 0
  const poolResults = await chunkedMulticall(poolCalls)
  const addresses = Array.from(new Set(poolResults
    .filter(result => result?.status === 'success')
    .map(result => getAddress(result.result as `0x${string}`))))
    .filter(address => !ARB_POOLS.some(pool => pool.address.toLowerCase() === address.toLowerCase()))
  if (addresses.length === 0) return 0

  const metadata = await chunkedMulticall(addresses.flatMap(address => [
    { address, abi: PAIR_ABI, functionName: 'token0' as const },
    { address, abi: PAIR_ABI, functionName: 'token1' as const },
    { address, abi: PAIR_ABI, functionName: 'feeBps' as const },
  ]))
  const addressToSymbol = new Map<string, keyof typeof TOKENS>()
  for (const symbol of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    addressToSymbol.set(TOKENS[symbol].address.toLowerCase(), symbol)
  }

  let added = 0
  for (let i = 0; i < addresses.length; i++) {
    const token0Result = metadata[i * 3]
    const token1Result = metadata[i * 3 + 1]
    const feeResult = metadata[i * 3 + 2]
    if (token0Result?.status !== 'success' || token1Result?.status !== 'success' || feeResult?.status !== 'success') continue
    const token0 = addressToSymbol.get(String(token0Result.result).toLowerCase())
    const token1 = addressToSymbol.get(String(token1Result.result).toLowerCase())
    if (!token0 || !token1) continue
    ARB_POOLS.push({
      name: `AEON ${token0}/${token1}`,
      address: addresses[i], token0, token1,
      feeBps: BigInt(feeResult.result as bigint),
      isUniV2: false, kind: 'vAMM',
    })
    added++
  }
  return added
}

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
    if (ARB_POOLS.some(p => p.address.toLowerCase() === address)) continue
    ARB_POOLS.push({
      name: `Uniswap ${source.token0}/${source.token1}`,
      address: getAddress(address),
      token0: source.token0,
      token1: source.token1,
      feeBps: UNISWAP_FEE_BPS,
      isUniV2: true,
      kind: 'uniV2',
    })
    added++
  }
  return added
}

// Algebra Integral (CL) pools don't expose token0/token1 in the shared
// ALGEBRA_POOL_ABI (the frontend never needed them there -- its pairs are
// already known statically), but the bot resolves them dynamically here.
const CL_POOL_ABI = [
  ...ALGEBRA_POOL_ABI,
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

// AEON's own concentrated-liquidity (Algebra Integral fork, "CL") and
// bin-based (Trader Joe Liquidity Book fork, "DLMM") pools -- hidden from
// the frontend's LP-deposit UI (governor-funded rewards, not automatic
// vote-weighted emissions -- see contracts.ts's CL_POOLS/DLMM_POOLS
// comments) but still real, live, tradeable liquidity on-chain. The bot
// only ever reads prices and swaps here, never deposits, so it's unaffected
// by that reward-guarantee concern. Address list comes from
// CL_GAUGES/DLMM_GAUGES's keys (kept live/maintained, unlike the
// commented-out CL_POOLS/DLMM_POOLS arrays) -- token symbols are resolved
// on-chain rather than hand-copied, so this stays correct if more get added.
async function discoverClAndDlmmPools(): Promise<{ cl: number; dlmm: number }> {
  const addrToSymbol = new Map<string, keyof typeof TOKENS>()
  for (const sym of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) {
    addrToSymbol.set(TOKENS[sym].address.toLowerCase(), sym)
  }

  const clAddresses = Object.keys(CL_GAUGES) as `0x${string}`[]
  const dlmmAddresses = Object.keys(DLMM_GAUGES) as `0x${string}`[]
  let clAdded = 0, dlmmAdded = 0

  if (clAddresses.length > 0) {
    const calls = clAddresses.flatMap(addr => [
      { address: addr, abi: CL_POOL_ABI, functionName: 'token0' as const },
      { address: addr, abi: CL_POOL_ABI, functionName: 'token1' as const },
    ])
    const results = await pub.multicall({ contracts: calls, allowFailure: true })
    for (let i = 0; i < clAddresses.length; i++) {
      const t0R = results[i * 2], t1R = results[i * 2 + 1]
      if (t0R?.status !== 'success' || t1R?.status !== 'success') continue
      const sym0 = addrToSymbol.get((t0R.result as string).toLowerCase())
      const sym1 = addrToSymbol.get((t1R.result as string).toLowerCase())
      if (!sym0 || !sym1) continue   // one side isn't a token this bot knows/trades
      if (ARB_POOLS.some(p => p.address.toLowerCase() === clAddresses[i].toLowerCase())) continue
      ARB_POOLS.push({
        name: `CL ${sym0}/${sym1}`, address: clAddresses[i],
        token0: sym0, token1: sym1, feeBps: 0n, isUniV2: false, kind: 'CL',
      })
      clAdded++
    }
  }

  if (dlmmAddresses.length > 0) {
    const calls = dlmmAddresses.flatMap(addr => [
      { address: addr, abi: LB_PAIR_ABI, functionName: 'getTokenX' as const },
      { address: addr, abi: LB_PAIR_ABI, functionName: 'getTokenY' as const },
      { address: addr, abi: LB_PAIR_ABI, functionName: 'getBinStep' as const },
    ])
    const results = await pub.multicall({ contracts: calls, allowFailure: true })
    for (let i = 0; i < dlmmAddresses.length; i++) {
      const xR = results[i * 3], yR = results[i * 3 + 1], bR = results[i * 3 + 2]
      if (xR?.status !== 'success' || yR?.status !== 'success' || bR?.status !== 'success') continue
      const symX = addrToSymbol.get((xR.result as string).toLowerCase())
      const symY = addrToSymbol.get((yR.result as string).toLowerCase())
      if (!symX || !symY) continue
      const binStep = Number(bR.result)
      // Real on-chain fee = baseFactor(5000) * binStep / 1e8 -- i.e. 0.5 bps
      // per unit of binStep (verified against every live pool, see
      // contracts.ts's DLMM_POOLS comment). Rounded UP since this feeBps
      // only feeds LOCAL sizing math, never the actual on-chain swap --
      // understating it would just size trades that fail the real
      // amountOutMin check more often than necessary, not lose money.
      const feeBps = BigInt(Math.max(1, Math.ceil(binStep * 0.5)))
      if (ARB_POOLS.some(p => p.address.toLowerCase() === dlmmAddresses[i].toLowerCase())) continue
      ARB_POOLS.push({
        name: `DLMM ${symX}/${symY}`, address: dlmmAddresses[i],
        token0: symX, token1: symY, feeBps, isUniV2: false, kind: 'DLMM', binStep,
      })
      dlmmAdded++
    }
  }

  return { cl: clAdded, dlmm: dlmmAdded }
}

// ─── Math (mirrors AeonPoolRH.swap()'s own constant-product formula) ─────────

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

// ─── Pool state ───────────────────────────────────────────────────────────────

interface PoolState {
  pool: PoolConfig
  r0: bigint
  r1: bigint
  onchain0: string
  effFeeBps: bigint   // this tick's actual fee -- static for vAMM/UniV2/DLMM, live-read for CL (Algebra's fee is dynamic)
}

// V4 pools all share PoolManager as their contract address, so their pool id
// is the only stable cache/event identity. Every other venue has one contract
// address per pool.
function poolStateKey(pool: PoolConfig): string {
  return pool.kind === 'uniV4' && pool.v4PoolId
    ? `v4:${pool.v4PoolId.toLowerCase()}`
    : `pool:${pool.address.toLowerCase()}`
}

// Chunk to stay well under any single RPC's multicall gas/size ceiling.
const MULTICALL_CHUNK = 120
async function chunkedMulticall(contracts: any[]): Promise<any[]> {
  const results: any[] = []
  for (let i = 0; i < contracts.length; i += MULTICALL_CHUNK) {
    const batch = await pub.multicall({ contracts: contracts.slice(i, i + MULTICALL_CHUNK) as any, allowFailure: true })
    results.push(...batch)
  }
  return results
}

async function fetchPoolStates(pools: PoolConfig[]): Promise<PoolState[]> {
  const vammPools = pools.filter(p => p.kind === 'vAMM' || p.kind === 'uniV2')
  const v3Pools   = pools.filter(p => p.kind === 'uniV3')
  const v4Pools   = pools.filter(p => p.kind === 'uniV4')
  const clPools   = pools.filter(p => p.kind === 'CL')
  const dlmmPools = pools.filter(p => p.kind === 'DLMM')

  const vammContracts = vammPools.flatMap(p => [
    { address: p.address, abi: PAIR_ABI, functionName: 'getReserves' as const },
    { address: p.address, abi: PAIR_ABI, functionName: 'token0'      as const },
  ])
  const clContracts = clPools.flatMap(p => [
    { address: p.address, abi: ALGEBRA_POOL_ABI, functionName: 'globalState' as const },
    { address: p.address, abi: ALGEBRA_POOL_ABI, functionName: 'liquidity'   as const },
  ])
  const dlmmActiveIdContracts = dlmmPools.map(p => ({
    address: p.address, abi: LB_PAIR_ABI, functionName: 'getActiveId' as const,
  }))
  const v3Contracts = v3Pools.flatMap(p => [
    { address: p.address, abi: UNISWAP_V3_POOL_ABI, functionName: 'slot0' as const },
    { address: p.address, abi: UNISWAP_V3_POOL_ABI, functionName: 'liquidity' as const },
  ])
  const v4Contracts = v4Pools.flatMap(p => [
    { address: UNISWAP_V4.stateView, abi: UNISWAP_V4_STATE_VIEW_ABI, functionName: 'getSlot0' as const, args: [p.v4PoolId!] as const },
    { address: UNISWAP_V4.stateView, abi: UNISWAP_V4_STATE_VIEW_ABI, functionName: 'getLiquidity' as const, args: [p.v4PoolId!] as const },
  ])

  const results = await chunkedMulticall([...vammContracts, ...clContracts, ...dlmmActiveIdContracts, ...v3Contracts, ...v4Contracts])
  const vammResults     = results.slice(0, vammContracts.length)
  const clResults       = results.slice(vammContracts.length, vammContracts.length + clContracts.length)
  const afterCl = vammContracts.length + clContracts.length
  const activeIdResults = results.slice(afterCl, afterCl + dlmmActiveIdContracts.length)
  const v3Start = afterCl + dlmmActiveIdContracts.length
  const v3Results = results.slice(v3Start, v3Start + v3Contracts.length)
  const v4Results = results.slice(v3Start + v3Contracts.length)

  const vammStates: PoolState[] = vammPools.map((pool, i) => {
    const resD  = vammResults[i * 2]
    const tok0D = vammResults[i * 2 + 1]
    const reserves = resD?.status  === 'success' ? resD.result  as [bigint, bigint, number] : null
    const onchain0  = tok0D?.status === 'success' ? (tok0D.result as string).toLowerCase() : ''
    return { pool, r0: reserves?.[0] ?? 0n, r1: reserves?.[1] ?? 0n, onchain0, effFeeBps: pool.feeBps }
  })

  const clStates: PoolState[] = clPools.map((pool, i) => {
    const gsD  = clResults[i * 2]
    const liqD = clResults[i * 2 + 1]
    const global = gsD?.status === 'success' ? gsD.result as readonly [bigint, number, number, number, number, boolean] : null
    const liquidity = liqD?.status === 'success' ? liqD.result as bigint : 0n
    const sqrtPriceX96 = global?.[0] ?? 0n
    if (!global || liquidity === 0n || sqrtPriceX96 === 0n) {
      return { pool, r0: 0n, r1: 0n, onchain0: '', effFeeBps: 0n }
    }
    // Standard concentrated-liquidity "virtual reserves": treats the
    // CURRENT tick's liquidity as an x*y=L^2 constant-product pool, exact
    // as long as a trade doesn't cross into the next tick. Beyond that this
    // undercounts real depth (multi-tick liquidity isn't visible here at
    // all), which only ever makes local sizing UNDERSTATE what's tradeable
    // -- the on-chain amountOutMin/simulateContract gate in
    // executeArbViaUniversalRouter/executeSettlementSwap is what actually
    // protects real funds either way, same as every other pool kind here.
    const virtualR0 = (liquidity << 96n) / sqrtPriceX96
    const virtualR1 = (liquidity * sqrtPriceX96) >> 96n
    // globalState().lastFee is Algebra's fee in parts-per-million (same
    // scale Uniswap V3's uint24 fee uses, just narrowed to uint16 since a
    // dynamic-fee pool here never needs more than ~6.5%) -- divided by 100
    // for bps, rounded up for the same "never understate the real fee in
    // local sizing" reason as DLMM's feeBps in discoverClAndDlmmPools().
    const effFeeBps = (BigInt(global[2]) + 99n) / 100n
    // Discovery already resolved token0/token1 to match on-chain order
    // exactly (see discoverClAndDlmmPools), so virtualR0 always IS
    // pool.token0's reserve -- no separate ordering check needed here.
    return { pool, r0: virtualR0, r1: virtualR1, onchain0: TOKENS[pool.token0].address.toLowerCase(), effFeeBps }
  })

  const activeIds = dlmmPools.map((_, i) => {
    const idD = activeIdResults[i]
    return idD?.status === 'success' ? idD.result as number : null
  })
  const dlmmBinContracts = dlmmPools
    .map((p, i) => (activeIds[i] !== null ? { address: p.address, abi: LB_PAIR_ABI, functionName: 'getBin' as const, args: [activeIds[i]!] as const } : null))
  const dlmmBinIdxs = dlmmBinContracts.map((c, i) => (c ? i : -1)).filter(i => i >= 0)
  const binResults = dlmmBinIdxs.length > 0
    ? await chunkedMulticall(dlmmBinIdxs.map(i => dlmmBinContracts[i]!))
    : []

  const dlmmStates: PoolState[] = dlmmPools.map((pool, i) => {
    const idxInValid = dlmmBinIdxs.indexOf(i)
    const binD = idxInValid >= 0 ? binResults[idxInValid] : null
    const bin = binD?.status === 'success' ? binD.result as [bigint, bigint] : null
    const activeId = activeIds[i]
    if (!bin || activeId === null || pool.binStep === undefined) {
      return { pool, r0: 0n, r1: 0n, onchain0: '', effFeeBps: 0n }
    }
    // A DLMM bin's raw reserveX/reserveY ratio does NOT encode price the
    // way a constant-product pool's does -- each bin trades at a FIXED
    // price set purely by its id and binStep, and X+Y can coexist in any
    // proportion an LP happened to deposit within it. Using the raw ratio
    // as if it were a price (as an earlier version of this code did) was
    // cross-checked against the real on-chain LBRouter.getSwapOut() quoter
    // before shipping and was off by >200x. The correct LB price formula
    // (price = (1+binStep/1e4)^(id-2^23), Y raw units per X raw unit) was
    // verified to match getSwapOut() within fee/rounding tolerance instead.
    // Anchoring virtual reserves on the REAL X-side bin reserve (genuine
    // on-chain depth) and deriving Y from that formula keeps the resulting
    // pair usable by the same constant-product amtOut/amtIn math every
    // other pool kind here uses, with a spot price that's actually correct.
    const price = Math.pow(1 + pool.binStep / 10000, activeId - 8388608)
    const virtualR0 = bin[0]
    const virtualR1 = BigInt(Math.floor(Number(bin[0]) * price))
    return { pool, r0: virtualR0, r1: virtualR1, onchain0: TOKENS[pool.token0].address.toLowerCase(), effFeeBps: pool.feeBps }
  })

  const v3States: PoolState[] = v3Pools.map((pool, i) => {
    const slotD = v3Results[i * 2], liqD = v3Results[i * 2 + 1]
    const slot = slotD?.status === 'success' ? slotD.result as readonly [bigint, number, number, number, number, number, boolean] : null
    const liquidity = liqD?.status === 'success' ? liqD.result as bigint : 0n
    const sqrtPriceX96 = slot?.[0] ?? 0n
    if (sqrtPriceX96 === 0n || liquidity === 0n) return { pool, r0: 0n, r1: 0n, onchain0: '', effFeeBps: pool.feeBps }
    return {
      pool,
      r0: (liquidity << 96n) / sqrtPriceX96,
      r1: (liquidity * sqrtPriceX96) >> 96n,
      onchain0: TOKENS[pool.token0].address.toLowerCase(),
      effFeeBps: pool.feeBps,
    }
  })

  const v4States: PoolState[] = v4Pools.map((pool, i) => {
    const slotD = v4Results[i * 2], liqD = v4Results[i * 2 + 1]
    const slot = slotD?.status === 'success' ? slotD.result as readonly [bigint, number, number, number] : null
    const liquidity = liqD?.status === 'success' ? liqD.result as bigint : 0n
    const sqrtPriceX96 = slot?.[0] ?? 0n
    if (sqrtPriceX96 === 0n || liquidity === 0n) return { pool, r0: 0n, r1: 0n, onchain0: '', effFeeBps: pool.feeBps }
    return {
      pool,
      r0: (liquidity << 96n) / sqrtPriceX96,
      r1: (liquidity * sqrtPriceX96) >> 96n,
      onchain0: TOKENS[pool.token0].address.toLowerCase(),
      effFeeBps: (BigInt(slot?.[3] ?? Number(pool.feeBps) * 100) + 99n) / 100n,
    }
  })

  return [...vammStates, ...clStates, ...dlmmStates, ...v3States, ...v4States].filter(s => s.r0 > 0n && s.r1 > 0n && hasRealLiquidity(s))
}

// State is immutable within a block and only pools that emitted logs since
// the previous scan can have changed. Keep the last good snapshot and replace
// just those entries. A missing refreshed state removes the old entry, so a
// pool that loses usable liquidity cannot remain tradeable from stale cache.
const poolStateCache = new Map<string, PoolState>()
const knownPoolStateKeys = new Set<string>()
let poolStateCacheReady = false

async function fetchAllStates(changedPoolKeys?: Set<string>): Promise<PoolState[]> {
  const poolsToFetch = !poolStateCacheReady || !changedPoolKeys
    ? [...ARB_POOLS]
    : ARB_POOLS.filter(pool => changedPoolKeys.has(poolStateKey(pool)) || !knownPoolStateKeys.has(poolStateKey(pool)))

  if (poolsToFetch.length > 0) {
    const refreshed = await fetchPoolStates(poolsToFetch)
    for (const pool of poolsToFetch) {
      const key = poolStateKey(pool)
      poolStateCache.delete(key)
      knownPoolStateKeys.add(key)
    }
    for (const state of refreshed) poolStateCache.set(poolStateKey(state.pool), state)
  }
  poolStateCacheReady = true

  // Preserve manifest order so route tie-breaking remains deterministic.
  return ARB_POOLS.map(pool => poolStateCache.get(poolStateKey(pool))).filter((state): state is PoolState => !!state)
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
  gasCostUsd?: number
  routeScore?: number
  reliabilityPct?: number
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
  gasCostUsd?: number
  routeScore?: number
  reliabilityPct?: number
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
    amt = amtOut(amt, h.reserveIn, h.reserveOut, h.pool.effFeeBps)
    if (amt === 0n) return 0n
  }
  return amt
}

// Constant-product output is concave: if the fee-adjusted infinitesimal
// exchange rate of a closed route is not above 1, no larger input can make
// that route profitable. Reject it before the comparatively expensive
// ternary sizer. This is exact integer ratio math, not a floating-point or
// heuristic filter, so it cannot discard a profitable route under the same
// reserve model used by cycleOut().
function hasPositiveMarginalEdge(hops: HopCandidate[]): boolean {
  let numerator = 1n
  let denominator = 1n
  for (const hop of hops) {
    const feeFactor = 10_000n - hop.pool.effFeeBps
    if (feeFactor <= 0n || hop.reserveIn <= 0n || hop.reserveOut <= 0n) return false
    numerator *= hop.reserveOut * feeFactor
    denominator *= hop.reserveIn * 10_000n
  }
  return numerator > denominator
}

// Generic ternary-search sizer -- works for any hop count, unlike a
// closed-form 2-hop formula, so the same function sizes both 2-hop and
// 3-hop cycles.
function optimalTrade(hops: HopCandidate[], maxIn: bigint): { amountIn: bigint; profit: bigint } {
  if (maxIn <= 1n) return { amountIn: 0n, profit: -1n }
  let lo = 0n, hi = maxIn
  // WETH-settled input ranges converge to raw-unit precision well before 48
  // ternary steps. The old 100-step loop multiplied into millions of bigint
  // route evaluations on ERZA's broad graph, making a scan ~30s stale before
  // exact quoting even began. Exact on-chain quotes and simulation remain the
  // final authority, so this only removes redundant approximate work.
  for (let i = 0; i < 48; i++) {
    const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n
    const p1 = cycleOut(m1, hops) - m1, p2 = cycleOut(m2, hops) - m2
    if (p1 < p2) lo = m1; else hi = m2
    if (hi - lo < 2n) break
  }
  const best = (lo + hi) / 2n
  return { amountIn: best, profit: cycleOut(best, hops) - best }
}

// CL/DLMM reserves are LOCAL approximations (current tick / current bin
// only -- see fetchAllStates), thinner and less reliable the further a
// trade pushes past them than a vAMM/UniV2 pool's real total reserves are.
// Capping first-hop size more tightly here reduces how often a route gets
// sized past what the real on-chain swap can actually deliver, which would
// otherwise just fail the final amountOutMin check and waste gas (never
// lose principal -- see executeArbViaUniversalRouter/executeSettlementSwap).
function sizingDivisor(kind: PoolKind): bigint {
  return kind === 'CL' || kind === 'DLMM' || kind === 'uniV3' || kind === 'uniV4' ? 20n : 4n
}

function arbOpportunityForHops(
  baseSym: keyof typeof TOKENS,
  walletBalance: bigint,
  hops: HopCandidate[],
): ArbOpp | null {
  if (!hasPositiveMarginalEdge(hops)) {
    scanTelemetry.marginalPruned++
    return null
  }
  scanTelemetry.sizedRoutes++

  const poolCap = hops[0].reserveIn / sizingDivisor(hops[0].pool.pool.kind)
  const walletCap = (walletBalance * MAX_BALANCE_USAGE_BPS) / 10_000n
  const maxIn = poolCap < walletCap ? poolCap : walletCap
  const { amountIn, profit } = optimalTrade(hops, maxIn)
  if (profit <= 0n || amountIn <= 0n) return null

  const profitPct = Number(profit * 10000n / amountIn) / 100
  if (profitPct > 50) return null

  return {
    tokenIn: TOKENS[baseSym],
    hops,
    amountIn,
    profitRaw: profit,
    profitPct,
    label: [baseSym, ...hops.map(h => h.tokenOutSym)].join('\u2192'),
  }
}

// Safety valve on the DFS below -- bails out rather than block the tick loop
// indefinitely if the pool graph ever grows dense enough for exhaustive
// simple-cycle enumeration up to MAX_HOPS to blow up combinatorially.
const MAX_DFS_VISITS = Math.max(10_000, parseInt(process.env.MAX_DFS_VISITS ?? '200000'))

function findArbs(
  graph: Map<string, HopCandidate[]>,
  baseSym: keyof typeof TOKENS,
  walletBalance: bigint,
  requiredPoolKeys?: Set<string>,
): ArbOpp[] {
  const opps: ArbOpp[] = []
  const seen = new Set<string>()
  let visits = 0
  let capped = false

  function tryOpp(hops: HopCandidate[]) {
    // Apply the dirty-pool constraint before the expensive bigint sizer.
    // Enumerating route shapes is cheap; sizing every unchanged route was the
    // measured multi-second incremental-scan bottleneck.
    if (requiredPoolKeys?.size && !hops.some(h => requiredPoolKeys.has(poolStateKey(h.pool.pool)))) return
    const key = hops.map(h => poolStateKey(h.pool.pool)).join('>')
    if (seen.has(key)) return
    seen.add(key)

    const opp = arbOpportunityForHops(baseSym, walletBalance, hops)
    if (opp) opps.push(opp)
  }

  const path: HopCandidate[] = []
  const visited = new Set<string>([baseSym])

  function dfs(currentSym: string) {
    if (capped) return
    if (++visits > MAX_DFS_VISITS) { capped = true; return }

    for (const edge of graph.get(currentSym) ?? []) {
      // Never immediately reverse through the exact same pool -- that's a
      // guaranteed loss to fees, not a candidate worth sizing.
      if (path.length > 0 && poolStateKey(edge.pool.pool) === poolStateKey(path[path.length - 1].pool.pool)) continue

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
  scanTelemetry.routeVisits += visits
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
function findSettlementRoutes(
  graph: Map<string, HopCandidate[]>,
  baseSym: keyof typeof TOKENS,
  walletBalance: bigint,
  requiredPoolKeys?: Set<string>,
): SettlementOpp[] {
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
    if (requiredPoolKeys?.size && !hops.some(hop => requiredPoolKeys.has(poolStateKey(hop.pool.pool)))) return
    const key = hops.map(h => poolStateKey(h.pool.pool)).join('>') + '=>' + endSym
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

    const poolCap = hops[0].reserveIn / sizingDivisor(hops[0].pool.pool.kind)
    const walletCap = (walletBalance * MAX_BALANCE_USAGE_BPS) / 10_000n
    const maxIn = poolCap < walletCap ? poolCap : walletCap
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
    if (profitPct > 50) return

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
      if (path.length > 0 && poolStateKey(edge.pool.pool) === poolStateKey(path[path.length - 1].pool.pool)) continue
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

// This chain confirms in a fraction of a second, so a 30% surcharge rejected
// many historically profitable routes after the exact pre-submit estimate.
// Keep a small configurable buffer, but never allow less than 100% of the
// fresh estimate: amountOutMin still enforces amountIn + estimated gas + 1.
const configuredGasSafetyPct = BigInt(process.env.GAS_SAFETY_MULT_PCT ?? '105')
const GAS_SAFETY_MULT_PCT = configuredGasSafetyPct < 100n
  ? 100n
  : configuredGasSafetyPct > 200n ? 200n : configuredGasSafetyPct
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
//
// Refreshed once at the top of every tick() (see below) instead of being
// fetched fresh inside gasCostFloorInToken() on every single candidate --
// gas price cannot meaningfully change within one tick, so re-fetching it
// per-candidate was pure redundant RPC latency (up to EXECUTION_CANDIDATES_
// PER_TICK round trips doing nothing but re-reading the same value). Pure
// speed optimization -- same value used either way, no change to which
// trades execute or how profit/gas floors are computed. Falls back to a
// live fetch if somehow read before the first tick populates it (never
// happens in normal operation).
let cachedGasPrice: bigint | null = null

async function gasCostFloorInToken(
  tokenInSym: string, tokenInAddress: `0x${string}`, hopCount: number, graph: Map<string, HopCandidate[]>, needsApproval = true,
): Promise<bigint | null> {
  const gasPrice = cachedGasPrice ?? await pub.getGasPrice()

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
  gasReserveWei: bigint
  gasReserveHealthy: boolean
}

// The reserve is never just a fixed ETH amount -- it's whichever is LARGER
// of GAS_RESERVE_ETH (a user-configured floor) and 3x a live, worst-case
// single-transaction gas estimate (deepest allowed cycle + an approval),
// at the CURRENT gas price. This is deliberately separate from
// GAS_SAFETY_MULT_PCT (which buffers whether one specific trade is
// profitable) -- this is a standing float that must never run out, so it
// gets its own, larger multiplier and reprices every tick against live gas
// prices rather than trusting a number picked once and forgotten.
const GAS_RESERVE_SAFETY_MULT = 3n
function computeMinGasReserveWei(gasPrice: bigint): bigint {
  const worstCaseGasUnits = APPROVE_GAS_FALLBACK + EXEC_ARB_BASE_GAS + EXEC_ARB_GAS_PER_HOP * BigInt(MAX_HOPS)
  const bufferedCostWei = (worstCaseGasUnits * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
  const dynamicReserveWei = bufferedCostWei * GAS_RESERVE_SAFETY_MULT
  const staticReserveWei = parseEther(String(GAS_RESERVE_ETH))
  return dynamicReserveWei > staticReserveWei ? dynamicReserveWei : staticReserveWei
}

async function fetchBalances(gasPrice: bigint): Promise<BalancesResult> {
  // ERZA settles only in WETH and every executable route is atomic, so she
  // never needs to inventory every intermediate asset on every block. Dynamic
  // discovery can add hundreds of tokens; querying all of their wallet
  // balances would turn broader coverage into an RPC bottleneck.
  const distinctSymbols = ERZA_MODE
    ? [...SETTLEMENT_TOKENS]
    : Array.from(new Set(ARB_POOLS.flatMap(p => [p.token0, p.token1])))
  const balances: Record<string, bigint> = {}
  const gasReserveWei = computeMinGasReserveWei(gasPrice)
  const balanceCalls = distinctSymbols.map(sym => ({
    address: TOKENS[sym as keyof typeof TOKENS].address,
    abi: ERC20_ABI,
    functionName: 'balanceOf' as const,
    args: [account.address] as const,
  }))
  const [balanceResults, nativeEth] = await Promise.all([
    chunkedMulticall(balanceCalls),
    pub.getBalance({ address: account.address }).catch(() => 0n),
  ])
  for (let i = 0; i < distinctSymbols.length; i++) {
    const result = balanceResults[i]
    balances[distinctSymbols[i]] = result?.status === 'success' ? BigInt(result.result as bigint) : 0n
  }
  const availableEthForWrap = nativeEth > gasReserveWei ? nativeEth - gasReserveWei : 0n

  const searchBalances = { ...balances, WETH: (balances.WETH ?? 0n) + availableEthForWrap }

  return { balances, searchBalances, nativeEth, availableEthForWrap, gasReserveWei, gasReserveHealthy: nativeEth >= gasReserveWei }
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
    // Route through writeContractTracked so the wrap uses the SAME monotonic
    // nonce discipline as every other tx -- the raw path here was the source
    // of the "nonce lower than current" failures that stopped WETH cycles.
    await writeContractTracked({
      address: TOKENS.WETH.address, abi: WETH_ABI, functionName: 'deposit', value: shortfall,
    }, 'wrap ETH->WETH')
    current = await pub.readContract({
      address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    }) as bigint
  } catch (err: any) {
    console.error(`   ⚠ Wrap failed: ${err?.shortMessage ?? err?.message ?? err}`)
  }
  return current
}

// WETH is a necessary routing token mid-trade (nearly every pool pairs
// against it), but the wallet should never REST holding it -- resting
// capital belongs in USDG, native ETH, or AEON, so any WETH balance left
// over once a tick's trading is done gets unwrapped back to ETH 1:1 (no
// market swap, no slippage, no fee, just the unwrap gas). Checked from the
// opening batched balance snapshot every trading tick, so it also catches
// WETH that arrived some other way (a manual deposit, for instance).
async function unwrapIdleWeth(knownBalance?: bigint): Promise<boolean> {
  if (DRY_RUN) return false
  const wethBal = knownBalance ?? await pub.readContract({
    address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  // Pool-liquidity dust (0.01 token) is far too large for a wallet balance:
  // it left several dollars of WETH resting and prevented native-cycle
  // sizing. Only ignore genuine transfer dust here (default 0.000001 WETH).
  const unwrapDust = parseEther(process.env.WETH_UNWRAP_DUST_ETH ?? '0.000001')
  if (wethBal < unwrapDust) return false

  console.log(`\n[${new Date().toISOString()}] Unwrapping idle WETH balance: ${formatEther(wethBal)} WETH → ETH`)
  try {
    await writeContractTracked({
      address: TOKENS.WETH.address, abi: WETH_ABI, functionName: 'withdraw', args: [wethBal],
    }, 'unwrap idle WETH')
    return true
  } catch (err: any) {
    console.error(`   ⚠ Unwrap failed: ${err?.shortMessage ?? err?.message ?? err}`)
    return false
  }
}

let lastGasRefillAttempt = 0

// The configured reserve is an operating target, not a trading shutdown.
// When native ETH drops below it, unwrap WETH 1:1 (no market swap or price
// impact) and resume. The refill includes a buffered estimate of its own gas
// and prefers a 20% cushion, but will accept the exact minimum when WETH is
// tight. It never sells another token or weakens the arb profit floor.
async function ensureNativeGasReserve(
  nativeEth: bigint, gasReserveWei: bigint, gasPrice: bigint, graph: Map<string, HopCandidate[]>,
): Promise<boolean> {
  if (nativeEth >= gasReserveWei) return true
  if (DRY_RUN) return false
  if (Date.now() - lastGasRefillAttempt < GAS_REFILL_RETRY_MS) return false
  lastGasRefillAttempt = Date.now()

  let currentNative = nativeEth
  let wethBalance = await pub.readContract({
    address: TOKENS.WETH.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint

  const withdrawGas = await pub.estimateContractGas({
    account: account.address,
    address: TOKENS.WETH.address,
    abi: WETH_ABI,
    functionName: 'withdraw',
    args: [1n],
  }).catch(() => 55_000n)
  const refillGasCost = (withdrawGas * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
  if (currentNative <= refillGasCost) {
    console.error(`   ⚠ Cannot self-refill gas: native ETH is below the buffered cost of an unwrap transaction`)
    return false
  }

  const targetWei = (gasReserveWei * GAS_REFILL_TARGET_BPS) / 10_000n
  let minimumUnwrap = gasReserveWei - currentNative + refillGasCost
  let preferredUnwrap = targetWei - currentNative + refillGasCost
  // A settlement trade can legitimately leave the wallet with USDG/AEON
  // and almost no WETH. Buy a small WETH operating buffer from USDG first,
  // then unwrap it. This is maintenance funding, never part of arb P&L.
  if (wethBalance < minimumUnwrap) {
    const wethOperatingTarget = preferredUnwrap + refillGasCost * 3n
    console.log(`   → WETH balance is short; buying a gas-refill buffer from USDG...`)
    wethBalance = await ensureBaseTokenFunded('WETH', wethOperatingTarget, graph)
    currentNative = await pub.getBalance({ address: account.address })
    if (currentNative <= refillGasCost) {
      console.error(`   ⚠ WETH was funded, but native ETH can no longer pay for the unwrap transaction`)
      return false
    }
    minimumUnwrap = gasReserveWei - currentNative + refillGasCost
    preferredUnwrap = targetWei - currentNative + refillGasCost
  }
  const unwrapAmount = wethBalance >= preferredUnwrap ? preferredUnwrap : minimumUnwrap
  if (wethBalance < unwrapAmount) {
    console.error(`   ⚠ Cannot self-refill gas: need ${formatEther(unwrapAmount)} WETH, have ${formatEther(wethBalance)} WETH`)
    return false
  }

  console.log(`\n[${new Date().toISOString()}] Gas reserve refill: unwrapping ${formatEther(unwrapAmount)} WETH to restore native ETH`)
  try {
    const { receipt } = await writeContractTracked({
      address: TOKENS.WETH.address,
      abi: WETH_ABI,
      functionName: 'withdraw',
      args: [unwrapAmount],
    }, 'gas reserve refill')
    if (receipt.status !== 'success') return false
    const after = await pub.getBalance({ address: account.address })
    console.log(`   ✅ Gas reserve restored to ${formatEther(after)} ETH`)
    return after >= gasReserveWei
  } catch (err: any) {
    console.error(`   ⚠ Gas reserve refill failed: ${err?.shortMessage ?? err?.message ?? err}`)
    return false
  }
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

// If neededSym's on-chain balance falls short of `needed`, tops it up by
// swapping in whichever OTHER token balance is currently worth the MOST in
// USD -- not just USDG. The bot doesn't track "which token do I happen to
// hold," it tracks total dollar value; an idle pile of WETH (or AEON, or
// anything else) is exactly as usable to fund a shortfall as USDG is, and
// leaving it idle instead is money left on the table. Tries the largest
// USD-value holding first via a live-ranked list, falling through to the
// next candidate if that one can't fully cover the shortfall (too small,
// or no direct reserve-exact path). Real swap, real fee/slippage, a
// genuine (small) cost not otherwise reflected in the arb's own
// profitability math -- acceptable since it only ever spends balances that
// would otherwise sit completely idle, and the swap's own amountOutMin
// means it either delivers at least `needed` extra or reverts (spending
// gas, not principal) rather than deliver less. Returns the resulting
// balance either way -- callers compare that against `needed` themselves,
// same pattern as ensureWethBalance.
async function ensureBaseTokenFunded(
  neededSym: keyof typeof TOKENS, needed: bigint, graph: Map<string, HopCandidate[]>,
): Promise<bigint> {
  let current = await pub.readContract({
    address: TOKENS[neededSym].address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (current >= needed) return current

  const shortfall = needed - current

  // Fresh read of every other token's balance -- funding only happens
  // occasionally (not every tick), so one extra multicall here is a fine
  // tradeoff for always ranking against the CURRENT wallet.
  const otherSymbols = (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).filter(sym => sym !== neededSym && sym !== 'ETH')
  const balResults = await pub.multicall({
    contracts: otherSymbols.map(sym => ({
      address: TOKENS[sym].address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [account.address] as const,
    })),
    allowFailure: true,
  })
  const candidates = otherSymbols
    .map((sym, i) => ({ sym, bal: balResults[i]?.status === 'success' ? balResults[i].result as bigint : 0n }))
    .filter(c => c.bal > 0n)
    .map(c => ({ ...c, usdValue: valueInUsdg(c.sym, c.bal, graph) }))
    .filter(c => c.usdValue > 0n)
    .sort((a, b) => (b.usdValue > a.usdValue ? 1 : b.usdValue < a.usdValue ? -1 : 0))

  for (const { sym: sourceSym, bal: sourceBal } of candidates) {
    // Maintenance funding needs a path where EVERY hop is a direct,
    // reserve-exact vAMM/UniV2 edge -- CL/DLMM/UniV3 local-liquidity
    // approximations aren't safe for sizing an exact shortfall purchase.
    const path = findConversionPath(graph, sourceSym, neededSym)
    if (!path || path.length === 0 || path.some(e => e.pool.pool.kind !== 'vAMM' && e.pool.pool.kind !== 'uniV2')) continue

    let sourceRequired = shortfall
    for (let i = path.length - 1; i >= 0; i--) {
      const edge = path[i]
      sourceRequired = amtIn(sourceRequired, edge.reserveIn, edge.reserveOut, edge.pool.effFeeBps)
      if (sourceRequired <= 0n) break
    }
    if (sourceRequired <= 0n) continue

    const sourceToSpend = (sourceRequired * FUND_SWAP_SLIPPAGE_BUFFER_PCT) / 100n
    if (sourceToSpend > sourceBal) continue   // this source alone isn't enough either -- try the next

    console.log(`   → funding ${formatUnits(shortfall, TOKENS[neededSym].decimals)} ${neededSym} by swapping ~${formatUnits(sourceToSpend, TOKENS[sourceSym].decimals)} ${sourceSym} (largest idle balance, not just USDG)...`)
    try {
      const route = buildUniversalHops(path)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

      const allowance = await pub.readContract({
        address: TOKENS[sourceSym].address, abi: ERC20_ABI, functionName: 'allowance',
        args: [account.address, CONTRACTS.UniversalRouter],
      }) as bigint
      if (allowance < sourceToSpend) {
        await writeContractTracked({
          address: TOKENS[sourceSym].address, abi: ERC20_ABI, functionName: 'approve',
          args: [CONTRACTS.UniversalRouter, MAX_UINT256],
        }, `funding approval ${neededSym} from ${sourceSym}`)
      }

      await writeContractTracked({
        address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
        args: [route, sourceToSpend, shortfall, account.address, deadline],   // amountOutMin = the exact shortfall needed
      }, `fund ${neededSym} from ${sourceSym}`)

      current = await pub.readContract({
        address: TOKENS[neededSym].address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      }) as bigint
      if (current >= needed) return current   // fully funded -- stop trying more sources
    } catch (err: any) {
      console.error(`   ⚠ Funding swap from ${sourceSym} failed: ${err?.shortMessage ?? err?.message ?? err}`)
      // fall through to the next candidate source rather than giving up entirely
    }
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
  profitToken?: string
  profitPct: number
  grossProfit?: string
  gasCost?: string
  gasCostEth?: string
  quotedProfit?: string
  realizedProfitUsd?: number
  quoteVariancePct?: number
  txHash?: string
  status: 'success' | 'failed' | 'dry-run'
  error?: string
  failureCategory?: FailureCategory
  failureStage?: FailureStage
  route: 'internal' | AggregatorSource
  venues?: string
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

type OutcomeKey = 'detected' | 'executed' | 'belowGas' | 'insufficientBalance' | 'simulationFailed' | 'staleQuote' | 'reverted'
const outcomeCounters: Record<OutcomeKey, number> = {
  detected: 0, executed: 0, belowGas: 0, insufficientBalance: 0,
  simulationFailed: 0, staleQuote: 0, reverted: 0,
}

interface PendingTransaction {
  hash: `0x${string}`
  label: string
  nonce: number
  submittedAt: string
  replacements: number
}

let pendingTransaction: PendingTransaction | null = null

function publishPendingTransaction() {
  try {
    const prior = JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
    const next = { ...prior, updatedAt: new Date().toISOString(), pendingTransaction }
    fs.writeFileSync(statusPath, JSON.stringify(next, null, 2))
    if (isBotStoreConfigured()) {
      writeBotStatus(next, BOT_ID).catch(err => console.error(`[bot store error] failed to sync pending transaction: ${err?.message ?? err}`))
    }
  } catch { /* the first full tick will create status.json */ }
}

type FailureCategory = 'stale_quote' | 'slippage' | 'allowance' | 'insufficient_balance' | 'rpc' | 'expired' | 'invalid_route' | 'venue_revert' | 'unknown'
type FailureStage = 'quote' | 'approval' | 'gas_estimate' | 'simulation' | 'submission' | 'confirmation'

interface DecodedFailure {
  category: FailureCategory
  message: string
  routeScoped: boolean
}

interface RouteHealth {
  failures: number
  cooldownUntil: number
  lastCategory: FailureCategory
}

const routeHealth = new Map<string, RouteHealth>()

function routeKey(hops: HopCandidate[]): string {
  return hops.map(h => `${h.tokenInSym}>${poolStateKey(h.pool.pool)}>${h.tokenOutSym}`).join('|')
}

interface RouteHistoryStats {
  successes: number
  failures: number
  lastSuccessAt: number
}

interface HistoricalRouteTemplate {
  tokens: string[]
  kinds: PoolKind[]
  stats: RouteHistoryStats
}

// Learn from completed closed-cycle history across both keeper wallets. The
// history is a ranking prior only: every configured pool and every new route
// still gets searched, and a rotating exploration slot still exact-quotes
// unproven families. This prevents a burst of attractive-but-unexecutable
// new routes from crowding all historically productive families out of the
// small exact-quote budget.
const routeHistory = new Map<string, RouteHistoryStats>()
const venueRouteHistory = new Map<string, RouteHistoryStats>()
const historicalRouteTemplates = new Map<string, HistoricalRouteTemplate>()

function tokenPathKey(label: string): string {
  return (label.match(/[A-Z][A-Z0-9]*/g) ?? []).join('>')
}

function tokenPathKeyFromHops(hops: HopCandidate[]): string {
  if (hops.length === 0) return ''
  return [hops[0].tokenInSym, ...hops.map(h => h.tokenOutSym)].join('>')
}

function venueSequenceFromDescription(description: string): string {
  const labels = description.match(/Uniswap V[234]|AEON CL|AEON DLMM|AEON DEX/gi) ?? []
  return labels.map(label => {
    const normalized = label.toLowerCase()
    if (normalized === 'uniswap v2') return 'uniV2'
    if (normalized === 'uniswap v3') return 'uniV3'
    if (normalized === 'uniswap v4') return 'uniV4'
    if (normalized === 'aeon cl') return 'CL'
    if (normalized === 'aeon dlmm') return 'DLMM'
    return 'vAMM'
  }).join('>')
}

function venueSequenceFromHops(hops: HopCandidate[]): string {
  return hops.map(hop => hop.pool.kind).join('>')
}

function venueSequenceAllowedForRole(sequence: string): boolean {
  const kinds = sequence.split('>').filter(Boolean) as PoolKind[]
  if (kinds.length === 0) return false
  if (KEEPER_ROLE === 'aeon-only') return kinds.every(isAeonPoolKind)
  if (KEEPER_ROLE === 'external-only') return kinds.every(kind => !isAeonPoolKind(kind))
  if (KEEPER_ROLE === 'external-first') return kinds.some(kind => !isAeonPoolKind(kind))
  if (KEEPER_ROLE === 'mirajane') return kinds.some(kind => !isAeonPoolKind(kind))
  return true
}

function recordHistoricalOutcome(
  pathKey: string,
  venueSequence: string,
  status: 'success' | 'failed',
  time: string,
) {
  const record = (history: Map<string, RouteHistoryStats>, key: string) => {
    const stats = history.get(key) ?? { successes: 0, failures: 0, lastSuccessAt: 0 }
    if (status === 'success') {
      stats.successes++
      stats.lastSuccessAt = Math.max(stats.lastSuccessAt, Date.parse(time) || 0)
    } else {
      stats.failures++
    }
    history.set(key, stats)
  }
  record(routeHistory, pathKey)
  if (venueSequence) {
    const templateKey = `${pathKey}|${venueSequence}`
    record(venueRouteHistory, templateKey)
    const tokens = pathKey.split('>').filter(Boolean)
    const kinds = venueSequence.split('>').filter(Boolean) as PoolKind[]
    if (
      tokens.length >= 3
      && tokens[0] === tokens[tokens.length - 1]
      && kinds.length === tokens.length - 1
      && venueSequenceAllowedForRole(venueSequence)
    ) {
      historicalRouteTemplates.set(templateKey, {
        tokens,
        kinds,
        stats: venueRouteHistory.get(templateKey)!,
      })
    }
  }
}

function loadRouteHistory() {
  const siblingTrades = fileURLToPath(new URL('../keeper2/trades.log', import.meta.url))
  const historyPaths = ERZA_MODE ? [tradesLogPath] : [tradesLogPath, siblingTrades]
  for (const historyPath of historyPaths) {
    if (!fs.existsSync(historyPath)) continue
    for (const line of fs.readFileSync(historyPath, 'utf-8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const trade = JSON.parse(line)
        if (trade.status !== 'success' && trade.status !== 'failed') continue
        const key = tokenPathKey(String(trade.pair ?? ''))
        const tokens = key.split('>').filter(Boolean)
        if (tokens.length < 3 || tokens[0] !== tokens[tokens.length - 1]) continue
        const venueSequence = venueSequenceFromDescription(String(trade.venues ?? ''))
        if (!venueSequenceAllowedForRole(venueSequence)) continue
        recordHistoricalOutcome(
          key,
          venueSequence,
          trade.status,
          String(trade.time ?? ''),
        )
      } catch { /* ignore a partially written or legacy log line */ }
    }
  }
}

loadRouteHistory()

function historicalStats(hops: HopCandidate[]): RouteHistoryStats {
  const pathKey = tokenPathKeyFromHops(hops)
  const venueStats = venueRouteHistory.get(`${pathKey}|${venueSequenceFromHops(hops)}`)
  return venueStats ?? routeHistory.get(pathKey) ?? { successes: 0, failures: 0, lastSuccessAt: 0 }
}

function historicalExecutionFactor(hops: HopCandidate[]): number {
  const stats = historicalStats(hops)
  const attempts = stats.successes + stats.failures
  if (stats.successes > 0) {
    const completionRate = (stats.successes + 1) / (attempts + 2)
    const evidenceBoost = Math.min(0.9, Math.log2(stats.successes + 1) * 0.16)
    return 1 + evidenceBoost * completionRate
  }
  // No exclusion: an unproven family remains searchable/explorable. Repeated
  // historical misses only stop it from monopolising execution priority.
  if (stats.failures > 0) return Math.max(0.3, 1 / (1 + stats.failures * 0.08))
  return 1
}

// Rebuild only historically completed route shapes against the current graph.
// This is a latency fast lane, never a trust shortcut: the selected variants
// still pass the same exact quote, simulation, net-profit, conflict and
// cooldown protections as every route found by the exhaustive search.
const MAX_FAST_LANE_VARIANTS_PER_TEMPLATE = 32
const MAX_FAST_LANE_OPPORTUNITIES = 24

function findHistoricalArbs(
  graph: Map<string, HopCandidate[]>,
  bases: Array<keyof typeof TOKENS>,
  walletBalances: Partial<Record<keyof typeof TOKENS, bigint>>,
  requiredPoolKeys?: Set<string>,
): ArbOpp[] {
  const baseSet = new Set<string>(bases)
  const dirty = requiredPoolKeys?.size ? requiredPoolKeys : undefined
  const seen = new Set<string>()
  const ranked: Array<{ opp: ArbOpp; stats: RouteHistoryStats }> = []
  const templates = [...historicalRouteTemplates.values()]
    .filter(template => template.stats.successes > 0)
    .sort((a, b) =>
      (b.stats.successes - a.stats.successes)
      || (b.stats.lastSuccessAt - a.stats.lastSuccessAt)
      || (a.stats.failures - b.stats.failures),
    )

  for (const template of templates) {
    const baseSym = template.tokens[0] as keyof typeof TOKENS
    const balance = walletBalances[baseSym] ?? 0n
    if (!baseSet.has(baseSym) || balance <= 0n) continue

    let variants: HopCandidate[][] = [[]]
    for (let index = 0; index < template.kinds.length && variants.length > 0; index++) {
      const tokenIn = template.tokens[index]
      const tokenOut = template.tokens[index + 1]
      const kind = template.kinds[index]
      const matchingEdges = (graph.get(tokenIn) ?? []).filter(edge =>
        edge.tokenOutSym === tokenOut && edge.pool.kind === kind,
      )
      const next: HopCandidate[][] = []
      for (const partial of variants) {
        const usedPoolKeys = new Set(partial.map(hop => poolStateKey(hop.pool.pool)))
        for (const edge of matchingEdges) {
          if (usedPoolKeys.has(poolStateKey(edge.pool.pool))) continue
          next.push([...partial, edge])
          if (next.length >= MAX_FAST_LANE_VARIANTS_PER_TEMPLATE) break
        }
        if (next.length >= MAX_FAST_LANE_VARIANTS_PER_TEMPLATE) break
      }
      variants = next
    }

    for (const hops of variants) {
      if (hops.length !== template.kinds.length) continue
      if (dirty && !hops.some(hop => dirty.has(poolStateKey(hop.pool.pool)))) continue
      const key = routeKey(hops)
      if (seen.has(key)) continue
      seen.add(key)
      const opp = arbOpportunityForHops(baseSym, balance, hops)
      if (opp) ranked.push({ opp, stats: template.stats })
    }
  }

  return ranked
    .sort((a, b) =>
      (b.stats.successes - a.stats.successes)
      || (b.stats.lastSuccessAt - a.stats.lastSuccessAt)
      || (a.stats.failures - b.stats.failures)
      || (b.opp.profitPct - a.opp.profitPct),
    )
    .slice(0, MAX_FAST_LANE_OPPORTUNITIES)
    .map(candidate => candidate.opp)
}

function decodeFailure(err: any): DecodedFailure {
  const parts = [err?.shortMessage, err?.details, err?.message, err?.cause?.shortMessage, err?.cause?.message]
    .filter(Boolean).map(String)
  const message = parts[0] ?? String(err)
  const text = parts.join(' | ').toLowerCase()

  if (text.includes('0xa5adf0af') || text.includes('notprofitable') || text.includes('0xbb2875c3') || text.includes('insufficientoutput') || text.includes('final simulation returned less')) {
    return { category: 'stale_quote', message: 'Route no longer clears its required output/profit floor', routeScoped: true }
  }
  if (text.includes('slippage') || text.includes('amountoutmin') || text.includes('too little received')) {
    return { category: 'slippage', message: 'Output moved below the protected minimum', routeScoped: true }
  }
  if (text.includes('allowance') || text.includes('transfer amount exceeds allowance') || text.includes('safe transfer from') || text.includes('stf')) {
    return { category: 'allowance', message: 'Token approval or transferFrom failed', routeScoped: false }
  }
  if (text.includes('insufficient balance') || text.includes('exceeds balance')) {
    return { category: 'insufficient_balance', message: 'Keeper balance is below the executable input', routeScoped: false }
  }
  if (text.includes('0x203d82d8') || text.includes('expired') || text.includes('deadline')) {
    return { category: 'expired', message: 'Execution deadline expired before inclusion', routeScoped: true }
  }
  if (text.includes('0x84e505d2') || text.includes('0xbfa9e1b5') || text.includes('invalidroute') || text.includes('unknownpooltype') || text.includes('notcyclic')) {
    return { category: 'invalid_route', message: 'Route shape or venue type is not executable', routeScoped: true }
  }
  if (text.includes('httprequesterror') || text.includes('http request failed') || text.includes('fetch failed') || text.includes('enotfound') || text.includes('timeout') || text.includes('429')) {
    return { category: 'rpc', message: 'RPC request failed or timed out', routeScoped: false }
  }
  if (text.includes('revert') || text.includes('execution reverted')) {
    return { category: 'venue_revert', message: message.slice(0, 240), routeScoped: true }
  }
  return { category: 'unknown', message: message.slice(0, 240), routeScoped: false }
}

function countFailureOutcome(failure: DecodedFailure, stage: FailureStage) {
  if (stage === 'simulation') outcomeCounters.simulationFailed++
  if (failure.category === 'stale_quote' || failure.category === 'slippage') outcomeCounters.staleQuote++
  else if (failure.category === 'insufficient_balance') outcomeCounters.insufficientBalance++
  else outcomeCounters.reverted++
}

function routeCooldownRemaining(hops: HopCandidate[]): number {
  const health = routeHealth.get(routeKey(hops))
  if (!health || health.cooldownUntil <= Date.now()) return 0
  return health.cooldownUntil - Date.now()
}

function registerRouteFailure(hops: HopCandidate[], failure: DecodedFailure, stage: FailureStage) {
  if (!failure.routeScoped) return
  const key = routeKey(hops)
  const previous = routeHealth.get(key)

  const preSubmissionStale = (
    failure.category === 'stale_quote' || failure.category === 'slippage'
  ) && (stage === 'quote' || stage === 'gas_estimate' || stage === 'simulation')
  if (preSubmissionStale) {
    const priorHardFailures = previous
      && previous.lastCategory !== 'stale_quote'
      && previous.lastCategory !== 'slippage'
      ? previous.failures
      : 0
    routeHealth.set(key, {
      failures: priorHardFailures,
      cooldownUntil: Date.now() + STALE_QUOTE_RETRY_MS,
      lastCategory: failure.category,
    })
    return
  }

  const failures = (previous?.failures ?? 0) + 1
  let cooldownUntil = previous?.cooldownUntil ?? 0
  if (failures >= ROUTE_FAILURE_THRESHOLD) {
    const exponent = Math.min(6, failures - ROUTE_FAILURE_THRESHOLD)
    const duration = Math.min(ROUTE_MAX_COOLDOWN_MS, ROUTE_COOLDOWN_MS * (2 ** exponent))
    cooldownUntil = Date.now() + duration
    console.warn(`   Route cooldown: ${Math.ceil(duration / 1000)}s after ${failures} ${failure.category} failures`)
  }
  routeHealth.set(key, { failures, cooldownUntil, lastCategory: failure.category })
}

function clearRouteFailure(hops: HopCandidate[]) {
  routeHealth.delete(routeKey(hops))
}

function routeReliability(hops: HopCandidate[]): number {
  const failures = routeHealth.get(routeKey(hops))?.failures ?? 0
  const venueFactor = hops.reduce((factor, hop) => {
    const kind = hop.pool.pool.kind
    const hopFactor = kind === 'vAMM' ? 1 : kind === 'uniV2' ? 0.98 : kind === 'uniV3' ? 0.95 : kind === 'uniV4' ? 0.92 : 0.9
    return factor * hopFactor
  }, 1)
  return Math.max(0.2, venueFactor * Math.pow(0.72, failures))
}

// Absolute net profit stays dominant. Reliability, hop count and first-hop
// depth only break ties between otherwise similar routes, avoiding the old
// behaviour where a fragile 8-hop quote beat a deep 2-hop route by a tiny
// percentage-point difference.
function scoreOpportunity<T extends { hops: HopCandidate[]; amountIn: bigint; reliabilityPct?: number }>(opp: T, netUsd: number): number {
  const reliability = routeReliability(opp.hops)
  const depthUsage = opp.hops[0].reserveIn > 0n ? Number(opp.amountIn * 10_000n / opp.hops[0].reserveIn) / 10_000 : 1
  const depthFactor = Math.max(0.45, 1 - depthUsage)
  const hopFactor = 1 / (1 + Math.max(0, opp.hops.length - 2) * 0.08)
  const historyFactor = historicalExecutionFactor(opp.hops)
  // ERZA may use AEON pools as part of a mixed route, but her purpose remains
  // external price discovery. A moderate score discount makes external-only
  // routes win close calls without hiding a materially better mixed profit.
  const externalFocusFactor = KEEPER_ROLE === 'external-first'
    && opp.hops.some(hop => isAeonPoolKind(hop.pool.pool.kind))
    ? 0.8
    : 1
  opp.reliabilityPct = reliability * 100
  return netUsd * reliability * depthFactor * hopFactor * historyFactor * externalFocusFactor
}

// Resume counters across restarts instead of losing history every deploy/reboot.
try {
  const prior = JSON.parse(fs.readFileSync(statusPath, 'utf-8'))
  // Gas-estimate and simulation rejections never submitted a transaction and
  // therefore are scanner diagnostics, not trades. Keep them out of Recent
  // Activity after a restart while preserving the append-only trades.log.
  recentArbs = (prior.recentArbs ?? []).filter((arb: ExecutedArb) => !(
    arb.status === 'failed'
      && (arb.failureStage === 'quote' || arb.failureStage === 'approval' || arb.failureStage === 'gas_estimate' || arb.failureStage === 'simulation')
  ))
  const knownVenuePaths: Record<string, string> = {
    '0xb9a383f6e144c898ad4255e2d2e2ed804c1043e773aabf428da0e6d3dee999d8': 'AEON DEX (AEON→WETH) → Uniswap V4 (WETH→CASHCAT) → AEON DEX (CASHCAT→AEON)',
    '0x0986a4a9dbd054f86b96600abbd18020c61057ce9dfe2bfd82551f055d982e84': 'Uniswap V4 (WETH→CASHCAT) → AEON DEX (CASHCAT→WETH)',
  }
  recentArbs = recentArbs.map(arb => ({ ...arb, venues: arb.venues ?? (arb.txHash ? knownVenuePaths[arb.txHash] : undefined) }))
  recentArbs = recentArbs.filter(arb => venueSequenceAllowedForRole(venueSequenceFromDescription(arb.venues ?? '')))
  cumulativeProfit = prior.cumulativeProfit ?? {}
  totalExecuted = prior.totalArbsExecuted ?? 0
  totalFailed = prior.totalArbsFailed ?? 0
  Object.assign(outcomeCounters, prior.outcomeCounters ?? {})
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
  if (arb.status === 'success' || arb.status === 'failed') {
    const pathKey = tokenPathKey(arb.pair)
    const tokens = pathKey.split('>').filter(Boolean)
    if (tokens.length >= 3 && tokens[0] === tokens[tokens.length - 1]) {
      recordHistoricalOutcome(pathKey, venueSequenceFromDescription(arb.venues ?? ''), arb.status, arb.time)
    }
  }
  recentArbs = [arb, ...recentArbs].slice(0, 30)
  try {
    fs.appendFileSync(tradesLogPath, JSON.stringify(arb) + '\n')
  } catch (err: any) {
    console.error(`[trade log error] failed to append to trades.log: ${err?.message ?? err}`)
  }
  if (isBotStoreConfigured()) {
    appendTrade(arb, BOT_ID).catch(err => console.error(`[bot store error] failed to sync trade: ${err?.message ?? err}`))
  }
}

const scanTelemetry = {
  lastBlock: '',
  mode: 'full' as 'full' | 'incremental' | 'gas-only' | 'heartbeat',
  changedPools: 0,
  stateReadMs: 0,
  balanceReadMs: 0,
  localSearchMs: 0,
  exactQuoteMs: 0,
  exactSelected: 0,
  exactChecked: 0,
  exactValid: 0,
  exactDeferredQuoteMisses: 0,
  exactFamilyQueueSize: 0,
  exactFamilyCursor: 0,
  exactSelectedFamilies: [] as string[],
  exactSelectedRoutes: [] as string[],
  exactValidRoutes: [] as string[],
  exactRejectedRoutes: [] as Array<{ pair: string; family: string; reason: string }>,
  historyProvenSelected: 0,
  fastLaneCandidates: 0,
  fastLaneChecked: 0,
  fastLaneValid: 0,
  fastLaneMs: 0,
  fastLaneAttempts: 0,
  dirtyRouteCandidates: 0,
  webSocketEnabled: WEBSOCKET_SCANNING,
  webSocketConnected: false,
  webSocketLastHeadAt: '',
  webSocketErrors: 0,
  webSocketFallbackPolls: 0,
  webSocketReconnectAttempts: 0,
  webSocketRecoveries: 0,
  webSocketNextReconnectAt: '',
  historicalClosedSuccesses: [...routeHistory.values()].reduce((sum, stats) => sum + stats.successes, 0),
  provenVenueRoutes: [...venueRouteHistory.values()].filter(stats => stats.successes > 0).length,
  approximateCandidates: 0,
  routeVisits: 0,
  marginalPruned: 0,
  sizedRoutes: 0,
  eventSkippedBlocks: 0,
  fullScans: 0,
  incrementalScans: 0,
  gasOnlyScans: 0,
  inactivePools: [] as string[],
}
let lastStatusSnapshot: any = null

async function writeStatus(lastOpps: (ArbOpp | SettlementOpp)[], tickMs: number, rawBalances: Record<string, bigint>, nativeEth: bigint, gasReserveWei: bigint, gasReserveHealthy: boolean, graph: Map<string, HopCandidate[]>) {
  const balances: Record<string, string> = { ETH: formatEther(nativeEth) }
  for (const [sym, bal] of Object.entries(rawBalances)) {
    balances[sym] = formatUnits(bal, TOKENS[sym as keyof typeof TOKENS].decimals)
  }

  const status = {
    updatedAt: new Date().toISOString(),
    keeperAddress: account.address,
    keeperRole: KEEPER_ROLE,
    botId: BOT_ID ?? null,
    dryRun: DRY_RUN,
    intervalMs: INTERVAL_MS,
    tickMs,
    scanTelemetry: { ...scanTelemetry },
    searchLimits: {
      settlementTokens: [...SETTLEMENT_TOKENS],
      maxHops: MAX_HOPS,
      maxDfsVisits: MAX_DFS_VISITS,
      exactCandidatesPerScan: EXACT_QUOTE_CANDIDATES_PER_TICK,
      exactMaxAttemptsPerScan: EXACT_QUOTE_MAX_ATTEMPTS_PER_TICK,
      exactQuoteConcurrency: EXACT_QUOTE_CONCURRENCY,
      executionCandidatesPerScan: EXECUTION_CANDIDATES_PER_TICK,
      externalMinLiquidityUsd: EXTERNAL_MIN_LIQUIDITY_USD,
      externalDiscoveryDepth: EXTERNAL_DISCOVERY_DEPTH,
      externalDiscoveryMaxTokens: EXTERNAL_DISCOVERY_MAX_TOKENS,
      externalDiscoveryMaxPools: EXTERNAL_DISCOVERY_MAX_POOLS,
      pinnedExternalTokens: [...MANUAL_EXTERNAL_TOKENS],
    },
    poolsMonitored: ARB_POOLS.length,
    aeonPoolsMonitored: ARB_POOLS.filter(pool => isAeonPoolKind(pool.kind)).length,
    externalPoolsMonitored: ARB_POOLS.filter(pool => !isAeonPoolKind(pool.kind)).length,
    rpcEndpointCount: RPC_URLS.length,
    directSequencerSubmission: SUBMIT_RPC.includes('sequencer.'),
    gasReserve: {
      requiredEth: formatEther(gasReserveWei),
      availableEth: formatEther(nativeEth),
      healthy: gasReserveHealthy,
    },
    pendingTransaction,
    outcomeCounters,
    activeRouteCooldowns: Array.from(routeHealth.entries())
      .filter(([, health]) => health.cooldownUntil > Date.now())
      .map(([route, health]) => ({ route, failures: health.failures, category: health.lastCategory, until: new Date(health.cooldownUntil).toISOString() })),
    balances,
    // Only publish opportunities that actually clear gas (net-of-gas positive).
    // Negative-net candidates are internal search noise and must never surface
    // on the dashboard -- if it shows here, it's worth trading.
    lastOpportunities: lastOpps.filter(o => o.expectedNetUsd > 0).slice(0, 20).map(o => {
      const isSettlement = 'profitUsdg' in o
      const grossProfit = isSettlement
        ? formatUnits(o.profitUsdg, TOKENS.USDG.decimals)
        : formatUnits(o.profitRaw, o.tokenIn.decimals)
      const grossProfitUsd = isSettlement
        ? Number(formatUnits(o.profitUsdg, TOKENS.USDG.decimals))
        : Number(formatUnits(valueInUsdg(o.tokenIn.symbol, o.profitRaw, graph), TOKENS.USDG.decimals))
      return {
      pair: o.label,
      profitPct: Number(o.profitPct.toFixed(4)),
      amountIn: formatUnits(o.amountIn, o.tokenIn.decimals),
      tokenIn: o.tokenIn.symbol,
      tokenOut: isSettlement ? o.tokenOut.symbol : o.tokenIn.symbol,
      grossProfit,
      grossProfitToken: isSettlement ? 'USDG' : o.tokenIn.symbol,
      grossProfitUsd,
      expectedNetUsd: o.expectedNetUsd,
      gasCostUsd: o.gasCostUsd,
      routeScore: o.routeScore,
      reliabilityPct: o.reliabilityPct,
      venues: o.hops.map(h => h.pool.pool.kind).join(' -> '),
      }
    }),
    recentArbs: recentArbs.slice(0, 30),
    cumulativeProfit,
    totalArbsExecuted: totalExecuted,
    totalArbsFailed: totalFailed,
    consecutiveFailures,
    pausedUntil: pausedUntil > Date.now() ? new Date(pausedUntil).toISOString() : null,
    recentErrors: recentErrors.slice(0, 5),
  }

  lastStatusSnapshot = status
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))

  // Throttled, fire-and-forget push to the shared store -- status changes
  // every tick (every 1s by default) but a live dashboard doesn't need
  // sub-second freshness, and pushing every tick would burn through
  // Upstash's free-tier command budget fast (86,400+/day at 1s intervals).
  if (isBotStoreConfigured() && Date.now() - lastRedisStatusSync >= REDIS_STATUS_SYNC_INTERVAL_MS) {
    lastRedisStatusSync = Date.now()
    writeBotStatus(status, BOT_ID).catch(err => console.error(`[bot store error] failed to sync status: ${err?.message ?? err}`))
  }
}

let lastRedisStatusSync = 0
const REDIS_STATUS_SYNC_INTERVAL_MS = parseInt(process.env.REDIS_STATUS_SYNC_INTERVAL_MS ?? '15000')

async function writeStatusHeartbeat(blockNumber: bigint): Promise<void> {
  if (!lastStatusSnapshot) return
  scanTelemetry.lastBlock = blockNumber.toString()
  scanTelemetry.mode = 'heartbeat'
  scanTelemetry.changedPools = 0
  scanTelemetry.eventSkippedBlocks++
  const status = {
    ...lastStatusSnapshot,
    updatedAt: new Date().toISOString(),
    pendingTransaction,
    scanTelemetry: { ...scanTelemetry },
  }
  lastStatusSnapshot = status
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
  if (isBotStoreConfigured() && Date.now() - lastRedisStatusSync >= REDIS_STATUS_SYNC_INTERVAL_MS) {
    lastRedisStatusSync = Date.now()
    writeBotStatus(status, BOT_ID).catch(err => console.error(`[bot store error] failed to sync heartbeat: ${err?.message ?? err}`))
  }
}

// ─── Execution ────────────────────────────────────────────────────────────────

type ExecResult = 'skipped' | 'attempted'

// Monotonic nonce guard. With multiple RPC endpoints behind failover, a raw
// getTransactionCount can land on an endpoint lagging behind our own
// just-sent txs and hand back a nonce we already used -> "nonce lower than
// the current nonce", which was silently killing every ETH->WETH wrap and
// so starving all WETH-funded cycles. This keeps a high-water mark so we
// never reissue a nonce, while still jumping forward if the chain's pending
// count ever exceeds ours. Reset to -1 on a nonce error to force a clean
// re-sync from the RPC on the next attempt.
let nonceHighWater = -1
async function acquireNonce(): Promise<number> {
  // walletRpc (single pinned endpoint), NOT pub (fallback) -- the nonce must
  // be read from the SAME node the tx is submitted to, or the two disagree.
  const rpcPending = await walletRpc.getTransactionCount({ address: account.address, blockTag: 'pending' })
  const n = rpcPending > nonceHighWater ? rpcPending : nonceHighWater + 1
  nonceHighWater = n
  return n
}
function isNonceError(err: any): boolean {
  return String(err?.shortMessage ?? err?.message ?? err).toLowerCase().includes('nonce')
}

async function writeContractTracked(args: any, label: string): Promise<{ hash: `0x${string}`; receipt: any }> {
  const nonce = await acquireNonce()
  const currentGasPrice = await pub.getGasPrice()
  const initialMaxFeePerGas = (currentGasPrice * TX_FEE_HEADROOM_BPS) / 10_000n
  // A sequencer endpoint is submit-only. Populate gas through the read RPC so
  // viem can sign locally and make its sole sequencer call eth_sendRawTransaction.
  const estimatedGas = args.gas ?? await pub.estimateContractGas({ ...args, account: account.address } as any)
  const gas = (BigInt(estimatedGas) * TX_GAS_LIMIT_HEADROOM_BPS) / 10_000n + 1n
  let hash: `0x${string}`
  try {
    hash = await submitPreparedContract({ ...args, gas, nonce, maxFeePerGas: initialMaxFeePerGas, maxPriorityFeePerGas: 0n } as any)
  } catch (sendErr: any) {
    // "nonce too low" => the chain is AHEAD of us (a lagging RPC handed back a
    // stale pending count). Keep the high-water where acquireNonce left it so
    // the NEXT attempt walks UP (+1) toward the real nonce -- re-reading the
    // same lagging endpoint would just return the same too-low value and loop.
    // Any OTHER failure means this nonce was never consumed, so roll the
    // high-water back one to reuse it instead of leaving a gap that stalls
    // every later tx.
    if (!isNonceError(sendErr)) nonceHighWater = nonce - 1
    throw sendErr
  }
  const originalHash = hash
  pendingTransaction = { hash, label, nonce, submittedAt: new Date().toISOString(), replacements: 0 }
  publishPendingTransaction()

  try {
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: PENDING_TX_TIMEOUT_MS })
    pendingTransaction = null
    publishPendingTransaction()
    return { hash, receipt }
  } catch (firstError: any) {
    // If the original landed but the first RPC missed the receipt, do not
    // manufacture a replacement. A direct receipt read distinguishes that
    // from a genuinely pending nonce.
    const landed = await pub.getTransactionReceipt({ hash }).catch(() => null)
    if (landed) {
      pendingTransaction = null
      publishPendingTransaction()
      return { hash, receipt: landed }
    }

    const bumpedMaxFeePerGas = initialMaxFeePerGas + (initialMaxFeePerGas * REPLACEMENT_GAS_BUMP_BPS) / 10_000n + 1n
    console.warn(`   Pending ${label} ${hash} exceeded ${PENDING_TX_TIMEOUT_MS}ms; replacing nonce ${nonce} with a ${Number(REPLACEMENT_GAS_BUMP_BPS) / 100}% gas bump`)
    try {
      const replacementHash = await submitPreparedContract({ ...args, gas, nonce, maxFeePerGas: bumpedMaxFeePerGas, maxPriorityFeePerGas: 0n } as any)
      hash = replacementHash
      pendingTransaction = { hash, label, nonce, submittedAt: new Date().toISOString(), replacements: 1 }
      publishPendingTransaction()
      const receipt = await pub.waitForTransactionReceipt({ hash, timeout: PENDING_TX_TIMEOUT_MS })
      pendingTransaction = null
      publishPendingTransaction()
      return { hash, receipt }
    } catch (replacementError: any) {
      // A race can mine the original between the receipt check and the
      // replacement. Prefer its real receipt when present.
      const originalReceipt = await pub.getTransactionReceipt({ hash: originalHash }).catch(() => null)
      pendingTransaction = null
      publishPendingTransaction()
      if (originalReceipt) return { hash: originalReceipt.transactionHash, receipt: originalReceipt }
      throw replacementError?.message ? replacementError : firstError
    }
  }
}

async function ensureKeeperAllowance(tokenAddress: `0x${string}`, needsApproval: boolean): Promise<bigint> {
  if (!needsApproval) return 0n
  const { receipt } = await writeContractTracked({
    address: tokenAddress, abi: ERC20_ABI, functionName: 'approve',
    args: [CONTRACTS.ArbKeeper, MAX_UINT256],
  }, 'ArbKeeper approval')
  return BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
}

// Maps HopCandidate[] (any mix of pool kinds) into AeonUniversalRouter's
// Hop[] shape. CL/DLMM hops pass pool=address(0) -- the router derives
// Algebra's pool from tokenIn/tokenOut/deployer and DLMM's pair from
// tokenPath/binStep, neither needs it (see AEON_UNIVERSAL_ROUTER_ABI's own
// comment in abis.ts).
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

function buildUniversalHops(hopCandidates: HopCandidate[]) {
  return hopCandidates.map(h => {
    const kind = h.pool.pool.kind
    const tokenIn  = getAddress(TOKENS[h.tokenInSym as keyof typeof TOKENS].address)
    const tokenOut = getAddress(TOKENS[h.tokenOutSym as keyof typeof TOKENS].address)
    if (kind === 'CL') return { poolType: 1, pool: ZERO_ADDRESS, tokenIn, tokenOut, feeBps: 0, binStep: 0, tickSpacing: 0, v4Native: false }
    if (kind === 'DLMM') return { poolType: 2, pool: ZERO_ADDRESS, tokenIn, tokenOut, feeBps: 0, binStep: h.pool.pool.binStep ?? 0, tickSpacing: 0, v4Native: false }
    if (kind === 'uniV3') return { poolType: 4, pool: getAddress(h.pool.pool.address), tokenIn, tokenOut, feeBps: h.pool.pool.v3Fee ?? 0, binStep: 0, tickSpacing: 0, v4Native: false }
    if (kind === 'uniV4') return { poolType: 5, pool: getAddress(h.pool.pool.v4Hooks ?? ZERO_ADDRESS), tokenIn, tokenOut, feeBps: h.pool.pool.v4Fee ?? 0, binStep: 0, tickSpacing: h.pool.pool.v4TickSpacing ?? 0, v4Native: h.pool.pool.v4Native ?? false }
    return { poolType: kind === 'uniV2' ? 3 : 0, pool: getAddress(h.pool.pool.address), tokenIn, tokenOut, feeBps: Number(h.pool.pool.feeBps), binStep: 0, tickSpacing: 0, v4Native: false }
  })
}

function venueName(kind: PoolKind): string {
  if (kind === 'uniV2') return 'Uniswap V2'
  if (kind === 'uniV3') return 'Uniswap V3'
  if (kind === 'uniV4') return 'Uniswap V4'
  if (kind === 'CL') return 'AEON CL'
  if (kind === 'DLMM') return 'AEON DLMM'
  return 'AEON DEX'
}

function describeVenuePath(hops: HopCandidate[]): string {
  return hops
    .map(h => `${venueName(h.pool.pool.kind)} (${h.tokenInSym}→${h.tokenOutSym})`)
    .join(' → ')
}

function hasNonVammHop(hopCandidates: HopCandidate[]): boolean {
  return hopCandidates.some(h => h.pool.pool.kind === 'CL' || h.pool.pool.kind === 'DLMM' || h.pool.pool.kind === 'uniV3' || h.pool.pool.kind === 'uniV4')
}

async function quoteMixedRouteExact(hops: HopCandidate[], amountIn: bigint): Promise<bigint> {
  let amount = amountIn
  for (const hop of hops) {
    if (hop.pool.pool.kind === 'uniV3') {
      const quote = await quoteUniswapV3ExactInput(
        pub,
        getAddress(TOKENS[hop.tokenInSym as keyof typeof TOKENS].address),
        getAddress(TOKENS[hop.tokenOutSym as keyof typeof TOKENS].address),
        hop.pool.pool.v3Fee ?? 0,
        amount,
      )
      if (!quote) return 0n
      amount = quote.amountOut
    } else if (hop.pool.pool.kind === 'CL') {
      const quote = await pub.readContract({
        address: ALGEBRA_CONTRACTS.quoterV2,
        abi: ALGEBRA_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: getAddress(TOKENS[hop.tokenInSym as keyof typeof TOKENS].address),
          tokenOut: getAddress(TOKENS[hop.tokenOutSym as keyof typeof TOKENS].address),
          deployer: ZERO_ADDRESS,
          amountIn: amount,
          limitSqrtPrice: 0n,
        }],
      }) as readonly [bigint, bigint, bigint, number, bigint, number]
      amount = BigInt(quote[0])
    } else if (hop.pool.pool.kind === 'DLMM') {
      if (amount > ((1n << 128n) - 1n)) return 0n
      const quote = await pub.readContract({
        address: DLMM_CONTRACTS.router,
        abi: LB_ROUTER_ABI,
        functionName: 'getSwapOut',
        args: [
          getAddress(hop.pool.pool.address),
          amount,
          hop.tokenInSym === hop.pool.pool.token0,
        ],
      }) as readonly [bigint, bigint, bigint]
      if (BigInt(quote[0]) !== 0n) return 0n
      amount = BigInt(quote[1])
    } else if (hop.pool.pool.kind === 'uniV4') {
      const ref = hop.pool.pool.v4PoolId ? uniswapV4Refs.get(hop.pool.pool.v4PoolId.toLowerCase()) : undefined
      if (!ref) return 0n
      const quote = await quoteUniswapV4ExactInput(
        pub,
        ref,
        getAddress(TOKENS[hop.tokenInSym as keyof typeof TOKENS].address),
        amount,
      )
      if (!quote) return 0n
      amount = quote.amountOut
    } else {
      amount = amtOut(amount, hop.reserveIn, hop.reserveOut, hop.pool.effFeeBps)
    }
    if (amount <= 0n) return 0n
  }
  return amount
}

interface ExactQuoteWaveCache {
  conversionPaths: Map<string, HopCandidate[] | null>
  exactValues: Map<string, Promise<bigint>>
}

async function exactValueInUsdg(
  tokenSym: string,
  amount: bigint,
  graph: Map<string, HopCandidate[]>,
  conversionPaths?: Map<string, HopCandidate[] | null>,
): Promise<bigint> {
  if (amount <= 0n) return 0n
  if (tokenSym === 'USDG') return amount
  let path: HopCandidate[] | null
  if (conversionPaths?.has(tokenSym)) {
    path = conversionPaths.get(tokenSym) ?? null
  } else {
    path = findConversionPath(graph, tokenSym, 'USDG')
    conversionPaths?.set(tokenSym, path)
  }
  if (!path) return 0n
  return quoteMixedRouteExact(path, amount)
}

async function exactValueInUsdgCached(
  tokenSym: string,
  amount: bigint,
  graph: Map<string, HopCandidate[]>,
  cache: ExactQuoteWaveCache,
): Promise<bigint> {
  const key = `${tokenSym}:${amount}`
  let pending = cache.exactValues.get(key)
  if (!pending) {
    pending = exactValueInUsdg(tokenSym, amount, graph, cache.conversionPaths).catch(err => {
      cache.exactValues.delete(key)
      throw err
    })
    cache.exactValues.set(key, pending)
  }
  return pending
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n
  return (numerator + denominator - 1n) / denominator
}

// Cyclic routes (same start/end token) that include a CL or DLMM hop can't
// go through AeonArbKeeper -- it only ever does raw vAMM/UniV2-style
// getReserves()+swap() calls (see AeonArbKeeper.sol's IPairLike/IAeonPoolSwap
// interfaces), no concept of Algebra's tick-based or LB's bin-based swap.
// This executes via AeonUniversalRouter instead, with the SAME
// "can't knowingly execute at a loss" property, just enforced by a computed
// amountOutMin (= amountIn + requiredProfit, same token in and out so no
// USDG-equivalent conversion is needed) instead of AeonArbKeeper's built-in
// profit check -- the whole transaction reverts if the real swap can't
// deliver that, same as every other execution path in this file.
async function executeArbViaUniversalRouter(opp: ArbOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenIn, hops: hopCandidates, amountIn, profitPct, label: pairLabel } = opp
  if (routeCooldownRemaining(hopCandidates) > 0) return 'skipped'
  let failureStage: FailureStage = 'quote'
  const venues = describeVenuePath(hopCandidates)
  const exactOut = await quoteMixedRouteExact(hopCandidates, amountIn)
  const profitRaw = exactOut > amountIn ? exactOut - amountIn : 0n
  if (profitRaw <= 0n) return 'skipped'

  console.log(`\n🔄 ARB (CL/DLMM route, via UniversalRouter): ${pairLabel}  profit ${profitPct.toFixed(3)}%  in ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`)

  // WETH-settled cycles use native ETH directly: the executor wraps, routes,
  // unwraps and returns ETH in one transaction. Fall back to the ERC20 path
  // only when this tick lacks enough ETH above the protected gas reserve.
  const useNativeCycle = tokenIn.symbol === 'WETH' && availableEthForWrap >= amountIn
  const allowance = useNativeCycle ? amountIn : await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.UniversalRouter],
  }) as bigint
  const needsApproval = !useNativeCycle && allowance < amountIn
  const gasFloor = await gasCostFloorInToken(tokenIn.symbol, tokenIn.address, hopCandidates.length, graph, needsApproval)
  if (gasFloor === null) {
    console.warn(`   ⚠ No live WETH price path for ${tokenIn.symbol} -- can't verify profit clears gas cost, skipping for safety`)
    return 'skipped'
  }
  console.log(`   Est. gas cost (incl. 1.3x buffer): ~${formatUnits(gasFloor, tokenIn.decimals)} ${tokenIn.symbol}`)

  let requiredProfit = gasFloor + 1n
  if (profitRaw < requiredProfit) {
    console.log('   Profit does not clear the buffered gas cost, skipping')
    outcomeCounters.belowGas++
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute via UniversalRouter -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(profitRaw, tokenIn.decimals),
      profitPct, status: 'dry-run', route: 'internal', venues,
    })
    return 'attempted'
  }

  let balIn = useNativeCycle ? await pub.getBalance({ address: account.address }) : await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (!useNativeCycle && balIn < amountIn && tokenIn.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)
  }
  if (!useNativeCycle && balIn < amountIn) {
    balIn = await ensureBaseTokenFunded(tokenIn.symbol as keyof typeof TOKENS, amountIn, graph)
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    outcomeCounters.insufficientBalance++
    return 'skipped'
  }
  const balanceBefore = balIn

  const hops = buildUniversalHops(hopCandidates)
  let amountOutMin = amountIn + requiredProfit
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

  try {
    let approvalGasWei = 0n
    if (needsApproval) {
      failureStage = 'approval'
      console.log('   → approve...')
      const { receipt: approvalReceipt } = await writeContractTracked({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.UniversalRouter, MAX_UINT256],
      }, 'UniversalRouter approval')
      approvalGasWei = BigInt(approvalReceipt.gasUsed) * BigInt(approvalReceipt.effectiveGasPrice)
    }

    // Refresh every venue quote after any approval transaction and directly
    // before simulation. The opening-tick quote is ranking data only.
    failureStage = 'quote'
    const finalQuotedOut = await quoteMixedRouteExact(hopCandidates, amountIn)
    const finalQuotedProfit = finalQuotedOut > amountIn ? finalQuotedOut - amountIn : 0n
    if (finalQuotedProfit < requiredProfit) {
      console.log('   Fresh executable quote no longer clears gas; not submitting')
      return 'skipped'
    }

    failureStage = 'gas_estimate'
    const gasPrice = await pub.getGasPrice()
    const executionGas = useNativeCycle
      ? await pub.estimateContractGas({
          account: account.address,
          address: CONTRACTS.NativeArbExecutor, abi: AEON_NATIVE_ARB_EXECUTOR_ABI, functionName: 'executeNativeCycle',
          args: [hops, amountOutMin, account.address, deadline], value: amountIn,
        })
      : await pub.estimateContractGas({
          account: account.address,
          address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
          args: [hops, amountIn, amountOutMin, account.address, deadline],
        })
    const bufferedGasWei = approvalGasWei + (executionGas * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const exactGasInToken = weiToToken(tokenIn.symbol, bufferedGasWei, graph)
    if (exactGasInToken === null) throw new Error(`cannot convert exact gas cost into ${tokenIn.symbol}`)
    requiredProfit = exactGasInToken + 1n
    amountOutMin = amountIn + requiredProfit
    if (finalQuotedProfit < requiredProfit) {
      console.log('   Exact gas estimate removed profitability; not submitting')
      outcomeCounters.belowGas++
      return 'skipped'
    }

    console.log(useNativeCycle ? '   → simulate atomic ETH→WETH→route→WETH→ETH...' : '   → simulate swapExactTokensForTokens...')
    failureStage = 'simulation'
    const simulation = useNativeCycle
      ? await pub.simulateContract({
          account,
          address: CONTRACTS.NativeArbExecutor, abi: AEON_NATIVE_ARB_EXECUTOR_ABI, functionName: 'executeNativeCycle',
          args: [hops, amountOutMin, account.address, deadline], value: amountIn,
        })
      : await pub.simulateContract({
          account,
          address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
          args: [hops, amountIn, amountOutMin, account.address, deadline],
        })
    if (typeof simulation.result === 'bigint' && simulation.result < amountOutMin) {
      throw new Error('final simulation returned less than amountOutMin')
    }

    failureStage = 'submission'
    console.log(useNativeCycle ? '   → execute native atomic cycle...' : '   → swapExactTokensForTokens...')
    const { hash: hSwap, receipt } = useNativeCycle
      ? await writeContractTracked({
          address: CONTRACTS.NativeArbExecutor, abi: AEON_NATIVE_ARB_EXECUTOR_ABI, functionName: 'executeNativeCycle',
          args: [hops, amountOutMin, account.address, deadline], value: amountIn,
        }, `native arb ${pairLabel}`)
      : await writeContractTracked({
          address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
          args: [hops, amountIn, amountOutMin, account.address, deadline],
        }, `arb ${pairLabel}`)
    failureStage = 'confirmation'

    if (receipt.status === 'success') {
      const totalGasWei = approvalGasWei + BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
      const balanceAfter = useNativeCycle
        ? await pub.getBalance({ address: account.address })
        : await pub.readContract({
            address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
          }) as bigint
      // Native balance delta already includes transaction gas. Add it back
      // here to recover gross route profit, then subtract it once below.
      const grossAdjustedAfter = useNativeCycle ? balanceAfter + totalGasWei : balanceAfter
      const realizedGross = grossAdjustedAfter > balanceBefore ? grossAdjustedAfter - balanceBefore : 0n
      const actualGasInToken = weiToToken(tokenIn.symbol, totalGasWei, graph) ?? 0n
      const realizedNet = realizedGross > actualGasInToken ? realizedGross - actualGasInToken : 0n
      const realizedNetPct = amountIn > 0n ? Number(realizedNet * 10000n / amountIn) / 100 : 0
      console.log(`   ✅ ARB COMPLETE (CL/DLMM route) — profit ~${formatUnits(profitRaw, tokenIn.decimals)} ${tokenIn.symbol} — ${hSwap}`)
      totalExecuted++
      outcomeCounters.executed++
      consecutiveFailures = 0
      clearRouteFailure(hopCandidates)
      const prev = parseFloat(cumulativeProfit[tokenIn.symbol] ?? '0')
      cumulativeProfit[tokenIn.symbol] = (prev + parseFloat(formatUnits(realizedNet, tokenIn.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(realizedNet, tokenIn.decimals),
        grossProfit: formatUnits(realizedGross, tokenIn.decimals), gasCost: formatUnits(actualGasInToken, tokenIn.decimals),
        gasCostEth: formatEther(totalGasWei), quotedProfit: formatUnits(finalQuotedProfit, tokenIn.decimals),
        realizedProfitUsd: Number(formatUnits(valueInUsdg(tokenIn.symbol, realizedNet, graph), TOKENS.USDG.decimals)),
        quoteVariancePct: finalQuotedProfit > 0n ? Number((realizedGross - finalQuotedProfit) * 10_000n / finalQuotedProfit) / 100 : 0,
        profitPct: realizedNetPct, txHash: hSwap, status: 'success', route: 'internal', venues,
      })
    } else {
      throw new Error('transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const failure = decodeFailure(err)
    countFailureOutcome(failure, failureStage)
    const message = `[${failure.category}/${failureStage}] ${failure.message}`
    registerRouteFailure(hopCandidates, failure, failureStage)
    const reachedSubmission = failureStage === 'submission' || failureStage === 'confirmation'
    console.error(reachedSubmission
      ? `   ARB TRANSACTION FAILED (atomic revert): ${message}`
      : `   Candidate rejected before submission (no transaction, no gas spent): ${message}`)
    // Route-local failures are isolated by their own cooldown and must not
    // pause unrelated routes through the global circuit breaker.
    if (reachedSubmission && !failure.routeScoped) consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    if (reachedSubmission) {
      totalFailed++
      recordArb({
        time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: '0', profitPct, status: 'failed', error: message,
        failureCategory: failure.category, failureStage, route: 'internal', venues,
      })
      return 'attempted'
    }
    return 'skipped'
  }
}

async function executeArb(opp: ArbOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenIn, hops: hopCandidates, amountIn, profitRaw, profitPct, label: pairLabel } = opp
  if (routeCooldownRemaining(hopCandidates) > 0) return 'skipped'
  let failureStage: FailureStage = 'quote'
  const venues = describeVenuePath(hopCandidates)

  // AeonArbKeeper (below) is vAMM/UniV2-only -- any route touching a CL or
  // DLMM pool needs the separate UniversalRouter-based path instead.
  if (hasNonVammHop(hopCandidates) || tokenIn.symbol === 'WETH') {
    return executeArbViaUniversalRouter(opp, graph, availableEthForWrap)
  }

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
    outcomeCounters.belowGas++
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(profitRaw, tokenIn.decimals),
      profitPct, status: 'dry-run', route: 'internal', venues,
    })
    return 'attempted'
  }

  let balIn = await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (balIn < amountIn && tokenIn.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)   // free wrap first, where it applies
  }
  if (balIn < amountIn) {
    balIn = await ensureBaseTokenFunded(tokenIn.symbol as keyof typeof TOKENS, amountIn, graph)   // then fall back to funding from USDG
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    outcomeCounters.insufficientBalance++
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
    failureStage = 'approval'
    console.log('   → approve...')
    const approvalGasWei = await ensureKeeperAllowance(tokenIn.address, needsApproval)

    failureStage = 'gas_estimate'
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
      outcomeCounters.belowGas++
      return 'skipped'
    }

    // Re-run the complete call against the latest chain state after the
    // approval confirms. A failed simulation costs no execution gas and
    // prevents submitting a route whose reserves already moved.
    console.log('   → simulate executeArb...')
    failureStage = 'simulation'
    const simulation = await pub.simulateContract({
      account,
      address: CONTRACTS.ArbKeeper, abi: ARB_KEEPER_ABI, functionName: 'executeArb',
      args: [hops, amountIn, requiredProfit, deadline],
    })
    if (typeof simulation.result === 'bigint' && simulation.result < requiredProfit) {
      throw new Error('final simulation returned less than requiredProfit')
    }

    failureStage = 'submission'
    console.log('   → executeArb...')
    const { hash: hExec, receipt } = await writeContractTracked({
      address: CONTRACTS.ArbKeeper, abi: ARB_KEEPER_ABI, functionName: 'executeArb',
      args: [hops, amountIn, requiredProfit, deadline],
    }, `arb ${pairLabel}`)
    failureStage = 'confirmation'

    if (receipt.status === 'success') {
      const balanceAfter = await pub.readContract({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      }) as bigint
      const realizedGross = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n
      const totalGasWei = approvalGasWei + BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
      const actualGasInToken = weiToToken(tokenIn.symbol, totalGasWei, graph) ?? 0n
      const realizedNet = realizedGross > actualGasInToken ? realizedGross - actualGasInToken : 0n
      const realizedNetPct = amountIn > 0n ? Number(realizedNet * 10000n / amountIn) / 100 : 0
      console.log(`   ✅ ARB COMPLETE — profit ~${formatUnits(profitRaw, tokenIn.decimals)} ${tokenIn.symbol} — ${hExec}`)
      totalExecuted++
      outcomeCounters.executed++
      consecutiveFailures = 0
      clearRouteFailure(hopCandidates)
      const prev = parseFloat(cumulativeProfit[tokenIn.symbol] ?? '0')
      cumulativeProfit[tokenIn.symbol] = (prev + parseFloat(formatUnits(realizedNet, tokenIn.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(realizedNet, tokenIn.decimals),
        grossProfit: formatUnits(realizedGross, tokenIn.decimals), gasCost: formatUnits(actualGasInToken, tokenIn.decimals),
        gasCostEth: formatEther(totalGasWei), quotedProfit: formatUnits(profitRaw, tokenIn.decimals),
        realizedProfitUsd: Number(formatUnits(valueInUsdg(tokenIn.symbol, realizedNet, graph), TOKENS.USDG.decimals)),
        quoteVariancePct: profitRaw > 0n ? Number((realizedGross - profitRaw) * 10_000n / profitRaw) / 100 : 0,
        profitPct: realizedNetPct, txHash: hExec, status: 'success', route: 'internal', venues,
      })
    } else {
      throw new Error('transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const failure = decodeFailure(err)
    countFailureOutcome(failure, failureStage)
    const message = `[${failure.category}/${failureStage}] ${failure.message}`
    registerRouteFailure(hopCandidates, failure, failureStage)
    const reachedSubmission = failureStage === 'submission' || failureStage === 'confirmation'
    console.error(reachedSubmission
      ? `   ARB TRANSACTION FAILED (atomic revert): ${message}`
      : `   Candidate rejected before submission (no transaction, no gas spent): ${message}`)
    if (reachedSubmission && !failure.routeScoped) consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    if (reachedSubmission) {
      totalFailed++
      recordArb({
        time: new Date().toISOString(), pair: pairLabel, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: '0', profitPct, status: 'failed', error: message,
        failureCategory: failure.category, failureStage, route: 'internal', venues,
      })
      return 'attempted'
    }
    return 'skipped'
  }
}

// ─── Settlement swap (starts in one settlement token, ends in another) ──────
//
// Not atomic in the AeonArbKeeper sense -- can't be, the contract rejects
// any route that doesn't close back to its own start token. This goes
// through AeonUniversalRouter's plain swapExactTokensForTokens instead
// (poolType-aware -- can cross vAMM, CL, DLMM, and UniV2 hops in the same
// route, see buildUniversalHops), over the FULL multi-hop route in one
// transaction. Still can't execute for nothing:
// amountOutMin is computed here as "the smallest output that would still be
// worth at least input value + gas, in live USDG terms" -- not a slippage
// percentage. If reserves moved enough since quoting that the route can't
// deliver that, the whole transaction reverts and only gas is spent.

const SETTLEMENT_SWAP_GAS_BASE = EXEC_ARB_BASE_GAS
const SETTLEMENT_SWAP_GAS_PER_HOP = EXEC_ARB_GAS_PER_HOP

async function executeSettlementSwap(
  opp: SettlementOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint,
): Promise<ExecResult> {
  // Kept only so old records/types remain readable. Cross-settlement execution
  // is intentionally disabled: unlike a closed cycle, its P&L depends on a
  // separate conversion price and cannot be enforced as an exact token gain.
  if (SAME_TOKEN_ONLY) return 'skipped'
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenIn, tokenOut, hops: hopCandidates, amountIn, label } = opp
  if (routeCooldownRemaining(hopCandidates) > 0) return 'skipped'
  let failureStage: FailureStage = 'quote'
  const venues = describeVenuePath(hopCandidates)

  console.log(`\n🔀 SETTLE: ${label}  in ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`)

  const inUsdgPath = tokenIn.symbol === 'USDG' ? [] : findConversionPath(graph, tokenIn.symbol, 'USDG')
  const outUsdgPath = tokenOut.symbol === 'USDG' ? [] : findConversionPath(graph, tokenOut.symbol, 'USDG')
  if (inUsdgPath === null || outUsdgPath === null) {
    console.warn(`   ⚠ No live USDG price path for ${tokenIn.symbol}/${tokenOut.symbol} -- can't verify profit clears gas cost, skipping for safety`)
    return 'skipped'
  }

  // When spare native ETH covers a WETH-starting settlement, the native
  // executor wraps and routes it in one transaction. No standalone WETH
  // wrap or ERC20 approval is needed, so the opportunity cannot disappear
  // between funding and execution.
  const useNativeSettlement = tokenIn.symbol === 'WETH' && availableEthForWrap >= amountIn
  const allowance = useNativeSettlement ? amountIn : await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, CONTRACTS.UniversalRouter],
  }) as bigint
  const needsApproval = !useNativeSettlement && allowance < amountIn

  const gasPrice = await pub.getGasPrice()
  let approveGasEstimate = 0n
  if (needsApproval) {
    approveGasEstimate = APPROVE_GAS_FALLBACK
    try {
      approveGasEstimate = await pub.estimateContractGas({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve',
        args: [CONTRACTS.UniversalRouter, MAX_UINT256], account: account.address,
      })
    } catch { /* fall back to a conservative fixed approval estimate */ }
  }
  const swapGasEstimate = SETTLEMENT_SWAP_GAS_BASE + SETTLEMENT_SWAP_GAS_PER_HOP * BigInt(hopCandidates.length)
  const gasWei = ((approveGasEstimate + swapGasEstimate) * gasPrice * GAS_SAFETY_MULT_PCT) / 100n
  const gasUsdg = valueInUsdg('WETH', gasWei, graph)
  console.log(`   Est. gas cost: ~${formatUnits(gasUsdg, TOKENS.USDG.decimals)} USDG`)

  let inUsdgValue = 0n
  let exactOut = 0n
  let exactOutUsdg = 0n
  let amountOutMin = 0n
  const refreshExecutableFloor = async (): Promise<boolean> => {
    exactOut = await quoteMixedRouteExact(hopCandidates, amountIn)
    if (exactOut <= 0n) return false
    inUsdgValue = await exactValueInUsdg(tokenIn.symbol, amountIn, graph)
    exactOutUsdg = await exactValueInUsdg(tokenOut.symbol, exactOut, graph)
    const requiredOutUsdg = inUsdgValue + gasUsdg + 1n
    if (inUsdgValue <= 0n || exactOutUsdg <= requiredOutUsdg) return false

    // Convert the required USDG floor into output-token units using the
    // current executable quote itself. The old fee-free spot conversion is
    // what made AEON routes look profitable and then revert on-chain.
    amountOutMin = ceilDiv(exactOut * requiredOutUsdg, exactOutUsdg)
    if (amountOutMin <= 0n || exactOut < amountOutMin) return false
    opp.amountOut = exactOut
    opp.profitUsdg = exactOutUsdg - inUsdgValue
    opp.profitPct = Number(opp.profitUsdg * 10_000n / inUsdgValue) / 100
    return true
  }

  if (!(await refreshExecutableFloor())) {
    console.log('   Profit does not clear the estimated gas cost, skipping')
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(opp.profitUsdg, TOKENS.USDG.decimals),
      profitToken: 'USDG',
      profitPct: opp.profitPct, status: 'dry-run', route: 'internal', venues,
    })
    return 'attempted'
  }

  let balIn = useNativeSettlement ? await pub.getBalance({ address: account.address }) : await pub.readContract({
    address: tokenIn.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (!useNativeSettlement && balIn < amountIn && tokenIn.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)
  }
  if (!useNativeSettlement && balIn < amountIn) {
    balIn = await ensureBaseTokenFunded(tokenIn.symbol as keyof typeof TOKENS, amountIn, graph)
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    return 'skipped'
  }
  const balanceBeforeOut = await pub.readContract({
    address: tokenOut.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint

  const hops = buildUniversalHops(hopCandidates)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

  try {
    let approvalGasWei = 0n
    if (needsApproval) {
      console.log('   → approve...')
      failureStage = 'approval'
      const { receipt: approveReceipt } = await writeContractTracked({
        address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.UniversalRouter, MAX_UINT256],
      }, 'settlement approval')
      approvalGasWei = (approveReceipt.gasUsed as bigint) * (approveReceipt.effectiveGasPrice as bigint)
      failureStage = 'quote'
      if (!(await refreshExecutableFloor())) {
        console.log('   Fresh executable quote no longer clears gas; not submitting')
        return 'attempted'
      }
    }
    if (!needsApproval && !(await refreshExecutableFloor())) {
      console.log('   Fresh executable quote no longer clears gas; not submitting')
      return 'skipped'
    }

    console.log('   → simulate swapExactTokensForTokens...')
    failureStage = 'simulation'
    if (useNativeSettlement) {
      await pub.simulateContract({
        account,
        address: CONTRACTS.NativeArbExecutor,
        abi: AEON_NATIVE_ARB_EXECUTOR_ABI,
        functionName: 'executeNativeSettlement',
        args: [hops, amountOutMin, account.address, deadline],
        value: amountIn,
      })
    } else {
      await pub.simulateContract({
        account,
        address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
        args: [hops, amountIn, amountOutMin, account.address, deadline],
      })
    }

    console.log('   → swapExactTokensForTokens...')
    failureStage = 'submission'
    const { hash: hSwap, receipt } = useNativeSettlement
      ? await writeContractTracked({
          address: CONTRACTS.NativeArbExecutor,
          abi: AEON_NATIVE_ARB_EXECUTOR_ABI,
          functionName: 'executeNativeSettlement',
          args: [hops, amountOutMin, account.address, deadline],
          value: amountIn,
        }, 'atomic native settlement')
      : await writeContractTracked({
          address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
          args: [hops, amountIn, amountOutMin, account.address, deadline],
        }, 'cross-settlement swap')
    failureStage = 'confirmation'

    if (receipt.status === 'success') {
      const balanceAfterOut = await pub.readContract({
        address: tokenOut.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      }) as bigint
      const realizedOut = balanceAfterOut > balanceBeforeOut ? balanceAfterOut - balanceBeforeOut : 0n
      let realizedOutUsdg = await exactValueInUsdg(tokenOut.symbol, realizedOut, graph)
      if (realizedOutUsdg <= 0n) {
        realizedOutUsdg = tokenOut.symbol === 'USDG' ? realizedOut : convertSpot(realizedOut, outUsdgPath)
      }
      const totalGasWei = approvalGasWei + (receipt.gasUsed as bigint) * (receipt.effectiveGasPrice as bigint)
      const gasUsdgActual = valueInUsdg('WETH', totalGasWei, graph)
      const realizedGrossUsdg = realizedOutUsdg > inUsdgValue ? realizedOutUsdg - inUsdgValue : 0n
      const realizedNetUsdg = realizedOutUsdg > inUsdgValue + gasUsdgActual ? realizedOutUsdg - inUsdgValue - gasUsdgActual : 0n

      console.log(`   ✅ SETTLE COMPLETE — received ${formatUnits(realizedOut, tokenOut.decimals)} ${tokenOut.symbol} (~${formatUnits(realizedNetUsdg, TOKENS.USDG.decimals)} USDG net) — ${hSwap}`)
      totalExecuted++
      outcomeCounters.executed++
      consecutiveFailures = 0
      clearRouteFailure(hopCandidates)
      const prev = parseFloat(cumulativeProfit['USDG'] ?? '0')
      cumulativeProfit['USDG'] = (prev + parseFloat(formatUnits(realizedNetUsdg, TOKENS.USDG.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: label, tokenIn: tokenIn.symbol,
        amountIn: formatUnits(amountIn, tokenIn.decimals), profit: formatUnits(realizedNetUsdg, TOKENS.USDG.decimals),
        profitToken: 'USDG',
        grossProfit: formatUnits(realizedGrossUsdg, TOKENS.USDG.decimals), gasCost: formatUnits(gasUsdgActual, TOKENS.USDG.decimals),
        gasCostEth: formatEther(totalGasWei),
        profitPct: opp.profitPct, txHash: hSwap, status: 'success', route: 'internal', venues,
      })
    } else {
      throw new Error('transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const failure = decodeFailure(err)
    countFailureOutcome(failure, failureStage)
    registerRouteFailure(hopCandidates, failure, failureStage)
    const message = `[${failure.category}/${failureStage}] ${failure.message}`
    console.error(`   ❌ SETTLE FAILED (no funds lost -- amountOutMin reverts atomically): ${message}`)
    totalFailed++
    if (!failure.routeScoped) consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenIn.symbol,
      amountIn: formatUnits(amountIn, tokenIn.decimals), profit: '0', profitPct: opp.profitPct, status: 'failed', error: message, route: 'internal', venues,
      failureCategory: failure.category, failureStage,
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
    // be one side of it. Restricted to vAMM/UniV2 -- "leg 1" below swaps via
    // AeonRouter, which hard-reverts on any other poolType.
    const eligible = states.filter(s =>
      (s.pool.token0 === baseSym || s.pool.token1 === baseSym) &&
      (s.pool.kind === 'vAMM' || s.pool.kind === 'uniV2') &&
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

        const midOutEstimate = amtOut(amountIn, rBaseIn, rMidOut, s.effFeeBps)
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
  if (balIn < amountIn) {
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

// ─── Direct Uniswap V3 CASHCAT/WETH arb (real external pool, not ours) ──────
//
// AEON doesn't operate this pool and AeonUniversalRouter has no concept of
// it, so unlike CL/DLMM this can't be one atomic multi-hop transaction --
// same non-atomic, 2-leg, re-quote-before-second-leg discipline as the
// aggregator-based cross-venue paths, just calling Uniswap's own
// SwapRouter02/QuoterV2 directly instead of going through OpenOcean/1inch.
// Two advantages over routing CASHCAT through the aggregator: no exposure
// to OpenOcean's rate limit (direct RPC calls, not their constrained
// public API), and this can be priced every tick instead of only every
// AGGREGATOR_SCAN_INTERVAL_MS, using the same cheap virtual-reserve
// technique already used for AEON's own CL pools.
//
// Verified 2026-07-12, all directly on-chain before writing a single line
// of execution code: the pool's token0/token1 match AEON's own known
// CASHCAT/WETH addresses exactly (not a same-named scam clone -- DexScreener
// listed several "CASHCAT"-labeled pairs, only this one matched); real
// bytecode confirmed at the factory/router/quoter addresses (sourced from
// Uniswap's own official Robinhood Chain deployment docs, cross-checked
// against the factory address read directly from the pool itself); a live
// QuoterV2 quote succeeded; and a SwapRouter02 simulateContract call
// reverted with "STF" (SafeTransferFrom failed) rather than a decode
// error -- proof the ABI shape is exactly right, not just plausible.
const CASHCAT_V3_POOL = getAddress('0xA70fc67C9F69da90B63a0e4C05D229954574E313')
const UNIV3_SWAP_ROUTER02 = getAddress('0xcaf681a66d020601342297493863e78c959e5cb2')
const UNIV3_QUOTER_V2 = getAddress('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7')
const CASHCAT_V3_FEE_PPM = 10000   // 1%, in Uniswap's parts-per-million fee units -- verified via the pool's own fee() read
const CASHCAT_V3_FEE_BPS = BigInt(CASHCAT_V3_FEE_PPM) / 100n   // -> 100 bps, the unit amtOut()/amtIn() expect

const UNIV3_POOL_ABI = [
  { name: 'slot0', type: 'function', stateMutability: 'view', inputs: [], outputs: [
    { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
    { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' },
    { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' }, { name: 'unlocked', type: 'bool' },
  ]},
  { name: 'liquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
] as const

const UNIV3_QUOTER_V2_ABI = [
  { name: 'quoteExactInputSingle', type: 'function', stateMutability: 'nonpayable', inputs: [{
    name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]
  }], outputs: [
    { name: 'amountOut', type: 'uint256' }, { name: 'sqrtPriceX96After', type: 'uint160' },
    { name: 'initializedTicksCrossed', type: 'uint32' }, { name: 'gasEstimate', type: 'uint256' },
  ]},
] as const

const UNIV3_SWAP_ROUTER02_ABI = [
  { name: 'exactInputSingle', type: 'function', stateMutability: 'payable', inputs: [{
    name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ]
  }], outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const

// Same virtual-reserve technique as AEON's own CL pools (see fetchAllStates)
// -- real Uniswap V3 uses the identical sqrtPriceX96/liquidity model
// (Algebra Integral is itself a V3 fork). token0 is CASHCAT, token1 is
// WETH -- verified directly on-chain, not assumed.
async function fetchCashcatV3Reserves(): Promise<{ rCashcat: bigint; rWeth: bigint } | null> {
  try {
    const [slot0, liquidity] = await Promise.all([
      pub.readContract({ address: CASHCAT_V3_POOL, abi: UNIV3_POOL_ABI, functionName: 'slot0' }),
      pub.readContract({ address: CASHCAT_V3_POOL, abi: UNIV3_POOL_ABI, functionName: 'liquidity' }),
    ])
    const sqrtPriceX96 = slot0[0]
    if (sqrtPriceX96 === 0n || liquidity === 0n) return null
    const rCashcat = (liquidity << 96n) / sqrtPriceX96
    const rWeth = (liquidity * sqrtPriceX96) >> 96n
    return { rCashcat, rWeth }
  } catch {
    return null
  }
}

interface CashcatV3Opp {
  direction: 'buyOursSellV3' | 'buyV3SellOurs'
  ourPool: PoolState
  amountIn: bigint    // WETH
  profitRaw: bigint   // WETH
  profitPct: number
  label: string
}

// Checks BOTH directions (buy on whichever of AEON's own CASHCAT/WETH pools
// -- vAMM, CL, or DLMM -- is cheapest, sell on the real Uniswap V3 pool; and
// the reverse) and sizes via the same ternary-search shape used everywhere
// else in this file.
async function scanCashcatV3Arb(states: PoolState[], searchWethBal: bigint): Promise<CashcatV3Opp[]> {
  if (searchWethBal <= 0n) return []
  const v3 = await fetchCashcatV3Reserves()
  if (!v3) return []

  const ourPools = states.filter(s =>
    (s.pool.token0 === 'CASHCAT' && s.pool.token1 === 'WETH') ||
    (s.pool.token0 === 'WETH' && s.pool.token1 === 'CASHCAT'),
  )
  if (ourPools.length === 0) return []

  const opps: CashcatV3Opp[] = []

  for (const ourPool of ourPools) {
    const t0IsFirst = ourPool.onchain0 === TOKENS[ourPool.pool.token0].address.toLowerCase()
    const [r0real, r1real] = t0IsFirst ? [ourPool.r0, ourPool.r1] : [ourPool.r1, ourPool.r0]
    const [rWethOurs, rCashcatOurs] = ourPool.pool.token0 === 'WETH' ? [r0real, r1real] : [r1real, r0real]
    if (rWethOurs <= 0n || rCashcatOurs <= 0n) continue

    // Same conservative first-hop cap used for CL/DLMM local approximations
    // -- see sizingDivisor -- applied here too since the V3 leg is also a
    // local (current-tick-only) approximation.
    const ourDivisor = sizingDivisor(ourPool.pool.kind)

    function tryDirection(direction: CashcatV3Opp['direction']) {
      const cycleOutWeth = (amt: bigint): bigint => {
        if (direction === 'buyOursSellV3') {
          const cashcatOut = amtOut(amt, rWethOurs, rCashcatOurs, ourPool.effFeeBps)
          return amtOut(cashcatOut, v3!.rCashcat, v3!.rWeth, CASHCAT_V3_FEE_BPS)
        } else {
          const cashcatOut = amtOut(amt, v3!.rWeth, v3!.rCashcat, CASHCAT_V3_FEE_BPS)
          return amtOut(cashcatOut, rCashcatOurs, rWethOurs, ourPool.effFeeBps)
        }
      }
      const firstHopReserve = direction === 'buyOursSellV3' ? rWethOurs : v3!.rWeth
      const divisor = direction === 'buyOursSellV3' ? ourDivisor : 20n
      const maxByPool = firstHopReserve / divisor
      const maxIn = searchWethBal < maxByPool ? searchWethBal : maxByPool
      if (maxIn <= 1n) return

      let lo = 0n, hi = maxIn
      for (let i = 0; i < 100; i++) {
        const m1 = lo + (hi - lo) / 3n, m2 = hi - (hi - lo) / 3n
        const p1 = cycleOutWeth(m1) - m1, p2 = cycleOutWeth(m2) - m2
        if (p1 < p2) lo = m1; else hi = m2
        if (hi - lo < 2n) break
      }
      const amountIn = (lo + hi) / 2n
      const profitRaw = cycleOutWeth(amountIn) - amountIn
      if (profitRaw <= 0n || amountIn <= 0n) return
      const profitPct = Number(profitRaw * 10000n / amountIn) / 100
      if (profitPct < 0.02 || profitPct > 50) return

      opps.push({
        direction, ourPool, amountIn, profitRaw, profitPct,
        label: direction === 'buyOursSellV3'
          ? `WETH→CASHCAT (${ourPool.pool.kind})→WETH (UniV3)`
          : `WETH→CASHCAT (UniV3)→WETH (${ourPool.pool.kind})`,
      })
    }

    tryDirection('buyOursSellV3')
    tryDirection('buyV3SellOurs')
  }

  return opps.sort((a, b) => b.profitPct - a.profitPct)
}

async function executeCashcatV3Arb(opp: CashcatV3Opp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { direction, ourPool, amountIn, profitRaw, profitPct, label } = opp
  const weth = TOKENS.WETH, cashcat = TOKENS.CASHCAT

  console.log(`\n🦄 CASHCAT/UniV3: ${label}  profit ${profitPct.toFixed(3)}%  in ${formatUnits(amountIn, weth.decimals)} WETH`)

  const gasFloor = await gasCostFloorCrossVenue('WETH', weth.address, graph)
  if (gasFloor === null) {
    console.warn('   ⚠ No live WETH price path -- can\'t verify profit clears gas cost, skipping for safety')
    return 'skipped'
  }
  console.log(`   Est. gas cost (2 tx pairs, incl. 1.3x buffer): ~${formatUnits(gasFloor, weth.decimals)} WETH`)

  const requiredProfit = gasFloor + 1n
  if (profitRaw < requiredProfit) {
    console.log('   Profit does not clear the buffered gas cost, skipping')
    return 'skipped'
  }

  if (DRY_RUN) {
    console.log('   [DRY RUN] would execute -- clears gas cost, skipping actual send')
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: 'WETH',
      amountIn: formatUnits(amountIn, weth.decimals), profit: formatUnits(profitRaw, weth.decimals),
      profitPct, status: 'dry-run', route: 'internal',
    })
    return 'attempted'
  }

  let balWeth = await pub.readContract({ address: weth.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
  if (balWeth < amountIn) balWeth = await ensureWethBalance(amountIn, availableEthForWrap)
  if (balWeth < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balWeth, weth.decimals)}, need ${formatUnits(amountIn, weth.decimals)} WETH`)
    return 'skipped'
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)
  let totalGasWei = 0n

  // Leg 1
  let midReceived = 0n
  const leg1IsOurs = direction === 'buyOursSellV3'
  try {
    if (leg1IsOurs) {
      const hop: HopCandidate = { pool: ourPool, tokenInSym: 'WETH', tokenOutSym: 'CASHCAT', reserveIn: 0n, reserveOut: 0n }
      const hops = buildUniversalHops([hop])
      const allowance = await pub.readContract({ address: weth.address, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.UniversalRouter] }) as bigint
      if (allowance < amountIn) {
        console.log('   → leg 1: approve to AeonUniversalRouter...')
        const hApprove = await wal.writeContract({ address: weth.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.UniversalRouter, MAX_UINT256] })
        const receipt = await pub.waitForTransactionReceipt({ hash: hApprove })
        totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      }
      console.log('   → leg 1: swap on our own pool...')
      const balMidBefore = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
      const hSwap = await wal.writeContract({
        address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
        args: [hops, amountIn, 1n, account.address, deadline],   // amountOutMin=1 -- this leg's own output isn't the safety gate, the OVERALL round-trip profit check (before this function ever ran) is
      })
      const receipt = await pub.waitForTransactionReceipt({ hash: hSwap })
      totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      const balMidAfter = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
      midReceived = balMidAfter - balMidBefore
    } else {
      const allowance = await pub.readContract({ address: weth.address, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, UNIV3_SWAP_ROUTER02] }) as bigint
      if (allowance < amountIn) {
        console.log('   → leg 1: approve to Uniswap SwapRouter02...')
        const hApprove = await wal.writeContract({ address: weth.address, abi: ERC20_ABI, functionName: 'approve', args: [UNIV3_SWAP_ROUTER02, MAX_UINT256] })
        const receipt = await pub.waitForTransactionReceipt({ hash: hApprove })
        totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      }
      console.log('   → leg 1: swap on Uniswap V3...')
      const balMidBefore = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
      const hSwap = await wal.writeContract({
        address: UNIV3_SWAP_ROUTER02, abi: UNIV3_SWAP_ROUTER02_ABI, functionName: 'exactInputSingle',
        args: [{ tokenIn: weth.address, tokenOut: cashcat.address, fee: CASHCAT_V3_FEE_PPM, recipient: account.address, amountIn, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
      })
      const receipt = await pub.waitForTransactionReceipt({ hash: hSwap })
      totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      const balMidAfter = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
      midReceived = balMidAfter - balMidBefore
    }
    console.log(`   ✓ leg 1 confirmed — received ${formatUnits(midReceived, cashcat.decimals)} CASHCAT`)
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ Leg 1 failed: ${message}`)
    totalFailed++
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({ time: new Date().toISOString(), pair: label, tokenIn: 'WETH', amountIn: formatUnits(amountIn, weth.decimals), profit: '0', profitPct, status: 'failed', error: message, route: 'internal' })
    return 'attempted'
  }

  if (midReceived <= 0n) {
    console.warn('   ⚠ Leg 1 produced no output, stopping (no funds lost beyond leg 1 gas)')
    return 'attempted'
  }

  // Leg 2: fresh re-quote for the amount ACTUALLY received before committing
  // to the second leg -- if it's no longer profitable after gas, hold
  // CASHCAT rather than force a losing trade.
  let freshWethOut: bigint
  try {
    if (leg1IsOurs) {
      const res = await pub.simulateContract({
        address: UNIV3_QUOTER_V2, abi: UNIV3_QUOTER_V2_ABI, functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: cashcat.address, tokenOut: weth.address, amountIn: midReceived, fee: CASHCAT_V3_FEE_PPM, sqrtPriceLimitX96: 0n }],
      })
      freshWethOut = res.result[0]
    } else {
      const fresh = await fetchCashcatV3Reserves()   // re-read our own pool fresh via the graph, which is only as fresh as this tick -- close enough for a same-tick re-quote
      const edge = (graph.get('CASHCAT') ?? []).find(e => e.tokenOutSym === 'WETH' && e.pool.pool.address === ourPool.pool.address)
      freshWethOut = edge ? amtOut(midReceived, edge.reserveIn, edge.reserveOut, edge.pool.effFeeBps) : 0n
      void fresh
    }
  } catch {
    freshWethOut = 0n
  }

  const freshProfit = freshWethOut - amountIn
  if (freshProfit < requiredProfit) {
    const message = `leg 1 filled, leg 2 no longer clears the buffered gas cost after re-quote -- holding ${formatUnits(midReceived, cashcat.decimals)} CASHCAT`
    console.warn(`   ⚠ ${message}`)
    recordArb({ time: new Date().toISOString(), pair: label, tokenIn: 'WETH', amountIn: formatUnits(amountIn, weth.decimals), profit: '0', profitPct, status: 'failed', error: message, route: 'internal' })
    return 'attempted'
  }

  try {
    const balBaseBefore = await pub.readContract({ address: weth.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint

    if (leg1IsOurs) {
      const allowance = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, UNIV3_SWAP_ROUTER02] }) as bigint
      if (allowance < midReceived) {
        console.log('   → leg 2: approve to Uniswap SwapRouter02...')
        const hApprove = await wal.writeContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'approve', args: [UNIV3_SWAP_ROUTER02, MAX_UINT256] })
        const receipt = await pub.waitForTransactionReceipt({ hash: hApprove })
        totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      }
      console.log('   → leg 2: swap on Uniswap V3...')
      const amountOutMin = amountIn + requiredProfit
      const hSwap2 = await wal.writeContract({
        address: UNIV3_SWAP_ROUTER02, abi: UNIV3_SWAP_ROUTER02_ABI, functionName: 'exactInputSingle',
        args: [{ tokenIn: cashcat.address, tokenOut: weth.address, fee: CASHCAT_V3_FEE_PPM, recipient: account.address, amountIn: midReceived, amountOutMinimum: amountOutMin, sqrtPriceLimitX96: 0n }],
      })
      const receipt2 = await pub.waitForTransactionReceipt({ hash: hSwap2 })
      totalGasWei += receipt2.gasUsed * receipt2.effectiveGasPrice
      if (receipt2.status !== 'success') throw new Error('leg 2 transaction reverted')
    } else {
      const hop: HopCandidate = { pool: ourPool, tokenInSym: 'CASHCAT', tokenOutSym: 'WETH', reserveIn: 0n, reserveOut: 0n }
      const hops = buildUniversalHops([hop])
      const allowance = await pub.readContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'allowance', args: [account.address, CONTRACTS.UniversalRouter] }) as bigint
      if (allowance < midReceived) {
        console.log('   → leg 2: approve to AeonUniversalRouter...')
        const hApprove = await wal.writeContract({ address: cashcat.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.UniversalRouter, MAX_UINT256] })
        const receipt = await pub.waitForTransactionReceipt({ hash: hApprove })
        totalGasWei += receipt.gasUsed * receipt.effectiveGasPrice
      }
      console.log('   → leg 2: swap on our own pool...')
      const amountOutMin = amountIn + requiredProfit
      const hSwap2 = await wal.writeContract({
        address: CONTRACTS.UniversalRouter, abi: AEON_UNIVERSAL_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
        args: [hops, midReceived, amountOutMin, account.address, deadline],
      })
      const receipt2 = await pub.waitForTransactionReceipt({ hash: hSwap2 })
      totalGasWei += receipt2.gasUsed * receipt2.effectiveGasPrice
      if (receipt2.status !== 'success') throw new Error('leg 2 transaction reverted')
    }

    const balBaseAfter = await pub.readContract({ address: weth.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
    const realizedOut = balBaseAfter > balBaseBefore ? balBaseAfter - balBaseBefore : 0n
    const realizedGross = realizedOut > amountIn ? realizedOut - amountIn : 0n
    const realizedNet = realizedGross > totalGasWei ? realizedGross - totalGasWei : 0n
    const realizedNetPct = amountIn > 0n ? Number(realizedNet * 10000n / amountIn) / 100 : 0
    console.log(`   ✅ CASHCAT/UniV3 ARB COMPLETE — profit ~${formatUnits(realizedNet, weth.decimals)} WETH`)
    totalExecuted++
    consecutiveFailures = 0
    const prev = parseFloat(cumulativeProfit['WETH'] ?? '0')
    cumulativeProfit['WETH'] = (prev + parseFloat(formatUnits(realizedNet, weth.decimals))).toString()
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: 'WETH',
      amountIn: formatUnits(amountIn, weth.decimals), profit: formatUnits(realizedNet, weth.decimals),
      grossProfit: formatUnits(realizedGross, weth.decimals), gasCost: formatUnits(totalGasWei, weth.decimals),
      gasCostEth: formatEther(totalGasWei), profitPct: realizedNetPct, status: 'success', route: 'internal',
    })
    return 'attempted'
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ Leg 2 failed: ${message} -- may be holding intermediate CASHCAT`)
    totalFailed++
    consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({ time: new Date().toISOString(), pair: label, tokenIn: 'WETH', amountIn: formatUnits(amountIn, weth.decimals), profit: '0', profitPct, status: 'failed', error: message, route: 'internal' })
    return 'attempted'
  }
}

// ─── Pure external-to-external arb (neither leg touches an AEON pool) ───────
//
// Explicitly requested despite the tradeoff: AEON's own pools (including the
// CL/DLMM ones above) are where this bot has a real edge -- first-mover
// pricing information nobody else is watching. Arbing purely BETWEEN two
// external DEXes that AEON doesn't operate is generic MEV territory,
// contested 24/7 by professional searcher infrastructure with far lower
// latency than a 1-second-polling bot -- there's little edge here. This
// stays strictly lower priority: it only runs on the same slow cross-venue
// cadence as scanAggregatorArbs above, and only after that path already had
// its turn this cycle (see tick()).
//
// Same non-atomic exposure as executeAggregatorArb: two separate
// transactions (buy via whichever aggregator quotes best, sell via
// whichever quotes best for the amount actually received), re-quoted fresh
// before the second leg, holding the intermediate token rather than force a
// losing trade if it's no longer profitable after re-quote.

// Do not hard-code intermediate tokens here. The atomic pool-graph scanner
// above has always considered every connected token, and this slower
// aggregator fallback must follow the same rule. Derive candidates from the
// external pools Mirajane currently monitors, so a newly configured token
// (PONS, another meme token, etc.) becomes eligible automatically as soon as
// at least one executable external pool for it has been discovered.
//
// Aggregator public APIs are rate limited, so scan a rotating batch rather
// than issuing requests for every token in the same tick. This changes only
// cadence, not coverage: every eligible token gets a turn without CASHCAT or
// VIRTUAL receiving special treatment.
const EXTERNAL_ARB_CANDIDATES_PER_SCAN = Math.max(1, parseInt(process.env.EXTERNAL_ARB_CANDIDATES_PER_SCAN ?? '4'))
let externalArbCandidateCursor = 0

function externalArbMidCandidates(): (keyof typeof TOKENS)[] {
  const eligible = new Set<keyof typeof TOKENS>()
  for (const pool of ARB_POOLS) {
    if (isAeonPoolKind(pool.kind)) continue
    for (const sym of [pool.token0, pool.token1]) {
      if (sym === 'ETH') continue
      if ((SETTLEMENT_TOKENS as readonly string[]).includes(String(sym))) continue
      if (UNISWAP_UNSUPPORTED_TOKENS.has(sym)) continue
      eligible.add(sym)
    }
  }

  const all = [...eligible].sort((a, b) => String(a).localeCompare(String(b)))
  if (all.length <= EXTERNAL_ARB_CANDIDATES_PER_SCAN) return all

  const selected: (keyof typeof TOKENS)[] = []
  for (let i = 0; i < EXTERNAL_ARB_CANDIDATES_PER_SCAN; i++) {
    selected.push(all[(externalArbCandidateCursor + i) % all.length])
  }
  externalArbCandidateCursor = (externalArbCandidateCursor + selected.length) % all.length
  return selected
}
const EXTERNAL_ARB_SIZE_FRACTIONS = [0.10]

interface ExternalArbOpp {
  tokenBase: typeof TOKENS[keyof typeof TOKENS]
  tokenMid:  typeof TOKENS[keyof typeof TOKENS]
  amountIn:  bigint
  buyQuote:  import('./aggregators').AggregatorQuote   // base -> mid
  midOutEstimate: bigint
  sellQuote: import('./aggregators').AggregatorQuote   // mid -> base, quoted at midOutEstimate -- re-quoted fresh before executing leg 2
  profitRaw: bigint
  profitPct: number
  label: string
}

async function scanExternalToExternalArbs(
  balances: Record<string, bigint>, bases: (keyof typeof TOKENS)[],
): Promise<ExternalArbOpp[]> {
  const opps: ExternalArbOpp[] = []
  const midCandidates = externalArbMidCandidates()

  for (const baseSym of bases) {
    const walletBal = balances[baseSym] ?? 0n
    if (walletBal <= 0n) continue
    const tokenBase = TOKENS[baseSym]

    for (const midSym of midCandidates) {
      if (midSym === baseSym) continue
      const tokenMid = TOKENS[midSym]

      for (const frac of EXTERNAL_ARB_SIZE_FRACTIONS) {
        const amountIn = BigInt(Math.floor(Number(walletBal) * frac))
        if (amountIn <= 0n) continue

        const buyQuote = await getBestQuote(tokenBase.address, tokenMid.address, amountIn, tokenBase.decimals)
        if (!buyQuote || buyQuote.amountOut <= 0n) continue

        const sellQuote = await getBestQuote(tokenMid.address, tokenBase.address, buyQuote.amountOut, tokenMid.decimals)
        if (!sellQuote || sellQuote.amountOut <= 0n) continue

        const profitRaw = sellQuote.amountOut - amountIn
        if (profitRaw <= 0n) continue
        const profitPct = Number(profitRaw * 10000n / amountIn) / 100
        if (profitPct < 0.02 || profitPct > 50) continue

        opps.push({
          tokenBase, tokenMid, amountIn, buyQuote, midOutEstimate: buyQuote.amountOut, sellQuote, profitRaw, profitPct,
          label: `${baseSym}→${tokenMid.symbol} (${buyQuote.source})→${baseSym} (${sellQuote.source})`,
        })
      }
    }
  }

  return opps.sort((a, b) => b.profitPct - a.profitPct)
}

async function executeExternalArb(opp: ExternalArbOpp, graph: Map<string, HopCandidate[]>, availableEthForWrap: bigint): Promise<ExecResult> {
  if (Date.now() < pausedUntil) return 'skipped'
  const { tokenBase, tokenMid, amountIn, buyQuote, profitRaw, profitPct, label } = opp

  console.log(`\n🌐 EXTERNAL ARB: ${label}  profit ${profitPct.toFixed(3)}%  in ${formatUnits(amountIn, tokenBase.decimals)} ${tokenBase.symbol}`)

  // Reuses the SAME gas floor as AEON-pool-vs-aggregator cross-venue --
  // identically shaped (approve+swap, twice), just both legs go through an
  // aggregator instead of one leg being our own pool.
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
    console.log(`   [DRY RUN] would execute ${buyQuote.source} -> ... -- clears gas cost, skipping actual send`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: formatUnits(profitRaw, tokenBase.decimals),
      profitPct, status: 'dry-run', route: buyQuote.source,
    })
    return 'attempted'
  }

  let balIn = await pub.readContract({
    address: tokenBase.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint
  if (balIn < amountIn && tokenBase.symbol === 'WETH') {
    balIn = await ensureWethBalance(amountIn, availableEthForWrap)
  }
  if (balIn < amountIn) {
    balIn = await ensureBaseTokenFunded(tokenBase.symbol as keyof typeof TOKENS, amountIn, graph)
  }
  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenBase.decimals)}, need ${formatUnits(amountIn, tokenBase.decimals)}`)
    return 'skipped'
  }

  // Leg 1: buy tokenMid via whichever aggregator quoted best -- fresh
  // swap-tx fetch right before sending, same discipline as leg 2 below.
  let midReceived = 0n
  try {
    const balMidBefore = await pub.readContract({ address: tokenMid.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint

    const buyTx = await getSwapTx(buyQuote.source, tokenBase.address, tokenMid.address, amountIn, tokenBase.decimals, account.address, AGGREGATOR_SLIPPAGE_PCT)
    if (!buyTx) {
      console.warn(`   ⚠ ${buyQuote.source} no longer has a route for leg 1, skipping`)
      return 'skipped'
    }

    console.log(`   → leg 1: approve to ${buyQuote.source}...`)
    const hApprove1 = await wal.writeContract({
      address: tokenBase.address, abi: ERC20_ABI, functionName: 'approve', args: [buyTx.to, amountIn],
    })
    await pub.waitForTransactionReceipt({ hash: hApprove1 })

    console.log(`   → leg 1: swap via ${buyQuote.source}...`)
    const hSwap1 = await wal.sendTransaction({ to: buyTx.to, data: buyTx.data, value: buyTx.value })
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
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: buyQuote.source,
    })
    return 'attempted'
  }

  if (midReceived <= 0n) {
    console.warn('   ⚠ Leg 1 produced no output, stopping (no funds lost beyond leg 1 gas)')
    return 'attempted'
  }

  // Leg 2: fresh re-quote for the amount ACTUALLY received -- if it's no
  // longer profitable after gas, stop here and hold tokenMid rather than
  // force a losing trade.
  const sellFreshQuote = await getBestQuote(tokenMid.address, tokenBase.address, midReceived, tokenMid.decimals)
  if (!sellFreshQuote) {
    const message = `leg 1 filled, no aggregator has a route back for leg 2 -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`
    console.warn(`   ⚠ ${message}`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: buyQuote.source,
    })
    return 'attempted'
  }

  const freshProfit = sellFreshQuote.amountOut - amountIn
  if (freshProfit < requiredProfit) {
    const message = `leg 1 filled, leg 2 no longer clears the buffered gas cost after re-quote -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`
    console.warn(`   ⚠ ${message}`)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: buyQuote.source,
    })
    return 'attempted'
  }

  try {
    const sellTx = await getSwapTx(sellFreshQuote.source, tokenMid.address, tokenBase.address, midReceived, tokenMid.decimals, account.address, AGGREGATOR_SLIPPAGE_PCT)
    if (!sellTx) {
      const message = `leg 1 filled, ${sellFreshQuote.source} swap-tx fetch failed for leg 2 -- holding ${formatUnits(midReceived, tokenMid.decimals)} ${tokenMid.symbol}`
      console.warn(`   ⚠ ${message}`)
      recordArb({
        time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
        amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: buyQuote.source,
      })
      return 'attempted'
    }

    const balBaseBefore = await pub.readContract({ address: tokenBase.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint

    console.log(`   → leg 2: approve to ${sellFreshQuote.source}...`)
    const hApprove2 = await wal.writeContract({
      address: tokenMid.address, abi: ERC20_ABI, functionName: 'approve', args: [sellTx.to, midReceived],
    })
    await pub.waitForTransactionReceipt({ hash: hApprove2 })

    console.log(`   → leg 2: swap via ${sellFreshQuote.source}...`)
    const hSwap2 = await wal.sendTransaction({ to: sellTx.to, data: sellTx.data, value: sellTx.value })
    const receipt2 = await pub.waitForTransactionReceipt({ hash: hSwap2 })

    if (receipt2.status === 'success') {
      const balBaseAfter = await pub.readContract({ address: tokenBase.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] }) as bigint
      const realizedOut = balBaseAfter > balBaseBefore ? balBaseAfter - balBaseBefore : 0n
      const realizedNet = realizedOut > amountIn ? realizedOut - amountIn : 0n
      const realizedNetPct = amountIn > 0n ? Number(realizedNet * 10000n / amountIn) / 100 : 0
      console.log(`   ✅ EXTERNAL ARB COMPLETE — profit ~${formatUnits(realizedNet, tokenBase.decimals)} ${tokenBase.symbol} — ${hSwap2}`)
      totalExecuted++
      consecutiveFailures = 0
      const prev = parseFloat(cumulativeProfit[tokenBase.symbol] ?? '0')
      cumulativeProfit[tokenBase.symbol] = (prev + parseFloat(formatUnits(realizedNet, tokenBase.decimals))).toString()
      recordArb({
        time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
        amountIn: formatUnits(amountIn, tokenBase.decimals), profit: formatUnits(realizedNet, tokenBase.decimals),
        profitPct: realizedNetPct, txHash: hSwap2, status: 'success', route: sellFreshQuote.source,
      })
    } else {
      throw new Error('leg 2 transaction reverted')
    }
    return 'attempted'
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? String(err)
    console.error(`   ❌ Leg 2 failed: ${message} -- may be holding intermediate ${tokenMid.symbol}`)
    totalFailed++
    consecutiveFailures++
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      pausedUntil = Date.now() + FAILURE_PAUSE_MS
      console.error(`   Circuit breaker paused execution until ${new Date(pausedUntil).toISOString()}`)
    }
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    recordArb({
      time: new Date().toISOString(), pair: label, tokenIn: tokenBase.symbol,
      amountIn: formatUnits(amountIn, tokenBase.decimals), profit: '0', profitPct, status: 'failed', error: message, route: buyQuote.source,
    })
    return 'attempted'
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let lastAggregatorScan = 0
let lastMultiGaugeDistribution = 0

const MULTI_GAUGE_POOLS = Array.from(new Set([
  ...Object.keys(CL_GAUGES),
  ...Object.keys(DLMM_GAUGES),
])).map(address => getAddress(address) as `0x${string}`)

// Permissionless maintenance for the vote-weighted CL/DLMM reward stream.
// Reads eight epochs so a temporary keeper outage cannot strand an older
// allocation. A transaction is sent only when claimable AEON is nonzero.
async function distributeMultiGaugeRewards() {
  if (ERZA_MODE) return
  if (Date.now() - lastMultiGaugeDistribution < MULTI_GAUGE_DISTRIBUTION_INTERVAL_MS) return
  lastMultiGaugeDistribution = Date.now()

  const currentEpoch = await pub.readContract({
    address: CONTRACTS.MultiGaugeController,
    abi: MULTI_GAUGE_CONTROLLER_ABI,
    functionName: 'currentEpoch',
  })

  for (let lookback = 0n; lookback < 8n; lookback++) {
    const offset = lookback * 604800n
    if (offset > currentEpoch) break
    const epoch = currentEpoch - offset
    const reads = await pub.multicall({
      contracts: MULTI_GAUGE_POOLS.map(pool => ({
        address: CONTRACTS.MultiGaugeController,
        abi: MULTI_GAUGE_CONTROLLER_ABI,
        functionName: 'claimable' as const,
        args: [pool, epoch] as const,
      })),
      allowFailure: true,
    })
    const fundedPools = MULTI_GAUGE_POOLS.filter((_, i) =>
      reads[i]?.status === 'success' && BigInt(reads[i].result as bigint) > 0n
    )
    if (fundedPools.length === 0) continue

    const totalClaimable = reads.reduce((sum, result) =>
      result.status === 'success' ? sum + BigInt(result.result as bigint) : sum, 0n
    )
    if (DRY_RUN) {
      console.log(`[multi-gauge dry run] epoch ${epoch}: ${fundedPools.length} gauges, ${formatUnits(totalClaimable, 18)} AEON claimable`)
      continue
    }

    const { request } = await pub.simulateContract({
      account,
      address: CONTRACTS.MultiGaugeController,
      abi: MULTI_GAUGE_CONTROLLER_ABI,
      functionName: 'distributeBatch',
      args: [fundedPools, epoch],
    })
    const { hash } = await writeContractTracked(request, `multi-gauge distribution epoch ${epoch}`)
    console.log(`[multi-gauge] forwarded ${formatUnits(totalClaimable, 18)} AEON to ${fundedPools.length} gauges: ${hash}`)
  }
}

type RankedInternalCandidate =
  | { kind: 'cycle'; opp: ArbOpp }
  | { kind: 'settlement'; opp: SettlementOpp }

interface ExactShortlistResult {
  valid: RankedInternalCandidate[]
  checkedRouteKeys: Set<string>
}

function sortRankedCandidates(candidates: RankedInternalCandidate[]) {
  candidates.sort((a, b) => {
    // Profit is the primary ordering rule. Reliability and route quality
    // remain safeguards/tie-breakers, but cannot push a lower-profit token or
    // route ahead merely because it belongs to a preferred family or venue.
    const netDiff = (b.opp.expectedNetUsd ?? -Infinity) - (a.opp.expectedNetUsd ?? -Infinity)
    if (netDiff !== 0) return netDiff
    const scoreDiff = (b.opp.routeScore ?? -Infinity) - (a.opp.routeScore ?? -Infinity)
    if (scoreDiff !== 0) return scoreDiff
    const outputA = a.kind === 'settlement' ? a.opp.tokenOut.symbol : a.opp.tokenIn.symbol
    const outputB = b.kind === 'settlement' ? b.opp.tokenOut.symbol : b.opp.tokenIn.symbol
    return (SETTLEMENT_PRIORITY[outputA] ?? 99) - (SETTLEMENT_PRIORITY[outputB] ?? 99)
  })
}

// Exact quoter calls are materially more expensive than the virtual-reserve
// graph scan. Validate a small, diverse shortlist (including candidates for
// every settlement input token) before anything reaches the dashboard or
// executor. This removes false-positive WETH rows and prevents the fallback
// loop from appearing to prefer AEON merely because those failures were the
// only attempts recorded in Recent Activity.
const EXACT_QUOTE_CANDIDATES_PER_TICK = Math.max(4, Math.min(32, parseInt(process.env.EXACT_QUOTE_CANDIDATES ?? '12')))
// A zero-output or incompatible route must not consume ERZA's entire exact
// quote budget. Keep the first wave small/fair, then backfill from the ranked
// queue until a profitable exact route is found or this bounded attempt cap
// is reached. Concurrency remains separately capped below to protect the RPC.
const EXACT_QUOTE_MAX_ATTEMPTS_PER_TICK = Math.max(
  EXACT_QUOTE_CANDIDATES_PER_TICK,
  Math.min(96, parseInt(process.env.EXACT_QUOTE_MAX_ATTEMPTS ?? '36')),
)
// Two independent routes per wave proved materially more reliable on the
// dedicated Alchemy endpoint. Larger bursts caused 429s and eventually left
// the WebSocket wake-up loop reconnecting instead of helping execution speed.
const EXACT_QUOTE_CONCURRENCY = Math.max(1, Math.min(32, parseInt(process.env.EXACT_QUOTE_CONCURRENCY ?? '2')))
let explorationCursor = 0
let tokenFamilyCursor = 0

function candidateNonCoreTokens(candidate: RankedInternalCandidate): string[] {
  // WETH is settlement; USDG and AEON are common bridges. Group by the real
  // non-core assets so a VEX/VIRTUAL cycle cannot disguise itself as the
  // generic USDG family and monopolize the quote rotation.
  const core = new Set<string>(['WETH', 'USDG', 'AEON'])
  const tokens = new Set<string>()
  for (const hop of candidate.opp.hops) {
    if (!core.has(hop.tokenInSym)) tokens.add(hop.tokenInSym)
    if (!core.has(hop.tokenOutSym)) tokens.add(hop.tokenOutSym)
  }
  return tokens.size > 0 ? [...tokens].sort() : ['CORE']
}

// Approximate constant-product reserve math is only a discovery hint. It can
// materially overstate routes that later return zero from a venue's canonical
// quoter (especially concentrated-liquidity and hook-enabled pools). Keep
// final/executable candidates profit-first, but do not let the same failed
// estimate consume ERZA's bounded exact-quote budget on every scan.
const EXACT_QUOTE_MISS_RETRY_MS = Math.max(
  5_000,
  parseInt(process.env.EXACT_QUOTE_MISS_RETRY_MS ?? '60000'),
)
const exactQuoteMissRetryAt = new Map<string, number>()

function deferExactQuoteMiss(candidate: RankedInternalCandidate, reason: string) {
  if (reason !== 'exact_quote_zero_output') return
  exactQuoteMissRetryAt.set(routeKey(candidate.opp.hops), Date.now() + EXACT_QUOTE_MISS_RETRY_MS)
}

function clearExactQuoteMiss(candidate: RankedInternalCandidate) {
  exactQuoteMissRetryAt.delete(routeKey(candidate.opp.hops))
}

function candidateTokenFamily(candidate: RankedInternalCandidate): string {
  return candidateNonCoreTokens(candidate).join('+')
}

interface ExactValidationResult {
  valid: boolean
  reason: string
}

async function revalidateCandidateExact(
  candidate: RankedInternalCandidate,
  graph: Map<string, HopCandidate[]>,
  rankingGasPrice: bigint,
  cache: ExactQuoteWaveCache,
): Promise<ExactValidationResult> {
  try {
    const { opp } = candidate
    const exactOut = await quoteMixedRouteExact(opp.hops, opp.amountIn)
    if (exactOut <= 0n) return { valid: false, reason: 'exact_quote_zero_output' }

    const gasUnits = (candidate.kind === 'settlement' ? SETTLEMENT_SWAP_GAS_BASE : EXEC_ARB_BASE_GAS)
      + (candidate.kind === 'settlement' ? SETTLEMENT_SWAP_GAS_PER_HOP : EXEC_ARB_GAS_PER_HOP) * BigInt(opp.hops.length)
    const gasWei = (gasUnits * rankingGasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const gasUsdg = await exactValueInUsdgCached('WETH', gasWei, graph, cache)
    if (gasUsdg <= 0n) return { valid: false, reason: 'gas_conversion_failed' }

    if (candidate.kind === 'cycle') {
      const profitRaw = exactOut > opp.amountIn ? exactOut - opp.amountIn : 0n
      if (profitRaw <= 0n) return { valid: false, reason: 'exact_no_gross_profit' }
      const grossUsdg = await exactValueInUsdgCached(opp.tokenIn.symbol, profitRaw, graph, cache)
      if (grossUsdg <= 0n) return { valid: false, reason: 'profit_conversion_failed' }
      opp.profitRaw = profitRaw
      opp.profitPct = Number(profitRaw * 10_000n / opp.amountIn) / 100
      opp.gasCostUsd = Number(formatUnits(gasUsdg, TOKENS.USDG.decimals))
      opp.expectedNetUsd = Number(formatUnits(grossUsdg - gasUsdg, TOKENS.USDG.decimals))
      opp.routeScore = scoreOpportunity(opp, opp.expectedNetUsd)
      return { valid: true, reason: (opp.expectedNetUsd ?? -Infinity) > 0 ? 'net_profitable' : 'below_gas' }
    }

    const inUsdg = await exactValueInUsdgCached(opp.tokenIn.symbol, opp.amountIn, graph, cache)
    const outUsdg = await exactValueInUsdgCached(opp.tokenOut.symbol, exactOut, graph, cache)
    if (inUsdg <= 0n) return { valid: false, reason: 'input_conversion_failed' }
    if (outUsdg <= inUsdg) return { valid: false, reason: 'exact_no_gross_profit' }
    const profitUsdg = outUsdg - inUsdg
    opp.amountOut = exactOut
    opp.profitUsdg = profitUsdg
    opp.profitPct = Number(profitUsdg * 10_000n / inUsdg) / 100
    opp.gasCostUsd = Number(formatUnits(gasUsdg, TOKENS.USDG.decimals))
    opp.expectedNetUsd = Number(formatUnits(profitUsdg - gasUsdg, TOKENS.USDG.decimals))
    opp.routeScore = scoreOpportunity(opp, opp.expectedNetUsd)
    return { valid: true, reason: (opp.expectedNetUsd ?? -Infinity) > 0 ? 'net_profitable' : 'below_gas' }
  } catch (error) {
    return { valid: false, reason: `quote_error:${safeErrorMessage(error).slice(0, 160)}` }
  }
}

async function exactRankedShortlist(
  approximate: RankedInternalCandidate[],
  graph: Map<string, HopCandidate[]>,
  rankingGasPrice: bigint,
  cache: ExactQuoteWaveCache,
): Promise<ExactShortlistResult> {
  const quoteStartedAt = Date.now()
  const selected: RankedInternalCandidate[] = []
  const selectedSet = new Set<RankedInternalCandidate>()
  const add = (candidate: RankedInternalCandidate | undefined) => {
    if (!candidate || selected.length >= EXACT_QUOTE_CANDIDATES_PER_TICK || selectedSet.has(candidate)) return
    selected.push(candidate)
    selectedSet.add(candidate)
  }

  // A route on cooldown already failed the real executor and must not consume
  // another scarce exact-quote slot. It remains in the graph and is eligible
  // again as soon as its short route-local cooldown expires.
  const now = Date.now()
  for (const [key, retryAt] of exactQuoteMissRetryAt) {
    if (retryAt <= now) exactQuoteMissRetryAt.delete(key)
  }
  const executionEligible = approximate.filter(candidate => routeCooldownRemaining(candidate.opp.hops) <= 0)
  const eligible = executionEligible.filter(candidate => (exactQuoteMissRetryAt.get(routeKey(candidate.opp.hops)) ?? 0) <= now)
  scanTelemetry.exactDeferredQuoteMisses = executionEligible.length - eligible.length

  // Reserve the first exact-quote slots for the highest estimated net profit
  // across the entire eligible graph. Token identity, venue, and hop count do
  // not receive priority; the later fair rotation only fills remaining slots.
  for (const candidate of eligible.slice(0, 4)) add(candidate)

  const proven = eligible
    .filter(candidate => historicalStats(candidate.opp.hops).successes > 0)
    .sort((a, b) => {
      const ah = historicalStats(a.opp.hops), bh = historicalStats(b.opp.hops)
      const aRate = (ah.successes + 1) / (ah.successes + ah.failures + 2)
      const bRate = (bh.successes + 1) / (bh.successes + bh.failures + 2)
      return (bh.successes * bRate) - (ah.successes * aRate)
        || (b.opp.routeScore ?? -Infinity) - (a.opp.routeScore ?? -Infinity)
    })

  // External-only routes get ERZA's first exact-quote slots. Mixed routes are
  // still eligible immediately afterwards when they offer materially more net
  // profit, while pure AEON routes were already removed by the role filter.
  if (KEEPER_ROLE === 'external-first') {
    const externalEligible = eligible.filter(candidate =>
      candidate.opp.hops.every(hop => !isAeonPoolKind(hop.pool.pool.kind)),
    )
    add(externalEligible[0] ?? eligible[0])

    // Give every distinct token family rotating exact-quote slots. Include
    // mixed routes too; routeAllowedForRole already guarantees every ERZA
    // candidate touches an external venue.
    // Rotate individual tokens, not every multi-token combination. A dense
    // five-hop graph produced 1,124 combination keys for only ~70 actual
    // tokens, making one fairness round take hours. Individual-token rotation
    // guarantees practical coverage while still selecting the best currently
    // ranked route containing that token.
    const familyKeys = [...new Set(eligible.flatMap(candidateNonCoreTokens))].sort()
    scanTelemetry.exactFamilyQueueSize = familyKeys.length
    scanTelemetry.exactFamilyCursor = familyKeys.length > 0 ? tokenFamilyCursor % familyKeys.length : 0
    const targetSelected = EXACT_QUOTE_CANDIDATES_PER_TICK
    let considered = 0
    while (selected.length < targetSelected && considered < familyKeys.length) {
      const family = familyKeys[(tokenFamilyCursor + considered) % familyKeys.length]
      add(eligible.find(candidate => candidateNonCoreTokens(candidate).includes(family)))
      considered++
    }
    if (familyKeys.length > 0) tokenFamilyCursor = (tokenFamilyCursor + considered) % familyKeys.length
  }

  // Then explicitly diversify across funded inputs and venue families before
  // history is allowed to fill the remaining budget.
  for (const symbol of SETTLEMENT_TOKENS) {
    add(eligible.find(candidate => candidate.opp.tokenIn.symbol === symbol))
  }
  if (KEEPER_ROLE === 'mirajane' || KEEPER_ROLE === 'external-only' || KEEPER_ROLE === 'external-first') {
    add(eligible.find(candidate => candidate.opp.hops.every(hop => !isAeonPoolKind(hop.pool.pool.kind))))
    if (KEEPER_ROLE === 'mirajane' || KEEPER_ROLE === 'external-first') {
      add(eligible.find(candidate => {
        const internal = candidate.opp.hops.some(hop => isAeonPoolKind(hop.pool.pool.kind))
        const external = candidate.opp.hops.some(hop => !isAeonPoolKind(hop.pool.pool.kind))
        return internal && external
      }))
    }
    for (const kind of ['uniV2', 'uniV3', 'uniV4'] as PoolKind[]) {
      add(eligible.find(candidate => candidate.opp.hops.some(hop => hop.pool.pool.kind === kind)))
    }
  } else if (KEEPER_ROLE === 'aeon-only') {
    for (const kind of ['vAMM', 'CL', 'DLMM'] as PoolKind[]) {
      add(eligible.find(candidate => candidate.opp.hops.some(hop => hop.pool.pool.kind === kind)))
    }
  }

  // One rotating exploration candidate guarantees that an unproven family
  // can establish its own success history instead of being permanently
  // buried behind known routes.
  const unproven = eligible.filter(candidate => historicalStats(candidate.opp.hops).successes === 0)
  if (unproven.length > 0) {
    const explorationSlots = Math.min(3, unproven.length)
    for (let i = 0; i < explorationSlots; i++) {
      add(unproven[(explorationCursor + i) % unproven.length])
    }
    explorationCursor += explorationSlots
  }
  for (const candidate of proven) add(candidate)
  for (const candidate of eligible) add(candidate)

  // The initial fair wave above is capped at EXACT_QUOTE_CANDIDATES_PER_TICK.
  // Append ranked backfills so quote_zero_output failures do not leave ERZA
  // with only one genuinely checked route out of a graph containing hundreds
  // of pools. These are checked only after every fair-wave slot has run.
  const fairWaveSize = selected.length
  if (ERZA_MODE && selected.length < EXACT_QUOTE_MAX_ATTEMPTS_PER_TICK) {
    for (const candidate of eligible) {
      if (selected.length >= EXACT_QUOTE_MAX_ATTEMPTS_PER_TICK) break
      if (selectedSet.has(candidate)) continue
      selected.push(candidate)
      selectedSet.add(candidate)
    }
  }

  // Current net profit, not historical identity, gets the first exact quote.
  // History remains a score/reliability input but cannot monopolize ERZA's
  // immediate slot merely because one token family traded successfully first.
  const immediateIndex = selected.findIndex(candidate => (candidate.opp.expectedNetUsd ?? -Infinity) > 0)
  if (immediateIndex > 0) {
    const [immediate] = selected.splice(immediateIndex, 1)
    selected.unshift(immediate)
  }

  scanTelemetry.exactSelected = selected.length
  scanTelemetry.exactSelectedFamilies = selected.map(candidateTokenFamily)
  scanTelemetry.exactSelectedRoutes = selected.map(candidate => candidate.opp.label)
  scanTelemetry.exactValidRoutes = []
  scanTelemetry.exactRejectedRoutes = []
  scanTelemetry.historyProvenSelected = selected.filter(candidate => historicalStats(candidate.opp.hops).successes > 0).length
  scanTelemetry.exactChecked = 0
  scanTelemetry.exactValid = 0
  const valid: RankedInternalCandidate[] = []
  const checkedRouteKeys = new Set<string>()

  let nextIndex = 0
  if (selected.length > 0) {
    const immediate = selected[0]
    const result = await revalidateCandidateExact(immediate, graph, rankingGasPrice, cache)
    checkedRouteKeys.add(routeKey(immediate.opp.hops))
    if (result.valid) {
      clearExactQuoteMiss(immediate)
      valid.push(immediate)
      scanTelemetry.exactValidRoutes.push(immediate.opp.label)
    } else {
      deferExactQuoteMiss(immediate, result.reason)
      scanTelemetry.exactRejectedRoutes.push({
        pair: immediate.opp.label,
        family: candidateTokenFamily(immediate),
        reason: result.reason,
      })
    }
    scanTelemetry.exactChecked = 1
    scanTelemetry.exactValid = valid.length
    nextIndex = 1
    // Other roles may take the first fresh profitable route immediately.
    // ERZA must finish the fair family wave; otherwise the first VEX/VIRTUAL
    // success prevents every remaining token family from being quoted.
    if (!ERZA_MODE && result.valid && (immediate.opp.expectedNetUsd ?? -Infinity) > 0) {
      sortRankedCandidates(valid)
      scanTelemetry.exactQuoteMs = Date.now() - quoteStartedAt
      return { valid, checkedRouteKeys }
    }
  }

  for (let i = nextIndex; i < selected.length; i += EXACT_QUOTE_CONCURRENCY) {
    const batch = selected.slice(i, i + EXACT_QUOTE_CONCURRENCY)
    const results = await Promise.all(batch.map(candidate => revalidateCandidateExact(candidate, graph, rankingGasPrice, cache)))
    for (let j = 0; j < batch.length; j++) {
      checkedRouteKeys.add(routeKey(batch[j].opp.hops))
      if (results[j].valid) {
        clearExactQuoteMiss(batch[j])
        valid.push(batch[j])
        scanTelemetry.exactValidRoutes.push(batch[j].opp.label)
      } else if (scanTelemetry.exactRejectedRoutes.length < EXACT_QUOTE_MAX_ATTEMPTS_PER_TICK) {
        deferExactQuoteMiss(batch[j], results[j].reason)
        scanTelemetry.exactRejectedRoutes.push({
          pair: batch[j].opp.label,
          family: candidateTokenFamily(batch[j]),
          reason: results[j].reason,
        })
      }
    }
    const checked = i + batch.length
    scanTelemetry.exactChecked = checked
    scanTelemetry.exactValid = valid.length
    if (!ERZA_MODE && valid.some(candidate => (candidate.opp.expectedNetUsd ?? -Infinity) > 0)) break
    if (ERZA_MODE && checked >= fairWaveSize && valid.some(candidate => (candidate.opp.expectedNetUsd ?? -Infinity) > 0)) break
  }
  sortRankedCandidates(valid)
  scanTelemetry.exactQuoteMs = Date.now() - quoteStartedAt
  return { valid, checkedRouteKeys }
}

// Bounds how many already-exact candidates are attempted per tick.
const EXECUTION_CANDIDATES_PER_TICK = 10

async function attemptRankedCandidates(
  candidates: RankedInternalCandidate[],
  graph: Map<string, HopCandidate[]>,
  availableEthForWrap: bigint,
): Promise<boolean> {
  const touchedPools = new Set<string>()
  const committedInputs = new Set<string>()
  let attempted = false
  for (const candidate of candidates.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
    const { opp } = candidate
    const finalToken = opp.hops.at(-1)?.tokenOutSym
    if (candidate.kind !== 'cycle' || finalToken !== opp.tokenIn.symbol) {
      console.error(`   BLOCKED non-closing route: ${opp.label}`)
      continue
    }
    if ((opp.expectedNetUsd ?? -Infinity) <= 0 || opp.profitPct < MIN_PROFIT_PCT) continue
    if (routeCooldownRemaining(opp.hops) > 0) continue
    const inSym = opp.tokenIn.symbol
    const poolsUsed = opp.hops.map(hop => poolStateKey(hop.pool.pool))
    if (committedInputs.has(inSym) || poolsUsed.some(pool => touchedPools.has(pool))) continue
    const result = await executeArb(opp, graph, availableEthForWrap)
    if (result === 'attempted') {
      attempted = true
      committedInputs.add(inSym)
      for (const pool of poolsUsed) touchedPools.add(pool)
    }
  }
  return attempted
}

async function tick(changedPoolKeys?: Set<string>, observedBlock?: bigint) {
  const t0 = Date.now()
  scanTelemetry.lastBlock = observedBlock?.toString() ?? scanTelemetry.lastBlock
  scanTelemetry.mode = changedPoolKeys
    ? (changedPoolKeys.size > 0 ? 'incremental' : 'gas-only')
    : 'full'
  scanTelemetry.changedPools = changedPoolKeys?.size ?? ARB_POOLS.length
  scanTelemetry.stateReadMs = 0
  scanTelemetry.balanceReadMs = 0
  scanTelemetry.localSearchMs = 0
  scanTelemetry.exactQuoteMs = 0
  scanTelemetry.exactSelected = 0
  scanTelemetry.exactChecked = 0
  scanTelemetry.exactValid = 0
  scanTelemetry.historyProvenSelected = 0
  scanTelemetry.fastLaneCandidates = 0
  scanTelemetry.fastLaneChecked = 0
  scanTelemetry.fastLaneValid = 0
  scanTelemetry.fastLaneMs = 0
  scanTelemetry.dirtyRouteCandidates = 0
  scanTelemetry.approximateCandidates = 0
  scanTelemetry.routeVisits = 0
  scanTelemetry.marginalPruned = 0
  scanTelemetry.sizedRoutes = 0
  if (!changedPoolKeys) scanTelemetry.fullScans++
  else if (changedPoolKeys.size > 0) scanTelemetry.incrementalScans++
  else scanTelemetry.gasOnlyScans++

  try {
    cachedGasPrice = await pub.getGasPrice()
  } catch { /* leave null -- gasCostFloorInToken falls back to a live fetch per-candidate this tick */ }

  try {
    await distributeMultiGaugeRewards()
  } catch (err: any) {
    const message = err?.message ?? String(err)
    console.error(`[multi-gauge distribution error] ${message}`)
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
  }

  if (!poolDiscoveryInFlight && Date.now() - lastPoolRefresh >= POOL_REFRESH_INTERVAL_MS) {
    lastPoolRefresh = Date.now()
    poolDiscoveryInFlight = true
    const refreshStartedAt = Date.now()
    void (async () => {
      const before = ARB_POOLS.length
      const counts = await refreshPoolDiscovery()
      const added = ARB_POOLS.length - before
      if (added > 0) {
        poolStateCacheReady = false
        console.log(`\n[${new Date().toISOString()}] Pool discovery refresh: +${added} new pools (now ${ARB_POOLS.length} monitored) -- uniV2:${counts.uniswapV2} uniV3:${counts.uniswapV3} uniV4:${counts.uniswapV4} CL:${counts.cl} DLMM:${counts.dlmm}`)
      }
      console.log(`[pool discovery refresh complete] ${Date.now() - refreshStartedAt}ms`)
    })().catch((err: any) => {
      const message = err?.message ?? String(err)
      console.error(`[pool discovery refresh error] ${message}`)
      recentErrors.unshift({ time: new Date().toISOString(), message })
      recentErrors = recentErrors.slice(0, 5)
    }).finally(() => { poolDiscoveryInFlight = false })
  }
  let states: PoolState[]
  const stateReadStartedAt = Date.now()
  try {
    states = await fetchAllStates(changedPoolKeys)
    scanTelemetry.stateReadMs = Date.now() - stateReadStartedAt
    scanTelemetry.inactivePools = ARB_POOLS
      .filter(pool => !poolStateCache.has(poolStateKey(pool)))
      .map(pool => pool.name)
  } catch (err: any) {
    const message = err?.message ?? String(err)
    console.error(`[RPC error] ${message}`)
    recentErrors.unshift({ time: new Date().toISOString(), message })
    recentErrors = recentErrors.slice(0, 5)
    return
  }

  // Reuse the opening-tick gas price. Fetching it again here added another
  // RPC round trip without improving freshness inside the same block.
  const rankingGasPrice = cachedGasPrice ?? await pub.getGasPrice()
  const graph = buildGraph(states)
  const balanceReadStartedAt = Date.now()
  let balanceSnapshot = await fetchBalances(rankingGasPrice)
  // Reuse the batched balance snapshot rather than issuing a separate WETH
  // balance RPC every block. Refresh balances only if an unwrap actually ran.
  if (await unwrapIdleWeth(balanceSnapshot.balances.WETH ?? 0n)) {
    balanceSnapshot = await fetchBalances(rankingGasPrice)
  }
  if (!balanceSnapshot.gasReserveHealthy) {
    const refilled = await ensureNativeGasReserve(balanceSnapshot.nativeEth, balanceSnapshot.gasReserveWei, rankingGasPrice, graph)
    if (refilled) balanceSnapshot = await fetchBalances(rankingGasPrice)
  }
  scanTelemetry.balanceReadMs = Date.now() - balanceReadStartedAt
  const { balances, searchBalances, nativeEth, availableEthForWrap, gasReserveWei, gasReserveHealthy } = balanceSnapshot
  const bases = candidateBaseTokens(searchBalances)
  const localSearchStartedAt = Date.now()
  // Signed, NOT floored at zero -- this feeds the dashboard's "net est."
  // figure too, and a trade that doesn't clear gas needs to show as
  // negative there, not as a misleading "$0.0000" sitting next to a
  // positive-looking gross profit number.
  // There are normally hundreds of approximate routes but only three
  // settlement currencies and a handful of hop counts. Cache the identical
  // spot-conversion work instead of running a BFS twice for every route.
  const usdgConversionPaths = new Map<string, HopCandidate[] | null>()
  const usdgPathFor = (tokenSym: string): HopCandidate[] | null => {
    if (!usdgConversionPaths.has(tokenSym)) {
      usdgConversionPaths.set(tokenSym, tokenSym === 'USDG' ? [] : findConversionPath(graph, tokenSym, 'USDG'))
    }
    return usdgConversionPaths.get(tokenSym)!
  }
  const valueInUsdgCached = (tokenSym: string, amount: bigint): bigint => {
    const path = usdgPathFor(tokenSym)
    return path ? convertSpot(amount, path) : 0n
  }
  const gasUsdgByHopCount = new Map<number, bigint>()
  const gasUsdgFor = (opp: ArbOpp) => {
    const cached = gasUsdgByHopCount.get(opp.hops.length)
    if (cached !== undefined) return cached
    const gasUnits = EXEC_ARB_BASE_GAS + EXEC_ARB_GAS_PER_HOP * BigInt(opp.hops.length)
    const gasWei = (gasUnits * rankingGasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const gasUsdg = valueInUsdgCached('WETH', gasWei)
    gasUsdgByHopCount.set(opp.hops.length, gasUsdg)
    return gasUsdg
  }
  const expectedNetUsdg = (opp: ArbOpp) => valueInUsdgCached(opp.tokenIn.symbol, opp.profitRaw) - gasUsdgFor(opp)
  const enrichCycleOpportunities = (cycleOpps: ArbOpp[]) => {
    for (const opp of cycleOpps) {
      const netUsd = Number(formatUnits(expectedNetUsdg(opp), TOKENS.USDG.decimals))
      opp.expectedNetUsd = netUsd
      opp.gasCostUsd = Number(formatUnits(gasUsdgFor(opp), TOKENS.USDG.decimals))
      opp.routeScore = scoreOpportunity(opp, netUsd)
    }
  }
  const dirtyRouteConstraint = changedPoolKeys?.size ? changedPoolKeys : undefined

  // Proven-route fast lane: rebuild successful historical venue/token shapes
  // from the freshly read graph and exact-quote them before the exhaustive
  // DFS. A transaction attempt ends this tick so a fresh state snapshot is
  // always used afterwards; otherwise the normal all-route search continues.
  const fastLaneStartedAt = Date.now()
  const fastLaneOpps = ERZA_MODE
    ? []
    : findHistoricalArbs(graph, bases, searchBalances, dirtyRouteConstraint)
  enrichCycleOpportunities(fastLaneOpps)
  const fastLaneCandidates: RankedInternalCandidate[] = fastLaneOpps
    .map(opp => ({ kind: 'cycle' as const, opp }))
    .filter(candidate => routeAllowedForRole(candidate.opp.hops))
  sortRankedCandidates(fastLaneCandidates)
  const exactQuoteCache: ExactQuoteWaveCache = {
    conversionPaths: new Map(),
    exactValues: new Map(),
  }
  scanTelemetry.fastLaneCandidates = fastLaneCandidates.length
  const fastLaneResult = await exactRankedShortlist(fastLaneCandidates, graph, rankingGasPrice, exactQuoteCache)
  scanTelemetry.fastLaneChecked = fastLaneResult.checkedRouteKeys.size
  scanTelemetry.fastLaneValid = fastLaneResult.valid.length
  scanTelemetry.fastLaneMs = Date.now() - fastLaneStartedAt
  outcomeCounters.detected += fastLaneResult.valid.length

  let anyAttempted = false
  if (gasReserveHealthy && fastLaneResult.valid.length > 0) {
    console.log(`\n[${new Date().toISOString()}] Fast lane: ${fastLaneResult.valid.length} exact profitable proven route(s) in ${scanTelemetry.fastLaneMs}ms`)
    anyAttempted = await attemptRankedCandidates(fastLaneResult.valid, graph, availableEthForWrap)
    if (anyAttempted) {
      scanTelemetry.fastLaneAttempts++
      const fastTickMs = Date.now() - t0
      await writeStatus(fastLaneResult.valid.map(candidate => candidate.opp), fastTickMs, balances, nativeEth, gasReserveWei, gasReserveHealthy, graph)
      return
    }
  }

  const opps = bases.flatMap(baseSym =>
    findArbs(graph, baseSym, searchBalances[baseSym] ?? 0n, dirtyRouteConstraint),
  )
  enrichCycleOpportunities(opps)
  const settlementOpps = SAME_TOKEN_ONLY
    ? []
    : bases.flatMap(baseSym =>
        findSettlementRoutes(graph, baseSym, searchBalances[baseSym] ?? 0n, dirtyRouteConstraint),
      )
  // Settlement profit is already USDG-denominated. Put it through the same
  // post-gas and reliability score as a cycle so neither route class can
  // starve the other merely because it is dispatched first in the code.
  for (const opp of settlementOpps) {
    const gasUnits = SETTLEMENT_SWAP_GAS_BASE + SETTLEMENT_SWAP_GAS_PER_HOP * BigInt(opp.hops.length)
    const gasWei = (gasUnits * rankingGasPrice * GAS_SAFETY_MULT_PCT) / 100n
    const gasUsdg = valueInUsdg('WETH', gasWei, graph)
    const netUsd = Number(formatUnits(opp.profitUsdg - gasUsdg, TOKENS.USDG.decimals))
    opp.expectedNetUsd = netUsd
    opp.gasCostUsd = Number(formatUnits(gasUsdg, TOKENS.USDG.decimals))
    opp.routeScore = scoreOpportunity(opp, netUsd)
  }

  let approximateCandidates: RankedInternalCandidate[] = [
    ...opps.map(opp => ({ kind: 'cycle' as const, opp })),
    ...settlementOpps.map(opp => ({ kind: 'settlement' as const, opp })),
  ].filter(candidate => routeAllowedForRole(candidate.opp.hops))
  if (fastLaneResult.checkedRouteKeys.size > 0) {
    approximateCandidates = approximateCandidates.filter(candidate =>
      !fastLaneResult.checkedRouteKeys.has(routeKey(candidate.opp.hops)),
    )
  }
  // On an event-driven scan, a route whose pools did not change cannot have
  // developed a new reserve edge. Restricting the expensive exact-quote wave
  // to routes touching the changed pool is the defender's main latency win.
  // Full and gas-only scans still consider every role-eligible route.
  if (changedPoolKeys && changedPoolKeys.size > 0) {
    approximateCandidates = approximateCandidates.filter(candidate =>
      candidate.opp.hops.some(hop => changedPoolKeys.has(poolStateKey(hop.pool.pool))),
    )
    scanTelemetry.dirtyRouteCandidates = approximateCandidates.length
  }
  scanTelemetry.approximateCandidates = approximateCandidates.length
  sortRankedCandidates(approximateCandidates)
  scanTelemetry.localSearchMs = Date.now() - localSearchStartedAt
  const { valid: rankedCandidates } = await exactRankedShortlist(approximateCandidates, graph, rankingGasPrice, exactQuoteCache)
  outcomeCounters.detected += rankedCandidates.length
  const tickMs = Date.now() - t0

  // Candidates were all sized from the same opening snapshot. Once one is
  // submitted (successfully or not), stop and rescan fresh state before
  // considering another route -- this avoids paying gas for stale
  // candidates after the first transaction changes pool reserves. Applies
  // across BOTH cyclic and settlement routes: at most one state-changing
  // attempt per tick, whichever kind fires first.
  if (!gasReserveHealthy) {
    console.warn(`\n[${new Date().toISOString()}] Execution disabled: gas wallet ${formatEther(nativeEth)} ETH is below reserve ${formatEther(gasReserveWei)} ETH`)
  } else if (rankedCandidates.length === 0) {
    process.stdout.write(`\r[${new Date().toISOString()}] No arb found (${tickMs}ms) — ${states.length}/${ARB_POOLS.length} pools live, base tokens: ${bases.join(',') || 'none'}`)
  } else {
    console.log(`\n[${new Date().toISOString()}] ${rankedCandidates.length} opportunities (${opps.length} cycles, ${settlementOpps.length} cross-settlement):`)
    for (const { opp: o } of rankedCandidates.slice(0, 5)) {
      console.log(`  ${o.label}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenIn.decimals)} ${o.tokenIn.symbol})`)
    }
    anyAttempted = await attemptRankedCandidates(rankedCandidates, graph, availableEthForWrap)
  }

  // Cross-venue (OpenOcean / 1inch) scan runs on its own slower cadence --
  // reuses this tick's already-fetched states/graph/balances, only adding
  // aggregator API calls, not extra pool or balance reads.
  if (!anyAttempted && gasReserveHealthy && ENABLE_CROSS_VENUE && Date.now() - lastAggregatorScan >= AGGREGATOR_SCAN_INTERVAL_MS) {
    lastAggregatorScan = Date.now()
    let aggAttempted = false
    try {
      const aggOpps = await scanAggregatorArbs(states, searchBalances, bases)
      if (aggOpps.length > 0) {
        console.log(`\n[${new Date().toISOString()}] ${aggOpps.length} cross-venue opportunities:`)
        for (const o of aggOpps.slice(0, 3)) {
          console.log(`  ${o.label}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenBase.decimals)} ${o.tokenBase.symbol})`)
        }
        if (ATOMIC_ONLY) {
          console.log('  [SCAN ONLY] non-atomic cross-venue execution disabled')
        } else {
          for (const opp of aggOpps.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
            if (opp.profitPct < MIN_PROFIT_PCT) break
            const result = await executeAggregatorArb(opp, graph, availableEthForWrap)
            if (result === 'attempted') { aggAttempted = true; break }
          }
        }
      }
    } catch (err: any) {
      const message = err?.message ?? String(err)
      console.error(`[aggregator scan error] ${message}`)
      recentErrors.unshift({ time: new Date().toISOString(), message })
      recentErrors = recentErrors.slice(0, 5)
    }

    // Pure external-to-external arb (see scanExternalToExternalArbs above)
    // is the lowest-priority tier -- AEON's own pools, then settlement
    // routes, then AEON-pool-vs-aggregator cross-venue, all get first crack
    // every cycle; this only gets a turn if NONE of those already acted.
    if (!anyAttempted && !aggAttempted) {
      try {
        const externalOpps = await scanExternalToExternalArbs(searchBalances, bases)
        if (externalOpps.length > 0) {
          console.log(`\n[${new Date().toISOString()}] ${externalOpps.length} pure external-to-external opportunities:`)
          for (const o of externalOpps.slice(0, 3)) {
            console.log(`  ${o.label}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenBase.decimals)} ${o.tokenBase.symbol})`)
          }
          if (ATOMIC_ONLY) {
            console.log('  [SCAN ONLY] non-atomic external execution disabled')
          } else {
            for (const opp of externalOpps.slice(0, EXECUTION_CANDIDATES_PER_TICK)) {
              if (opp.profitPct < MIN_PROFIT_PCT) break
              const result = await executeExternalArb(opp, graph, availableEthForWrap)
              if (result === 'attempted') break
            }
          }
        }
      } catch (err: any) {
        const message = err?.message ?? String(err)
        console.error(`[external arb scan error] ${message}`)
        recentErrors.unshift({ time: new Date().toISOString(), message })
        recentErrors = recentErrors.slice(0, 5)
      }
    }
  }

  await writeStatus(rankedCandidates.map(candidate => candidate.opp), tickMs, balances, nativeEth, gasReserveWei, gasReserveHealthy, graph)
}

interface DiscoveryCounts {
  aeonVamm: number
  uniswapV2: number
  uniswapV3: number
  uniswapV4: number
  cl: number
  dlmm: number
}

async function refreshPoolDiscovery(includeRemoteExternal = true): Promise<DiscoveryCounts> {
  if (ERZA_MODE) {
    enforcePoolUniverseForRole()
    await validateMirajaneV3Pools()
    let aeonVamm = 0
    let cl = 0
    let dlmm = 0
    if (KEEPER_ROLE === 'external-first' && includeRemoteExternal) {
      aeonVamm = await discoverAeonVammPools()
      const aeonConcentrated = await discoverClAndDlmmPools()
      cl = aeonConcentrated.cl
      dlmm = aeonConcentrated.dlmm
      enforcePoolUniverseForRole()
    }
    if (POOL_ALLOWLIST_ACTIVE) {
      applyPoolAllowlist()
      enforcePoolUniverseForRole()
      return { aeonVamm, uniswapV2: 0, uniswapV3: 0, uniswapV4: 0, cl, dlmm }
    }
    if (!includeRemoteExternal) {
      return { aeonVamm, uniswapV2: 0, uniswapV3: 0, uniswapV4: 0, cl, dlmm }
    }
    const universe = await discoverRobinhoodUniswapUniverse()
    enforcePoolUniverseForRole()
    return {
      aeonVamm,
      uniswapV2: universe.v2,
      uniswapV3: universe.v3,
      uniswapV4: universe.v4,
      cl,
      dlmm,
    }
  }
  const aeonVamm = await discoverAeonVammPools()
  const { cl, dlmm } = await discoverClAndDlmmPools()
  if (KEEPER_ROLE === 'aeon-only') {
    enforcePoolUniverseForRole()
    return { aeonVamm, uniswapV2: 0, uniswapV3: 0, uniswapV4: 0, cl, dlmm }
  }
  if (POOL_ALLOWLIST_ACTIVE) {
    // Allowlist mode: skip every remote external discovery (the slow part).
    // Still run the local CL/DLMM registration so any allowlisted CL/DLMM
    // pool gets its proper (Algebra / LB) quoting path, then hard-filter
    // ARB_POOLS down to exactly the allowlist.
    applyPoolAllowlist()
    return { aeonVamm, uniswapV2: 0, uniswapV3: 0, uniswapV4: 0, cl, dlmm }
  }
  // The curated Mirajane manifest is a fast seed, not a permanent blindfold.
  // Validate its V3 entries and then discover newly live external venues too.
  await validateMirajaneV3Pools()
  if (!includeRemoteExternal) {
    return { aeonVamm, uniswapV2: 0, uniswapV3: 0, uniswapV4: 0, cl, dlmm }
  }
  const uniswapV2 = await discoverUniswapPools()
  const uniswapV3 = await discoverHighVolumeUniswapV3Pools()
  const uniswapV4 = await discoverHighVolumeUniswapV4Pools()
  return { aeonVamm, uniswapV2, uniswapV3, uniswapV4, cl, dlmm }
}

let lastPoolRefresh = 0
let poolDiscoveryInFlight = false

let eventWatchPoolCount = -1
let directEventPoolKeys = new Map<string, string[]>()
let v4EventPoolKeys = new Map<string, string>()
let eventWatchAddresses: `0x${string}`[] = []
let lastEventScanWarning = 0
let latestWebSocketHead: bigint | null = null
let webSocketHeadSequence = 0
let consumedWebSocketHeadSequence = 0
let resolveWebSocketHeadWait: (() => void) | null = null
let stopWebSocketHeadWatch: (() => void) | null = null
let webSocketReconnectTimer: ReturnType<typeof setTimeout> | null = null
let webSocketReconnectAttempt = 0

function signalWebSocketWaiter() {
  const resolve = resolveWebSocketHeadWait
  resolveWebSocketHeadWait = null
  resolve?.()
}

function cancelScheduledWebSocketReconnect() {
  if (webSocketReconnectTimer) clearTimeout(webSocketReconnectTimer)
  webSocketReconnectTimer = null
  scanTelemetry.webSocketNextReconnectAt = ''
}

function scheduleWebSocketHeadReconnect() {
  if (!wsPub || webSocketReconnectTimer) return
  const delay = Math.min(
    WS_RECONNECT_MAX_MS,
    WS_RECONNECT_BASE_MS * (2 ** Math.min(webSocketReconnectAttempt, 8)),
  )
  webSocketReconnectAttempt++
  scanTelemetry.webSocketNextReconnectAt = new Date(Date.now() + delay).toISOString()
  webSocketReconnectTimer = setTimeout(() => {
    webSocketReconnectTimer = null
    scanTelemetry.webSocketNextReconnectAt = ''
    scanTelemetry.webSocketReconnectAttempts++
    const stop = stopWebSocketHeadWatch
    stopWebSocketHeadWatch = null
    try { stop?.() } catch { /* already closed */ }
    startWebSocketHeadFeed()
  }, delay)
}

function startWebSocketHeadFeed() {
  if (!wsPub || stopWebSocketHeadWatch) return
  try {
    stopWebSocketHeadWatch = wsPub.watchBlockNumber({
      emitOnBegin: true,
      emitMissed: true,
      poll: false,
      onBlockNumber(blockNumber) {
        const recovered = !scanTelemetry.webSocketConnected && scanTelemetry.webSocketErrors > 0
        latestWebSocketHead = blockNumber
        webSocketHeadSequence++
        scanTelemetry.webSocketConnected = true
        scanTelemetry.webSocketLastHeadAt = new Date().toISOString()
        if (recovered) scanTelemetry.webSocketRecoveries++
        webSocketReconnectAttempt = 0
        cancelScheduledWebSocketReconnect()
        signalWebSocketWaiter()
      },
      onError(error) {
        scanTelemetry.webSocketConnected = false
        scanTelemetry.webSocketErrors++
        if (Date.now() - lastEventScanWarning > 30_000) {
          lastEventScanWarning = Date.now()
          console.warn(`[websocket fallback] ${safeErrorMessage(error)} -- HTTP block polling remains active`)
        }
        signalWebSocketWaiter()
        scheduleWebSocketHeadReconnect()
      },
    })
  } catch (error: any) {
    scanTelemetry.webSocketConnected = false
    scanTelemetry.webSocketErrors++
    console.warn(`[websocket fallback] ${safeErrorMessage(error)} -- HTTP block polling remains active`)
    scheduleWebSocketHeadReconnect()
  }
}

async function nextObservedBlock(): Promise<bigint> {
  if (!wsPub) return pub.getBlockNumber()
  if (latestWebSocketHead !== null && webSocketHeadSequence !== consumedWebSocketHeadSequence) {
    consumedWebSocketHeadSequence = webSocketHeadSequence
    return latestWebSocketHead
  }

  const startingSequence = webSocketHeadSequence
  await new Promise<void>(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (resolveWebSocketHeadWait === finish) resolveWebSocketHeadWait = null
      resolve()
    }
    const timer = setTimeout(finish, WS_FALLBACK_POLL_MS)
    resolveWebSocketHeadWait = finish
    // Close the tiny race where a head arrived between the pre-check above
    // and installing this waiter.
    if (webSocketHeadSequence !== startingSequence) finish()
  })

  if (latestWebSocketHead !== null && webSocketHeadSequence !== consumedWebSocketHeadSequence) {
    consumedWebSocketHeadSequence = webSocketHeadSequence
    return latestWebSocketHead
  }
  scanTelemetry.webSocketFallbackPolls++
  return pub.getBlockNumber()
}

function rebuildEventWatchIndex() {
  if (eventWatchPoolCount === ARB_POOLS.length) return
  directEventPoolKeys = new Map()
  v4EventPoolKeys = new Map()
  for (const pool of ARB_POOLS) {
    const key = poolStateKey(pool)
    if (pool.kind === 'uniV4' && pool.v4PoolId) {
      v4EventPoolKeys.set(pool.v4PoolId.toLowerCase(), key)
      continue
    }
    const address = pool.address.toLowerCase()
    const keys = directEventPoolKeys.get(address) ?? []
    keys.push(key)
    directEventPoolKeys.set(address, keys)
  }
  eventWatchAddresses = [
    ...Array.from(directEventPoolKeys.keys()).map(address => getAddress(address)),
    UNISWAP_V4.poolManager,
  ]
  eventWatchPoolCount = ARB_POOLS.length
}

// Returns null when the log query itself is unavailable; callers respond by
// doing a conservative full refresh rather than trusting incomplete state.
async function detectChangedPoolKeys(fromBlock: bigint, toBlock: bigint): Promise<Set<string> | null> {
  rebuildEventWatchIndex()
  try {
    const logs = await pub.getLogs({
      address: eventWatchAddresses as any,
      fromBlock,
      toBlock,
    } as any)
    const changed = new Set<string>()
    const poolManager = UNISWAP_V4.poolManager.toLowerCase()
    for (const log of logs as any[]) {
      const address = String(log.address ?? '').toLowerCase()
      if (address === poolManager) {
        const id = String(log.topics?.[1] ?? '').toLowerCase()
        const key = v4EventPoolKeys.get(id)
        if (key) changed.add(key)
        continue
      }
      for (const key of directEventPoolKeys.get(address) ?? []) changed.add(key)
    }
    return changed
  } catch (err: any) {
    if (Date.now() - lastEventScanWarning > 30_000) {
      lastEventScanWarning = Date.now()
      console.warn(`[event scan fallback] ${err?.shortMessage ?? err?.message ?? err} -- performing full state refresh`)
    }
    return null
  }
}

async function main() {
  let discoveryCounts: DiscoveryCounts | null = null
  let retryDelayMs = 1000
  while (!discoveryCounts) {
    try {
      // Mirajane already has a validated curated seed. Remote factory/API
      // expansion runs later in the background and must never block startup.
      // Start from ERZA's validated curated seed immediately. The first tick
      // launches broader external discovery in the background so startup and
      // transaction readiness never wait on factory/API enumeration.
      discoveryCounts = await refreshPoolDiscovery(!MIRAJANE_MODE && !ERZA_MODE)
    } catch (err: any) {
      const message = err?.message ?? String(err)
      console.error(`[startup discovery error] ${message}; retrying in ${retryDelayMs}ms`)
      await new Promise(r => setTimeout(r, retryDelayMs))
      retryDelayMs = Math.min(30_000, retryDelayMs * 2)
    }
  }
  const { aeonVamm: aeonVammPools, uniswapV2: uniswapPools, uniswapV3: uniswapV3Pools, uniswapV4: uniswapV4Pools, cl: clPools, dlmm: dlmmPools } = discoveryCounts
  lastPoolRefresh = ERZA_MODE ? 0 : Date.now()
  console.log(`ERZA External Arb Keeper`)
  console.log(`  Keeper address: ${account.address}`)
  console.log(`  Keeper role: ${KEEPER_ROLE}`)
  console.log(`  RPC endpoints with automatic failover: ${RPC_URLS.length}`)
  console.log(`  Direct sequencer submission: ${SUBMIT_RPC}`)
  console.log(`  Max wallet balance per opportunity: ${Number(MAX_BALANCE_USAGE_BPS) / 100}%`)
  console.log(`  Route cooldown: after ${ROUTE_FAILURE_THRESHOLD} failures, ${ROUTE_COOLDOWN_MS}ms base`)
  console.log(`  Settlement token: WETH only (native ETH wraps on demand; every cycle closes back to WETH)`)
  console.log(`  Same-token cycles only: ${SAME_TOKEN_ONLY}`)
  console.log(`  Atomic execution only: ${ATOMIC_ONLY}`)
  console.log(`  Max hops per cycle: ${MAX_HOPS}`)
  console.log(`  Pools monitored: ${ARB_POOLS.length}`)
  if (ERZA_MODE) {
    const byKind = ARB_POOLS.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {} as Record<string, number>)
    console.log(`  ERZA MODE -- WETH-only, external-first; pure AEON cycles excluded, mixed routes allowed: ${JSON.stringify(byKind)}`)
    for (const p of ARB_POOLS) console.log(`    - ${p.name} [${p.kind}]${p.v3Fee ? ' fee ' + p.v3Fee : ''}${p.v4Native ? ' [native]' : ''}`)
  } else if (MIRAJANE_MODE) {
    const byKind = ARB_POOLS.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {} as Record<string, number>)
    console.log(`  MIRAJANE MODE -- curated seed plus live external discovery; AEON-only routes excluded: ${JSON.stringify(byKind)}`)
    for (const p of ARB_POOLS) console.log(`    - ${p.name} [${p.kind}]${p.v3Fee ? ' fee ' + p.v3Fee : ''}${p.v4Native ? ' [native]' : ''}`)
  } else if (POOL_ALLOWLIST_ACTIVE) {
    console.log(`  Pool allowlist ACTIVE (${POOL_ALLOWLIST.size} pools) -- external discovery disabled:`)
    for (const p of ARB_POOLS) console.log(`    - ${p.name} [${p.kind}] ${p.address}`)
  }
  console.log(`  AEON factory vAMM pools discovered: ${aeonVammPools}`)
  console.log(`  Uniswap V2 pools discovered: ${uniswapPools}`)
  console.log(`  Uniswap V3 pools above $${MIN_EXTERNAL_VOLUME_USD.toLocaleString()} volume discovered: ${uniswapV3Pools}`)
  console.log(`  Uniswap V4 pools above $${MIN_EXTERNAL_VOLUME_USD.toLocaleString()} volume discovered: ${uniswapV4Pools}`)
  console.log(`  AEON CL pools discovered: ${clPools}  |  AEON DLMM pools discovered: ${dlmmPools}`)
  console.log(`  Pool discovery refresh interval: ${POOL_REFRESH_INTERVAL_MS}ms`)
  console.log(`  Min profit to execute: ${MIN_PROFIT_PCT}%`)
  console.log(`  Exact gas safety margin: ${Number(GAS_SAFETY_MULT_PCT) / 100}x`)
  console.log(`  Interval: ${INTERVAL_MS}ms`)
  console.log(`  Block-aware scanning: enabled (at most one full scan per observed block)`)
  console.log(`  Event-driven pool refresh: ${EVENT_DRIVEN_SCANNING ? `enabled (${FULL_STATE_REFRESH_MS}ms safety refresh, ${GAS_ONLY_RECHECK_MS}ms gas recheck)` : 'disabled'}`)
  console.log(`  WebSocket block wake-up: ${WEBSOCKET_SCANNING ? `enabled (${WS_FALLBACK_POLL_MS}ms HTTP fallback)` : 'disabled (HTTP polling)'}`)
  console.log(`  Exact quote wave: up to ${EXACT_QUOTE_CANDIDATES_PER_TICK} candidates / ${EXACT_QUOTE_CONCURRENCY} concurrent`)
  console.log(`  Historical learning: ${scanTelemetry.historicalClosedSuccesses} closed-cycle successes across ${scanTelemetry.provenVenueRoutes} proven venue routes`)
  console.log(`  Cross-venue scan interval: ${AGGREGATOR_SCAN_INTERVAL_MS}ms`)
  console.log(`  Cross-venue scan: ${ENABLE_CROSS_VENUE ? 'enabled' : 'disabled'}`)
  console.log(`  Non-atomic cross-venue execution: ${ENABLE_CROSS_VENUE && !ATOMIC_ONLY ? 'enabled' : 'disabled'}`)
  console.log(`  1inch: ${process.env.ONEINCH_API_KEY ? 'configured' : 'not configured (OpenOcean only)'}`)
  console.log(`  Dry run: ${DRY_RUN}`)
  console.log(`  Status file: ${statusPath}`)
  console.log()

  startWebSocketHeadFeed()

  let lastScannedBlock: bigint | null = null
  let lastFullStateRefresh = 0
  let lastGasOnlyRecheck = 0
  while (true) {
    try {
      const blockNumber = await nextObservedBlock()
      if (lastScannedBlock !== null && blockNumber === lastScannedBlock) {
        if (!WEBSOCKET_SCANNING) await new Promise(r => setTimeout(r, INTERVAL_MS))
        continue
      }
      const previousBlock = lastScannedBlock
      lastScannedBlock = blockNumber
      const now = Date.now()
      const forceFull = !EVENT_DRIVEN_SCANNING
        || !poolStateCacheReady
        || now - lastFullStateRefresh >= FULL_STATE_REFRESH_MS

      if (forceFull) {
        lastFullStateRefresh = now
        lastGasOnlyRecheck = now
        await tick(undefined, blockNumber).catch(e => console.error('[tick error]', e))
      } else {
        // A shallow reorg can lower the observed head. Query the replacement
        // block directly instead of constructing an invalid inverted range.
        const fromBlock = previousBlock === null || blockNumber <= previousBlock
          ? blockNumber
          : previousBlock + 1n
        const changed = await detectChangedPoolKeys(fromBlock, blockNumber)
        if (changed === null) {
          lastFullStateRefresh = now
          lastGasOnlyRecheck = now
          await tick(undefined, blockNumber).catch(e => console.error('[tick error]', e))
        } else if (changed.size > 0) {
          lastGasOnlyRecheck = now
          await tick(changed, blockNumber).catch(e => console.error('[tick error]', e))
        } else if (now - lastGasOnlyRecheck >= GAS_ONLY_RECHECK_MS) {
          lastGasOnlyRecheck = now
          await tick(changed, blockNumber).catch(e => console.error('[tick error]', e))
        } else {
          await writeStatusHeartbeat(blockNumber)
        }
      }
      // Do not add a fixed delay after a slow scan or transaction. If a new
      // block arrived while it was running, rescan immediately; otherwise
      // the same-block branch above applies the configured poll interval.
    } catch (e) {
      console.error('[block poll error]', e)
      await new Promise(r => setTimeout(r, INTERVAL_MS))
    }
  }
}

main()
