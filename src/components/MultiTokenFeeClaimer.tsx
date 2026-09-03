'use client'

import { useState, useEffect } from 'react'
import { Coins, Loader2, CheckCircle2, Gift } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from 'wagmi'
import { POOLS, CONTRACTS, TOKENS } from '@/config/contracts'
import { FEE_DISTRIBUTOR_ABI, VOTER_ABI, VOTING_ESCROW_ABI } from '@/config/abis'

const WEEK_S = 604800n

function useOwnedTokenIds(owner?: `0x${string}`) {
  const { data: maxIdRaw } = useReadContracts({
    contracts: [{ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'tokenId' }],
  })
  const maxId = Math.min(Number(maxIdRaw?.[0]?.result ?? 0n), 200)

  const { data } = useReadContracts({
    contracts: Array.from({ length: maxId }, (_, i) => ({
      address: CONTRACTS.AeonVotingEscrow,
      abi: VOTING_ESCROW_ABI,
      functionName: 'ownerOf' as const,
      args: [BigInt(i + 1)] as const,
    })),
    query: { enabled: !!owner && maxId > 0 },
  })

  if (!owner) return []
  return (data ?? [])
    .map((r, i) => (r.status === 'success' && (r.result as string).toLowerCase() === owner.toLowerCase() ? BigInt(i + 1) : null))
    .filter((id): id is bigint => id !== null)
}

export function MultiTokenFeeClaimer() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [claiming, setClaiming] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [success, setSuccess] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const ownedIds = useOwnedTokenIds(address)
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const lastClosedEpoch = (nowSec / WEEK_S) * WEEK_S - WEEK_S
  const prevClosedEpoch = lastClosedEpoch - WEEK_S

  const epochsToScan = [lastClosedEpoch, prevClosedEpoch]

  // Check poolVoteWeight for each pool x owned veNFT x epoch
  const voteCalls: any[] = []
  for (const pool of POOLS) {
    for (const tokenId of ownedIds) {
      for (const ep of epochsToScan) {
        voteCalls.push({
          address: CONTRACTS.AeonVoter,
          abi: VOTER_ABI,
          functionName: 'poolVoteWeight' as const,
          args: [tokenId, pool.address as `0x${string}`, ep] as const,
        })
      }
    }
  }

  const { data: voteWeightsRes, refetch: refetchVotes } = useReadContracts({
    contracts: voteCalls,
    query: { enabled: !!address && ownedIds.length > 0 && voteCalls.length > 0 },
  })

  // Build list of claim targets
  const claimTargets: { pool: `0x${string}`; poolName: string; tokenId: bigint; epoch: bigint }[] = []
  const seenKey = new Set<string>()

  if (voteWeightsRes) {
    let callIdx = 0
    for (const pool of POOLS) {
      for (const tokenId of ownedIds) {
        for (const ep of epochsToScan) {
          const res = voteWeightsRes[callIdx]
          callIdx++
          if (res && res.status === 'success' && (res.result as bigint) > 0n) {
            const key = `${pool.address.toLowerCase()}_${tokenId}_${ep}`
            if (!seenKey.has(key)) {
              seenKey.add(key)
              claimTargets.push({
                pool: pool.address as `0x${string}`,
                poolName: pool.name,
                tokenId,
                epoch: ep,
              })
            }
          }
        }
      }
    }
  }

  async function handleClaimAllFees() {
    if (!address || claimTargets.length === 0 || claiming) return
    setClaiming(true)
    setSuccess(false)
    setStatusMsg(`Claiming fee shares across ${claimTargets.length} pool/epoch stream(s)...`)

    try {
      for (let i = 0; i < claimTargets.length; i++) {
        const target = claimTargets[i]
        setStatusMsg(`Claiming ${i + 1}/${claimTargets.length} (${target.poolName} veNFT #${target.tokenId})...`)
        const hash = await writeContractAsync({
          address: CONTRACTS.FeeDistributor,
          abi: FEE_DISTRIBUTOR_ABI,
          functionName: 'claimAllFees',
          args: [target.pool, target.tokenId, target.epoch],
        })
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash })
        }
      }

      setStatusMsg('All epoch fee shares claimed successfully!')
      setSuccess(true)
      await refetchVotes()
    } catch (e: any) {
      setStatusMsg(`Claim failed: ${e?.shortMessage || e?.message || String(e)}`)
    } finally {
      setClaiming(false)
    }
  }

  if (!mounted || !address || ownedIds.length === 0 || claimTargets.length === 0) return null

  return (
    <div className="card p-4 bg-gradient-to-r from-amber-500/10 via-aeon-400/10 to-violet-500/10 border border-amber-500/30 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
          <Gift size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-base text-text-primary">
              Epoch Trading Fees Available
            </span>
            <span className="text-2xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              {claimTargets.length} Stream(s) Ready
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Trading fee shares (AEON, WETH, USDG, memecoins) ready to claim for your voted veNFTs
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 w-full sm:w-auto">
        {statusMsg && (
          <span className="text-2xs font-mono text-text-muted truncate max-w-[200px]">
            {statusMsg}
          </span>
        )}
        <button
          onClick={handleClaimAllFees}
          disabled={claiming}
          className="btn-primary w-full sm:w-auto text-sm py-2.5 px-5 flex items-center justify-center gap-2 shrink-0 bg-gradient-to-r from-amber-500 to-aeon-400 hover:from-amber-400 hover:to-aeon-300"
        >
          {claiming ? (
            <Loader2 size={16} className="animate-spin" />
          ) : success ? (
            <CheckCircle2 size={16} className="text-emerald-950" />
          ) : (
            <Gift size={16} />
          )}
          {claiming ? 'Claiming Fees...' : success ? 'Fees Claimed!' : 'Claim All Epoch Fees'}
        </button>
      </div>
    </div>
  )
}
