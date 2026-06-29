'use client'
import { useState, useEffect } from 'react'
import { Coins, ChevronDown, ChevronUp, Loader2, Wallet } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { POOLS, CONTRACTS, TOKENS } from '@/config/contracts'
import { ERC20_ABI, GAUGE_ABI, GAUGE_FACTORY_ABI, PAIR_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

function fmtUsd(n: number | null): string {
  if (n === null) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Deduplicate by address, keeping the FIRST occurrence (vAMM before CL/DLMM)
const UNIQUE_POOLS = POOLS.filter((p, _, arr) => arr.findIndex(x => x.address === p.address) === arr.indexOf(p))

type Step = 'idle' | 'approving' | 'approve_wait' | 'staking' | 'stake_wait' | 'done' | 'unstaking' | 'unstake_wait' | 'claiming' | 'claim_wait'

function parseFeeRate(fee: string): number {
  return parseFloat(fee.replace('%', '')) / 100
}

function fmtApr(apr: number | null): string {
  if (apr === null) return '—%'
  if (apr >= 1000) return '>1000%'
  return apr.toFixed(2) + '%'
}

function usePoolPrice(pool: typeof UNIQUE_POOLS[number]) {
  const { data: reservesData } = useReadContracts({
    contracts: [
      { address: pool.address as `0x${string}`, abi: PAIR_ABI, functionName: 'getReserves' as const },
      { address: pool.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0'      as const },
    ],
    query: { refetchInterval: 15000 },
  })
  if (!reservesData || reservesData[0].status !== 'success' || reservesData[1].status !== 'success') {
    return { hasLiquidity: false, price: null, priceLabel: null }
  }
  const [r0, r1] = reservesData[0].result as [bigint, bigint, number]
  const onChainToken0 = (reservesData[1].result as string).toLowerCase()
  const hasLiquidity  = r0 > 0n && r1 > 0n

  // Identify token decimals
  const tk0 = Object.values(TOKENS).find(t => t.address.toLowerCase() === onChainToken0)
  const tk1Key = Object.entries(TOKENS).find(([, t]) => t.address.toLowerCase() !== onChainToken0 &&
    [pool.token0, pool.token1].some(k => TOKENS[k as keyof typeof TOKENS]?.address.toLowerCase() === t.address.toLowerCase()))
  const dec0 = tk0?.decimals ?? 18
  // find dec1 from pool config
  const cfgT0 = TOKENS[pool.token0 as keyof typeof TOKENS]
  const cfgT1 = TOKENS[pool.token1 as keyof typeof TOKENS]
  const isFlipped = cfgT0 && onChainToken0 !== cfgT0.address.toLowerCase()
  const dec1 = isFlipped ? (cfgT0?.decimals ?? 18) : (cfgT1?.decimals ?? 18)

  if (!hasLiquidity) return { hasLiquidity: false, price: null, priceLabel: null }

  // price = r1/r0 adjusted for decimals, expressed as token0_cfg per token1_cfg
  const adjR0 = Number(r0) / 10 ** dec0
  const adjR1 = Number(r1) / 10 ** dec1
  // price of token1-cfg in terms of token0-cfg
  const price = isFlipped ? adjR0 / adjR1 : adjR1 / adjR0
  const sym0 = cfgT0?.symbol ?? pool.token0
  const sym1 = cfgT1?.symbol ?? pool.token1
  const priceLabel = price < 0.001
    ? `1 ${sym1} = ${(1 / price).toFixed(2)} ${sym0}`
    : `1 ${sym1} = ${price < 1 ? price.toFixed(6) : price.toFixed(4)} ${sym0}`

  return { hasLiquidity, price, priceLabel }
}

function PoolRow({ pool, wallet, tvlUsd, apr }: { pool: typeof UNIQUE_POOLS[number]; wallet?: `0x${string}`; tvlUsd?: number | null; apr?: number | null }) {
  const [expanded,   setExpanded]   = useState(false)
  const [stakeAmt,   setStakeAmt]   = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [step,       setStep]       = useState<Step>('idle')
  const [errMsg,     setErrMsg]     = useState('')

  const poolPrice = usePoolPrice(pool)

  // Read gauge address from factory
  const { data: gaugeAddr } = useReadContract({
    address: CONTRACTS.AeonGaugeFactory,
    abi: GAUGE_FACTORY_ABI,
    functionName: 'gaugeForPool',
    args: [pool.address],
    query: { enabled: expanded },
  })
  const gauge = gaugeAddr && gaugeAddr !== '0x0000000000000000000000000000000000000000' ? gaugeAddr : undefined

  // LP token balance (pool address is the LP token)
  const { data: lpBalRaw, refetch: refetchLP } = useReadContract({
    address: pool.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!wallet },
  })
  const lpBal = lpBalRaw as bigint | undefined ?? 0n
  const lpFormatted = lpBal > 0n ? formatUnits(lpBal, 18).replace(/\.?0+$/, '') : '0'

  // Staked balance in gauge
  const { data: stakedRaw, refetch: refetchStaked } = useReadContract({
    address: gauge,
    abi: GAUGE_ABI,
    functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!gauge && !!wallet },
  })
  const staked = stakedRaw as bigint | undefined ?? 0n
  const stakedFormatted = staked > 0n ? formatUnits(staked, 18).replace(/\.?0+$/, '') : '0'

  // Claimable AEON
  const { data: earnedRaw, refetch: refetchEarned } = useReadContract({
    address: gauge,
    abi: GAUGE_ABI,
    functionName: 'earned',
    args: wallet ? [wallet] : undefined,
    query: { enabled: !!gauge && !!wallet, refetchInterval: 15000 },
  })
  const earned = earnedRaw as bigint | undefined ?? 0n
  const earnedFormatted = earned > 0n ? parseFloat(formatUnits(earned, 18)).toFixed(4) : '0'

  // LP allowance for gauge
  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: pool.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: wallet && gauge ? [wallet, gauge] : undefined,
    query: { enabled: !!wallet && !!gauge },
  })
  const allowance = allowanceRaw as bigint | undefined ?? 0n

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchLP(); refetchStaked(); refetchEarned(); refetchAllowance()
    if (step === 'approve_wait') { setStep('staking'); return }
    if (step === 'stake_wait')   { setStep('done'); setStakeAmt(''); return }
    if (step === 'unstake_wait') { setStep('idle'); setUnstakeAmt(''); return }
    if (step === 'claim_wait')   { setStep('idle'); return }
  }, [txSuccess])

  useEffect(() => {
    if (!writeError) return
    setErrMsg(writeError.message.slice(0, 150))
    setStep('idle')
  }, [writeError])

  // Trigger writes when step changes
  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving') {
      writeContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [gauge, maxUint256] })
      setStep('approve_wait')
    }
    if (step === 'staking') {
      const amt = parseUnits(stakeAmt || '0', 18)
      if (amt === 0n) { setStep('idle'); return }
      writeContract({ address: gauge, abi: GAUGE_ABI, functionName: 'deposit', args: [amt] })
      setStep('stake_wait')
    }
    if (step === 'unstaking') {
      const amt = parseUnits(unstakeAmt || '0', 18)
      if (amt === 0n) { setStep('idle'); return }
      writeContract({ address: gauge, abi: GAUGE_ABI, functionName: 'withdraw', args: [amt] })
      setStep('unstake_wait')
    }
    if (step === 'claiming') {
      writeContract({ address: gauge, abi: GAUGE_ABI, functionName: 'getReward', args: [wallet as `0x${string}`] })
      setStep('claim_wait')
    }
  }, [step])

  function handleStake() {
    if (!stakeAmt || !gauge) return
    const amt = parseUnits(stakeAmt, 18)
    if (allowance < amt) { setStep('approving'); return }
    setStep('staking')
  }

  function handleUnstake() {
    if (!unstakeAmt || !gauge) return
    setStep('unstaking')
  }

  const isBusy = ['approving','approve_wait','staking','stake_wait','unstaking','unstake_wait','claiming','claim_wait'].includes(step)

  function stakeLabel() {
    if (step === 'approving' || step === 'approve_wait') return 'Approving…'
    if (step === 'staking'   || step === 'stake_wait')   return 'Staking…'
    if (step === 'done') return '✓ Staked!'
    const needApprove = stakeAmt && parseUnits(stakeAmt, 18) > allowance
    return needApprove ? 'Approve & Stake' : 'Stake'
  }

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      <button
        className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-3 flex items-center gap-2">
          <div className="flex -space-x-1">
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold z-10">{pool.token0.startsWith('WBTC') ? '₿' : pool.token0[0]}</div>
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold">{pool.token1.startsWith('WBTC') ? '₿' : pool.token1[0]}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary">{pool.name}</span>
              {poolPrice.hasLiquidity
                ? <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-bold">● Active</span>
                : <span className="text-2xs px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-mono font-bold">● No Liquidity</span>
              }
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span>
              <span className="text-2xs text-text-muted">· {pool.fee}</span>
              {poolPrice.priceLabel && <span className="text-2xs text-text-muted font-mono ml-1">· {poolPrice.priceLabel}</span>}
            </div>
          </div>
        </div>
        <div className="col-span-2 hidden md:block">
          <div className="text-sm font-mono text-text-secondary">{fmtUsd(tvlUsd ?? null)}</div>
          <div className="text-2xs text-text-muted">TVL</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono font-bold text-emerald-400">{fmtApr(apr ?? null)}</div>
          <div className="text-2xs text-text-muted">Fee APR</div>
        </div>
        <div className="col-span-2 hidden sm:block">
          <div className="text-sm font-mono font-bold text-violet-400">—%</div>
          <div className="text-2xs text-text-muted">vAPR</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono text-text-secondary">{wallet ? (staked > 0n ? stakedFormatted : lpBal > 0n ? lpFormatted + ' LP' : '—') : '—'}</div>
          <div className="text-2xs text-text-muted">{staked > 0n ? 'Staked' : 'LP Balance'}</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border px-4 py-4 bg-bg-raised">
          {!wallet ? (
            <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
          ) : !gauge ? (
            <div className="p-4 text-center text-xs text-yellow-400">Gauge not deployed for this pool yet</div>
          ) : (
            {/* Pool price / range status */}
            <div className={clsx('mb-4 p-3 rounded-xl flex items-center justify-between text-xs font-mono',
              poolPrice.hasLiquidity ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-red-500/5 border border-red-500/20'
            )}>
              <span className={poolPrice.hasLiquidity ? 'text-emerald-400' : 'text-red-400'}>
                {poolPrice.hasLiquidity ? '● Pool is active — earning fees on every trade' : '● Pool has no liquidity — add funds to start earning'}
              </span>
              {poolPrice.priceLabel && <span className="text-text-muted">{poolPrice.priceLabel}</span>}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Stake / Unstake */}
              <div>
                <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Stake LP — Earn AEON Emissions</h4>
                <div className="space-y-3">
                  {/* Stake */}
                  <div className="flex items-center gap-2">
                    <input type="number" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)} placeholder="0.0" className="input-base flex-1 text-sm py-2" />
                    <button onClick={() => setStakeAmt(lpFormatted)} className="text-xs text-aeon-400 font-mono hover:underline px-1">MAX</button>
                    <button
                      disabled={!stakeAmt || parseFloat(stakeAmt) <= 0 || isBusy}
                      onClick={handleStake}
                      className="btn-primary text-sm py-2 px-4 disabled:opacity-40 flex items-center gap-1 min-w-[90px] justify-center"
                    >
                      {(step === 'approving' || step === 'approve_wait' || step === 'staking' || step === 'stake_wait') && <Loader2 size={12} className="animate-spin" />}
                      {stakeLabel()}
                    </button>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">LP Balance: <span className="font-mono text-text-primary">{lpFormatted}</span></span>
                    <span className="text-text-muted">Staked: <span className="font-mono text-text-primary">{stakedFormatted}</span></span>
                  </div>

                  {/* Unstake */}
                  {staked > 0n && (
                    <div className="flex items-center gap-2">
                      <input type="number" value={unstakeAmt} onChange={e => setUnstakeAmt(e.target.value)} placeholder="Unstake amount" className="input-base flex-1 text-sm py-2" />
                      <button onClick={() => setUnstakeAmt(stakedFormatted)} className="text-xs text-text-muted font-mono hover:underline px-1">MAX</button>
                      <button
                        disabled={!unstakeAmt || parseFloat(unstakeAmt) <= 0 || isBusy}
                        onClick={handleUnstake}
                        className="btn-ghost text-sm py-2 px-4 border border-bg-border disabled:opacity-40 flex items-center gap-1"
                      >
                        {(step === 'unstaking' || step === 'unstake_wait') && <Loader2 size={12} className="animate-spin" />}
                        Unstake
                      </button>
                    </div>
                  )}

                  {/* Claimable AEON */}
                  <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl">
                    <span className="text-sm text-text-muted">Claimable AEON</span>
                    <div className="flex items-center gap-2">
                      <span className={clsx('font-mono font-bold text-sm', earned > 0n ? 'text-aeon-400' : 'text-text-muted')}>{earnedFormatted} AEON</span>
                      <button
                        disabled={earned === 0n || isBusy}
                        onClick={() => setStep('claiming')}
                        className="text-xs btn-ghost py-1 px-2 text-aeon-400 disabled:opacity-40 flex items-center gap-1"
                      >
                        {(step === 'claiming' || step === 'claim_wait') && <Loader2 size={10} className="animate-spin" />}
                        Claim
                      </button>
                    </div>
                  </div>

                  {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
                </div>
              </div>

              {/* Fee rewards */}
              <div>
                <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Rewards — From Your veNFT Vote</h4>
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
                  <div className="text-2xs text-text-muted mt-2 text-center">Vote for this pool with your veNFT to earn fee rewards</div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-bg-border flex items-center justify-between">
            <span className="text-2xs text-text-muted font-mono">Pool: {pool.address.slice(0,10)}…{pool.address.slice(-8)}</span>
            <a href={`https://snowtrace.io/address/${pool.address}`} target="_blank" rel="noreferrer" className="text-2xs text-aeon-400 hover:underline font-mono">View on Snowtrace ↗</a>
          </div>
        </div>
      )}
    </div>
  )
}

