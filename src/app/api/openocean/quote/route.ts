// GET /api/openocean/quote?src=0x..&dst=0x..&amount=123&decimalsIn=18
// Proxies OpenOcean's /quote endpoint server-side. OpenOcean's own `amount`
// param is a HUMAN-readable decimal (not wei, unlike 1inch's) -- converts
// here so callers can keep passing wei like everywhere else in this app.
import { NextResponse } from 'next/server'
import { formatUnits } from 'viem'
import { openOceanFetch } from '@/lib/openocean'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const src = searchParams.get('src')
  const dst = searchParams.get('dst')
  const amount = searchParams.get('amount')
  const decimalsIn = searchParams.get('decimalsIn')
  if (!src || !dst || !amount || !decimalsIn) {
    return NextResponse.json({ error: 'src, dst, amount, and decimalsIn are required' }, { status: 400 })
  }

  try {
    const humanAmount = formatUnits(BigInt(amount), Number(decimalsIn))
    const data = await openOceanFetch('/quote', { inTokenAddress: src, outTokenAddress: dst, amount: humanAmount, gasPrice: '1' })
    return NextResponse.json({ configured: true, amountOut: data.outAmount as string })
  } catch (e) {
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 })
  }
}
