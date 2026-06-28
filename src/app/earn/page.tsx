'use client'
import { useState, useEffect } from 'react'
import { Coins, ChevronDown, ChevronUp, Loader2, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS } from '@/config/contracts'
import { ERC20_ABI } from '@/config/abis'

// Deduplicate by address, keeping the FIRST occurrence (vAMM comes before CL/DLMM)
const UNIQUE_POOLS = POOLS.filter((p, _, arr) => arr.findIndex(x => x.address === p.address) === arr.indexOf(p))

function useLPBalance(poolAddress: `0x${string}`, wallet?: `0x${string}`) {
  const { data } = useReadContract({
    address: poolAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet },
  })
  if (!wallet || data === undefined) return { formatted: '—', raw: 0n }
  return {
    formatted: formatUnits(data as bigint, 18).replace(/\.?0+$/, ''),
    raw: data as bigint,
  }
}

function PoolRow({ pool, wallet }: { pool: typeof UNIQUE_POOLS[number]; wallet?: `0x${string}` }) {
  const [expanded, setExpanded]   = useState(false)
  const [stakeAmt, setStakeAmt]   = useState('')

  const lpBal = useLPBalance(pool.address, wallet)

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => { if (txSuccess) setStakeAmt('') }, [txSuccess])

  const parsedStake = stakeAmt ? parseUnits(stakeAmt, 18) : 0n
  const canStake = parsedStake > 0n && lpBal.raw >= parsedStake

  function handleMaxStake() {
    if (lpBal.raw > 0n) setStakeAmt(formatUnits(lpBal.raw, 18).replace(/\.?0+$/, ''))
  }

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      {/* Header row */}
      <button
        className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-3 flex items-center gap-2">
          <div className="flex -space-x-1">
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold z-10">{pool.token0[0]}</div>
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold">{pool.token1[0]}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">{pool.name}</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span>
              <span className="text-2xs text-text-muted">· {pool.fee}</span>
            </div>
          </div>
        </div>

        <div className="col-span-2 hidden md:block">
          <div className="text-sm font-mono text-text-secondary">$—</div>
          <div className="text-2xs text-text-muted">TVL</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono font-bold text-emerald-400">—%</div>
          <div className="text-2xs text-text-muted">APR</div>
        </div>
        <div className="col-span-2 hidden sm:block">
          <div className="text-sm font-mono font-bold text-violet-400">—%</div>
          <div className="text-2xs text-text-muted">vAPR</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono text-text-secondary">
            {wallet ? (lpBal.raw > 0n ? lpBal.formatted : '—') : '—'}
          </div>
          <div className="text-2xs text-text-muted">LP Balance</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-bg-border px-4 py-4 bg-bg-raised">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Stake LP */}
            <div>
              <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
                Stake LP — Earn AEON Emissions
              </h4>
              {!wallet ? (
                <div className="p-3 rounded-xl bg-bg-base text-xs text-text-muted text-center">Connect wallet to stake</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={stakeAmt}
                      onChange={e => setStakeAmt(e.target.value)}
                      placeholder="0.0"
                      className="input-base flex-1 text-sm py-2"
                    />
                    <button onClick={handleMaxStake} className="text-xs text-aeon-400 font-mono hover:underline px-1">MAX</button>
                    <button
                      disabled={!canStake || isPending || txWaiting}
                      onClick={() => {
                        // Gauge staking requires deployed gauge — show info for now
                        // writeContract({ address: gaugeAddress, abi: GAUGE_ABI, functionName: 'deposit', args: [parsedStake] })
                      }}
                      className="btn-primary text-sm py-2 px-4 disabled:opacity-40 flex items-center gap-1"
                    >
                      {(isPending || txWaiting) && <Loader2 size={12} className="animate-spin" />}
                      Stake
                    </button>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">LP Balance: <span className="font-mono text-text-primary">{lpBal.formatted}</span></span>
                    <span className="text-text-muted">Staked: <span className="font-mono">—</span></span>
                  </div>
                  <div className="p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-2xs text-yellow-500/70 text-center">
                    Gauge deployment coming soon — staking will be enabled
                  </div>
                  <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                    <span className="text-sm text-text-muted">Claimable AEON</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-aeon-400">— AEON</span>
                      <button disabled className="text-xs btn-ghost py-1 px-2 text-aeon-400 opacity-40">Claim</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Fee rewards */}
            <div>
              <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
                Fee Rewards — From Your veNFT Vote
              </h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                  <span className="text-sm text-text-muted">{pool.token0} fees</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-text-primary">—</span>
                    <button disabled className="text-xs btn-ghost py-1 px-2 text-emerald-400 opacity-40">Claim</button>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                  <span className="text-sm text-text-muted">{pool.token1} fees</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-text-primary">—</span>
                    <button disabled className="text-xs btn-ghost py-1 px-2 text-emerald-400 opacity-40">Claim</button>
                  </div>
                </div>
                <div className="text-2xs text-text-muted mt-2 text-center">
                  Vote for this pool with your veNFT to earn fee rewards
                </div>
              </div>
            </div>
          </div>

          {/* Pool address */}
          <div className="mt-4 pt-3 border-t border-bg-border flex items-center justify-between">
            <span className="text-2xs text-text-muted font-mono">Pool: {pool.address.slice(0,10)}…{pool.address.slice(-8)}</span>
            <a href={`https://snowtrace.io/address/${pool.address}`} target="_blank" rel="noreferrer" className="text-2xs text-aeon-400 hover:underline font-mono">View on Snowtrace ↗</a>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EarnPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [filterTab, setFilterTab] = useState<'all' | 'my'>('all')

  // "My Positions" = pools where user holds LP tokens
  const displayPools = filterTab === 'all' ? UNIQUE_POOLS : UNIQUE_POOLS // filter by LP balance needs per-pool hook — show all for now

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Earn</h1>
        <p className="text-text-secondary">Stake LP tokens to earn AEON emissions. Vote with veNFTs to earn trading fees.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'My Staked LP',     value: '$—',     sub: 'across all gauges' },
          { label: 'Claimable Fees',   value: '— AEON', sub: 'from voted pools' },
          { label: 'Claimable Emiss.', value: '— AEON', sub: 'from staked LP' },
          { label: 'My Avg APR',       value: '—%',     sub: 'weighted average' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <div className="stat-label mb-1">{s.label}</div>
            <div className="stat-value text-xl mb-0.5">{s.value}</div>
            <div className="text-2xs text-text-muted">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
          {(['all', 'my'] as const).map(t => (
            <button key={t} onClick={() => setFilterTab(t)} className={clsx('px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all', filterTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
              {t === 'all' ? 'All Pools' : 'My Positions'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {!isConnected && (
            <button onClick={() => openConnectModal?.()} className="btn-ghost text-sm py-2 px-3 flex items-center gap-1.5">
              <Wallet size={14} /> Connect Wallet
            </button>
          )}
          <button disabled className="btn-primary text-sm py-2 px-4 flex items-center gap-2 opacity-40">
            <Coins size={14} /> Claim All
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-12 gap-2 px-4 mb-2">
        {['Pool', '', 'TVL', 'APR', 'vAPR', 'LP Balance', ''].map((h, i) => (
          <div key={i} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', i === 0 ? 'col-span-3' : i === 2 ? 'col-span-2 hidden md:block' : i === 3 ? 'col-span-2' : i === 4 ? 'col-span-2 hidden sm:block' : i === 5 ? 'col-span-2' : i === 6 ? 'col-span-1' : 'hidden')}>
            {h}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {displayPools.map(pool => (
          <PoolRow key={pool.address} pool={pool} wallet={isConnected ? address : undefined} />
        ))}
      </div>
    </div>
  )
}
