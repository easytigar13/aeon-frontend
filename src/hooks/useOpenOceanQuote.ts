'use client'
import { useEffect, useState } from 'react'
import { TOKENS, NATIVE_SENTINEL } from '@/config/contracts'

export interface OpenOceanQuote {
  configured: boolean
  amountOut: bigint | null
  loading: boolean
}

function tokenAddr(key: string): `0x${string}` {
  if (key === 'ETH') return NATIVE_SENTINEL
  return TOKENS[key as keyof typeof TOKENS]?.address ?? NATIVE_SENTINEL
}
function tokenDecimals(key: string): number {
  return TOKENS[key as keyof typeof TOKENS]?.decimals ?? 18
}

// Debounced quote from our own /api/openocean/quote proxy -- mirrors
// useOneInchQuote's shape exactly so the Swap page can treat both as
// interchangeable "external aggregator" candidates. OpenOcean's public API
// needs no key (unlike 1inch's), so `configured` here really just means
// "got a usable route back", not "is a key set".
export function useOpenOceanQuote(tokenInKey: string, tokenOutKey: string, amountIn: bigint): OpenOceanQuote {
  const [state, setState] = useState<OpenOceanQuote>({ configured: false, amountOut: null, loading: false })

  useEffect(() => {
    if (amountIn <= 0n || tokenInKey === tokenOutKey || !tokenInKey || !tokenOutKey) {
      setState({ configured: false, amountOut: null, loading: false })
      return
    }

    let cancelled = false
    const handle = setTimeout(async () => {
      setState(s => ({ ...s, loading: true }))
      try {
        const params = new URLSearchParams({
          src: tokenAddr(tokenInKey),
          dst: tokenAddr(tokenOutKey),
          amount: amountIn.toString(),
          decimalsIn: tokenDecimals(tokenInKey).toString(),
        })
        const res = await fetch(`/api/openocean/quote?${params.toString()}`)
        const body = await res.json()
        if (cancelled) return
        if (!body.configured || body.error || !body.amountOut || body.amountOut === '0') {
          setState({ configured: false, amountOut: null, loading: false })
        } else {
          setState({ configured: true, amountOut: BigInt(body.amountOut), loading: false })
        }
      } catch {
        if (!cancelled) setState({ configured: false, amountOut: null, loading: false })
      }
    }, 400) // debounce -- avoid firing on every keystroke

    return () => { cancelled = true; clearTimeout(handle) }
  }, [tokenInKey, tokenOutKey, amountIn])

  return state
}
