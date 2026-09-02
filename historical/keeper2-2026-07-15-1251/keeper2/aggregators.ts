/**
 * Cross-venue quote sources: OpenOcean (public, no key needed) and 1inch
 * (needs ONEINCH_API_KEY in keeper/.env -- deliberately separate from the
 * frontend's own .env.local key, so the bot's request volume never eats
 * into the swap page's own rate-limit budget).
 *
 * Self-contained on purpose -- doesn't import src/lib/oneinch.ts or
 * src/lib/openocean.ts, since those use the "@/..." path alias Next.js
 * resolves but this standalone tsx process doesn't. Same API shapes and
 * endpoints those already-live routes use, just re-implemented here without
 * the alias dependency.
 *
 * Both quote functions return null on "no route", "not configured", or any
 * API error -- callers treat that as "just skip this source", never as a
 * hard failure.
 */

import { formatUnits } from 'viem'
import { CHAIN_ID } from '../src/config/contracts'

export type AggregatorSource = 'openocean' | '1inch'

export interface AggregatorQuote {
  source: AggregatorSource
  amountOut: bigint
}

export interface AggregatorSwapTx {
  source: AggregatorSource
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
  amountOut: bigint
}

const OPENOCEAN_BASE = 'https://open-api.openocean.finance/v3'
const OPENOCEAN_CHAIN_SLUG = 'robinhood'

// OpenOcean's public tier hard-caps at 1 request/second -- confirmed
// directly against the live API (429, "Your data usage has exceeded the
// limit of 1 r/s. Please try again in 1 hour."). Exceeding it doesn't just
// fail the next call, it locks out EVERY OpenOcean call for a full hour,
// which would silently disable cross-venue arb (both AEON-pool-vs-aggregator
// and pure external-to-external) for that whole window without erroring --
// getBestQuote's null-on-failure design means a lockout just looks like "no
// opportunities found," not a visible outage. This throttle is the single
// chokepoint every OpenOcean call goes through, so it protects all current
// and future callers, not just one code path.
const OPENOCEAN_MIN_INTERVAL_MS = 1100   // 1.1s between requests -- a safety margin over the bare 1 r/s limit
let lastOpenOceanRequestAt = 0
let openOceanQueue: Promise<void> = Promise.resolve()

async function throttleOpenOcean(): Promise<void> {
  const myTurn = openOceanQueue.then(async () => {
    const wait = lastOpenOceanRequestAt + OPENOCEAN_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastOpenOceanRequestAt = Date.now()
  })
  openOceanQueue = myTurn.catch(() => {})   // keep the queue alive even if one caller's own request later throws
  return myTurn
}

async function openOceanFetch(path: string, params: Record<string, string>): Promise<any> {
  await throttleOpenOcean()
  const url = `${OPENOCEAN_BASE}/${OPENOCEAN_CHAIN_SLUG}${path}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url)
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.code !== 200) {
    throw new Error(body?.message ?? body?.error ?? `OpenOcean API error (${res.status})`)
  }
  return body.data
}

async function oneInchFetch(path: string, params: Record<string, string>): Promise<any | null> {
  const apiKey = process.env.ONEINCH_API_KEY
  if (!apiKey) return null   // not configured -- treated as "no route", not an error

  const base = process.env.ONEINCH_API_BASE || 'https://api.1inch.dev'
  const url = `${base}/swap/v6.1/${CHAIN_ID}${path}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.description ?? body?.error ?? `1inch API error (${res.status})`)
  return body
}

async function openOceanQuote(src: `0x${string}`, dst: `0x${string}`, amountIn: bigint, decimalsIn: number): Promise<bigint | null> {
  try {
    const humanAmount = formatUnits(amountIn, decimalsIn)
    const data = await openOceanFetch('/quote', { inTokenAddress: src, outTokenAddress: dst, amount: humanAmount, gasPrice: '1' })
    return BigInt(data.outAmount)
  } catch {
    return null
  }
}

async function oneInchQuote(src: `0x${string}`, dst: `0x${string}`, amountIn: bigint): Promise<bigint | null> {
  try {
    const body = await oneInchFetch('/quote', { src, dst, amount: amountIn.toString() })
    if (!body) return null
    return BigInt(body.dstAmount)
  } catch {
    return null
  }
}

// Best quote across whichever aggregators currently have a usable route.
export async function getBestQuote(
  src: `0x${string}`, dst: `0x${string}`, amountIn: bigint, decimalsIn: number,
): Promise<AggregatorQuote | null> {
  const [oo, oi] = await Promise.all([
    openOceanQuote(src, dst, amountIn, decimalsIn),
    oneInchQuote(src, dst, amountIn),
  ])
  const candidates: AggregatorQuote[] = []
  if (oo !== null) candidates.push({ source: 'openocean', amountOut: oo })
  if (oi !== null) candidates.push({ source: '1inch', amountOut: oi })
  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => (c.amountOut > best.amountOut ? c : best))
}

// Ready-to-send transaction data from a SPECIFIC source, fetched fresh right
// before executing -- OpenOcean's or 1inch's own router calldata, meant to
// be signed and sent as a raw transaction, NOT a call through any of our
// own contract ABIs.
export async function getSwapTx(
  source: AggregatorSource, src: `0x${string}`, dst: `0x${string}`, amountIn: bigint, decimalsIn: number,
  from: `0x${string}`, slippagePct: number,
): Promise<AggregatorSwapTx | null> {
  try {
    if (source === 'openocean') {
      const humanAmount = formatUnits(amountIn, decimalsIn)
      const data = await openOceanFetch('/swap_quote', {
        inTokenAddress: src, outTokenAddress: dst, amount: humanAmount,
        gasPrice: '1', slippage: String(slippagePct), account: from,
      })
      return { source, to: data.to, data: data.data, value: BigInt(data.value ?? 0), amountOut: BigInt(data.outAmount) }
    } else {
      const body = await oneInchFetch('/swap', {
        src, dst, amount: amountIn.toString(), from, slippage: String(slippagePct), disableEstimate: 'true',
      })
      if (!body) return null
      return { source, to: body.tx.to, data: body.tx.data, value: BigInt(body.tx.value ?? 0), amountOut: BigInt(body.dstAmount) }
    }
  } catch {
    return null
  }
}
