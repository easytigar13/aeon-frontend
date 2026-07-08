// GET /api/oneinch/quote?src=0x..&dst=0x..&amount=123
// Proxies 1inch's /quote endpoint server-side so the API key never reaches
// the browser. Returns { amountOut: string } on success, or a 204-style
// { configured: false } when no ONEINCH_API_KEY is set -- callers should
// treat that as "1inch just isn't available right now", not an error.
import { NextResponse } from 'next/server'
import { oneInchFetch, OneInchNotConfigured } from '@/lib/oneinch'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const src = searchParams.get('src')
  const dst = searchParams.get('dst')
  const amount = searchParams.get('amount')
  if (!src || !dst || !amount) {
    return NextResponse.json({ error: 'src, dst, and amount are required' }, { status: 400 })
  }

  try {
    const body = await oneInchFetch('/quote', { src, dst, amount })
    return NextResponse.json({ configured: true, amountOut: body.dstAmount as string })
  } catch (e) {
    if (e instanceof OneInchNotConfigured) {
      return NextResponse.json({ configured: false })
    }
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 })
  }
}
