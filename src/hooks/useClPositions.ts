'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { ALGEBRA_CONTRACTS } from '@/config/contracts'
import { ALGEBRA_PM_ENUMERABLE_ABI } from '@/config/abis'

const PM = ALGEBRA_CONTRACTS.nonfungiblePositionManager

export interface ClPosition {
  tokenId: bigint
  token0: string
  token1: string
  tickLower: number
  tickUpper: number
  liquidity: bigint
}

// Enumerates every open (liquidity > 0) Algebra Integral CL position an
// address holds, across all CL pools at once — brute-force scans up to
// MAX_SLOTS tokenIds via the position manager's ERC721Enumerable interface
// since there's no per-pool position index to query directly.
export function useClPositions(owner: `0x${string}` | undefined): { positions: ClPosition[]; refetch: () => void } {
  const MAX_SLOTS = 15
  const { data: balData } = useReadContract({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'balanceOf',
    args: owner ? [owner] : undefined, query: { enabled: !!owner, refetchInterval: 20000 },
  })
  const balance = Math.min(Number((balData as bigint | undefined) ?? 0n), MAX_SLOTS)

  const idxContracts = Array.from({ length: MAX_SLOTS }, (_, i) => ({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'tokenOfOwnerByIndex' as const,
    args: owner ? [owner, BigInt(i)] as const : undefined,
  }))
  const { data: tokenIdData } = useReadContracts({ contracts: idxContracts, query: { enabled: !!owner && balance > 0 } })
  const tokenIds = (tokenIdData ?? []).slice(0, balance).filter(r => r.status === 'success').map(r => r.result as bigint)

  const posContracts = tokenIds.map(id => ({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'positions' as const, args: [id] as const,
  }))
  const { data: posData, refetch } = useReadContracts({ contracts: posContracts, query: { enabled: tokenIds.length > 0, refetchInterval: 20000 } })

  const positions = tokenIds.map((id, i) => {
    const r = posData?.[i]
    if (!r || r.status !== 'success') return null
    const result = r.result as readonly [bigint, string, string, string, string, number, number, bigint, bigint, bigint, bigint, bigint]
    const [, , token0, token1, , tickLower, tickUpper, liquidity] = result
    return { tokenId: id, token0, token1, tickLower, tickUpper, liquidity }
  }).filter((p): p is ClPosition => p !== null && p.liquidity > 0n)

  return { positions, refetch }
}
