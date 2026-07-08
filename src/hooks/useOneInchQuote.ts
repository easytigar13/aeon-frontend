'use client'
import { useEffect, useState } from 'react'
import { TOKENS, NATIVE_SENTINEL } from '@/config/contracts'

export interface OneInchQuote {
  configured: boolean
  amountOut: bigint | null
  loading: boolean
}

// 1inch's own convention for "native ETH" is the exact same sentinel address
// this app already uses everywhere else -- no translation needed.
function tokenAddr(key: string): `0x${string}` {
  if (key === 'ETH') return NATIVE_SENTINEL
  return TOKENS[key as keyof typeof TOKENS]?.address ?? NATIVE_SENTINEL
}

// Debounced quote from our own /api/oneinch/quote proxy. Silently reports
// configured:false (no error, no throw) whenever ONEINCH_API_KEY isn't set
// server-side, or the pair/amount can't be quoted -- callers should just
// fall back to their own routing in either case.
export function useOneInchQuote(tokenInKey: string, tokenOutKey: string, amountIn: bigint): OneInchQuote {
  const [state, setState] = useState<OneInchQuote>({ configured: false, amountOut: null, loading: false })

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
        })
        const res = await fetch(`/api/oneinch/quote?${params.toString()}`)
        const body = await res.json()
        if (cancelled) return
        if (!body.configured || body.error) {
          setState({ configured: !!body.configured, amountOut: null, loading: false })
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
