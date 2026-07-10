// GET /api/openocean/swap?src=0x..&dst=0x..&amount=123&decimalsIn=18&from=0x..&slippage=0.5
// Proxies OpenOcean's /swap_quote endpoint. Returns ready-to-send tx data
// { to, data, value } -- OpenOcean's own router calldata, sent as a raw
// transaction, same pattern as /api/oneinch/swap.
import { NextResponse } from 'next/server'
import { formatUnits } from 'viem'
import { openOceanFetch } from '@/lib/openocean'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const src = searchParams.get('src')
  const dst = searchParams.get('dst')
  const amount = searchParams.get('amount')
  const decimalsIn = searchParams.get('decimalsIn')
  const from = searchParams.get('from')
  const slippage = searchParams.get('slippage') ?? '0.5'
  if (!src || !dst || !amount || !decimalsIn || !from) {
    return NextResponse.json({ error: 'src, dst, amount, decimalsIn, and from are required' }, { status: 400 })
  }

  try {
    const humanAmount = formatUnits(BigInt(amount), Number(decimalsIn))
    const data = await openOceanFetch('/swap_quote', { inTokenAddress: src, outTokenAddress: dst, amount: humanAmount, gasPrice: '1', slippage, account: from })
    return NextResponse.json({
      configured: true,
      amountOut: data.outAmount as string,
      tx: { to: data.to as string, data: data.data as string, value: data.value as string },
    })
  } catch (e) {
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 })
  }
}
