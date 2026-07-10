// Shared helper for the /api/openocean/* routes -- talks to OpenOcean's
// aggregator API server-side. Unlike 1inch, OpenOcean's API needs no key
// (fully public), but still routed through our own server for consistency
// with the rest of this app's external-API pattern. Base URL:
// https://open-api.openocean.finance/v3/{chainSlug}/{path}. Robinhood Chain
// is supported under the slug "robinhood" -- confirmed with a live quote
// returning real UniswapV2/V3/V4 + PancakeV2/V3 routes before wiring this in
// (a bogus chain slug correctly rejects with "chain must be equal to one of
// the allowed values", so this isn't just lenient URL routing).
const CHAIN_SLUG = 'robinhood'
const BASE = 'https://open-api.openocean.finance/v3'

export async function openOceanFetch(path: string, params: Record<string, string>) {
  const url = `${BASE}/${CHAIN_SLUG}${path}?${new URLSearchParams(params).toString()}`
  const res = await fetch(url)
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.code !== 200) {
    const msg = body?.message || body?.error || `OpenOcean API error (${res.status})`
    throw new Error(msg)
  }
  return body.data
}
