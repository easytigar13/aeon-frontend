'use client'
import { useReadContract, useReadContracts } from 'wagmi'
import { CONTRACTS } from '@/config/contracts'
import { VOTING_ESCROW_ABI } from '@/config/abis'

export interface VeNftPosition {
  tokenId: bigint
  lockedAmount: bigint // AEON locked (18 dec)
  lockedEnd: bigint    // unlock unix timestamp (0 = none)
  votingPower: bigint  // current veAEON voting power (18 dec, decays to lockedEnd)
}

// Bound on how many tokenIds we scan. AeonVotingEscrow is NOT ERC721Enumerable
// (tokenOfOwnerByIndex reverts), so we can't ask "give me this owner's NFTs".
// Instead we read the sequential `tokenId` counter (max ever minted) and scan
// ownerOf(1..counter), filtering by owner — all batched into a single
// multicall3 call, so it's one RPC regardless of count. The cap only guards
// against a pathological counter value.
const SCAN_CAP = 3000

export function useVeNftPositions(wallet?: `0x${string}`): VeNftPosition[] {
  const { data: maxIdRaw } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'tokenId',
    query: { enabled: !!wallet, refetchInterval: 60000 },
  })
  const maxId = maxIdRaw !== undefined ? Number(maxIdRaw as bigint) : 0
  const scanN = Math.min(maxId, SCAN_CAP)

  const { data: owners } = useReadContracts({
    contracts: Array.from({ length: scanN }, (_, i) => ({
      address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI,
      functionName: 'ownerOf' as const, args: [BigInt(i + 1)],
    })),
    query: { enabled: !!wallet && scanN > 0, refetchInterval: 60000 },
  })

  const w = (wallet ?? '').toLowerCase()
  const ownedIds = (owners ?? [])
    .map((r, i) => (r.status === 'success' && (r.result as string).toLowerCase() === w ? BigInt(i + 1) : null))
    .filter((x): x is bigint => x !== null)

  const { data: detail } = useReadContracts({
    contracts: ownedIds.flatMap(id => ([
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'lockedAmount' as const, args: [id] },
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'lockedEnd' as const, args: [id] },
      { address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'balanceOfNFT' as const, args: [id] },
    ])),
    query: { enabled: ownedIds.length > 0, refetchInterval: 30000 },
  })

  return ownedIds
    .map((id, i) => {
      const base = i * 3
      const get = (o: number) => (detail?.[base + o]?.status === 'success' ? (detail[base + o].result as bigint) : 0n)
      return { tokenId: id, lockedAmount: get(0), lockedEnd: get(1), votingPower: get(2) }
    })
    .filter(p => p.lockedAmount > 0n)
}
