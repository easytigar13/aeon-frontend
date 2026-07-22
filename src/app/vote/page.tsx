'use client'
import { useState, useEffect } from 'react'
import { Vote, Plus, X, Flame, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, CONTRACTS, EPOCH_CONFIG, LEGACY_AEON_VOTER, LEGACY_FEE_DISTRIBUTOR } from '@/config/contracts'
import { VOTING_ESCROW_ABI, VOTER_ABI, MULTI_GAUGE_CONTROLLER_ABI, EMISSIONS_ENGINE_ABI, FURNACE_ABI, ERC20_ABI, FEE_DISTRIBUTOR_ABI, LEGACY_FEE_DISTRIBUTOR_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useDlmmPoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { projectNextEmission } from '@/lib/emissionsProjection'
import { useOraclePricedTokens } from '@/hooks/useOraclePricedTokens'
import { pricedFeeFraction } from '@/lib/pricedFees'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

// AeonVotingEscrow is a plain (non-Enumerable) ERC721 — the only way to find
// which tokenIds a wallet owns is to walk every minted id and check ownerOf.
// `tokenId()` is the mint counter (highest id ever minted), and this is a
// genesis-scale deployment (a handful of veNFTs total), so a direct multicall
// scan is cheap — no event-log fallback needed at this scale.
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

  if (!owner) return { owned: [] as bigint[], loading: false }
  if (maxId > 0 && !data) return { owned: [] as bigint[], loading: true }

  const owned = (data ?? [])
    .map((r, i) => (r.status === 'success' && (r.result as string).toLowerCase() === owner.toLowerCase() ? BigInt(i + 1) : null))
    .filter((id): id is bigint => id !== null)

  return { owned, loading: false }
}

function parseFeeRate(fee: string): number {
  return parseFloat(fee.replace('%', '')) / 100
}
function fmtApr(apr: number | null): string {
  if (apr === null) return '—%'
  if (apr >= 1000) return '>1000%'
  return apr.toFixed(2) + '%'
}

