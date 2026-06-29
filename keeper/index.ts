/**
 * AeonDEX Price Keeper
 *
 * Watches all pools every ~5 seconds.
 * When AEON (or any token) is priced differently in two pools,
 * executes an arbitrage swap to equalise prices and earn the spread.
 *
 * Usage:
 *   cp keeper/.env.example keeper/.env   # add your private key
 *   npx tsx keeper/index.ts
 *
 * The keeper does two sequential on-chain txs per arb:
 *   1. ERC20.transfer(pair, amountIn)   — send tokens in
 *   2. pair.swap(out0, out1, self, "0x") — pull tokens out
 * Both are signed by KEEPER_PRIVATE_KEY.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  encodeFunctionData,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { avalanche } from 'viem/chains'
import * as dotenv from 'dotenv'

dotenv.config({ path: new URL('.env', import.meta.url).pathname })

// ─── Config ──────────────────────────────────────────────────────────────────

const RPC      = process.env.RPC_URL ?? 'https://api.avax.network/ext/bc/C/rpc'
const PK       = (process.env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}`
const MIN_PROFIT_USD = parseFloat(process.env.MIN_PROFIT_USD ?? '0.05')   // skip tiny arbs
const INTERVAL_MS    = parseInt(process.env.INTERVAL_MS     ?? '5000')
const DRY_RUN        = process.env.DRY_RUN === 'true'

if (!PK || PK.length < 66) {
  console.error('Set KEEPER_PRIVATE_KEY in keeper/.env')
  process.exit(1)
}

// ─── Pool & token config ──────────────────────────────────────────────────────

interface Token {
  address: `0x${string}`
  symbol:  string
  decimals: number
}

interface Pool {
  address: `0x${string}`
  token0:  string   // key in TOKENS
  token1:  string
  feeBps:  bigint
}

const TOKENS: Record<string, Token> = {
  AEON:  { address: '0xd4c93eD1843606f92CccA078941f3d52A585982f', symbol: 'AEON',    decimals: 18 },
  WAVAX: { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX',   decimals: 18 },
  USDC:  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC',    decimals: 6  },
  ARENA: { address: '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C', symbol: 'ARENA',   decimals: 18 },
  COQ:   { address: '0x420FcA0121DC28039145009570975747295f2329', symbol: 'COQ',     decimals: 18 },
  GUNZ:  { address: '0x26deBD39D5eD069770406FCa10A0E4f8d2c743eB', symbol: 'GUNZ',    decimals: 18 },
  WETHE: { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH.e',  decimals: 18 },
  WBTCE: { address: '0x50b7545627a5162F82A992c33b87aDc75187B218', symbol: 'WBTC.e',  decimals: 8  },
  SPX:   { address: '0x3Bb4445D30AC020A84c1b5A8a2C6248EBC9779D0', symbol: 'SPX6900', decimals: 18 },
}

// Only pools that are confirmed deployed and have unique addresses
const POOLS: Pool[] = [
  { address: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489', token0: 'AEON',  token1: 'WAVAX', feeBps: 100n },
  { address: '0xFD029a446632618f218189d4a0B572896CD29B58', token0: 'AEON',  token1: 'USDC',  feeBps: 100n },
  { address: '0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086', token0: 'WAVAX', token1: 'USDC',  feeBps: 30n  },
  { address: '0x1C95905E0C7D290A46E1d970BeCD315BE10b3421', token0: 'AEON',  token1: 'ARENA', feeBps: 30n  },
  { address: '0x978968E5f40f1b183959Ca8852718e22A6f3fcE7', token0: 'ARENA', token1: 'AEON',  feeBps: 100n },
  { address: '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77', token0: 'ARENA', token1: 'USDC',  feeBps: 30n  },
  { address: '0x19aE273606588fb17D99572321eAD9b0B060DF00', token0: 'COQ',   token1: 'USDC',  feeBps: 30n  },
  { address: '0x29c818b0929F9D247157f7b17a49B89664C9efcE', token0: 'AEON',  token1: 'USDC',  feeBps: 30n  },
  { address: '0xd1C58E8B2E3d54FbFf443F34c67952c033aC77a6', token0: 'AEON',  token1: 'WAVAX', feeBps: 30n  },
  { address: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b', token0: 'WAVAX', token1: 'USDC',  feeBps: 5n   },
]

// ─── ABIs (minimal) ───────────────────────────────────────────────────────────

const ERC20_ABI = [
  { name: 'transfer',   type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { name: 'balanceOf',  type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals',   type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint8' }] },
] as const

const PAIR_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [
      { name: 'reserve0',           type: 'uint112' },
      { name: 'reserve1',           type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32'  },
    ]},
  { name: 'token0', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
  { name: 'swap', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount0Out', type: 'uint256' },
      { name: 'amount1Out', type: 'uint256' },
      { name: 'to',         type: 'address' },
      { name: 'data',       type: 'bytes'   },
    ],
    outputs: [] },
] as const

// ─── Clients ──────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PK)
const pub = createPublicClient({ chain: avalanche, transport: http(RPC) })
const wal = createWalletClient({ account, chain: avalanche, transport: http(RPC) })

// ─── Math ─────────────────────────────────────────────────────────────────────

function amtOut(amtIn: bigint, rIn: bigint, rOut: bigint, feeBps: bigint): bigint {
  if (rIn === 0n || rOut === 0n || amtIn === 0n) return 0n
  const inFee = amtIn * (10000n - feeBps)
  return inFee * rOut / (rIn * 10000n + inFee)
}

// Optimal input for max profit in a 2-pool arb (bisection search)
function optimalIn(
  rIn1: bigint, rOut1: bigint, fee1: bigint,
  rIn2: bigint, rOut2: bigint, fee2: bigint,
): bigint {
  let lo = 1n, hi = rIn1 / 4n   // never take more than 25% of reserve
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2n
    if (mid === 0n) break
    const mid1 = amtOut(mid, rIn1, rOut1, fee1)
    const mid2 = amtOut(mid + 1n, rIn1, rOut1, fee1)
    const out1 = amtOut(mid1, rIn2, rOut2, fee2)
    const out2 = amtOut(mid2, rIn2, rOut2, fee2)
    if (out2 > out1) lo = mid + 1n
    else             hi = mid
  }
  return lo
}

// ─── Pool state ───────────────────────────────────────────────────────────────

interface PoolState {
  pool:    Pool
  r0:      bigint
  r1:      bigint
  onchain0: string   // actual on-chain token0 address
}

async function fetchAllStates(): Promise<PoolState[]> {
  const contracts = POOLS.flatMap(p => [
    { address: p.address, abi: PAIR_ABI, functionName: 'getReserves' as const },
    { address: p.address, abi: PAIR_ABI, functionName: 'token0'      as const },
  ])
  const res = await pub.multicall({ contracts: contracts as any, allowFailure: true })

  return POOLS.map((pool, i) => {
    const resD  = res[i * 2]
    const tok0D = res[i * 2 + 1]
    const reserves   = resD?.status  === 'success' ? resD.result  as [bigint, bigint, number] : null
    const onchain0   = tok0D?.status === 'success' ? (tok0D.result as string).toLowerCase() : ''
    return {
      pool,
      r0: reserves?.[0] ?? 0n,
      r1: reserves?.[1] ?? 0n,
      onchain0,
    }
  }).filter(s => s.r0 > 0n && s.r1 > 0n)
}

// ─── Arb finder ───────────────────────────────────────────────────────────────

interface ArbOpp {
  tokenIn:   Token
  tokenMid:  Token
  pool1:     PoolState   // buy tokenMid cheap here (sell tokenIn)
  pool2:     PoolState   // sell tokenMid expensive here (get tokenIn back)
  amountIn:  bigint
  amountMid: bigint
  amountOut: bigint
  profitRaw: bigint      // in tokenIn units
  profitPct: number
}

function findArbs(states: PoolState[]): ArbOpp[] {
  const opps: ArbOpp[] = []

  // For every pair of pools that share a common "mid" token and a common "base" token
  for (let a = 0; a < states.length; a++) {
    for (let b = a + 1; b < states.length; b++) {
      const A = states[a], B = states[b]
      const A_tok = [A.pool.token0, A.pool.token1]
      const B_tok = [B.pool.token0, B.pool.token1]

      // Find tokens in common
      const common = A_tok.filter(t => B_tok.includes(t))
      if (common.length !== 1) continue   // need exactly 1 shared token (the mid)

      const mid  = common[0]
      const base = A_tok.find(t => t !== mid)!
      if (!B_tok.includes(base) === false && !B_tok.find(t => t !== mid)) continue

      // We want: base → mid in pool A, mid → base in pool B (or vice versa)
      const tokenBase = TOKENS[base]
      const tokenMid  = TOKENS[mid]
      if (!tokenBase || !tokenMid) continue

      for (const [pBuy, pSell] of [[A, B], [B, A]]) {
        // pBuy: sell tokenBase → get tokenMid
        const midIsT0_buy  = pBuy.onchain0 === tokenMid.address.toLowerCase()
        const [rBaseIn, rMidOut] = midIsT0_buy
          ? [pBuy.r1, pBuy.r0]
          : [pBuy.r0, pBuy.r1]

        // pSell: sell tokenMid → get tokenBase
        const midIsT0_sell = pSell.onchain0 === tokenMid.address.toLowerCase()
        const [rMidIn, rBaseOut] = midIsT0_sell
          ? [pSell.r0, pSell.r1]
          : [pSell.r1, pSell.r0]

        // Optimal input
        const optIn = optimalIn(
          rBaseIn, rMidOut, pBuy.pool.feeBps,
          rMidIn,  rBaseOut, pSell.pool.feeBps,
        )
        if (optIn <= 0n) continue

        const midAmt  = amtOut(optIn, rBaseIn, rMidOut, pBuy.pool.feeBps)
        const baseOut = amtOut(midAmt, rMidIn, rBaseOut, pSell.pool.feeBps)

        if (baseOut <= optIn) continue   // no profit

        const profitRaw = baseOut - optIn
        const profitPct = Number(profitRaw * 10000n / optIn) / 100

        if (profitPct < 0.05) continue   // < 0.05% → skip tiny dust arbs

        opps.push({
          tokenIn:   tokenBase,
          tokenMid:  tokenMid,
          pool1:     pBuy,
          pool2:     pSell,
          amountIn:  optIn,
          amountMid: midAmt,
          amountOut: baseOut,
          profitRaw,
          profitPct,
        })
      }
    }
  }

  // Sort by profit % descending
  return opps.sort((a, b) => b.profitPct - a.profitPct)
}

// ─── Execution ────────────────────────────────────────────────────────────────

async function executeArb(opp: ArbOpp): Promise<void> {
  const { tokenIn, tokenMid, pool1, pool2, amountIn, amountMid, amountOut, profitPct } = opp

  console.log(`\n🔄 ARB: ${tokenIn.symbol} → ${tokenMid.symbol} → ${tokenIn.symbol}`)
  console.log(`   Pool1: ${pool1.pool.address} (buy ${tokenMid.symbol})`)
  console.log(`   Pool2: ${pool2.pool.address} (sell ${tokenMid.symbol})`)
  console.log(`   In:  ${formatUnits(amountIn,  tokenIn.decimals)}  ${tokenIn.symbol}`)
  console.log(`   Mid: ${formatUnits(amountMid, tokenMid.decimals)} ${tokenMid.symbol}`)
  console.log(`   Out: ${formatUnits(amountOut, tokenIn.decimals)}  ${tokenIn.symbol}`)
  console.log(`   Profit: ${profitPct.toFixed(3)}%`)

  if (DRY_RUN) {
    console.log('   [DRY RUN] skipping execution')
    return
  }

  // Check keeper balance
  const balIn = await pub.readContract({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  }) as bigint

  if (balIn < amountIn) {
    console.warn(`   ⚠ Insufficient balance: have ${formatUnits(balIn, tokenIn.decimals)}, need ${formatUnits(amountIn, tokenIn.decimals)}`)
    return
  }

  // Determine amount0Out / amount1Out for pool1 swap
  const midIsT0_pool1 = pool1.onchain0 === tokenMid.address.toLowerCase()
  const amount0Out1 = midIsT0_pool1 ? amountMid : 0n
  const amount1Out1 = midIsT0_pool1 ? 0n : amountMid

  // Determine amount0Out / amount1Out for pool2 swap
  const baseIsT0_pool2 = pool2.onchain0 === tokenIn.address.toLowerCase()
  const amount0Out2 = baseIsT0_pool2 ? amountOut : 0n
  const amount1Out2 = baseIsT0_pool2 ? 0n : amountOut

  try {
    // TX 1: Transfer tokenIn to pool1
    console.log('   → TX1: transfer tokenIn to pool1...')
    const h1 = await wal.writeContract({
      address: tokenIn.address,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [pool1.pool.address, amountIn],
    })
    await pub.waitForTransactionReceipt({ hash: h1 })
    console.log(`   ✓ TX1 confirmed: ${h1}`)

    // TX 2: Swap in pool1 → receive tokenMid at keeper address
    console.log('   → TX2: swap pool1 (get tokenMid)...')
    const h2 = await wal.writeContract({
      address: pool1.pool.address,
      abi: PAIR_ABI,
      functionName: 'swap',
      args: [amount0Out1, amount1Out1, account.address, '0x'],
    })
    await pub.waitForTransactionReceipt({ hash: h2 })
    console.log(`   ✓ TX2 confirmed: ${h2}`)

    // TX 3: Transfer tokenMid to pool2
    console.log('   → TX3: transfer tokenMid to pool2...')
    const h3 = await wal.writeContract({
      address: tokenMid.address,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [pool2.pool.address, amountMid],
    })
    await pub.waitForTransactionReceipt({ hash: h3 })
    console.log(`   ✓ TX3 confirmed: ${h3}`)

    // TX 4: Swap in pool2 → receive tokenIn at keeper address
    console.log('   → TX4: swap pool2 (get tokenIn back)...')
    const h4 = await wal.writeContract({
      address: pool2.pool.address,
      abi: PAIR_ABI,
      functionName: 'swap',
      args: [amount0Out2, amount1Out2, account.address, '0x'],
    })
    await pub.waitForTransactionReceipt({ hash: h4 })
    console.log(`   ✓ TX4 confirmed: ${h4}`)

    console.log(`   ✅ ARB COMPLETE — profit ~${formatUnits(opp.profitRaw, tokenIn.decimals)} ${tokenIn.symbol}`)
  } catch (err: any) {
    console.error(`   ❌ ARB FAILED: ${err?.shortMessage ?? err?.message ?? err}`)
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function tick() {
  const t0 = Date.now()
  let states: PoolState[]
  try {
    states = await fetchAllStates()
  } catch (err: any) {
    console.error(`[RPC error] ${err?.message}`)
    return
  }

  const opps = findArbs(states)

  if (opps.length === 0) {
    process.stdout.write(`\r[${new Date().toISOString()}] No arb found (${Date.now() - t0}ms) — ${states.length} pools monitored`)
    return
  }

  // Print all opportunities
  console.log(`\n[${new Date().toISOString()}] ${opps.length} arb opportunities:`)
  for (const o of opps.slice(0, 5)) {
    console.log(`  ${o.tokenIn.symbol}→${o.tokenMid.symbol}→${o.tokenIn.symbol}  ${o.profitPct.toFixed(3)}%  (in: ${formatUnits(o.amountIn, o.tokenIn.decimals)} ${o.tokenIn.symbol})`)
  }

  // Execute the best one
  const best = opps[0]
  if (best.profitPct >= 0.1) {   // at least 0.1% profit to execute
    await executeArb(best)
  } else {
    console.log(`  Best profit ${best.profitPct.toFixed(3)}% below threshold, skipping`)
  }
}

async function main() {
  console.log(`AeonDEX Price Keeper`)
  console.log(`  Keeper address: ${account.address}`)
  console.log(`  Monitoring ${POOLS.length} pools`)
  console.log(`  Min profit: ${MIN_PROFIT_USD} USD equivalent`)
  console.log(`  Interval: ${INTERVAL_MS}ms`)
  console.log(`  Dry run: ${DRY_RUN}`)
  console.log(`  RPC: ${RPC}`)
  console.log()

  while (true) {
    await tick().catch(e => console.error('[tick error]', e))
    await new Promise(r => setTimeout(r, INTERVAL_MS))
  }
}

main()