function useEarnStats(wallet?: `0x${string}`) {
  // Batch LP balances per pool
  const { data: lpBalances } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({
      address: p.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [wallet!] as [`0x${string}`],
    })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })

  // Batch gauge addresses (index-aligned with UNIQUE_POOLS)
  const { data: gaugeAddrs } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({
      address: CONTRACTS.AeonGaugeFactory as `0x${string}`,
      abi: GAUGE_FACTORY_ABI,
      functionName: 'gaugeForPool' as const,
      args: [p.address as `0x${string}`],
    })),
    query: { refetchInterval: 60000 },
  })

  // Keep alignment: null for pools with no gauge
  const gaugeByIndex: (`0x${string}` | null)[] = (gaugeAddrs ?? []).map(r =>
    r.status === 'success' && r.result && r.result !== '0x0000000000000000000000000000000000000000'
      ? r.result as `0x${string}` : null
  )

  // Batch staked + earned using same index alignment; use zero-address for missing gauges
  const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
  const { data: stakedBalances } = useReadContracts({
    contracts: gaugeByIndex.map(g => ({
      address: g ?? ZERO,
      abi: GAUGE_ABI,
      functionName: 'balanceOf' as const,
      args: [wallet ?? ZERO],
    })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const { data: earnedAmounts } = useReadContracts({
    contracts: gaugeByIndex.map(g => ({
      address: g ?? ZERO,
      abi: GAUGE_ABI,
      functionName: 'earned' as const,
      args: [wallet ?? ZERO],
    })),
    query: { enabled: !!wallet, refetchInterval: 15000 },
  })

  // Per-pool maps (keyed by pool address lowercase)
  const lpByAddr: Record<string, bigint> = {}
  const stakedByAddr: Record<string, bigint> = {}
  const earnedByAddr: Record<string, bigint> = {}
  let totalStaked = 0n, totalLPUnstaked = 0n, totalEarned = 0n

  UNIQUE_POOLS.forEach((p, i) => {
    const addr = p.address.toLowerCase()
    const lp     = lpBalances?.[i]?.status === 'success'      ? lpBalances[i].result as bigint      : 0n
    const staked = stakedBalances?.[i]?.status === 'success'   ? stakedBalances[i].result as bigint  : 0n
    const earned = earnedAmounts?.[i]?.status === 'success'    ? earnedAmounts[i].result as bigint   : 0n
    lpByAddr[addr]     = lp
    stakedByAddr[addr] = staked
    earnedByAddr[addr] = earned
    totalLPUnstaked   += lp
    totalStaked       += staked
    totalEarned       += earned
  })

  const fmtLP   = (wei: bigint) => wei > 0n ? parseFloat(formatUnits(wei, 18)).toFixed(4) : '0'
  const fmtAEON = (wei: bigint) => wei > 0n ? parseFloat(formatUnits(wei, 18)).toFixed(4) : '0'

  return { totalStaked, totalLPUnstaked, totalEarned, lpByAddr, stakedByAddr, earnedByAddr, fmtLP, fmtAEON }
}

export default function EarnPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [filterTab, setFilterTab] = useState<'all' | 'my'>('all')

  const stats     = useEarnStats(isConnected ? address : undefined)
  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const tvlByAddr = Object.fromEntries(poolStats.map(s => [s.address, s.tvlUsd]))
  const volResult = useVolume24h(prices)

  // Fee APR per pool: vol24h × feeRate × 365 / TVL
  const aprByAddr: Record<string, number | null> = {}
  for (const pool of UNIQUE_POOLS) {
    const tvl = tvlByAddr[pool.address] ?? null
    const vol = volResult.byPool[pool.address.toLowerCase()] ?? null
    aprByAddr[pool.address] = (tvl && tvl > 0 && vol !== null)
      ? (vol * parseFeeRate(pool.fee) * 365 / tvl) * 100
      : null
  }

  const stakedDisplay  = isConnected ? `${stats.fmtLP(stats.totalStaked)} LP` : '—'
  const lpDisplay      = isConnected ? `${stats.fmtLP(stats.totalLPUnstaked)} LP` : '—'
  const earnedDisplay  = isConnected ? `${stats.fmtAEON(stats.totalEarned)} AEON` : '—'

  // "My Positions" filter: pools with any LP balance or staked LP
  const displayPools = filterTab === 'my' && isConnected
    ? UNIQUE_POOLS.filter(p => {
        const addr = p.address.toLowerCase()
        return (stats.lpByAddr[addr] ?? 0n) > 0n || (stats.stakedByAddr[addr] ?? 0n) > 0n
      })
    : UNIQUE_POOLS

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Earn</h1>
        <p className="text-text-secondary">Stake LP tokens to earn AEON emissions. Vote with veNFTs to earn trading fees.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'My Staked LP',     value: stakedDisplay,  sub: 'across all gauges' },
          { label: 'Unstaked LP',      value: lpDisplay,      sub: 'not yet earning' },
          { label: 'Claimable Emiss.', value: earnedDisplay,  sub: 'from staked LP' },
          { label: 'Claimable Fees',   value: '— AEON',       sub: 'from voted pools' },
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

      <div className="grid grid-cols-12 gap-2 px-4 mb-2">
        {[['Pool', 'col-span-3'], ['TVL', 'col-span-2 hidden md:block'], ['APR', 'col-span-2'], ['vAPR', 'col-span-2 hidden sm:block'], ['My Stake', 'col-span-2'], ['', 'col-span-1']].map(([h, cls]) => (
          <div key={h} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', cls)}>{h}</div>
        ))}
      </div>

      {filterTab === 'my' && isConnected && displayPools.length === 0 && (
        <div className="card p-8 text-center text-sm text-text-muted">No LP positions found — add liquidity first.</div>
      )}

      <div className="space-y-2">
        {displayPools.map(pool => (
          <PoolRow key={pool.address} pool={pool} wallet={isConnected ? address : undefined} tvlUsd={tvlByAddr[pool.address]} apr={aprByAddr[pool.address]} />
        ))}
      </div>
    </div>
  )
}