function fmtUsd(n: number | null): string {
  if (n === null) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface VoteAllocation { pool: string; poolAddress: `0x${string}`; weight: number }
interface VotePool { name: string; token0: string; token1: string; type: string; fee: string; address: `0x${string}` }
type VoteMode = 'vAMM' | 'CL_DLMM'

export default function VotePage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenIdInput,  setTokenIdInput]  = useState('')
  const [allocations,   setAllocations]   = useState<VoteAllocation[]>([])
  const [search,        setSearch]        = useState('')
  const [voteMode,      setVoteMode]      = useState<VoteMode>('vAMM')

  // Safe conversion — BigInt throws on non-integer strings
  const tokenId = (() => {
    try { return tokenIdInput ? BigInt(Math.trunc(parseFloat(tokenIdInput))) : undefined } catch { return undefined }
  })()

  // Read veNFT count and voting power
  const { data: veNFTCount } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow,
    abi: VOTING_ESCROW_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // AeonVoterV2.vote() adds furnace.votingPowerOf(owner) on top of the veNFT's
  // own balance for whichever tokenId is used to vote — but it requires an
  // owned tokenId to call at all, so a Furnace-only burner (no veNFT) has no
  // way to vote until they hold at least one, even a dust-sized one.
  const { data: furnaceWeightRaw, refetch: refetchFurnaceWeight } = useReadContract({
    address: CONTRACTS.TheFurnace,
    abi: FURNACE_ABI,
    functionName: 'votingPowerOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  })
  const rawFurnaceWeight = (furnaceWeightRaw as bigint | undefined) ?? 0n

  // AeonVoterV3 fix: the Furnace bonus only ever applies ONCE per wallet per
  // epoch, no matter which (or how many) owned veNFTs you vote with. The
  // read above is just the wallet's raw cumulative burn -- shown as-is it
  // looks identical for every NFT in the picker, which reads exactly like
  // "they all have full furnace power" even though the contract itself
  // would only actually grant it once. This checks whether it's already
  // been spent this epoch so the preview reflects reality.
  const CURRENT_EPOCH_SEC = BigInt(Math.floor(Date.now() / 1000 / 604800) * 604800)
  const { data: furnacePowerAlreadyUsed } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'furnacePowerUsed',
    args: address ? [CURRENT_EPOCH_SEC, address] : undefined,
    query: { enabled: !!address, refetchInterval: 15000 },
  })
  const furnaceWeight = furnacePowerAlreadyUsed ? 0n : rawFurnaceWeight

  const { owned: ownedTokenIds, loading: loadingOwned } = useOwnedVeNFTs(address)

  // Auto-select the wallet's only veNFT so users don't have to look up their
  // own tokenId; leave the field alone if they own several (picker below) or
  // have already typed something themselves.
  useEffect(() => {
    if (tokenIdInput || loadingOwned) return
    if (ownedTokenIds.length === 1) setTokenIdInput(ownedTokenIds[0].toString())
  }, [ownedTokenIds, loadingOwned, tokenIdInput])

  // KNOWN CONTRACT BUG (frontend-only stopgap, not a real fix): AeonVoterV2.
  // vote()/poke() re-read furnace.votingPowerOf(owner) -- the wallet's FULL
  // cumulative Furnace burn -- fresh on every call, with no per-wallet
  // consumption tracking. A wallet owning multiple veNFTs can vote with each
  // one separately in the same epoch and get the full furnace bonus counted
  // once per veNFT instead of once per wallet. This can't be fixed on-chain
  // without a full AeonVoterV2 (+ every gauge) redeploy -- gauges hold real
  // staked LP, so that migration needs to happen carefully, not rushed. This
  // blocks the easy path through OUR OWN UI only; it does not stop someone
  // calling the contract directly.
  const { data: ownedLastVotedReads } = useReadContracts({
    contracts: ownedTokenIds.map(id => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'lastVoted' as const, args: [id] as const,
    })),
    query: { enabled: ownedTokenIds.length > 1 },
  })
  const CURRENT_EPOCH_START_SEC = BigInt(Math.floor(Date.now() / 1000 / 604800) * 604800)
  const walletAlreadyVotedTokenId = ownedTokenIds.find((id, i) => {
    if (tokenId !== undefined && id === tokenId) return false
    const r = ownedLastVotedReads?.[i]
    return r?.status === 'success' && (r.result as bigint) >= CURRENT_EPOCH_START_SEC
  })

  const { data: nftOwner } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow,
    abi: VOTING_ESCROW_ABI,
    functionName: 'ownerOf',
    args: tokenId ? [tokenId] : undefined,
    query: { enabled: !!tokenId },
  })

  const { data: votingPower } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow,
    abi: VOTING_ESCROW_ABI,
    functionName: 'balanceOfNFT',
    args: tokenId ? [tokenId] : undefined,
    query: { enabled: !!tokenId },
  })

  const { data: hasVoted, refetch: refetchHasVoted } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow,
    abi: VOTING_ESCROW_ABI,
    functionName: 'voted',
    args: tokenId ? [tokenId] : undefined,
    query: { enabled: !!tokenId },
  })

  const { data: multiEpoch } = useReadContract({
    address: CONTRACTS.MultiGaugeController,
    abi: MULTI_GAUGE_CONTROLLER_ABI,
    functionName: 'currentEpoch',
  })

  const { data: multiHasVoted, refetch: refetchMultiHasVoted } = useReadContract({
    address: CONTRACTS.MultiGaugeController,
    abi: MULTI_GAUGE_CONTROLLER_ABI,
    functionName: 'hasVoted',
    args: multiEpoch !== undefined && tokenId !== undefined ? [multiEpoch, tokenId] : undefined,
    query: { enabled: multiEpoch !== undefined && tokenId !== undefined },
  })

  const { data: lastVotedTs } = useReadContract({
    address: CONTRACTS.AeonVoter,
    abi: VOTER_ABI,
    functionName: 'lastVoted',
    args: tokenId ? [tokenId] : undefined,
    query: { enabled: !!tokenId },
  })

  // Reset is only allowed after the epoch following the vote (epoch = 7 days, aligned to UNIX/604800 boundary)
  const WEEK = 604800n
  const resetAllowedAt = lastVotedTs ? ((lastVotedTs / WEEK) * WEEK + WEEK) : undefined
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const canReset = resetAllowedAt !== undefined ? nowSec >= resetAllowedAt : true

  function resetCountdown() {
    if (!resetAllowedAt) return ''
    const remaining = Number(resetAllowedAt - nowSec)
    if (remaining <= 0) return ''
    const h = Math.floor(remaining / 3600)
    const m = Math.floor((remaining % 3600) / 60)
    return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`
  }

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const { writeContract: writeReset, data: resetHash, isPending: resetPending } = useWriteContract()
  const { isLoading: resetConfirming, isSuccess: resetSuccess } = useWaitForTransactionReceipt({ hash: resetHash })

  // Quick-activate: a minimal 1-AEON / 1-week lock, just to mint a tokenId so
  // a Furnace-only burner's votingPowerOf() bonus becomes usable via vote().
  const ACTIVATE_AMOUNT = parseUnits('1', 18)
  const ACTIVATE_WEEK   = 604800n
  const [activateStep, setActivateStep] = useState<'idle' | 'approve' | 'approve_wait' | 'lock' | 'lock_wait'>('idle')
  const [activateErr,  setActivateErr]  = useState('')

  const { data: aeonAllowance } = useReadContract({
    address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, CONTRACTS.AeonVotingEscrow] : undefined,
    query: { enabled: !!address },
  })

  const { writeContract: writeActivate, data: activateHash, error: activateWriteErr } = useWriteContract()
  const { isSuccess: activateTxSuccess } = useWaitForTransactionReceipt({ hash: activateHash, query: { enabled: !!activateHash } })

  useEffect(() => {
    if (!activateTxSuccess) return
    if (activateStep === 'approve_wait') { setActivateStep('lock'); return }
    if (activateStep === 'lock_wait')    { setActivateStep('idle'); refetchFurnaceWeight(); return }
  }, [activateTxSuccess])

  useEffect(() => {
    if (!address) return
    setActivateErr('')
    if (activateStep === 'approve') {
      writeActivate({ address: CONTRACTS.AeonToken, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.AeonVotingEscrow, ACTIVATE_AMOUNT] })
      setActivateStep('approve_wait')
    }
    if (activateStep === 'lock') {
      writeActivate({ address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'createLock', args: [ACTIVATE_AMOUNT, ACTIVATE_WEEK] })
      setActivateStep('lock_wait')
    }
  }, [activateStep])

  useEffect(() => {
    if (activateWriteErr) { setActivateErr(activateWriteErr.message.slice(0, 150)); setActivateStep('idle') }
  }, [activateWriteErr])

  function handleActivateFurnaceVoting() {
    if (!address) { openConnectModal?.(); return }
    setActivateErr('')
    if ((aeonAllowance as bigint | undefined ?? 0n) < ACTIVATE_AMOUNT) { setActivateStep('approve'); return }
    setActivateStep('lock')
  }

  const isActivating = activateStep !== 'idle'

  useEffect(() => {
    if (txSuccess) {
      if (voteMode === 'vAMM') refetchHasVoted()
      else refetchMultiHasVoted()
    }
  }, [txSuccess, voteMode, refetchHasVoted, refetchMultiHasVoted])

  useEffect(() => {
    if (resetSuccess) { refetchHasVoted() }
  }, [resetSuccess])

  const isBusy      = isPending || isConfirming
  const isResetting = resetPending || resetConfirming

  const prices    = usePrices()
  const poolStats     = usePoolStats(prices)
  const clPoolStats   = useClPoolStats(prices)
  const dlmmPoolStats = useDlmmPoolStats(prices)
  // Merge all three so the CL+DLMM tab has TVL/votes too -- usePoolStats alone
  // only covers vAMM POOLS, which left every CL/DLMM row showing $—/—%.
  const allStats    = [...poolStats, ...clPoolStats, ...dlmmPoolStats]
  const tvlByAddr   = Object.fromEntries(allStats.map(s => [s.address, s.tvlUsd]))
  const votesByAddr = Object.fromEntries(allStats.map(s => [s.address, s.votesFormatted]))
  const volResult   = useVolume24h(prices)
  const { data: gaugeAddressReads } = useReadContracts({
    contracts: POOLS.map(pool => ({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges' as const, args: [pool.address] as const })),
  })
  const gaugeAddresses = POOLS.map((_, i) => gaugeAddressReads?.[i]?.status === 'success' ? gaugeAddressReads[i].result as `0x${string}` : ZERO_ADDRESS)
  const { data: lpSupplyReads } = useReadContracts({
    contracts: POOLS.map(pool => ({ address: pool.address, abi: ERC20_ABI, functionName: 'totalSupply' as const })),
  })
  const { data: gaugeLpReads } = useReadContracts({
    contracts: POOLS.map((pool, i) => ({ address: pool.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [gaugeAddresses[i]] as const })),
  })

  // Fee APR per pool: trailing-week volume, not literal 24h -- a pool with
  // real but sporadic trading shouldn't show "—%" just because nothing
  // happened to trade in the exact last 24h. volWeek -> daily avg (÷7) ->
  // annualized (×365) = ×(365/7).
  const aprByAddr: Record<string, number | null> = {}
  const feesWeekByAddr: Record<string, number | null> = {}
  for (const pool of [...POOLS, ...CL_POOLS, ...DLMM_POOLS]) {
    const tvl = tvlByAddr[pool.address] ?? null
    const volWeek = volResult.byPoolWeek[pool.address.toLowerCase()] ?? null
    const feesWeek = volWeek !== null ? volWeek * parseFeeRate(pool.fee) : null
    feesWeekByAddr[pool.address] = feesWeek
    aprByAddr[pool.address] = (tvl && tvl > 0 && feesWeek !== null)
      ? (feesWeek * (365 / 7) / tvl) * 100
      : null
  }

  // "If you vote here" — FeeDistributorV3 pays 80% of a pool's RAW fees
  // (feesVoterSplit) to voters for that specific epoch, split by
  // poolVoteWeight(tokenId, pool, epoch) / poolTotalWeight(pool, epoch) --
  // an EPOCH-scoped weight, distinct from the all-time cumulative
  // weights/totalWeight the emissions vAPR above uses. Modeling the
  // prospective outcome of submitting the CURRENT allocation sliders right
  // now: the user's own veNFT+Furnace weight split by their chosen %,
  // added on top of whatever's already voted for that pool this epoch.
  const WEEK_SECONDS = 604800
  const currentEpochSeconds = BigInt(Math.floor(Date.now() / 1000 / WEEK_SECONDS) * WEEK_SECONDS)
  const { data: poolTotalWeightReads } = useReadContracts({
    contracts: allocations.map(a => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'poolTotalWeight' as const,
      args: [a.poolAddress, currentEpochSeconds] as const,
    })),
    query: { enabled: allocations.length > 0 },
  })
  const { data: lockedAmountRaw } = useReadContract({
    address: CONTRACTS.AeonVotingEscrow, abi: VOTING_ESCROW_ABI, functionName: 'lockedAmount',
    args: tokenId ? [tokenId] : undefined,
    query: { enabled: !!tokenId },
  })
  const aeonPrice = prices['AEON'] ?? null
  const userLockedUsd = (lockedAmountRaw !== undefined && aeonPrice !== null)
    ? parseFloat(formatUnits(lockedAmountRaw as bigint, 18)) * aeonPrice
    : null
  const userVoteWeight = (votingPower !== undefined ? votingPower : 0n) + furnaceWeight

  function estimateVoteFeeShare(alloc: VoteAllocation, index: number): { usd: number | null; vapr: number | null } {
    const feesWeek = feesWeekByAddr[alloc.poolAddress]
    const totalWeightRead = poolTotalWeightReads?.[index]
    const existingPoolWeight = totalWeightRead?.status === 'success' ? totalWeightRead.result as bigint : null
    if (feesWeek === null || feesWeek === undefined || existingPoolWeight === null || userVoteWeight === 0n) {
      return { usd: null, vapr: null }
    }
    const theirPoolWeight = (userVoteWeight * BigInt(Math.round(alloc.weight * 100))) / 10_000n
    const newTotalWeight = existingPoolWeight + theirPoolWeight
    if (newTotalWeight === 0n || theirPoolWeight === 0n) return { usd: 0, vapr: 0 }
    const theirShare = Number(theirPoolWeight) / Number(newTotalWeight)
    const voterPoolUsd = feesWeek * (EPOCH_CONFIG.feeVoterSplit / 100)
    const usd = voterPoolUsd * theirShare
    const vapr = userLockedUsd && userLockedUsd > 0 ? (usd * 52 / userLockedUsd) * 100 : null
    return { usd, vapr }
  }

  // vAPR per pool: the annualized $ return a pool's LPs get from the AEON
  // emissions voting currently directs to it, relative to its own TVL --
  // distinct from "APR" above (trading-fee yield).
  //
  // 2026-07-13: EmissionsEngineRH (rolling 3-epoch average, 3x growth cap,
  // 95/5 voter/Furnace split) was replaced by VoteDirectedLpEmissionsEngineRH
  // -- confirmed live via MinterProxy.logic(), not just a deploy script.
  // The new engine has no rolling average and no growth cap: each epoch
  // mints AEON worth exactly 25% of that epoch's finalized USD fees
  // (feeDistributor.lastEpochFeesUSD()), and 100% of every mint goes to
  // vote-directed LP gauges (0% to Furnace now). This mirrors that exact
  // math -- see src/lib/emissionsProjection.ts.
  const { data: onChainTotalWeight } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
  })

  const { data: lastFeesUSDRaw } = useReadContract({
    address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'lastFeesUSD',
  })
  const { data: multiGaugeBpsRaw } = useReadContract({
    address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'multiGaugeBps',
  })
  const { data: currentMultiWeight } = useReadContract({
    address: CONTRACTS.MultiGaugeController,
    abi: MULTI_GAUGE_CONTROLLER_ABI,
    functionName: 'totalWeight',
    args: multiEpoch !== undefined ? [multiEpoch] : undefined,
    query: { enabled: multiEpoch !== undefined },
  })

  const pricedTokens = useOraclePricedTokens()
  const lastFeesUSD = lastFeesUSDRaw !== undefined ? Number(formatUnits(lastFeesUSDRaw as bigint, 18)) : null

  // Use the same live fee estimate shown on the dashboard so vAPR stays
  // connected to fees as they rise/fall through the epoch, instead of only
  // reflecting the last finalized epoch's number.
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const elapsedDays = (now - Math.floor(now / WEEK_MS) * WEEK_MS) / (24 * 60 * 60 * 1000)
  // ONLY vAMM pools' fees reach the FeeDistributor and size the emission mint
  // (their gauges call collectFees->notifyFees). CL/DLMM swap fees accrue to
  // LPs natively and never enter lastEpochFeesUSD, so the emission budget is
  // computed over vAMM POOLS only.
  const seenFeePools = new Set<string>()
  const feeBudgetPools = POOLS.filter(pool => {
    const address = pool.address.toLowerCase()
    if (seenFeePools.has(address)) return false
    seenFeePools.add(address)
    return true
  })
  const hasLiveFeeData = Object.keys(volResult.byPoolWeek).length > 0
  // Emissions are minted off ONLY oracle-priced-token fees (the protocol counts
  // unpriced memecoin fees as $0 toward lastEpochFeesUSD), so the live estimate
  // that feeds the projection weights each pool by its priced fraction. NOTE:
  // the separate voter-fee-share math below (estimateVoteFeeShare) intentionally
  // uses RAW all-token fees, because voters really do receive every fee token
  // in-kind regardless of whether the oracle can price it.
  const liveEpochFeesUSD = hasLiveFeeData
    ? feeBudgetPools.reduce((sum, pool) => {
        const volumeWeek = volResult.byPoolWeek[pool.address.toLowerCase()]
        if (volumeWeek === undefined) return sum
        const raw = (volumeWeek / 7) * elapsedDays * parseFeeRate(pool.fee)
        return sum + raw * pricedFeeFraction(pool.token0, pool.token1, pricedTokens)
      }, 0)
    : null
  const emissionProjection = projectNextEmission({
    lastFeesUSD,
    liveEpochFeesUSD,
    aeonPriceUSD: aeonPrice,
  })
  const tokensToMintAeon = emissionProjection.projectedMintAeon

  // Matches updatePeriod()'s exact branching: multi-gauge only gets a share
  // if it has live vote weight this epoch, and gets the FULL mint (not just
  // its bps share) if the legacy vAMM voter has zero weight.
  const legacyHasWeight = !!onChainTotalWeight && onChainTotalWeight > 0n
  const multiHasWeight = !!currentMultiWeight && currentMultiWeight > 0n
  const toMultiGaugeAeon = multiHasWeight
    ? (legacyHasWeight ? tokensToMintAeon * (Number(multiGaugeBpsRaw ?? 0n) / 10_000) : tokensToMintAeon)
    : 0
  const toVoterAeon = tokensToMintAeon - toMultiGaugeAeon
  const projectedWeeklyToVoterUSD = aeonPrice ? toVoterAeon * aeonPrice : 0

  const vaprByAddr: Record<string, number | null> = {}
  for (const [poolIndex, pool] of POOLS.entries()) {
    const tvl = tvlByAddr[pool.address] ?? null
    const totalLp = lpSupplyReads?.[poolIndex]?.status === 'success' ? lpSupplyReads[poolIndex].result as bigint : 0n
    const stakedLp = gaugeLpReads?.[poolIndex]?.status === 'success' ? gaugeLpReads[poolIndex].result as bigint : 0n
    const stakedTvl = tvl && totalLp > 0n ? tvl * Number(stakedLp) / Number(totalLp) : 0
    const poolWeight = poolStats.find(s => s.address === pool.address)?.votesWei ?? 0n
    vaprByAddr[pool.address] = (stakedTvl > 0 && aeonPrice && onChainTotalWeight && onChainTotalWeight > 0n)
      ? (projectedWeeklyToVoterUSD * (Number(poolWeight) / Number(onChainTotalWeight)) * 52 / stakedTvl) * 100
      : null
  }
  // CL/DLMM vAPR: these gauges are funded by the MultiGaugeController, not the
  // legacy voter -- so a pool's projected AEON = toMultiGaugeAeon split by its
  // controller vote share (weights[epoch][pool] / totalWeight[epoch]), over the
  // pool's TVL. (Uses total pool TVL as the denominator; CL positions earn only
  // when staked, so this is the "if this TVL were staked" projection.)
  const projectedWeeklyToMultiUSD = aeonPrice ? toMultiGaugeAeon * aeonPrice : 0
  for (const pool of [...CL_POOLS, ...DLMM_POOLS]) {
    const tvl = tvlByAddr[pool.address] ?? null
    const poolWeight = allStats.find(s => s.address === pool.address)?.votesWei ?? 0n
    vaprByAddr[pool.address] = (tvl && tvl > 0 && poolWeight > 0n && currentMultiWeight && currentMultiWeight > 0n)
      ? (projectedWeeklyToMultiUSD * (Number(poolWeight) / Number(currentMultiWeight)) * 52 / tvl) * 100
      : null
  }

  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0)
  const remaining   = 100 - totalWeight

  const availablePools: VotePool[] = voteMode === 'vAMM' ? POOLS : [...CL_POOLS, ...DLMM_POOLS]
  const filteredPools = availablePools.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const hasVotedForMode = voteMode === 'vAMM' ? !!hasVoted : !!multiHasVoted

  const isOwner = nftOwner && address && nftOwner.toLowerCase() === address.toLowerCase()

  // Matches AeonVoterV2.MAX_POOLS (the real on-chain cap) -- not an arbitrary
  // UI limit, so this stays correct as more pools get added.
  const MAX_VOTE_POOLS = 30

  function addPool(pool: VotePool) {
    if (allocations.length >= MAX_VOTE_POOLS) return
    if (allocations.find(a => a.poolAddress === pool.address)) return
    const share = Math.floor(remaining / (MAX_VOTE_POOLS - allocations.length + 1))
    setAllocations(prev => [...prev, { pool: pool.name + ' ' + pool.type, poolAddress: pool.address, weight: share }])
  }

  function removePool(poolAddress: `0x${string}`) {
    setAllocations(prev => prev.filter(a => a.poolAddress !== poolAddress))
  }

  function setWeight(poolAddress: `0x${string}`, weight: number) {
    setAllocations(prev => prev.map(a => a.poolAddress === poolAddress ? { ...a, weight: Math.max(0, Math.min(100, weight)) } : a))
  }

  function distribute() {
    if (allocations.length === 0) return
    const share = Math.floor(100 / allocations.length)
    const rem   = 100 - share * allocations.length
    setAllocations(prev => prev.map((a, i) => ({ ...a, weight: i === 0 ? share + rem : share })))
  }

  function handleVote() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!tokenId || !isOwner || totalWeight !== 100 || allocations.length === 0) return
    if (walletAlreadyVotedTokenId !== undefined) return
    const poolAddresses = allocations.map(a => a.poolAddress)
    const weights       = allocations.map(a => BigInt(Math.round(a.weight * 100)))
    if (voteMode === 'vAMM') {
      writeContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'vote', args: [tokenId, poolAddresses, weights] })
    } else {
      writeContract({ address: CONTRACTS.MultiGaugeController, abi: MULTI_GAUGE_CONTROLLER_ABI, functionName: 'vote', args: [tokenId, poolAddresses, weights] })
    }
  }

  function changeVoteMode(mode: VoteMode) {
    setVoteMode(mode)
    setAllocations([])
    setSearch('')
  }

  function handleReset() {
    if (!tokenId) return
    writeReset({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'reset', args: [tokenId] })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Vote</h1>
        <p className="text-text-secondary">Direct emissions by voting with your veNFT. Earn fees from pools you vote for.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          {/* veNFT selector */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Your veNFT</div>
            {!isConnected ? (
              <div className="text-center py-4 text-text-muted text-sm">Connect wallet to vote</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-muted">veNFTs owned</span>
                  <span className="font-mono text-violet-400 font-bold">{veNFTCount?.toString() ?? '—'}</span>
                </div>

                {ownedTokenIds.length > 1 ? (
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">Your veNFTs</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {ownedTokenIds.map(id => (
                        <button key={id.toString()} onClick={() => setTokenIdInput(id.toString())}
                          className={clsx('px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',
                            tokenIdInput === id.toString() ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                          #{id.toString()}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-xs text-text-muted mb-1 block">Enter veNFT Token ID</label>
                    <input
                      type="number"
                      value={tokenIdInput}
                      onChange={e => setTokenIdInput(e.target.value)}
                      placeholder="e.g. 1"
                      className="input-base w-full text-sm py-2"
                    />
                  </div>
                )}

                {tokenId && (
                  <div className="space-y-1.5 p-3 bg-bg-raised rounded-xl">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Owner</span>
                      <span className={clsx('font-mono', isOwner ? 'text-emerald-400' : 'text-red-400')}>
                        {nftOwner ? (isOwner ? 'You ✓' : 'Not yours') : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">veNFT Lock Weight</span>
                      <span className="font-mono text-text-secondary">
                        {votingPower !== undefined ? parseFloat(formatUnits(votingPower, 18)).toFixed(4) : '—'} veAEON
                      </span>
                    </div>
                    {rawFurnaceWeight > 0n && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted flex items-center gap-1"><Flame size={11} className="text-orange-400" /> Furnace Bonus</span>
                        <span className={clsx('font-mono', furnacePowerAlreadyUsed ? 'text-text-muted' : 'text-orange-400')}>
                          {furnacePowerAlreadyUsed
                            ? 'Used this epoch (0.0000)'
                            : `+${parseFloat(formatUnits(furnaceWeight, 18)).toFixed(4)} veAEON`}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs pt-1.5 border-t border-bg-border">
                      <span className="text-text-primary font-medium">Total Voting Power</span>
                      <span className="font-mono text-aeon-400 font-bold">
                        {votingPower !== undefined ? parseFloat(formatUnits(votingPower + furnaceWeight, 18)).toFixed(4) : '—'} veAEON
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Has Voted</span>
                      <span className={clsx('font-mono', hasVotedForMode ? 'text-yellow-400' : 'text-emerald-400')}>
                        {voteMode === 'vAMM' && hasVoted === undefined ? '—' : voteMode === 'CL_DLMM' && multiHasVoted === undefined ? '—' : hasVotedForMode ? 'Yes' : 'No'}
                      </span>
                    </div>
                    {hasVotedForMode && <CurrentVotes tokenId={tokenId} mode={voteMode} epoch={multiEpoch} />}
                    {voteMode === 'vAMM' && hasVoted && (
                      <div className="space-y-1 mt-1">
                        <button onClick={handleReset} disabled={isResetting || !canReset} className="btn-ghost w-full text-xs py-1.5 text-red-400 border border-red-400/20 hover:border-red-400/50 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                          {isResetting ? 'Resetting…' : canReset ? 'Reset Vote' : `Reset unlocks in ${resetCountdown()}`}
                        </button>
                        {!canReset && (
                          <p className="text-2xs text-text-muted text-center">Reset is only available after the epoch you voted in ends</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Wallet-level, independent of which veNFT is selected above --
                    reads the wallet's pre-cutover vote directly. */}
                {address && <LegacyClaim wallet={address} />}

                {!loadingOwned && ownedTokenIds.length === 0 && furnaceWeight > 0n && (
                  <div className="p-3 rounded-xl bg-orange-400/5 border border-orange-400/20 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-orange-400">
                      <Flame size={13} /> Furnace weight not yet active
                    </div>
                    <p className="text-2xs text-text-muted leading-relaxed">
                      You've burned {parseFloat(formatUnits(furnaceWeight, 18)).toFixed(2)} AEON in the Furnace, but AeonVoterV2 only counts that weight toward whichever veNFT you vote with — it needs at least one, even a tiny one. Lock 1 AEON for 1 week to mint a veNFT and unlock your full Furnace voting power.
                    </p>
                    <button
                      onClick={handleActivateFurnaceVoting}
                      disabled={isActivating}
                      className="btn-primary w-full text-xs py-2 flex items-center justify-center gap-1.5 disabled:opacity-40"
                    >
                      {isActivating && <Loader2 size={12} className="animate-spin" />}
                      {activateStep === 'approve' || activateStep === 'approve_wait' ? 'Approving 1 AEON…'
                        : activateStep === 'lock' || activateStep === 'lock_wait' ? 'Creating veNFT…'
                        : 'Activate Furnace Voting (lock 1 AEON)'}
                    </button>
                    {activateErr && <div className="text-2xs text-red-400 font-mono break-all">{activateErr}</div>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vote builder */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Vote Allocation</div>
              <button onClick={distribute} className="text-2xs font-mono text-aeon-400 hover:text-aeon-300 transition-colors" disabled={allocations.length === 0}>
                Distribute evenly
              </button>
            </div>

            {allocations.length === 0 ? (
              <div className="text-center py-6">
                <Vote size={24} className="text-text-muted mx-auto mb-2" />
                <p className="text-sm text-text-muted">Select pools from the list</p>
              </div>
            ) : (
              <div className="space-y-3">
                {allocations.map((alloc, index) => {
                  const { usd: voteEstUsd, vapr: voteEstVapr } = estimateVoteFeeShare(alloc, index)
                  return (
                  <div key={alloc.poolAddress} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text-primary">{alloc.pool}</span>
                      <button onClick={() => removePool(alloc.poolAddress)} className="text-text-muted hover:text-red-400 transition-colors"><X size={14} /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="range" min={0} max={100} value={alloc.weight} onChange={e => setWeight(alloc.poolAddress, parseInt(e.target.value))} className="flex-1 accent-aeon-400" />
                      <div className="flex items-center gap-1 w-16">
                        <input type="number" min={0} max={100} value={alloc.weight} onChange={e => setWeight(alloc.poolAddress, parseInt(e.target.value) || 0)} className="w-12 bg-bg-base border border-bg-border rounded-lg px-2 py-1 text-xs font-mono text-center text-text-primary focus:outline-none focus:border-aeon-400" />
                        <span className="text-xs text-text-muted">%</span>
                      </div>
                    </div>
                    {alloc.weight > 0 && (
                      <div className="flex items-center justify-between text-2xs font-mono pl-0.5">
                        <span className="text-text-muted">Est. fee share this epoch (80% of pool fees)</span>
                        <span className="text-emerald-400">
                          {voteEstUsd !== null ? fmtUsd(voteEstUsd) : '$—'}
                          {voteEstVapr !== null && <span className="text-text-muted"> · {fmtApr(voteEstVapr)} vAPR</span>}
                        </span>
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-bg-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Total weight</span>
                <span className={clsx('text-sm font-mono font-bold', totalWeight === 100 ? 'text-emerald-400' : totalWeight > 100 ? 'text-red-400' : 'text-text-primary')}>
                  {totalWeight}%
                </span>
              </div>
              <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                <div className={clsx('h-full rounded-full transition-all', totalWeight === 100 ? 'bg-emerald-400' : totalWeight > 100 ? 'bg-red-400' : 'bg-aeon-400')} style={{ width: `${Math.min(totalWeight, 100)}%` }} />
              </div>
            </div>

            <button
              onClick={handleVote}
              disabled={isBusy || (isConnected && (totalWeight !== 100 || allocations.length === 0 || !tokenId || !isOwner || hasVotedForMode || walletAlreadyVotedTokenId !== undefined))}
              className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
            >
              <Vote size={16} />
              {!isConnected ? 'Connect Wallet' : isBusy ? 'Voting...' : 'Cast Vote'}
            </button>
            {isConnected && !tokenId && <p className="text-2xs text-text-muted text-center mt-2">Enter your veNFT ID above to vote</p>}
            {isConnected && tokenId && hasVotedForMode && (
              <p className="text-2xs text-yellow-400 text-center mt-2">
                {voteMode === 'vAMM' ? 'Reset your vAMM vote first before re-voting' : 'CL/DLMM votes renew next epoch'}
              </p>
            )}
            {isConnected && walletAlreadyVotedTokenId !== undefined && (
              <p className="text-2xs text-red-400 text-center mt-2">
                Your wallet already voted this epoch with veNFT #{walletAlreadyVotedTokenId.toString()}. Only one of your veNFTs can vote per epoch — your Furnace burn bonus only counts once, no matter how many veNFTs you switch between.
              </p>
            )}
          </div>

          {/* Epoch info */}
          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Epoch Info</div>
            <EpochInfo />
          </div>
        </div>

        {/* Pool list */}
        <div className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pools..." className="input-base flex-1 text-sm py-2" />
            <div className="flex rounded-xl border border-bg-border bg-bg-base p-1">
              <button onClick={() => changeVoteMode('vAMM')} className={clsx('px-3 py-1.5 rounded-lg text-xs font-mono transition-colors', voteMode === 'vAMM' ? 'bg-blue-400/15 text-blue-400' : 'text-text-muted')}>vAMM</button>
              <button onClick={() => changeVoteMode('CL_DLMM')} className={clsx('px-3 py-1.5 rounded-lg text-xs font-mono transition-colors', voteMode === 'CL_DLMM' ? 'bg-violet-400/15 text-violet-400' : 'text-text-muted')}>CL + DLMM</button>
            </div>
          </div>
          <p className="text-2xs text-text-muted mb-3 -mt-1">
            {voteMode === 'vAMM'
              ? `Every vAMM pool remains on the legacy voter — up to ${MAX_VOTE_POOLS} at once.`
              : `Existing CL and DLMM positions now receive automatic vote-weighted AEON emissions. Votes are epoch-scoped and renew weekly.`}
          </p>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-bg-border">
              {['Pool', 'Type', 'TVL', 'Volume 24h', '7d gross fee APR', 'Live projected vAPR', ''].map((h, i) => (
                <div key={h + i} title={i === 4 ? 'Trailing 7-day gross swap fees annualized: fees7d ÷ TVL × 365/7.' : i === 5 ? 'Live current-epoch fees projected into the next rolling snapshot, then the 10:1 rule, 3× cap, gauge vote share and staked TVL. Refreshes every minute.' : undefined} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', i === 0 ? 'col-span-3' : i === 1 ? 'col-span-1' : i === 6 ? 'col-span-1 text-right' : 'col-span-2')}>{h}</div>
              ))}
            </div>

            <div className="divide-y divide-bg-border">
              {filteredPools.slice(0, 30).map(pool => {
                const isSelected = allocations.some(a => a.poolAddress === pool.address)
                return (
                  <div key={pool.address} className={clsx('grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-bg-raised transition-colors', isSelected && 'bg-aeon-400/5')}>
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="flex -space-x-1">
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold z-10">{pool.token0[0]}</div>
                        <div className="w-6 h-6 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-2xs font-bold">{pool.token1[0]}</div>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary leading-tight">{pool.name}</div>
                        <div className="text-2xs font-mono text-text-muted">{pool.fee}</div>
                      </div>
                    </div>
                    <div className="col-span-1">
                      <span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span>
                    </div>
                    <div className="col-span-2 text-sm font-mono text-text-secondary">{fmtUsd(tvlByAddr[pool.address] ?? null)}</div>
                    <div className="col-span-2 text-sm font-mono text-text-secondary">{fmtUsd(volResult.byPool[pool.address.toLowerCase()] ?? null)}</div>
                    <div className="col-span-2 text-sm font-mono text-emerald-400">{fmtApr(aprByAddr[pool.address] ?? null)}</div>
                    <div className="col-span-1 text-sm font-mono text-violet-400">{fmtApr(vaprByAddr[pool.address] ?? null)}</div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => isSelected ? removePool(pool.address) : addPool(pool)}
                        disabled={allocations.length >= MAX_VOTE_POOLS && !isSelected}
                        className={clsx('w-7 h-7 rounded-lg flex items-center justify-center transition-all', isSelected ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-aeon-400/10 text-aeon-400 hover:bg-aeon-400/20', allocations.length >= 6 && !isSelected && 'opacity-30 cursor-not-allowed')}
                      >
                        {isSelected ? <X size={12} /> : <Plus size={12} />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <p className="text-xs text-text-muted mt-3 text-center font-mono">{filteredPools.length} pools · Max {MAX_VOTE_POOLS} pools per vote</p>
        </div>
      </div>
    </div>
  )
}

// The unique pools this tokenId could possibly have voted for — de-duped by
// address, matching how AeonVoterV2 tracks votes per pool (not per fee tier).
const UNIQUE_VOTE_POOLS = POOLS.filter((p, i, arr) => arr.findIndex(x => x.address === p.address) === i)
const UNIQUE_MULTI_VOTE_POOLS = [...CL_POOLS, ...DLMM_POOLS]
  .filter((p, i, arr) => arr.findIndex(x => x.address === p.address) === i)

function CurrentVotes({ tokenId, mode, epoch }: { tokenId: bigint | undefined; mode: VoteMode; epoch: bigint | undefined }) {
  const { data: legacyData } = useReadContracts({
    contracts: UNIQUE_VOTE_POOLS.map(p => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'getVotes' as const,
      args: tokenId !== undefined ? [tokenId, p.address] as const : undefined,
    })),
    query: { enabled: mode === 'vAMM' && tokenId !== undefined, refetchInterval: 15000 },
  })
  const { data: multiData } = useReadContracts({
    contracts: UNIQUE_MULTI_VOTE_POOLS.map(p => ({
      address: CONTRACTS.MultiGaugeController, abi: MULTI_GAUGE_CONTROLLER_ABI, functionName: 'votes' as const,
      args: tokenId !== undefined && epoch !== undefined ? [epoch, tokenId, p.address] as const : undefined,
    })),
    query: { enabled: mode === 'CL_DLMM' && tokenId !== undefined && epoch !== undefined, refetchInterval: 15000 },
  })

  const votePools = mode === 'vAMM' ? UNIQUE_VOTE_POOLS : UNIQUE_MULTI_VOTE_POOLS
  const data = mode === 'vAMM' ? legacyData : multiData

  const rows = votePools
    .map((pool, i) => ({ pool, weight: data?.[i]?.status === 'success' ? data[i].result as bigint : 0n }))
    .filter(r => r.weight > 0n)

  const total = rows.reduce((s, r) => s + r.weight, 0n)

  if (!data) return <div className="text-2xs text-text-muted text-center py-1">Loading your votes…</div>
  if (rows.length === 0) return <div className="text-2xs text-text-muted text-center py-1">No pool allocation found for this veNFT</div>

  return (
    <div className="space-y-1 pt-1 border-t border-bg-border mt-1">
      <div className="text-2xs text-text-muted uppercase tracking-wider pt-1">Your Current Votes</div>
      {rows.map(({ pool, weight }) => (
        <div key={pool.address} className="flex justify-between items-center text-xs">
          <span className="text-text-secondary">{pool.name}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-aeon-400">
              {total > 0n ? `${(Number(weight * 10000n / total) / 100).toFixed(1)}%` : '—'}
            </span>
            {mode === 'vAMM' && tokenId !== undefined && <ClaimFees pool={pool} tokenId={tokenId} />}
          </div>
        </div>
      ))}
    </div>
  )
}

// Cutover (2026-07-16) happened mid-epoch. The real fees collected during
// that epoch (~700 AEON as of cutover) live in the OLD FeeDistributor,
// tagged to vote weights that live entirely on LEGACY_AEON_VOTER -- that
// pairing is self-contained and unaffected by the voter/engine cutover
// (pure wall-clock epoch math, immutable reference to the old voter's
// still-intact storage). This shows + claims that one legacy epoch's money
// so it doesn't just sit unclaimed once the new Claim Fees button (which
// only knows about the new, empty-so-far FeeDistributor) can't see it.
function LegacyClaim({ wallet }: { wallet: `0x${string}` }) {
  const WEEK_S = 604800n
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const currentEpoch = (nowSec / WEEK_S) * WEEK_S
  const isClosed = nowSec >= currentEpoch + WEEK_S
  const closesAt = new Date(Number(currentEpoch + WEEK_S) * 1000)

  // The claiming contract (LEGACY_FEE_DISTRIBUTOR, immutable, pre-cutover)
  // hardcodes msg.sender -> voter.lastVotedTokenId(msg.sender) -- it can
  // only ever pay out through THIS ONE tokenId, no matter which of the
  // wallet's other veNFTs also has real weight. poke() never updates that
  // mapping (only vote() does), so a wallet that poked one NFT and voted
  // fresh with another can have its "active" tokenId pointing at the wrong
  // one -- surfaced below so it's visible instead of just silently showing
  // nothing.
  const { data: activeTokenIdRaw } = useReadContract({
    address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'lastVotedTokenId', args: [wallet],
  })
  const activeTokenId = activeTokenIdRaw as bigint | undefined

  const { owned: ownedTokenIds } = useOwnedVeNFTs(wallet)

  // Epoch-specific vote-weight snapshot -- NOT getVotes() (reflects the
  // ongoing/current allocation, not what was actually locked in for this
  // epoch) and NOT derived from lastVoted() (poke() never updates that
  // timestamp -- caused a real bug here: pointed at an old, already-fully-
  // processed epoch instead of the one actually holding the pre-cutover fees).
  const { data: activeWeightData } = useReadContracts({
    contracts: UNIQUE_VOTE_POOLS.map(p => ({
      address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'poolVoteWeight' as const,
      args: activeTokenId !== undefined ? [activeTokenId, p.address, currentEpoch] as const : undefined,
    })),
    query: { enabled: activeTokenId !== undefined && activeTokenId > 0n, refetchInterval: 15000 },
  })

  // Sum of every OTHER owned tokenId's weight, per tokenId, so we can flag
  // "you own #X with real weight but it isn't your active claiming NFT."
  const otherTokenIds = ownedTokenIds.filter(id => id !== activeTokenId)
  const { data: otherWeightData } = useReadContracts({
    contracts: otherTokenIds.flatMap(id =>
      UNIQUE_VOTE_POOLS.map(p => ({
        address: LEGACY_AEON_VOTER, abi: VOTER_ABI, functionName: 'poolVoteWeight' as const,
        args: [id, p.address, currentEpoch] as const,
      }))
    ),
    query: { enabled: otherTokenIds.length > 0, refetchInterval: 15000 },
  })

  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [claimedPools, setClaimedPools] = useState<Set<string>>(new Set())
  const [claimingIndex, setClaimingIndex] = useState<number | null>(null)
  const [claimError, setClaimError] = useState('')

  if (!activeTokenId || activeTokenId === 0n) return null
  const rows = UNIQUE_VOTE_POOLS
    .map((pool, i) => ({ pool, weight: activeWeightData?.[i]?.status === 'success' ? activeWeightData[i].result as bigint : 0n }))
    .filter(r => r.weight > 0n)

  const otherIdsWithWeight = otherTokenIds.filter((id, idx) => {
    const start = idx * UNIQUE_VOTE_POOLS.length
    return UNIQUE_VOTE_POOLS.some((_, j) => otherWeightData?.[start + j]?.status === 'success' && (otherWeightData[start + j].result as bigint) > 0n)
  })

  if (rows.length === 0 && otherIdsWithWeight.length === 0) return null

  const pending = rows.filter(r => !claimedPools.has(r.pool.address))
  const isClaiming = claimingIndex !== null

  async function handleClaimAll() {
    setClaimError('')
    for (let i = 0; i < pending.length; i++) {
      setClaimingIndex(i)
      try {
        const hash = await writeContractAsync({
          address: LEGACY_FEE_DISTRIBUTOR, abi: LEGACY_FEE_DISTRIBUTOR_ABI, functionName: 'claimAllFees',
          args: [pending[i].pool.address, currentEpoch],
        })
        await publicClient?.waitForTransactionReceipt({ hash })
        setClaimedPools(prev => new Set(prev).add(pending[i].pool.address))
      } catch (e: any) {
        setClaimError((e.shortMessage ?? e.message ?? 'Claim failed').slice(0, 150))
        break
      }
    }
    setClaimingIndex(null)
  }

  return (
    <div className="space-y-1 pt-1 border-t border-amber-500/20 mt-1">
      <div className="text-2xs text-amber-400 uppercase tracking-wider pt-1">Pre-migration rewards (veNFT #{activeTokenId.toString()})</div>
      {rows.map(({ pool }) => (
        <div key={pool.address} className="flex justify-between items-center text-xs">
          <span className="text-text-secondary">{pool.name}</span>
          <span className={clsx('font-mono text-2xs', claimedPools.has(pool.address) ? 'text-emerald-400' : 'text-text-muted')}>
            {claimedPools.has(pool.address) ? 'Claimed ✓' : 'Pending'}
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="text-2xs text-text-muted">veNFT #{activeTokenId.toString()} has no weight this epoch.</p>
      )}
      {isClosed ? (
        pending.length > 0 && (
          <button
            onClick={handleClaimAll}
            disabled={isClaiming}
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2 text-sm py-2 disabled:opacity-60"
          >
            {isClaiming && <Loader2 size={14} className="animate-spin" />}
            {isClaiming ? `Claiming ${claimingIndex! + 1}/${pending.length}…` : `Claim All (${pending.length})`}
          </button>
        )
      ) : (
        <p className="text-2xs text-text-muted pt-1">Claimable once this epoch closes (~{closesAt.toLocaleDateString()}).</p>
      )}
      {claimError && <p className="text-2xs text-red-400 pt-1 break-all">{claimError}</p>}
      {otherIdsWithWeight.length > 0 && (
        <p className="text-2xs text-orange-400 pt-1 leading-relaxed">
          You also own veNFT {otherIdsWithWeight.map(id => `#${id}`).join(', ')} with real weight this epoch, but only
          #{activeTokenId.toString()} can claim right now -- the old contract only pays out through whichever veNFT you
          last called Vote with (poking doesn't count). Call Vote here with {otherIdsWithWeight.map(id => `#${id}`).join('/')} to
          make it active, then come back to claim its share too.
        </p>
      )}
    </div>
  )
}

