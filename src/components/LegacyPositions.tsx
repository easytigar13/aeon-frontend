'use client'
import { useEffect, useState } from 'react'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { formatUnits } from 'viem'
import { LEGACY_GAUGES, LEGACY_FEE_DISTRIBUTOR, LEGACY_AEON_VOTER, CONTRACTS } from '@/config/contracts'
import { GAUGE_ABI, LEGACY_FEE_DISTRIBUTOR_ABI, VOTER_ABI, VOTING_ESCROW_ABI } from '@/config/abis'
import { TokenIcon } from '@/components/TokenIcon'
import { Loader2, AlertTriangle, Gift, CheckCircle2 } from 'lucide-react'

const ZERO = '0x0000000000000000000000000000000000000000' as const

const LEGACY_FEE_POOLS = [
  { address: '0xD215650cb628113A64D938164Ee5CD72293F9ea6' as `0x${string}`, name: 'AEON/ETH' },
  { address: '0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288' as `0x${string}`, name: 'AEON/USDG' },
  { address: '0x2732E1312e5Bba5729534E9d94D44c090b200F14' as `0x${string}`, name: 'ETH/USDG' },
  { address: '0x67B2da1742187Aa09b427082b06ACDC5bBCA2D99' as `0x${string}`, name: 'VIRTUAL/AEON' },
  { address: '0xeB638e1FA253E5526C2be76626dE26F02E4bdaba' as `0x${string}`, name: 'ROBINFUN/AEON' },
  { address: '0x22d76bf4e8d2c1DfCca7de6c9dC46Ec2a8Ed7Eb7' as `0x${string}`, name: 'CASHCAT/AEON' },
  { address: '0x3DC6b6c354fB1e9CFdaA8A36ff845728f7176f4e' as `0x${string}`, name: 'CASHCAT/ETH' },
  { address: '0x82203a764428Fbf826DCd1CE48Fdd57655b604f2' as `0x${string}`, name: 'CASHCAT/USDG' },
  { address: '0x625fcD4CA1cA34Eb8ac74883748419De037d78DF' as `0x${string}`, name: 'ROBINFUN/ETH' },
  { address: '0xB60d3Dea956204c6731cA22622bE2b8bEFac4029' as `0x${string}`, name: 'ROBINFUN/USDG' },
  { address: '0x8Ca7acDe0218B5A905dC29CC9d650fadC706Fd9E' as `0x${string}`, name: 'CASHCAT/ROBINFUN' },
  { address: '0xB4692A778E33fBA0B97Feaa863377C6322c83AA4' as `0x${string}`, name: 'SHERWOOD/AEON' },
  { address: '0x3C643F22F0b24795710638CdEf2296eA12896317' as `0x${string}`, name: 'HOODIE/AEON' },
  { address: '0xbf5FCFF8e5604b3ba404a4Cb5Be49EF230e0dA76' as `0x${string}`, name: 'NASDAQ/AEON' },
] as const

const LEGACY_EPOCHS = [1783555200n, 1784160000n] as const

function useOwnedVeNFTs(owner: `0x${string}` | undefined) {
  const { data: maxIdRaw } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'tokenId',
  })
  const maxId = Math.min(Number(maxIdRaw ?? 0n), 500)

  const { data } = useReadContracts({
    contracts: Array.from({ length: maxId }, (_, i) => ({
      address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'ownerOf' as const,
      args: [BigInt(i + 1)] as const,
    })),
    query: { enabled: !!owner && maxId > 0 },
  })

  if (!owner) return { owned: [] as bigint[] }

  const owned = (data ?? [])
    .map((r, i) => (r.status === 'success' && (r.result as string).toLowerCase() === owner.toLowerCase() ? BigInt(i + 1) : null))
    .filter((id): id is bigint => id !== null)

  return { owned }
}

