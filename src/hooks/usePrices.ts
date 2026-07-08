'use client'
import { useReadContracts } from 'wagmi'
import { TOKENS, POOLS, CL_POOLS } from '@/config/contracts'
import { PAIR_ABI, ALGEBRA_POOL_ABI } from '@/config/abis'

const POOL_AEON_USDG     = POOLS.find(p => p.name === 'AEON/USDG')!.address
const POOL_ETH_USDG      = POOLS.find(p => p.name === 'ETH/USDG')!.address
const POOL_VIRTUAL_AEON  = CL_POOLS.find(p => p.name === 'VIRTUAL/AEON')!.address
const POOL_ROBINFUN_AEON = POOLS.find(p => p.name === 'ROBINFUN/AEON')!.address

// Static — defined once at module scope so useReadContracts gets a stable
// reference across renders instead of a fresh array every time (which
// wagmi treats as a config change and re-queries for).
const PRICE_CONTRACTS = [
  { address: POOL_AEON_USDG,     abi: PAIR_ABI,         functionName: 'getReserves' },
  { address: POOL_AEON_USDG,     abi: PAIR_ABI,         functionName: 'token0' },
  { address: POOL_ETH_USDG,      abi: PAIR_ABI,         functionName: 'getReserves' },
  { address: POOL_ETH_USDG,      abi: PAIR_ABI,         functionName: 'token0' },
  { address: POOL_VIRTUAL_AEON,  abi: ALGEBRA_POOL_ABI, functionName: 'globalState' },
  { address: POOL_VIRTUAL_AEON,  abi: PAIR_ABI,         functionName: 'token0' },
  { address: POOL_ROBINFUN_AEON, abi: PAIR_ABI,         functionName: 'getReserves' },
  { address: POOL_ROBINFUN_AEON, abi: PAIR_ABI,         functionName: 'token0' },
] as const

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

// Derive USD price of VIRTUAL from its CL pool's sqrtPriceX96 (both legs are
// 18-decimal tokens so no decimal scaling is needed) cross-multiplied by AEON's
// own USD price — the CL pool only prices VIRTUAL in AEON terms, not USD.
function deriveVirtualUsdPrice(sqrtPriceX96: bigint | undefined, token0: string | undefined, aeonUsd: number | null): number | null {
  if (!sqrtPriceX96 || !token0 || aeonUsd === null || sqrtPriceX96 === 0n) return null
  const Q96 = 2 ** 96
  const ratio = (Number(sqrtPriceX96) / Q96) ** 2 // token1 per token0
  const isVirtual0 = token0.toLowerCase() === TOKENS.VIRTUAL.address.toLowerCase()
  const aeonPerVirtual = isVirtual0 ? ratio : 1 / ratio
  return aeonPerVirtual * aeonUsd
}

// Derive USD price of a token from its own vAMM pool against AEON (both
// legs 18-decimal, so no scaling needed) cross-multiplied by AEON's own USD
// price — same "no direct USDG pool" situation VIRTUAL is already in, just
// via getReserves() instead of a CL pool's sqrtPriceX96.
function deriveViaAeonPool(
  reserves: Reserves | undefined,
  token0: string | undefined,
  targetAddr: string,
  aeonUsd: number | null,
): number | null {
  if (!reserves || !token0 || aeonUsd === null) return null
  const [r0, r1] = reserves
  if (r0 === 0n || r1 === 0n) return null
  const isTarget0 = token0.toLowerCase() === targetAddr.toLowerCase()
  const rTarget = Number(isTarget0 ? r0 : r1)
  const rAeon   = Number(isTarget0 ? r1 : r0)
  const aeonPerTarget = rAeon / rTarget
  return aeonPerTarget * aeonUsd
}

export type PriceMap = Record<string, number | null>

export function usePrices(): PriceMap {
  const { data } = useReadContracts({ contracts: PRICE_CONTRACTS, query: { refetchInterval: 15000 } })

  const get = (i: number) => data?.[i]?.status === 'success' ? data[i].result : undefined

  const aeon = deriveUsdPrice(get(0) as Reserves | undefined, get(1) as string | undefined, TOKENS.USDG.address, TOKENS.AEON.decimals)
  const weth = deriveUsdPrice(get(2) as Reserves | undefined, get(3) as string | undefined, TOKENS.USDG.address, TOKENS.WETH.decimals)
  const virtualGlobalState = get(4) as readonly [bigint, number, number, number, number, boolean] | undefined
  const virtual  = deriveVirtualUsdPrice(virtualGlobalState?.[0], get(5) as string | undefined, aeon)
  const robinfun = deriveViaAeonPool(get(6) as Reserves | undefined, get(7) as string | undefined, TOKENS.ROBINFUN.address, aeon)

  return { AEON: aeon, ETH: weth, WETH: weth, USDG: 1, VIRTUAL: virtual, ROBINFUN: robinfun }
}