// Claims `tokenId`'s voter-share of every fee token FeeDistributorV4
// collected for `pool` during the most recently CLOSED epoch (claimAllFees
// reverts/no-ops on the still-open current epoch -- epoch must be < currentEpoch()).
// tokenId is required and checked against real ownership/approval on-chain --
// V3's old resolve-by-wallet behavior made every other owned veNFT's share
// permanently unclaimable for multi-NFT wallets, fixed in V4.
function ClaimFees({ pool, tokenId }: { pool: { address: `0x${string}`; name: string }; tokenId: bigint }) {
  const WEEK_S = 604800n
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const lastClosedEpoch = (nowSec / WEEK_S) * WEEK_S - WEEK_S

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash, query: { enabled: !!hash } })

  function handleClaim() {
    writeContract({
      address: CONTRACTS.FeeDistributor, abi: FEE_DISTRIBUTOR_ABI, functionName: 'claimAllFees',
      args: [pool.address, tokenId, lastClosedEpoch],
    })
  }

  return (
    <button
      onClick={handleClaim}
      disabled={isPending || isConfirming}
      title={error ? error.message.slice(0, 150) : 'Claim your voter fee share for the last closed epoch'}
      className="text-2xs font-mono text-aeon-400 hover:text-aeon-300 transition-colors disabled:opacity-50 border border-aeon-800/50 rounded px-1.5 py-0.5"
    >
      {isPending || isConfirming ? '…' : isSuccess ? 'Claimed ✓' : 'Claim Fees'}
    </button>
  )
}

