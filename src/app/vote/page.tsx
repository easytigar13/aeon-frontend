'use client'
import { useState, useEffect } from 'react'
import { Vote, Plus, X, Flame, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, CONTRACTS } from '@/config/contracts'
import { VOTING_ESCROW_ABI, VOTER_ABI, EMISSIONS_ENGINE_ABI, FURNACE_ABI, ERC20_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

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

export default function VotePage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenIdInput,  setTokenIdInput]  = useState('')
  const [allocations,   setAllocations]   = useState<VoteAllocation[]>([])
  const [search,        setSearch]        = useState('')

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
  const furnaceWeight = (furnaceWeightRaw as bigint | undefined) ?? 0n

  const { owned: ownedTokenIds, loading: loadingOwned } = useOwnedVeNFTs(address)

  // Auto-select the wallet's only veNFT so users don't have to look up their
  // own tokenId; leave the field alone if they own several (picker below) or
  // have already typed something themselves.
  useEffect(() => {
    if (tokenIdInput || loadingOwned) return
    if (ownedTokenIds.length === 1) setTokenIdInput(ownedTokenIds[0].toString())
  }, [ownedTokenIds, loadingOwned, tokenIdInput])

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
    if (txSuccess) { refetchHasVoted() }
  }, [txSuccess])

  useEffect(() => {
    if (resetSuccess) { refetchHasVoted() }
  }, [resetSuccess])

  const isBusy      = isPending || isConfirming
  const isResetting = resetPending || resetConfirming

  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const tvlByAddr   = Object.fromEntries(poolStats.map(s => [s.address, s.tvlUsd]))
  const votesByAddr = Object.fromEntries(poolStats.map(s => [s.address, s.votesFormatted]))
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
  for (const pool of POOLS) {
    const tvl = tvlByAddr[pool.address] ?? null
    const volWeek = volResult.byPoolWeek[pool.address.toLowerCase()] ?? null
    const feesWeek = volWeek !== null ? volWeek * parseFeeRate(pool.fee) : null
    aprByAddr[pool.address] = (tvl && tvl > 0 && feesWeek !== null)
      ? (feesWeek * (365 / 7) / tvl) * 100
      : null
  }

  // vAPR per pool: the annualized $ return a pool's LPs get from the AEON
  // emissions voting currently directs to it, relative to its own TVL --
  // distinct from "APR" above (trading-fee yield).
  //
  // Previously projected this epoch's fee budget from live trailing-week
  // volume instead of reading EmissionsEngineRH's own 3-epoch rolling
  // average -- justified at the time by feeHistory being "all zeros
  // pre-genesis-flip". Checked live on-chain (2026-07-12): that's no longer
  // true. updatePeriod() has run once (feeHistoryIndex=1, lastMintAmount≈2.94
  // AEON), so feeHistory[0]≈$0.57 is real, and the live-volume projection
  // was overstating vAPR by ignoring two things the real contract enforces:
  //   1. smoothedFeesUSD is an average of actual SNAPSHOTTED epoch fees
  //      (only updated once per week, at the epoch flip), not continuous
  //      trailing volume -- these can differ hugely mid-epoch.
  //   2. tokensToMint is hard-capped at lastMintAmount * CIRCUIT_BREAKER (3x)
  //      once a mint has happened -- no matter how high live volume runs,
  //      the next real mint provably cannot exceed 3x the last one.
  // This now replicates EmissionsEngineRH.updatePeriod()'s exact math
  // (_rollingAverage -> emissionBudgetUSD -> rawMint -> circuit-breaker cap
  // -> toVoter) using the real on-chain feeHistory/lastMintAmount, so vAPR
  // reflects what the next mint can actually be, not a live-volume guess.
  const { data: onChainTotalWeight } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'totalWeight',
  })
  const aeonPrice = prices['AEON'] ?? null

  const { data: feeHistoryRaw } = useReadContracts({
    contracts: [0, 1, 2].map(i => ({
      address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'feeHistory', args: [BigInt(i)],
    } as const)),
  })
  const { data: lastMintAmountRaw } = useReadContract({
    address: CONTRACTS.EmissionsEngine, abi: EMISSIONS_ENGINE_ABI, functionName: 'lastMintAmount',
  })

  const feeHistory = (feeHistoryRaw ?? []).map(r => (r.status === 'success' ? (r.result as bigint) : undefined))
  const nonZeroFees = feeHistory.filter((v): v is bigint => v !== undefined && v > 0n)
  // Mirrors _rollingAverage(): average of the nonzero slots only (not always
  // ÷3) -- with just one real snapshot so far, this is exactly that one value.
  const smoothedFeesUSD = nonZeroFees.length > 0
    ? Number(formatUnits(nonZeroFees.reduce((a, b) => a + b, 0n), 18)) / nonZeroFees.length
    : 0
  const lastMintAmount = lastMintAmountRaw !== undefined ? Number(formatUnits(lastMintAmountRaw as bigint, 18)) : 0

  const EMISSION_RATIO = 10
  const TO_VOTER_SHARE = 0.95
  const CIRCUIT_BREAKER = 3

  const emissionBudgetUSD = smoothedFeesUSD / EMISSION_RATIO
  const rawMintAeon = aeonPrice && aeonPrice > 0 ? emissionBudgetUSD / aeonPrice : 0
  const tokensToMintAeon = lastMintAmount > 0 ? Math.min(rawMintAeon, lastMintAmount * CIRCUIT_BREAKER) : rawMintAeon
  const toVoterAeon = tokensToMintAeon * TO_VOTER_SHARE
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

  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0)
  const remaining   = 100 - totalWeight

  const filteredPools = POOLS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const isOwner = nftOwner && address && nftOwner.toLowerCase() === address.toLowerCase()

  // Matches AeonVoterV2.MAX_POOLS (the real on-chain cap) -- not an arbitrary
  // UI limit, so this stays correct as more pools get added.
  const MAX_VOTE_POOLS = 30

  function addPool(pool: typeof POOLS[number]) {
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
    const poolAddresses = allocations.map(a => a.poolAddress)
    const weights       = allocations.map(a => BigInt(Math.round(a.weight * 100)))
    writeContract({ address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'vote', args: [tokenId, poolAddresses, weights] })
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
                    {furnaceWeight > 0n && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted flex items-center gap-1"><Flame size={11} className="text-orange-400" /> Furnace Bonus</span>
                        <span className="font-mono text-orange-400">
                          +{parseFloat(formatUnits(furnaceWeight, 18)).toFixed(4)} veAEON
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
                      <span className={clsx('font-mono', hasVoted ? 'text-yellow-400' : 'text-emerald-400')}>
                        {hasVoted === undefined ? '—' : hasVoted ? 'Yes (reset first)' : 'No'}
                      </span>
                    </div>
                    {hasVoted && <CurrentVotes tokenId={tokenId} />}
                    {hasVoted && (
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
                {allocations.map(alloc => (
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
                  </div>
                ))}
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
              disabled={isBusy || (isConnected && (totalWeight !== 100 || allocations.length === 0 || !tokenId || !isOwner || !!hasVoted))}
              className="btn-primary w-full mt-4 flex items-center justify-center gap-2"
            >
              <Vote size={16} />
              {!isConnected ? 'Connect Wallet' : isBusy ? 'Voting...' : 'Cast Vote'}
            </button>
            {isConnected && !tokenId && <p className="text-2xs text-text-muted text-center mt-2">Enter your veNFT ID above to vote</p>}
            {isConnected && tokenId && hasVoted && <p className="text-2xs text-yellow-400 text-center mt-2">Reset your vote first before re-voting</p>}
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
          </div>
          <p className="text-2xs text-text-muted mb-3 -mt-1">
            Every vAMM pool is votable, including new ones as they launch — up to {MAX_VOTE_POOLS} at once, matching the on-chain limit.
            CL and DLMM pools aren't listed yet: they don't have gauges, so voting for one would revert.
          </p>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-bg-border">
              {['Pool', 'Type', 'TVL', 'Volume 24h', '7d gross fee APR', 'Projected gauge vAPR', ''].map((h, i) => (
                <div key={h + i} title={i === 4 ? 'Trailing 7-day gross swap fees annualized: fees7d ÷ TVL × 365/7.' : i === 5 ? 'Projected next-epoch AEON rewards annualized and divided by gauge-staked TVL only.' : undefined} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', i === 0 ? 'col-span-3' : i === 1 ? 'col-span-1' : i === 6 ? 'col-span-1 text-right' : 'col-span-2')}>{h}</div>
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

function CurrentVotes({ tokenId }: { tokenId: bigint | undefined }) {
  const { data } = useReadContracts({
    contracts: UNIQUE_VOTE_POOLS.map(p => ({
      address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'getVotes' as const,
      args: tokenId !== undefined ? [tokenId, p.address] as const : undefined,
    })),
    query: { enabled: tokenId !== undefined, refetchInterval: 15000 },
  })

  const rows = UNIQUE_VOTE_POOLS
    .map((pool, i) => ({ pool, weight: data?.[i]?.status === 'success' ? data[i].result as bigint : 0n }))
    .filter(r => r.weight > 0n)

  const total = rows.reduce((s, r) => s + r.weight, 0n)

  if (!data) return <div className="text-2xs text-text-muted text-center py-1">Loading your votes…</div>
  if (rows.length === 0) return <div className="text-2xs text-text-muted text-center py-1">No pool allocation found for this veNFT</div>

  return (
    <div className="space-y-1 pt-1 border-t border-bg-border mt-1">
      <div className="text-2xs text-text-muted uppercase tracking-wider pt-1">Your Current Votes</div>
      {rows.map(({ pool, weight }) => (
        <div key={pool.address} className="flex justify-between text-xs">
          <span className="text-text-secondary">{pool.name}</span>
          <span className="font-mono text-aeon-400">
            {total > 0n ? `${(Number(weight * 10000n / total) / 100).toFixed(1)}%` : '—'}
          </span>
        </div>
      ))}
    </div>
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
