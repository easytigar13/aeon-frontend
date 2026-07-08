// Shared helper for the /api/oneinch/* routes -- talks to 1inch's Swap API
// server-side only (their API key must never reach the browser). Base URL
// pattern: https://api.1inch.dev/swap/v6.1/{chainId}/{path}. Robinhood Chain
// (id 4663) is listed as a supported chain in 1inch's own docs, no special
// onboarding needed there -- the only real prerequisite is the API key
// itself, which has to come from the account holder (portal.1inch.dev),
// never something this code can create on its own.
import { CHAIN_ID } from '@/config/contracts'

export class OneInchNotConfigured extends Error {}

export async function oneInchFetch(path: string, params: Record<string, string>) {
  const apiKey = process.env.ONEINCH_API_KEY
  if (!apiKey) throw new OneInchNotConfigured('ONEINCH_API_KEY not set')

  const base = process.env.ONEINCH_API_BASE || 'https://api.1inch.dev'
  const url = `${base}/swap/v6.1/${CHAIN_ID}${path}?${new URLSearchParams(params).toString()}`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = body?.description || body?.error || `1inch API error (${res.status})`
    throw new Error(msg)
  }
  return body
}