export function LegacyPositions({ wallet: propWallet }: { wallet?: `0x${string}` } = {}) {
  const { address: accountAddress } = useAccount()
  const address = propWallet ?? accountAddress
  const [acting, setActing] = useState<string | null>(null) // `${gauge}:${action}`

  // 1. Read vAMM v1 legacy gauge balances and earned rewards using GAUGE_ABI
  const { data: gaugeData, refetch: refetchGauges } = useReadContracts({
    contracts: LEGACY_GAUGES.flatMap(g => ([
      { address: g.gauge, abi: GAUGE_ABI, functionName: 'balanceOf' as const, args: [address ?? ZERO] },
      { address: g.gauge, abi: GAUGE_ABI, functionName: 'earned' as const, args: [address ?? ZERO] },
    ])),
    query: { enabled: !!address, refetchInterval: 30000 },
  })

  const positions = LEGACY_GAUGES
    .map((g, i) => {
      const staked = gaugeData?.[i * 2]?.status === 'success' ? (gaugeData[i * 2].result as bigint) : 0n
      const earned = gaugeData?.[i * 2 + 1]?.status === 'success' ? (gaugeData[i * 2 + 1].result as bigint) : 0n
      return { ...g, staked, earned }
    })
    .filter(p => p.staked > 0n || p.earned > 0n)

  // 2. Read pre-cutover fee distribution weights targeting LEGACY_FEE_DISTRIBUTOR via LEGACY_AEON_VOTER for activeTokenId
  const { owned: ownedTokenIds } = useOwnedVeNFTs(address)

  const { data: activeTokenIdRaw } = useReadContract({
    address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'lastVotedTokenId',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const activeTokenId = (activeTokenIdRaw as bigint | undefined) ?? (ownedTokenIds.length > 0 ? ownedTokenIds[0] : undefined)

  const FEE_PAIRS = LEGACY_FEE_POOLS.flatMap(pool => LEGACY_EPOCHS.map(epoch => ({ pool, epoch })))
  
  const { data: activeFeeWeights } = useReadContracts({
    contracts: FEE_PAIRS.map(q => ({
      address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'poolVoteWeight' as const,
      args: activeTokenId !== undefined ? [activeTokenId, q.pool.address, q.epoch] as const : undefined,
    })),
    query: { enabled: activeTokenId !== undefined && activeTokenId > 0n, refetchInterval: 30000 },
  })

  const otherTokenIds = ownedTokenIds.filter(id => id !== activeTokenId)
  const { data: otherFeeWeights } = useReadContracts({
    contracts: otherTokenIds.flatMap(id =>
      FEE_PAIRS.map(q => ({
        address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'poolVoteWeight' as const,
        args: [id, q.pool.address, q.epoch] as const,
      }))
    ),
    query: { enabled: otherTokenIds.length > 0, refetchInterval: 30000 },
  })

  const feePositions = activeTokenId
    ? FEE_PAIRS.map((q, i) => {
        const weight = activeFeeWeights?.[i]?.status === 'success' ? (activeFeeWeights[i].result as bigint) : 0n
        return { ...q, tokenId: activeTokenId, weight }
      }).filter(r => r.weight > 0n)
    : []

  const otherIdsWithWeight = otherTokenIds.filter((id, idx) => {
    const start = idx * FEE_PAIRS.length
    return FEE_PAIRS.some((_, j) => otherFeeWeights?.[start + j]?.status === 'success' && (otherFeeWeights[start + j].result as bigint) > 0n)
  })

  const publicClient = usePublicClient()
  const { writeContract, writeContractAsync, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } })

  const [claimedFeeKeys, setClaimedFeeKeys] = useState<Set<string>>(new Set())
  const [claimingFeeIndex, setClaimingFeeIndex] = useState<number | null>(null)
  const [feeError, setFeeError] = useState('')

  useEffect(() => { if (isSuccess) { refetchGauges(); setActing(null) } }, [isSuccess, refetchGauges])
  useEffect(() => { if (error) setActing(null) }, [error])

  const busy = isPending || isConfirming || claimingFeeIndex !== null

  if (!address) return null

  const keyOf = (poolAddr: string, epoch: bigint, tokenId: bigint) => `${poolAddr}-${epoch}-${tokenId.toString()}`
  const pendingFees = feePositions.filter(r => !claimedFeeKeys.has(keyOf(r.pool.address, r.epoch, r.tokenId)))

  async function handleClaimFee(poolAddress: `0x${string}`, epoch: bigint, tokenId: bigint) {
    const key = keyOf(poolAddress, epoch, tokenId)
    setFeeError('')
    try {
      const tx = await writeContractAsync({
        address: LEGACY_FEE_DISTRIBUTOR,
        abi: LEGACY_FEE_DISTRIBUTOR_ABI,
        functionName: 'claimAllFees',
        args: [poolAddress, epoch],
      })
      await publicClient?.waitForTransactionReceipt({ hash: tx })
      setClaimedFeeKeys(prev => new Set(prev).add(key))
    } catch (e: any) {
      setFeeError((e.shortMessage ?? e.message ?? 'Fee claim failed').slice(0, 150))
    }
  }

  async function handleClaimAllFees() {
    setFeeError('')
    for (let i = 0; i < pendingFees.length; i++) {
      setClaimingFeeIndex(i)
      try {
        const tx = await writeContractAsync({
          address: LEGACY_FEE_DISTRIBUTOR,
          abi: LEGACY_FEE_DISTRIBUTOR_ABI,
          functionName: 'claimAllFees',
          args: [pendingFees[i].pool.address, pendingFees[i].epoch],
        })
        await publicClient?.waitForTransactionReceipt({ hash: tx })
        setClaimedFeeKeys(prev => new Set(prev).add(keyOf(pendingFees[i].pool.address, pendingFees[i].epoch, pendingFees[i].tokenId)))
      } catch (e: any) {
        setFeeError((e.shortMessage ?? e.message ?? 'Fee claim failed').slice(0, 150))
        break
      }
    }
    setClaimingFeeIndex(null)
  }

  return (
    <div className="card p-5 bg-gradient-to-r from-amber-500/5 to-transparent border-amber-500/30">
      <div className="text-xs font-mono text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-2">
        <AlertTriangle size={14} /> Pre-Migration / Legacy Positions & Rewards
      </div>
      <div className="text-2xs text-text-muted mb-4">
        Emissions from pre-migration (vAMM v1) gauges (`LEGACY_GAUGES`) and pre-cutover fee distributions (`LEGACY_FEE_DISTRIBUTOR`).
      </div>

      {positions.length === 0 && feePositions.length === 0 ? (
        <div className="flex items-center gap-2 text-2xs text-text-muted font-mono bg-bg-raised p-3 rounded-lg border border-bg-border">
          <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
          No pending pre-migration gauge emissions or pre-cutover fee rewards found for this wallet.
        </div>
      ) : (
        <div className="space-y-4">
          {/* vAMM v1 Gauge Emissions */}
          {positions.length > 0 && (
            <div className="space-y-2">
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider">vAMM v1 Gauge Emissions</div>
              {positions.map(p => {
                const stakedFmt = parseFloat(formatUnits(p.staked, 18))
                const earnedFmt = parseFloat(formatUnits(p.earned, 18))
                const isActing = (a: string) => acting === `${p.gauge}:${a}`
                return (
                  <div key={p.gauge} className="card px-4 py-3 flex items-center justify-between gap-3 border-amber-500/20 bg-bg-surface">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex -space-x-2 shrink-0">
                        <TokenIcon symbol={p.token0} size={36} />
                        <TokenIcon symbol={p.token1} size={36} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary">{p.token0}/{p.token1}</div>
                        <div className="text-2xs font-mono text-text-muted truncate">
                          {p.staked > 0n ? `${stakedFmt.toLocaleString(undefined, { maximumFractionDigits: 6 })} LP staked (old gauge)` : 'Unstaked'}
                          {earnedFmt > 0.000001 ? ` · ${earnedFmt.toFixed(4)} AEON claimable` : ''}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.earned > 0n && (
                        <button
                          onClick={() => {
                            setActing(`${p.gauge}:claim`)
                            writeContract({ address: p.gauge, abi: GAUGE_ABI, functionName: 'getReward', args: [address], gas: 400_000n })
                          }}
                          disabled={busy}
                          className="text-2xs font-mono text-emerald-400 border border-emerald-800/50 rounded px-2.5 py-1 hover:bg-emerald-400/10 disabled:opacity-50 transition-colors"
                        >
                          {isActing('claim') && (isPending || isConfirming) ? <Loader2 size={12} className="animate-spin" /> : 'Claim Rewards'}
                        </button>
                      )}
                      {p.staked > 0n && (
                        <button
                          onClick={() => {
                            setActing(`${p.gauge}:unstake`)
                            writeContract({ address: p.gauge, abi: GAUGE_ABI, functionName: 'withdraw', args: [p.staked], gas: 600_000n })
                          }}
                          disabled={busy}
                          className="text-2xs font-mono text-aeon-400 border border-aeon-800/50 rounded px-2.5 py-1 hover:bg-aeon-400/10 disabled:opacity-50 transition-colors"
                        >
                          {isActing('unstake') && (isPending || isConfirming) ? <Loader2 size={12} className="animate-spin" /> : 'Unstake'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pre-cutover Fee Distributions */}
          {feePositions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-amber-500/20">
              <div className="flex items-center justify-between">
                <div className="text-2xs font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Gift size={12} /> Pre-Cutover Fee Distributions
                </div>
                {pendingFees.length > 1 && (
                  <button
                    onClick={handleClaimAllFees}
                    disabled={busy}
                    className="text-2xs font-mono text-emerald-400 border border-emerald-800/50 rounded px-2.5 py-1 hover:bg-emerald-400/10 disabled:opacity-50 transition-colors"
                  >
                    {claimingFeeIndex !== null ? `Claiming ${claimingFeeIndex + 1}/${pendingFees.length}…` : `Claim All (${pendingFees.length})`}
                  </button>
                )}
              </div>
              {feePositions.map(({ pool, epoch, tokenId }) => {
                const key = keyOf(pool.address, epoch, tokenId)
                const isClaimed = claimedFeeKeys.has(key)
                return (
                  <div key={key} className="card px-4 py-2.5 flex items-center justify-between gap-3 border-amber-500/20 bg-bg-surface">
                    <div className="text-xs font-semibold text-text-primary">
                      {pool.name} <span className="text-2xs text-text-muted font-normal">(veNFT #{tokenId.toString()} · {epoch === 1783555200n ? 'Epoch 1' : 'Epoch 2'})</span>
                    </div>
                    <div>
                      {isClaimed ? (
                        <span className="text-2xs font-mono text-emerald-400">Claimed ✓</span>
                      ) : (
                        <button
                          onClick={() => handleClaimFee(pool.address, epoch, tokenId)}
                          disabled={busy}
                          className="text-2xs font-mono text-emerald-400 border border-emerald-800/50 rounded px-2.5 py-1 hover:bg-emerald-400/10 disabled:opacity-50 transition-colors"
                        >
                          Claim Fees
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {feeError && <div className="text-2xs text-red-400 font-mono pt-1">{feeError}</div>}
              {otherIdsWithWeight.length > 0 && (
                <div className="text-2xs text-amber-400 font-mono pt-2 border-t border-amber-500/20 leading-relaxed">
                  Notice: You also own veNFT {otherIdsWithWeight.map(id => `#${id.toString()}`).join(', ')} with pre-cutover vote weight.
                  The legacy fee distributor contract only pays out through whichever veNFT is set as active (last voted).
                  To claim for veNFT {otherIdsWithWeight.map(id => `#${id.toString()}`).join('/' )}, cast a vote with that veNFT on the Vote page to make it active, then return here to claim its share.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-2xs text-red-400 mt-2 font-mono">{error.message.slice(0, 160)}</div>}
    </div>
  )
}


