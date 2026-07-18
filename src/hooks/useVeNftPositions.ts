'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { CONTRACTS } from '@/config/contracts'
import { VOTING_ESCROW_ABI } from '@/config/abis'

export interface VeNftPosition {
  tokenId: bigint
  lockedAmount: bigint // AEON locked (18 dec)
  lockedEnd: bigint    // unlock unix timestamp (0 = perpetual/none)
  votingPower: bigint  // current veAEON voting power (18 dec, decays to lockedEnd)
}

// Every veNFT a wallet owns, with its locked AEON, unlock time, and live voting
// power. Locked AEON is invisible in a plain token-balance view (it sits in the
// escrow, not the wallet), so a portfolio that omits this understates a
// ve(3,3) user's real holdings — often by most of their AEON.
export function useVeNftPositions(wallet?: `0x${string}`): VeNftPosition[] {
  const { data: countRaw } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const count = countRaw !== undefined ? Number(countRaw as bigint) : 0

  const { data: idData } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,
      functionName: 'tokenOfOwnerByIndex' as const, args: [wallet!, BigInt(i)],
    })),
    query: { enabled: !!wallet && count > 0, refetchInterval: 30000 },
  })
  const tokenIds = (idData ?? [])
    .map(r => (r.status === 'success' ? (r.result as bigint) : null))
    .filter((x): x is bigint => x !== null)

  const { data: detail } = useReadContracts({
    contracts: tokenIds.flatMap(id => ([
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'lockedAmount' as const, args: [id] },
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'lockedEnd' as const, args: [id] },
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'balanceOfNFT' as const, args: [id] },
    ])),
    query: { enabled: tokenIds.length > 0, refetchInterval: 30000 },
  })

  return tokenIds
    .map((id, i) => {
      const base = i * 3
      const get = (o: number) => (detail?.[base + o]?.status === 'success' ? (detail[base + o].result as bigint) : 0n)
      return { tokenId: id, lockedAmount: get(0), lockedEnd: get(1), votingPower: get(2) }
    })
    .filter(p => p.lockedAmount > 0n)
}
