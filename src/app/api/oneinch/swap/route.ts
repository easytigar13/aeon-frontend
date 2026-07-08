// GET /api/oneinch/swap?src=0x..&dst=0x..&amount=123&from=0x..&slippage=0.5
// Proxies 1inch's /swap endpoint server-side (API key never reaches the
// browser). Returns ready-to-send transaction data { to, data, value } for
// the caller's own wallet to sign -- this is NOT a contract call through our
// own ABIs, it's 1inch's own router calldata, sent via a raw transaction.
import { NextResponse } from 'next/server'
import { oneInchFetch, OneInchNotConfigured } from '@/lib/oneinch'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const src = searchParams.get('src')
  const dst = searchParams.get('dst')
  const amount = searchParams.get('amount')
  const from = searchParams.get('from')
  const slippage = searchParams.get('slippage') ?? '0.5'
  if (!src || !dst || !amount || !from) {
    return NextResponse.json({ error: 'src, dst, amount, and from are required' }, { status: 400 })
  }

  try {
    const body = await oneInchFetch('/swap', { src, dst, amount, from, slippage, disableEstimate: 'true' })
    return NextResponse.json({
      configured: true,
      amountOut: body.dstAmount as string,
      tx: { to: body.tx.to as string, data: body.tx.data as string, value: body.tx.value as string },
    })
  } catch (e) {
    if (e instanceof OneInchNotConfigured) {
      return NextResponse.json({ configured: false })
    }
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 })
  }
}
