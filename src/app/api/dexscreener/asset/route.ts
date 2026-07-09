// GET /api/dexscreener/asset?id=:address
// DEX Screener Adapter spec: https://docs.dexscreener.com/
import { NextResponse } from 'next/server'
import { isAddress, getAddress, formatUnits } from 'viem'
import { client, CORS } from '@/lib/dexscreener/shared'
import { ERC20_ABI } from '@/config/abis'

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !isAddress(id)) {
    return NextResponse.json({ error: 'invalid or missing id' }, { status: 400, headers: CORS })
  }
  const address = getAddress(id)

  const results = await client.multicall({
    contracts: [
      { address, abi: ERC20_ABI, functionName: 'name' },
      { address, abi: ERC20_ABI, functionName: 'symbol' },
      { address, abi: ERC20_ABI, functionName: 'decimals' },
      { address, abi: ERC20_ABI, functionName: 'totalSupply' },
    ],
    allowFailure: true,
  })

  const [nameR, symbolR, decimalsR, totalSupplyR] = results
  if (nameR.status !== 'success' || symbolR.status !== 'success' || decimalsR.status !== 'success') {
    return NextResponse.json({ error: 'not an ERC20 token' }, { status: 404, headers: CORS })
  }

  const decimals = Number(decimalsR.result)
  const totalSupply = totalSupplyR.status === 'success'
    ? formatUnits(totalSupplyR.result as bigint, decimals)
    : undefined

  return NextResponse.json(
    {
      asset: {
        id: address,
        name: nameR.result as string,
        symbol: symbolR.result as string,
        ...(totalSupply !== undefined ? { totalSupply } : {}),
      },
    },
    { headers: CORS },
  )
}
