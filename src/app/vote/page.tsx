'use client'
import { useState, useEffect } from 'react'
import { Vote, Plus, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { POOLS, CONTRACTS } from '@/config/contracts'
import { VOTING_ESCROW_ABI, VOTER_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

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
  const [filterType,    setFilterType]    = useState<'all' | 'vAMM' | 'CL' | 'DLMM'>('all')

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

  // Fee APR per pool: vol24h × feeRate × 365 / TVL × 100
  const aprByAddr: Record<string, number | null> = {}
  for (const pool of POOLS) {
    const tvl = tvlByAddr[pool.address] ?? null
    const vol = volResult.byPool[pool.address.toLowerCase()] ?? null
    aprByAddr[pool.address] = (tvl && tvl > 0 && vol !== null)
      ? (vol * parseFeeRate(pool.fee) * 365 / tvl) * 100
      : null
  }

  const totalWeight = allocations.reduce((s, a) => s + a.weight, 0)
  const remaining   = 100 - totalWeight

  const filteredPools = POOLS.filter(p =>
    (filterType === 'all' || p.type === filterType) &&
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  const isOwner = nftOwner && address && nftOwner.toLowerCase() === address.toLowerCase()

  function addPool(pool: typeof POOLS[number]) {
    if (allocations.length >= 6) return
    if (allocations.find(a => a.poolAddress === pool.address)) return
    const share = Math.floor(remaining / (6 - allocations.length + 1))
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
                {tokenId && (
                  <div className="space-y-1.5 p-3 bg-bg-raised rounded-xl">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Owner</span>
                      <span className={clsx('font-mono', isOwner ? 'text-emerald-400' : 'text-red-400')}>
                        {nftOwner ? (isOwner ? 'You ✓' : 'Not yours') : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Voting Power</span>
                      <span className="font-mono text-aeon-400">
                        {votingPower !== undefined ? parseFloat(formatUnits(votingPower, 18)).toFixed(4) : '—'} veAEON
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Has Voted</span>
                      <span className={clsx('font-mono', hasVoted ? 'text-yellow-400' : 'text-emerald-400')}>
                        {hasVoted === undefined ? '—' : hasVoted ? 'Yes (reset first)' : 'No'}
                      </span>
                    </div>
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
            <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
              {(['all', 'vAMM', 'CL', 'DLMM'] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)} className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-all capitalize', filterType === t ? 'bg-bg-base text-text-primary' : 'text-text-muted hover:text-text-secondary')}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-bg-border">
              {['Pool', 'Type', 'TVL', 'Volume 24h', 'APR', 'vAPR', ''].map((h, i) => (
                <div key={h + i} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', i === 0 ? 'col-span-3' : i === 1 ? 'col-span-1' : i === 6 ? 'col-span-1 text-right' : 'col-span-2')}>{h}</div>
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
                    <div className="col-span-1 text-sm font-mono text-violet-400">—%</div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => isSelected ? removePool(pool.address) : addPool(pool)}
                        disabled={allocations.length >= 6 && !isSelected}
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
          <p className="text-xs text-text-muted mt-3 text-center font-mono">{filteredPools.length} pools · Max 6 pools per vote</p>
        </div>
      </div>
    </div>
  )
}

function EpochInfo() {
  const EPOCH_LENGTH = 7 * 24 * 60 * 60 * 1000
  const now        = Date.now()
  const epochNum   = Math.floor(now / EPOCH_LENGTH)
  const epochStart = epochNum * EPOCH_LENGTH
  const remaining  = epochStart + EPOCH_LENGTH - now
  const days       = Math.floor(remaining / (24 * 60 * 60 * 1000))
  const hours      = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))

  const { data: totalWeight } = useReadContract({
    address: CONTRACTS.AeonVoter,
    abi: VOTER_ABI,
    functionName: 'totalWeight',
  })

  return (
    <div className="space-y-2">
      {[
        { label: 'Current Epoch', value: `#${epochNum}` },
        { label: 'Epoch Ends',    value: `${days}d ${hours}h` },
        { label: 'Total Votes',   value: totalWeight !== undefined ? `${parseFloat(formatUnits(totalWeight, 18)).toFixed(2)} veAEON` : '—' },
        { label: 'Next Emissions',value: '— AEON' },
      ].map(item => (
        <div key={item.label} className="flex justify-between text-sm">
          <span className="text-text-muted">{item.label}</span>
          <span className="font-mono text-text-primary">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