// Robinhood Chain genesis epoch — matches the constant used on /dashboard.
const GENESIS_S = 1782950400 // 2026-07-02 00:00:00 UTC

function EpochInfo() {
  const WEEK_MS    = 7 * 24 * 60 * 60 * 1000
  const WEEK_S     = 7 * 24 * 60 * 60
  const now        = Date.now()
  const epochStart = Math.floor(now / WEEK_MS) * WEEK_MS
  const remaining  = epochStart + WEEK_MS - now
  const days       = Math.floor(remaining / (24 * 60 * 60 * 1000))
  const hours      = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const epochNum   = Math.floor((now / 1000 - GENESIS_S) / WEEK_S)

  const { data: totalWeight } = useReadContract({
    address: CONTRACTS.AeonVoter,
    abi: VOTER_ABI,
    functionName: 'totalWeight',
  })

  const { data: lastMintAmount } = useReadContract({
    address: CONTRACTS.EmissionsEngine,
    abi: EMISSIONS_ENGINE_ABI,
    functionName: 'lastMintAmount',
  })

  return (
    <div className="space-y-2">
      {[
        { label: 'Current Epoch', value: `#${epochNum}` },
        { label: 'Epoch Ends',    value: `${days}d ${hours}h` },
        { label: 'Total Votes',   value: totalWeight !== undefined ? `${parseFloat(formatUnits(totalWeight, 18)).toFixed(2)} veAEON` : '—' },
        { label: 'Last Emission', value: lastMintAmount !== undefined ? `${parseFloat(formatUnits(lastMintAmount, 18)).toFixed(2)} AEON` : '— AEON' },
      ].map(item => (
        <div key={item.label} className="flex justify-between text-sm">
          <span className="text-text-muted">{item.label}</span>
          <span className="font-mono text-text-primary">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
