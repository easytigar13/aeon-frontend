'use client'
import { useReadContracts } from 'wagmi'
import { TOKENS } from '@/config/contracts'
import { PAIR_ABI } from '@/config/abis'

const CHAINLINK_ABI = [{
  name: 'latestAnswer', type: 'function', stateMutability: 'view',
  inputs: [], outputs: [{ name: '', type: 'int256' }],
}] as const

// Chainlink AVAX/USD on Avalanche mainnet (8 decimals)
const FEED_AVAX = '0x0A77230d17318075983913bC2145DB16C7366156' as `0x${string}`

// Price-source pools (best liquidity for each token)
const POOL_AEON_WAVAX  = '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489' as `0x${string}`
const POOL_WAVAX_USDC  = '0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086' as `0x${string}`
const POOL_WBTCE_USDC  = '0xC84D3fb669b3b0369978E253dC2F1B7329F6D7eF' as `0x${string}`
const POOL_WETHE_USDC  = '0x306B89922bccea64545e701795Ffbf20FB5a0f70' as `0x${string}`
const POOL_SPX_USDC    = '0xFb0b8D088691057fE08040f4364494c23B60c66C' as `0x${string}`
const POOL_GUNZ_USDC   = '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd' as `0x${string}`
const POOL_ARENA_USDC  = '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77' as `0x${string}`
const POOL_COQ_USDC    = '0x19aE273606588fb17D99572321eAD9b0B060DF00' as `0x${string}`

type Reserves = readonly [bigint, bigint, number]

// Derive price of "target" token given the other token's price.
// Returns USD price of target token, or null if no liquidity.
function derivePrice(
  reserves: Reserves | undefined,
  token0: string | undefined,
  knownToken: string,   // address of the token we know the price for
  knownPrice: number,   // USD price of that token
  knownDec: number,     // decimals of known token
  targetDec: number,    // decimals of target token
): number | null {
  if (!reserves || !token0) return null
  const [r0, r1] = reserves
  if (r0 === 0n || r1 === 0n) return null
  const isKnown0 = token0.toLowerCase() === knownToken.toLowerCase()
  const rKnown  = Number(isKnown0 ? r0 : r1)
  const rTarget = Number(isKnown0 ? r1 : r0)
  // price_target = (rKnown / 10^knownDec * knownPrice) / (rTarget / 10^targetDec)
  return (rKnown * knownPrice * 10 ** targetDec) / (rTarget * 10 ** knownDec)
}

export type PriceMap = Record<string, number | null>

export function usePrices(): PriceMap {
  const pools = [
    POOL_AEON_WAVAX, POOL_WAVAX_USDC, POOL_WBTCE_USDC, POOL_WETHE_USDC,
    POOL_SPX_USDC, POOL_GUNZ_USDC, POOL_ARENA_USDC, POOL_COQ_USDC,
  ]

  const contracts: any[] = [
    { address: FEED_AVAX, abi: CHAINLINK_ABI, functionName: 'latestAnswer' },
    ...pools.flatMap(addr => ([
      { address: addr, abi: PAIR_ABI, functionName: 'getReserves' },
      { address: addr, abi: PAIR_ABI, functionName: 'token0' },
    ])),
  ]

  const { data } = useReadContracts({ contracts, query: { refetchInterval: 60000 } })

  const get = (i: number) => data?.[i]?.status === 'success' ? data[i].result : undefined

  // Index layout: 0=chainlink, 1,2=aeon/wavax, 3,4=wavax/usdc, 5,6=wbtce/usdc, 7,8=wethe/usdc
  // 9,10=spx/usdc, 11,12=gunz/usdc, 13,14=arena/usdc, 15,16=coq/usdc
  const chainlinkAvax = get(0) as bigint | undefined
  let avax = chainlinkAvax ? Number(chainlinkAvax) / 1e8 : null

  // Fallback: derive AVAX from WAVAX/USDC pool if Chainlink unavailable
  if (!avax) {
    avax = derivePrice(
      get(3) as Reserves | undefined, get(4) as string | undefined,
      TOKENS.USDC.address, 1, 6, 18,
    )
  }

  const aeon  = avax ? derivePrice(get(1) as Reserves | undefined, get(2) as string | undefined, TOKENS.WAVAX.address, avax, 18, 18) : null
  const wbtce = derivePrice(get(5) as Reserves | undefined, get(6) as string | undefined, TOKENS.USDC.address, 1, 6, 8)
  const wethe = derivePrice(get(7) as Reserves | undefined, get(8) as string | undefined, TOKENS.USDC.address, 1, 6, 18)
  const spx   = derivePrice(get(9) as Reserves | undefined, get(10) as string | undefined, TOKENS.USDC.address, 1, 6, 18)
  const gunz  = derivePrice(get(11) as Reserves | undefined, get(12) as string | undefined, TOKENS.USDC.address, 1, 6, 18)
  const arena = derivePrice(get(13) as Reserves | undefined, get(14) as string | undefined, TOKENS.USDC.address, 1, 6, 18)
  const coq   = derivePrice(get(15) as Reserves | undefined, get(16) as string | undefined, TOKENS.USDC.address, 1, 6, 18)

  return { AVAX: avax, WAVAX: avax, AEON: aeon, USDC: 1, WUSDT: 1, WBTCE: wbtce, WETHE: wethe, SPX: spx, GUNZ: gunz, ARENA: arena, COQ: coq }
}
