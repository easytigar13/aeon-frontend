'use client'
import { useReadContracts } from 'wagmi'
import { TOKENS, POOLS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

const POOL_AEON_USDG = POOLS.find(p => p.name === 'AEON/USDG')!.address
const POOL_ETH_USDG  = POOLS.find(p => p.name === 'ETH/USDG')!.address

type Reserves = readonly [bigint, bigint, number]

// Derive USD price of "target" token from a pool paired against USDG ($1).
function deriveUsdPrice(
  reserves: Reserves | undefined,
  token0: string | undefined,
  usdgAddr: string,
  targetDec: number,
): number | null {
  if (!reserves || !token0) return null
  const [r0, r1] = reserves
  if (r0 === 0n || r1 === 0n) return null
  const isUsdg0 = token0.toLowerCase() === usdgAddr.toLowerCase()
  const rUsdg   = Number(isUsdg0 ? r0 : r1)
  const rTarget = Number(isUsdg0 ? r1 : r0)
  // price_target = (rUsdg / 1e6) / (rTarget / 10^targetDec)
  return (rUsdg * 10 ** targetDec) / (rTarget * 1e6)
}

export type PriceMap = Record<string, number | null>

export function usePrices(): PriceMap {
  const contracts = [
    { address: POOL_AEON_USDG, abi: PAIR_ABI, functionName: 'getReserves' },
    { address: POOL_AEON_USDG, abi: PAIR_ABI, functionName: 'token0' },
    { address: POOL_ETH_USDG,  abi: PAIR_ABI, functionName: 'getReserves' },
    { address: POOL_ETH_USDG,  abi: PAIR_ABI, functionName: 'token0' },
  ] as const

  const { data } = useReadContracts({ contracts, query: { refetchInterval: 15000 } })

  const get = (i: number) => data?.[i]?.status === 'success' ? data[i].result : undefined

  const aeon = deriveUsdPrice(get(0) as Reserves | undefined, get(1) as string | undefined, TOKENS.USDG.address, TOKENS.AEON.decimals)
  const weth = deriveUsdPrice(get(2) as Reserves | undefined, get(3) as string | undefined, TOKENS.USDG.address, TOKENS.WETH.decimals)

  return { AEON: aeon, ETH: weth, WETH: weth, USDG: 1 }
}
