'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Coins, ChevronDown, ChevronUp, Loader2, Wallet, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, CL_GAUGES, DLMM_GAUGES, ALGEBRA_CONTRACTS, CONTRACTS, TOKENS, NATIVE_SENTINEL } from '@/config/contracts'
import { ERC20_ABI, GAUGE_ABI, PAIR_ABI, LIQUIDITY_HELPER_V2_ABI, VOTER_ABI, ALGEBRA_POOL_ABI, LB_PAIR_ABI, CL_GAUGE_ABI, DLMM_GAUGE_ABI, ERC721_APPROVE_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { useClPositions, type ClPosition } from '@/hooks/useClPositions'
import { useDlmmPositions } from '@/hooks/useDlmmPositions'
import { TokenIcon } from '@/components/TokenIcon'
import { tickToPrice, amountsForLiquidity } from '@/lib/clMath'
import { binIdToPrice } from '@/lib/dlmmMath'

type PriceMap = Record<string, number | null>

// Same slippage tolerance as the Liquidity page's LiquidityHelperV2 calls —
// bounds what this panel's price-oracle-derived amounts are allowed to
// diverge from the pool's real reserve ratio before the mint reverts
// instead of silently accepting a lopsided deposit.
const LIQ_SLIPPAGE_BPS = 50n // 0.5%
const withLiqSlippage = (wei: bigint) => wei * (10000n - LIQ_SLIPPAGE_BPS) / 10000n
const liqDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200)

function fmtUsd(n: number | null): string {
  if (n === null || n <= 0) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Formats a single price POINT (one end of a range) — unlike fmtUsd, never
// collapses a real sub-cent price down to "$0.00".
function fmtPricePoint(n: number | null): string {
  if (n === null || !isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000_000 || n < 1e-9) return '$' + n.toExponential(2)
  if (n >= 1) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}
function symbolFor(addr: string): string {
  const key = Object.entries(TOKENS).find(([, t]) => t.address.toLowerCase() === addr.toLowerCase())?.[0] ?? '?'
  return dispSym(key)
}

// Display-only: WETH's real display symbol stays 'WETH' in TOKENS (needed
// so the Swap page's native ETH and wrapped WETH stay distinguishable as
// two separate selectable tokens there) -- but on the Earn page's CL/DLMM
// panels there's no such ambiguity (WETH is always just "the ETH side" of
// a pair), so show the more familiar "ETH" label here instead.
function dispSym(sym: string): string {
  return sym === 'WETH' ? 'ETH' : sym
}

const UNIQUE_POOLS = POOLS

type Step = 'idle' | 'approving' | 'approve_wait' | 'staking' | 'stake_wait' | 'done' | 'unstaking' | 'unstake_wait' | 'claiming' | 'claim_wait'
type LiqStep = 'idle' | 'app0' | 'app0_wait' | 'app1' | 'app1_wait' | 'adding' | 'adding_wait'

function parseFeeRate(fee: string): number { return parseFloat(fee.replace('%', '')) / 100 }
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
  if (!reservesData || reservesData[0].status !== 'success' || reservesData[1].status !== 'success')
    return { hasLiquidity: false, price: null, priceLabel: null }
  const [r0, r1]      = reservesData[0].result as [bigint, bigint, number]
  const onChainToken0 = (reservesData[1].result as string).toLowerCase()
  const hasLiquidity  = r0 > 0n && r1 > 0n
  const cfgT0 = TOKENS[pool.token0 as keyof typeof TOKENS]
  const cfgT1 = TOKENS[pool.token1 as keyof typeof TOKENS]
  const isFlipped = cfgT0 && onChainToken0 !== cfgT0.address.toLowerCase()
  const dec0 = (isFlipped ? cfgT1 : cfgT0)?.decimals ?? 18
  const dec1 = (isFlipped ? cfgT0 : cfgT1)?.decimals ?? 18
  if (!hasLiquidity) return { hasLiquidity: false, price: null, priceLabel: null }
  const adjR0 = Number(r0) / 10 ** dec0
  const adjR1 = Number(r1) / 10 ** dec1
  const price = isFlipped ? adjR0 / adjR1 : adjR1 / adjR0
  const sym0  = dispSym(cfgT0?.symbol ?? pool.token0)
  const sym1  = dispSym(cfgT1?.symbol ?? pool.token1)
  const priceLabel = price < 0.001
    ? `1 ${sym1} = ${(1 / price).toFixed(2)} ${sym0}`
    : `1 ${sym1} = ${price < 1 ? price.toFixed(6) : price.toFixed(4)} ${sym0}`
  return { hasLiquidity, price, priceLabel }
}

function LiquidityPanel({ pool, wallet, prices, tvlUsd, onDone }: {
  pool: typeof UNIQUE_POOLS[number]
  wallet: `0x${string}`
  prices: PriceMap
  tvlUsd?: number | null
  onDone?: () => void
}) {
  const [amt0,      setAmt0]      = useState('')
  const [amt1,      setAmt1]      = useState('')
  const [liqStep,   setLiqStep]   = useState<LiqStep>('idle')
  const [liqErr,    setLiqErr]    = useState('')

  const t0 = TOKENS[pool.token0 as keyof typeof TOKENS]
  const t1 = TOKENS[pool.token1 as keyof typeof TOKENS]

  // Pools sort token0/token1 by address on-chain, which doesn't always match
  // this config's declared order ("AEON/ETH" doesn't guarantee AEON is
  // token0) — LiquidityHelperRH.addLiquidity() reverts TokenMismatch() unless
  // the args exactly match the pool's own token0()/token1().
  const { data: poolToken0Addr } = useReadContract({
    address: pool.address as `0x${string}`, abi: PAIR_ABI, functionName: 'token0',
  })
  const isToken0First = !poolToken0Addr || !t0 || (poolToken0Addr as string).toLowerCase() === t0.address.toLowerCase()

  const { data: bal0Raw,    refetch: refBal0   } = useReadContract({ address: t0?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { enabled: !!t0, refetchInterval: 15000 } })
  const { data: bal1Raw,    refetch: refBal1   } = useReadContract({ address: t1?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { enabled: !!t1, refetchInterval: 15000 } })
  const { data: lpBalRaw,   refetch: refLpBal  } = useReadContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { refetchInterval: 15000 } })
  const { data: allow0Raw,  refetch: refAllow0 } = useReadContract({ address: t0?.address, abi: ERC20_ABI, functionName: 'allowance', args: [wallet, CONTRACTS.LiquidityHelperV2], query: { enabled: !!t0 } })
  const { data: allow1Raw,  refetch: refAllow1 } = useReadContract({ address: t1?.address, abi: ERC20_ABI, functionName: 'allowance', args: [wallet, CONTRACTS.LiquidityHelperV2], query: { enabled: !!t1 } })

  const bal0    = (bal0Raw    as bigint | undefined) ?? 0n
  const bal1    = (bal1Raw    as bigint | undefined) ?? 0n
  const lpBal   = (lpBalRaw  as bigint | undefined) ?? 0n
  const allow0  = (allow0Raw as bigint | undefined) ?? 0n
  const allow1  = (allow1Raw as bigint | undefined) ?? 0n

  const bal0Fmt = t0 ? parseFloat(formatUnits(bal0, t0.decimals)).toFixed(6) : '0'
  const bal1Fmt = t1 ? parseFloat(formatUnits(bal1, t1.decimals)).toFixed(6) : '0'
  const lpFmt   = parseFloat(formatUnits(lpBal, 18)).toFixed(8)

  const { writeContract: liqWrite, data: liqHash, error: liqWriteErr } = useWriteContract()
  const { isSuccess: liqSuccess } = useWaitForTransactionReceipt({ hash: liqHash })

  useEffect(() => {
    if (!liqSuccess) return
    refBal0(); refBal1(); refLpBal(); refAllow0(); refAllow1(); onDone?.()
    if (liqStep === 'app0_wait')     { setLiqStep('app1');   return }
    if (liqStep === 'app1_wait')     { setLiqStep('adding'); return }
    if (liqStep === 'adding_wait')   { setLiqStep('idle');   setAmt0(''); setAmt1(''); return }
  }, [liqSuccess])

  useEffect(() => {
    if (!liqWriteErr) return
    setLiqErr(liqWriteErr.message.slice(0, 180))
    setLiqStep('idle')
  }, [liqWriteErr])

  useEffect(() => {
    if (!t0 || !t1) return
    setLiqErr('')
    if (liqStep === 'app0')    { liqWrite({ address: t0.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.LiquidityHelperV2, parseUnits(amt0 || '0', t0.decimals)] }); setLiqStep('app0_wait') }
    if (liqStep === 'app1')    { liqWrite({ address: t1.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.LiquidityHelperV2, parseUnits(amt1 || '0', t1.decimals)] }); setLiqStep('app1_wait') }
    if (liqStep === 'adding')  {
      const a0 = parseUnits(amt0 || '0', t0.decimals)
      const a1 = parseUnits(amt1 || '0', t1.decimals)
      const [addr0, amt0Wei, addr1, amt1Wei] = isToken0First
        ? [t0.address, a0, t1.address, a1]
        : [t1.address, a1, t0.address, a0]
      liqWrite({
        address: CONTRACTS.LiquidityHelperV2, abi: LIQUIDITY_HELPER_V2_ABI, functionName: 'addLiquidity',
        args: [pool.address as `0x${string}`, addr0, amt0Wei, amt1Wei, withLiqSlippage(amt0Wei), withLiqSlippage(amt1Wei), addr1, wallet, liqDeadline()],
      })
      setLiqStep('adding_wait')
    }
  }, [liqStep])

  function autoFill0(v: string) {
    setAmt0(v)
    const p0 = prices[pool.token0] ?? null
    const p1 = prices[pool.token1] ?? null
    if (p0 && p1 && v && parseFloat(v) > 0) setAmt1(((parseFloat(v) * p0) / p1).toFixed(8))
  }
  function autoFill1(v: string) {
    setAmt1(v)
    const p0 = prices[pool.token0] ?? null
    const p1 = prices[pool.token1] ?? null
    if (p0 && p1 && v && parseFloat(v) > 0) setAmt0(((parseFloat(v) * p1) / p0).toFixed(8))
  }

  function handleAdd() {
    if (!amt0 || !amt1 || !t0 || !t1 || parseFloat(amt0) <= 0 || parseFloat(amt1) <= 0) return
    if (allow0 < parseUnits(amt0, t0.decimals)) { setLiqStep('app0'); return }
    if (allow1 < parseUnits(amt1, t1.decimals)) { setLiqStep('app1'); return }
    setLiqStep('adding')
  }

  const addBusy = ['app0', 'app0_wait', 'app1', 'app1_wait', 'adding', 'adding_wait'].includes(liqStep)

  function addLabel() {
    if (liqStep === 'app0' || liqStep === 'app0_wait') return `Approving ${t0?.symbol}…`
    if (liqStep === 'app1' || liqStep === 'app1_wait') return `Approving ${t1?.symbol}…`
    if (liqStep === 'adding' || liqStep === 'adding_wait') return 'Adding…'
    const na0 = amt0 && t0 && parseFloat(amt0) > 0 && parseUnits(amt0, t0.decimals) > allow0
    const na1 = amt1 && t1 && parseFloat(amt1) > 0 && parseUnits(amt1, t1.decimals) > allow1
    if (na0 || na1) return 'Approve & Add'
    return 'Add Liquidity'
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex justify-between text-2xs text-text-muted mb-1">
          <span>{dispSym(t0?.symbol ?? pool.token0)}</span>
          <button onClick={() => autoFill0(bal0Fmt)} className="text-aeon-400 font-mono hover:underline">MAX {bal0Fmt}</button>
        </div>
        <input type="number" value={amt0} onChange={e => autoFill0(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2" />
      </div>
      <div>
        <div className="flex justify-between text-2xs text-text-muted mb-1">
          <span>{dispSym(t1?.symbol ?? pool.token1)}</span>
          <button onClick={() => autoFill1(bal1Fmt)} className="text-aeon-400 font-mono hover:underline">MAX {bal1Fmt}</button>
        </div>
        <input type="number" value={amt1} onChange={e => autoFill1(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2" />
      </div>
      {!prices[pool.token0] && !prices[pool.token1] && (
        <div className="text-2xs text-yellow-400 font-mono px-1">No price feed yet — enter both amounts manually to set the initial ratio</div>
      )}
      <button
        disabled={!amt0 || !amt1 || parseFloat(amt0 || '0') <= 0 || parseFloat(amt1 || '0') <= 0 || addBusy}
        onClick={handleAdd}
        className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
      >
        {addBusy && <Loader2 size={12} className="animate-spin" />}
        {addLabel()}
      </button>
      {liqErr && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{liqErr}</div>}
      {lpBal > 0n && <div className="text-2xs text-text-muted text-center">Your LP: {lpFmt} · use the <a href="/liquidity" className="text-aeon-400 hover:underline">Liquidity</a> page to remove</div>}
    </div>
  )
}

function PoolRow({ pool, wallet, tvlUsd, apr, prices }: {
  pool: typeof UNIQUE_POOLS[number]
  wallet?: `0x${string}`
  tvlUsd?: number | null
  apr?: number | null
  prices: PriceMap
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [innerTab,   setInnerTab]   = useState<'earn' | 'liquidity'>('earn')
  const [stakeAmt,   setStakeAmt]   = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [step,       setStep]       = useState<Step>('idle')
  const [errMsg,     setErrMsg]     = useState('')

  const poolPrice = usePoolPrice(pool)

  // No refetchInterval before meant a pool with no gauge yet at first expand
  // stayed "Gauge not yet deployed" forever for that session, even after a
  // gauge was created moments later elsewhere -- happened for real with
  // CASHCAT/ROBINFUN and SLEEP/AEON, both gauge'd after the page was already
  // loaded. Refetching periodically means a newly created gauge shows up
  // without the user needing a hard refresh.
  const { data: gaugeAddr } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'gauges',
    args: [pool.address], query: { enabled: expanded, refetchInterval: 20000 },
  })
  const gauge = gaugeAddr && gaugeAddr !== '0x0000000000000000000000000000000000000000' ? gaugeAddr : undefined

  const { data: lpBalRaw, refetch: refetchLP } = useReadContract({
    address: pool.address, abi: ERC20_ABI, functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet },
  })
  const lpBal = (lpBalRaw as bigint | undefined) ?? 0n
  const lpFormatted = lpBal > 0n ? formatUnits(lpBal, 18).replace(/\.?0+$/, '') : '0'

  const { data: stakedRaw, refetch: refetchStaked } = useReadContract({
    address: gauge, abi: GAUGE_ABI, functionName: 'balanceOf',
    args: wallet ? [wallet] : undefined, query: { enabled: !!gauge && !!wallet },
  })
  const staked = (stakedRaw as bigint | undefined) ?? 0n
  const stakedFormatted = staked > 0n ? formatUnits(staked, 18).replace(/\.?0+$/, '') : '0'

  const { data: earnedRaw, refetch: refetchEarned } = useReadContract({
    address: gauge, abi: GAUGE_ABI, functionName: 'earned',
    args: wallet ? [wallet] : undefined, query: { enabled: !!gauge && !!wallet, refetchInterval: 15000 },
  })
  const earned = (earnedRaw as bigint | undefined) ?? 0n
  const earnedFormatted = earned > 0n ? parseFloat(formatUnits(earned, 18)).toFixed(4) : '0'

  const { data: allowanceRaw, refetch: refetchAllowance } = useReadContract({
    address: pool.address, abi: ERC20_ABI, functionName: 'allowance',
    args: wallet && gauge ? [wallet, gauge] : undefined, query: { enabled: !!wallet && !!gauge },
  })
  const allowance = (allowanceRaw as bigint | undefined) ?? 0n

  const { data: rewardRateRaw } = useReadContract({
    address: gauge, abi: GAUGE_ABI, functionName: 'rewardRate',
    query: { enabled: !!gauge, refetchInterval: 60000 },
  })
  const { data: periodFinishRaw } = useReadContract({
    address: gauge, abi: GAUGE_ABI, functionName: 'periodFinish',
    query: { enabled: !!gauge },
  })
  const rewardRate = (rewardRateRaw as bigint | undefined) ?? 0n
  const periodFinish = (periodFinishRaw as bigint | undefined) ?? 0n
  const isEmitting = periodFinish > BigInt(Math.floor(Date.now() / 1000))
  const aeonPrice = prices['AEON'] ?? null
  const { data: totalLpSupplyRaw } = useReadContract({ address: pool.address, abi: ERC20_ABI, functionName: 'totalSupply' })
  const { data: gaugeLpBalanceRaw } = useReadContract({
    address: pool.address, abi: ERC20_ABI, functionName: 'balanceOf', args: gauge ? [gauge] : undefined,
    query: { enabled: !!gauge, refetchInterval: 60_000 },
  })
  const totalLpSupply = (totalLpSupplyRaw as bigint | undefined) ?? 0n
  const gaugeLpBalance = (gaugeLpBalanceRaw as bigint | undefined) ?? 0n
  const stakedTvlUsd = tvlUsd && totalLpSupply > 0n ? tvlUsd * Number(gaugeLpBalance) / Number(totalLpSupply) : 0
  const vApr = isEmitting && rewardRate > 0n && aeonPrice !== null && stakedTvlUsd > 0
    ? (Number(formatUnits(rewardRate, 18)) * 365 * 24 * 3600 * aeonPrice) / stakedTvlUsd * 100
    : null

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchLP(); refetchStaked(); refetchEarned(); refetchAllowance()
    if (step === 'approve_wait')    { setStep('staking');  return }
    if (step === 'stake_wait')      { setStep('done');     setStakeAmt('');   return }
    if (step === 'unstake_wait')    { setStep('idle');     setUnstakeAmt(''); return }
    if (step === 'claim_wait')      { setStep('idle');     return }
  }, [txSuccess])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving') {
      writeContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [gauge, parseUnits(stakeAmt || '0', 18)] })
      setStep('approve_wait')
    }
    if (step === 'staking') {
      const amt = parseUnits(stakeAmt || '0', 18)
      if (!amt) { setStep('idle'); return }
      writeContract({ address: gauge, abi: GAUGE_ABI, functionName: 'deposit', args: [amt] })
      setStep('stake_wait')
    }
    if (step === 'unstaking') {
      const amt = parseUnits(unstakeAmt || '0', 18)
      if (!amt) { setStep('idle'); return }
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
    if (allowance < parseUnits(stakeAmt, 18)) { setStep('approving'); return }
    setStep('staking')
  }

  const isBusy = ['approving', 'approve_wait', 'staking', 'stake_wait', 'unstaking', 'unstake_wait', 'claiming', 'claim_wait'].includes(step)

  function stakeLabel() {
    if (step === 'approving' || step === 'approve_wait') return 'Approving…'
    if (step === 'staking'   || step === 'stake_wait')   return 'Staking…'
    if (step === 'done') return '✓ Staked!'
    return stakeAmt && parseUnits(stakeAmt, 18) > allowance ? 'Approve & Stake' : 'Stake'
  }

  const myPosition = wallet
    ? (staked > 0n ? `${parseFloat(stakedFormatted).toFixed(4)} LP staked` : lpBal > 0n ? `${parseFloat(lpFormatted).toFixed(4)} LP` : null)
    : null

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      <button
        className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="col-span-3 flex items-center gap-2">
          <div className="flex -space-x-1">
            <TokenIcon symbol={pool.token0} size={28} />
            <TokenIcon symbol={pool.token1} size={28} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary">{pool.name}</span>
              {poolPrice.hasLiquidity
                ? <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-bold">● Active</span>
                : <span className="text-2xs px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-mono font-bold">● Empty</span>}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-2xs font-mono font-bold text-blue-400">{pool.type}</span>
              <span className="text-2xs text-text-muted">· {pool.fee}</span>
              {poolPrice.priceLabel && <span className="text-2xs text-text-muted font-mono ml-1 hidden xl:inline">· {poolPrice.priceLabel}</span>}
            </div>
          </div>
        </div>
        <div className="col-span-2 hidden md:block">
          <div className="text-sm font-mono text-text-secondary">{fmtUsd(tvlUsd ?? null)}</div>
          <div className="text-2xs text-text-muted">TVL</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono font-bold text-emerald-400">{fmtApr(apr ?? null)}</div>
          <div className="text-2xs text-text-muted" title="Trailing 7-day gross swap fees annualized over total pool TVL. Fees are organic trading yield; gauge rewards are separate.">7d gross fee APR</div>
        </div>
        <div className="col-span-2 hidden sm:block">
          <div className="text-sm font-mono font-bold text-violet-400">{fmtApr(vApr)}</div>
          <div className="text-2xs text-text-muted" title="Current AEON reward rate annualized over gauge-staked TVL only.">Gauge vAPR</div>
        </div>
        <div className="col-span-2">
          <div className="text-sm font-mono text-text-secondary">{myPosition ?? '—'}</div>
          <div className="text-2xs text-text-muted">{staked > 0n ? 'Staked' : 'LP Balance'}</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border bg-bg-raised">
          <div className="flex gap-1 px-4 pt-3">
            {(['earn', 'liquidity'] as const).map(t => (
              <button key={t} onClick={() => setInnerTab(t)} className={clsx('flex items-center gap-1.5 px-4 py-1.5 rounded-t-lg text-xs font-medium border border-b-0 transition-all', innerTab === t ? 'bg-bg-base border-bg-border text-text-primary' : 'border-transparent text-text-muted')}>
                <Coins size={11} /> {t === 'earn' ? 'Earn' : 'Add Liquidity'}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4 pt-0 bg-bg-base">
            <div className={clsx('my-4 p-3 rounded-xl flex items-center justify-between text-xs font-mono',
              poolPrice.hasLiquidity ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-red-500/5 border border-red-500/20'
            )}>
              <span className={poolPrice.hasLiquidity ? 'text-emerald-400' : 'text-red-400'}>
                {poolPrice.hasLiquidity ? '● Pool active — earning fees on every trade' : '● Pool empty — add liquidity to start earning'}
              </span>
              {poolPrice.priceLabel && <span className="text-text-muted hidden sm:inline">{poolPrice.priceLabel}</span>}
            </div>

            {innerTab === 'liquidity' ? (
              !wallet
                ? <div className="p-4 text-center text-sm text-text-muted">Connect wallet to add liquidity</div>
                : <LiquidityPanel pool={pool} wallet={wallet} prices={prices} tvlUsd={tvlUsd} onDone={refetchLP} />
            ) : !wallet
              ? <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
              : !gauge
                ? <div className="p-4 text-center text-xs text-yellow-400">Gauge not yet deployed for this pool</div>
                : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <input type="number" value={stakeAmt} onChange={e => setStakeAmt(e.target.value)} placeholder="0.0" className="input-base flex-1 text-sm py-2" />
                        <button onClick={() => setStakeAmt(lpFormatted)} className="text-xs text-aeon-400 font-mono hover:underline px-1">MAX</button>
                        <button
                          disabled={!stakeAmt || parseFloat(stakeAmt) <= 0 || isBusy}
                          onClick={handleStake}
                          className="btn-primary text-sm py-2 px-4 disabled:opacity-40 flex items-center gap-1 min-w-[110px] justify-center"
                        >
                          {(step === 'approving' || step === 'approve_wait' || step === 'staking' || step === 'stake_wait') && <Loader2 size={12} className="animate-spin" />}
                          {stakeLabel()}
                        </button>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted">LP Balance: <span className="font-mono text-text-primary">{lpFormatted}</span></span>
                        <span className="text-text-muted">Staked: <span className="font-mono text-text-primary">{stakedFormatted}</span></span>
                      </div>
                      {staked > 0n && (
                        <div className="flex items-center gap-2">
                          <input type="number" value={unstakeAmt} onChange={e => setUnstakeAmt(e.target.value)} placeholder="Unstake amount" className="input-base flex-1 text-sm py-2" />
                          <button onClick={() => setUnstakeAmt(stakedFormatted)} className="text-xs text-text-muted font-mono hover:underline px-1">MAX</button>
                          <button
                            disabled={!unstakeAmt || parseFloat(unstakeAmt) <= 0 || isBusy}
                            onClick={() => setStep('unstaking')}
                            className="btn-ghost text-sm py-2 px-4 border border-bg-border disabled:opacity-40 flex items-center gap-1"
                          >
                            {(step === 'unstaking' || step === 'unstake_wait') && <Loader2 size={12} className="animate-spin" />}
                            Unstake
                          </button>
                        </div>
                      )}
                      <div className="flex items-center justify-between p-3 bg-bg-raised rounded-xl">
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
                  )
            }

            <div className="mt-4 pt-3 border-t border-bg-border flex items-center justify-between">
              <span className="text-2xs text-text-muted font-mono">{pool.address.slice(0, 10)}…{pool.address.slice(-8)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// CL and DLMM staking — parallel gauges (see CL_GAUGES/DLMM_GAUGES in
// config/contracts.ts for why these aren't the same official-emissions
// gauges vAMM pools use). Same expandable-row shape as PoolRow, but staking
// works on discrete positions (an NFT, or a set of bins) instead of a plain
// amount of a fungible LP token.
// ─────────────────────────────────────────────────────────────────────────

type GaugeStep = 'idle' | 'approving' | 'approve_wait' | 'staking' | 'stake_wait' | 'unstaking' | 'unstake_wait' | 'claiming' | 'claim_wait'

function ClGaugeRow({ pool, wallet }: { pool: typeof CL_POOLS[number]; wallet?: `0x${string}` }) {
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<GaugeStep>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [activeTokenId, setActiveTokenId] = useState<bigint | null>(null)

  const gauge = CL_GAUGES[pool.address]
  const t0Addr = TOKENS[pool.token0 as keyof typeof TOKENS].address.toLowerCase()
  const t1Addr = TOKENS[pool.token1 as keyof typeof TOKENS].address.toLowerCase()

  const { positions: myPositions, refetch: refetchPositions } = useClPositions(wallet)
  const poolPositions = myPositions.filter(p => {
    const pt0 = p.token0.toLowerCase(), pt1 = p.token1.toLowerCase()
    return (pt0 === t0Addr && pt1 === t1Addr) || (pt0 === t1Addr && pt1 === t0Addr)
  })

  const { data: stakedIdsRaw, refetch: refetchStakedIds } = useReadContract({
    address: gauge, abi: CL_GAUGE_ABI, functionName: 'getStakedTokenIds',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet && expanded },
  })
  const stakedIds = (stakedIdsRaw as readonly bigint[] | undefined) ?? []

  const { data: stakedLiqRaw } = useReadContracts({
    contracts: stakedIds.map(id => ({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'stakedLiquidity' as const, args: [id] as const })),
    query: { enabled: stakedIds.length > 0 },
  })
  const stakedPositions = stakedIds.map((id, i) => ({
    id,
    liquidity: stakedLiqRaw?.[i]?.status === 'success' ? stakedLiqRaw[i].result as bigint : 0n,
  }))

  const { data: earnedRaw, refetch: refetchEarned } = useReadContract({
    address: gauge, abi: CL_GAUGE_ABI, functionName: 'earned',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet, refetchInterval: 15000 },
  })
  const earned = (earnedRaw as bigint | undefined) ?? 0n
  const earnedFormatted = earned > 0n ? parseFloat(formatUnits(earned, 18)).toFixed(4) : '0'

  // Not gated behind `expanded` -- "Reward status" (Emitting / No active
  // rewards) shows in the COLLAPSED row summary, so gating this behind
  // expansion made it default to a wrong "No active rewards" for every
  // gauge until the user happened to click it open, even when real
  // rewards were live. Cheap single-value reads, fine to always fetch.
  const { data: rewardRateRaw } = useReadContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'rewardRate', query: { refetchInterval: 60000 } })
  const { data: periodFinishRaw } = useReadContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'periodFinish' })
  const rewardRate = (rewardRateRaw as bigint | undefined) ?? 0n
  const periodFinish = (periodFinishRaw as bigint | undefined) ?? 0n
  const isEmitting = periodFinish > BigInt(Math.floor(Date.now() / 1000))

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchPositions(); refetchStakedIds(); refetchEarned()
    if (step === 'approve_wait') { setStep('staking'); return }
    if (['stake_wait', 'unstake_wait', 'claim_wait'].includes(step)) { setStep('idle'); setActiveTokenId(null); return }
  }, [txSuccess])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving' && activeTokenId !== null) {
      writeContract({ address: ALGEBRA_CONTRACTS.nonfungiblePositionManager, abi: ERC721_APPROVE_ABI, functionName: 'approve', args: [gauge, activeTokenId] })
      setStep('approve_wait')
    }
    if (step === 'staking' && activeTokenId !== null) {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'stake', args: [activeTokenId] })
      setStep('stake_wait')
    }
    if (step === 'unstaking' && activeTokenId !== null) {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'withdraw', args: [activeTokenId] })
      setStep('unstake_wait')
    }
    if (step === 'claiming') {
      writeContract({ address: gauge, abi: CL_GAUGE_ABI, functionName: 'getReward', args: [] })
      setStep('claim_wait')
    }
  }, [step])

  const isBusy = step !== 'idle'

  function handleStake(tokenId: bigint) { setActiveTokenId(tokenId); setStep('approving') }
  function handleUnstake(tokenId: bigint) { setActiveTokenId(tokenId); setStep('unstaking') }

  if (!gauge) return null

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      <button className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left" onClick={() => setExpanded(!expanded)}>
        <div className="col-span-4 flex items-center gap-2">
          <div className="flex -space-x-1">
            <TokenIcon symbol={pool.token0} size={28} />
            <TokenIcon symbol={pool.token1} size={28} />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary">{pool.name}</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-2xs font-mono font-bold text-violet-400">CL</span>
              <span className="text-2xs text-text-muted">· {pool.fee}</span>
            </div>
          </div>
        </div>
        <div className="col-span-3">
          <div className="text-sm font-mono text-text-secondary">{poolPositions.length} unstaked · {stakedIds.length} staked</div>
          <div className="text-2xs text-text-muted">Your positions</div>
        </div>
        <div className="col-span-3">
          <div className={clsx('text-sm font-mono', isEmitting ? 'text-aeon-400 font-bold' : 'text-text-muted')}>{isEmitting ? 'Emitting' : 'No active rewards'}</div>
          <div className="text-2xs text-text-muted">Reward status</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border bg-bg-raised px-4 py-4 space-y-3">
          {!wallet ? (
            <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
          ) : (
            <>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider">Unstaked positions</div>
              {poolPositions.length === 0 && <div className="text-xs text-text-muted">None — add liquidity on the <Link href="/liquidity" className="text-aeon-400 hover:underline">Liquidity page</Link> first.</div>}
              {poolPositions.map(p => (
                <div key={p.tokenId.toString()} className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                  <span className="text-xs font-mono text-text-secondary">#{p.tokenId.toString()} · liquidity {p.liquidity.toString()}</span>
                  <button
                    disabled={isBusy && activeTokenId === p.tokenId}
                    onClick={() => handleStake(p.tokenId)}
                    className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1"
                  >
                    {isBusy && activeTokenId === p.tokenId && <Loader2 size={11} className="animate-spin" />}
                    {isBusy && activeTokenId === p.tokenId ? (step === 'approving' || step === 'approve_wait' ? 'Approving…' : 'Staking…') : 'Stake'}
                  </button>
                </div>
              ))}

              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider pt-2">Staked positions</div>
              {stakedPositions.length === 0 && <div className="text-xs text-text-muted">None yet.</div>}
              {stakedPositions.map(p => (
                <div key={p.id.toString()} className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                  <span className="text-xs font-mono text-text-secondary">#{p.id.toString()} · liquidity {p.liquidity.toString()}</span>
                  <button
                    disabled={isBusy && activeTokenId === p.id}
                    onClick={() => handleUnstake(p.id)}
                    className="btn-ghost text-xs py-1.5 px-3 border border-bg-border disabled:opacity-40 flex items-center gap-1"
                  >
                    {isBusy && activeTokenId === p.id && <Loader2 size={11} className="animate-spin" />}
                    Unstake
                  </button>
                </div>
              ))}

              <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl mt-2">
                <span className="text-sm text-text-muted">Claimable AEON</span>
                <div className="flex items-center gap-2">
                  <span className={clsx('font-mono font-bold text-sm', earned > 0n ? 'text-aeon-400' : 'text-text-muted')}>{earnedFormatted} AEON</span>
                  <button disabled={earned === 0n || isBusy} onClick={() => setStep('claiming')} className="text-xs btn-ghost py-1 px-2 text-aeon-400 disabled:opacity-40 flex items-center gap-1">
                    {(step === 'claiming' || step === 'claim_wait') && <Loader2 size={10} className="animate-spin" />}
                    Claim
                  </button>
                </div>
              </div>

              {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DlmmGaugeRow({ pool, wallet }: { pool: typeof DLMM_POOLS[number]; wallet?: `0x${string}` }) {
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<GaugeStep>('idle')
  const [errMsg, setErrMsg] = useState('')

  const gauge = DLMM_GAUGES[pool.address]

  const { data: activeIdRaw } = useReadContract({
    address: pool.address, abi: LB_PAIR_ABI, functionName: 'getActiveId', query: { enabled: expanded, refetchInterval: 20000 },
  })
  const activeId = activeIdRaw !== undefined ? Number(activeIdRaw) : undefined
  const { positions: myPositions, refetch: refetchPositions } = useDlmmPositions(pool, wallet, activeId)

  const { data: isApprovedRaw, refetch: refetchApproval } = useReadContract({
    address: pool.address, abi: LB_PAIR_ABI, functionName: 'isApprovedForAll',
    args: wallet && gauge ? [wallet, gauge] : undefined, query: { enabled: !!wallet && !!gauge && expanded },
  })
  const isApproved = !!isApprovedRaw

  const { data: stakedIdsRaw, refetch: refetchStakedIds } = useReadContract({
    address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'getStakedBinIds',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet && expanded },
  })
  const stakedIdsAll = (stakedIdsRaw as readonly bigint[] | undefined) ?? []

  const { data: stakedAmountsRaw } = useReadContracts({
    contracts: stakedIdsAll.map(id => ({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'stakedBins' as const, args: wallet ? [wallet, id] as const : undefined })),
    query: { enabled: !!wallet && stakedIdsAll.length > 0 },
  })
  const stakedPositions = stakedIdsAll
    .map((id, i) => {
      const r = stakedAmountsRaw?.[i]
      const amt = r?.status === 'success' ? r.result as bigint : 0n
      return amt > 0n ? { id, amount: amt } : null
    })
    .filter((p): p is { id: bigint; amount: bigint } => p !== null)

  const { data: earnedRaw, refetch: refetchEarned } = useReadContract({
    address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'earned',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet, refetchInterval: 15000 },
  })
  const earned = (earnedRaw as bigint | undefined) ?? 0n
  const earnedFormatted = earned > 0n ? parseFloat(formatUnits(earned, 18)).toFixed(4) : '0'

  // See matching comment in ClGaugeRow above -- not gated behind `expanded`
  // for the same reason (collapsed-row "Reward status" was defaulting to
  // wrong).
  const { data: rewardRateRaw } = useReadContract({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'rewardRate', query: { refetchInterval: 60000 } })
  const { data: periodFinishRaw } = useReadContract({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'periodFinish' })
  const periodFinish = (periodFinishRaw as bigint | undefined) ?? 0n
  const isEmitting = periodFinish > BigInt(Math.floor(Date.now() / 1000))

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchPositions(); refetchStakedIds(); refetchEarned(); refetchApproval()
    if (step === 'approve_wait') { setStep('staking'); return }
    if (['stake_wait', 'unstake_wait', 'claim_wait'].includes(step)) { setStep('idle'); return }
  }, [txSuccess])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving') {
      writeContract({ address: pool.address, abi: LB_PAIR_ABI, functionName: 'approveForAll', args: [gauge, true] })
      setStep('approve_wait')
    }
    if (step === 'staking') {
      const ids = myPositions.map(p => BigInt(p.id))
      const amounts = myPositions.map(p => p.balance)
      if (ids.length === 0) { setStep('idle'); return }
      writeContract({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'stake', args: [ids, amounts] })
      setStep('stake_wait')
    }
    if (step === 'unstaking') {
      const ids = stakedPositions.map(p => p.id)
      const amounts = stakedPositions.map(p => p.amount)
      if (ids.length === 0) { setStep('idle'); return }
      writeContract({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'withdraw', args: [ids, amounts] })
      setStep('unstake_wait')
    }
    if (step === 'claiming') {
      writeContract({ address: gauge, abi: DLMM_GAUGE_ABI, functionName: 'getReward', args: [] })
      setStep('claim_wait')
    }
  }, [step])

  const isBusy = step !== 'idle'

  function handleStakeAll() {
    if (myPositions.length === 0) return
    setStep(isApproved ? 'staking' : 'approving')
  }

  if (!gauge) return null

  return (
    <div className={clsx('card overflow-hidden transition-all', expanded && 'border-aeon-400/20')}>
      <button className="w-full grid grid-cols-12 gap-2 px-4 py-4 items-center hover:bg-bg-raised transition-colors text-left" onClick={() => setExpanded(!expanded)}>
        <div className="col-span-4 flex items-center gap-2">
          <div className="flex -space-x-1">
            <TokenIcon symbol={pool.token0} size={28} />
            <TokenIcon symbol={pool.token1} size={28} />
          </div>
          <div>
            <span className="text-sm font-medium text-text-primary">{pool.name}</span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-2xs font-mono font-bold text-amber-400">DLMM</span>
              <span className="text-2xs text-text-muted">· {pool.binStep}bp bins</span>
            </div>
          </div>
        </div>
        <div className="col-span-3">
          <div className="text-sm font-mono text-text-secondary">{myPositions.length} unstaked bin{myPositions.length === 1 ? '' : 's'} · {stakedPositions.length} staked</div>
          <div className="text-2xs text-text-muted">Your positions</div>
        </div>
        <div className="col-span-3">
          <div className={clsx('text-sm font-mono', isEmitting ? 'text-aeon-400 font-bold' : 'text-text-muted')}>{isEmitting ? 'Emitting' : 'No active rewards'}</div>
          <div className="text-2xs text-text-muted">Reward status</div>
        </div>
        <div className="col-span-1 flex justify-end">
          {expanded ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-bg-border bg-bg-raised px-4 py-4 space-y-3">
          {!wallet ? (
            <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
          ) : (
            <>
              <div className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                <span className="text-xs text-text-muted">{myPositions.length} unstaked bin{myPositions.length === 1 ? '' : 's'} available</span>
                <button
                  disabled={myPositions.length === 0 || isBusy}
                  onClick={handleStakeAll}
                  className="btn-primary text-xs py-1.5 px-3 disabled:opacity-40 flex items-center gap-1"
                >
                  {(step === 'approving' || step === 'approve_wait' || step === 'staking' || step === 'stake_wait') && <Loader2 size={11} className="animate-spin" />}
                  {step === 'approving' || step === 'approve_wait' ? 'Approving…' : step === 'staking' || step === 'stake_wait' ? 'Staking…' : 'Stake All'}
                </button>
              </div>

              <div className="flex items-center justify-between p-2 bg-bg-base rounded-lg">
                <span className="text-xs text-text-muted">{stakedPositions.length} bin{stakedPositions.length === 1 ? '' : 's'} staked</span>
                <button
                  disabled={stakedPositions.length === 0 || isBusy}
                  onClick={() => setStep('unstaking')}
                  className="btn-ghost text-xs py-1.5 px-3 border border-bg-border disabled:opacity-40 flex items-center gap-1"
                >
                  {(step === 'unstaking' || step === 'unstake_wait') && <Loader2 size={11} className="animate-spin" />}
                  Unstake All
                </button>
              </div>

              <div className="flex items-center justify-between p-3 bg-bg-base rounded-xl mt-2">
                <span className="text-sm text-text-muted">Claimable AEON</span>
                <div className="flex items-center gap-2">
                  <span className={clsx('font-mono font-bold text-sm', earned > 0n ? 'text-aeon-400' : 'text-text-muted')}>{earnedFormatted} AEON</span>
                  <button disabled={earned === 0n || isBusy} onClick={() => setStep('claiming')} className="text-xs btn-ghost py-1 px-2 text-aeon-400 disabled:opacity-40 flex items-center gap-1">
                    {(step === 'claiming' || step === 'claim_wait') && <Loader2 size={10} className="animate-spin" />}
                    Claim
                  </button>
                </div>
              </div>

              {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function useEarnStats(wallet?: `0x${string}`) {
  const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
  const { data: lpBalances } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({ address: p.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [wallet!] as [`0x${string}`] })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const { data: gaugeAddrs } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({ address: CONTRACTS.AeonVoter as `0x${string}`, abi: VOTER_ABI, functionName: 'gauges' as const, args: [p.address as `0x${string}`] })),
    query: { refetchInterval: 60000 },
  })
  const gaugeByIndex: (`0x${string}` | null)[] = (gaugeAddrs ?? []).map(r =>
    r.status === 'success' && r.result && r.result !== ZERO ? r.result as `0x${string}` : null
  )
  const { data: stakedBalances } = useReadContracts({
    contracts: gaugeByIndex.map(g => ({ address: g ?? ZERO, abi: GAUGE_ABI, functionName: 'balanceOf' as const, args: [wallet ?? ZERO] })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const { data: earnedAmounts } = useReadContracts({
    contracts: gaugeByIndex.map(g => ({ address: g ?? ZERO, abi: GAUGE_ABI, functionName: 'earned' as const, args: [wallet ?? ZERO] })),
    query: { enabled: !!wallet, refetchInterval: 15000 },
  })
  const lpByAddr: Record<string, bigint>     = {}
  const stakedByAddr: Record<string, bigint> = {}
  const earnedByAddr: Record<string, bigint> = {}
  let totalStaked = 0n, totalLPUnstaked = 0n, totalEarned = 0n
  UNIQUE_POOLS.forEach((p, i) => {
    const addr   = p.address.toLowerCase()
    const lp     = lpBalances?.[i]?.status    === 'success' ? lpBalances[i].result    as bigint : 0n
    const staked = stakedBalances?.[i]?.status === 'success' ? stakedBalances[i].result as bigint : 0n
    const earned = earnedAmounts?.[i]?.status  === 'success' ? earnedAmounts[i].result  as bigint : 0n
    lpByAddr[addr] = lp; stakedByAddr[addr] = staked; earnedByAddr[addr] = earned
    totalLPUnstaked += lp; totalStaked += staked; totalEarned += earned
  })
  const fmtLP   = (wei: bigint) => wei > 0n ? parseFloat(formatUnits(wei, 18)).toFixed(4) : '0'
  const fmtAEON = (wei: bigint) => wei > 0n ? parseFloat(formatUnits(wei, 18)).toFixed(4) : '0'
  return { totalStaked, totalLPUnstaked, totalEarned, lpByAddr, stakedByAddr, earnedByAddr, fmtLP, fmtAEON }
}

// ─────────────────────────────────────────────────────────────────────────
// CL (Algebra Integral) and DLMM positions — invisible in Portfolio before
// this: only vAMM LP was ever tracked here, so anyone who added CL or DLMM
// liquidity via /liquidity had no way to see it reflected anywhere else.
// ─────────────────────────────────────────────────────────────────────────

function ClPositionRow({ pos, prices, onUsd }: { pos: ClPosition; prices: PriceMap; onUsd: (tokenId: bigint, usd: number | null) => void }) {
  const poolCfg = CL_POOLS.find(cp => {
    const a0 = TOKENS[cp.token0 as keyof typeof TOKENS].address.toLowerCase()
    const a1 = TOKENS[cp.token1 as keyof typeof TOKENS].address.toLowerCase()
    const p0 = pos.token0.toLowerCase(), p1 = pos.token1.toLowerCase()
    return (a0 === p0 && a1 === p1) || (a0 === p1 && a1 === p0)
  })

  const { data: globalStateRaw } = useReadContract({
    address: poolCfg?.address, abi: ALGEBRA_POOL_ABI, functionName: 'globalState',
    query: { enabled: !!poolCfg, refetchInterval: 20000 },
  })
  const globalState = globalStateRaw as readonly [bigint, number, number, number, number, boolean] | undefined
  const sqrtPriceX96 = globalState?.[0] ?? 0n
  const currentTick  = globalState?.[1] ?? 0
  const poolInitialized = sqrtPriceX96 > 0n

  const sym0 = symbolFor(pos.token0)
  const sym1 = symbolFor(pos.token1)
  const dec0 = TOKENS[sym0 as keyof typeof TOKENS]?.decimals ?? 18
  const dec1 = TOKENS[sym1 as keyof typeof TOKENS]?.decimals ?? 18

  const priceLow  = tickToPrice(pos.tickLower, dec0, dec1)
  const priceHigh = tickToPrice(pos.tickUpper, dec0, dec1)
  const p1Usd = prices[sym1] ?? null
  const usdLow  = p1Usd !== null ? priceLow  * p1Usd : null
  const usdHigh = p1Usd !== null ? priceHigh * p1Usd : null

  const inRange = poolInitialized && currentTick >= pos.tickLower && currentTick < pos.tickUpper

  const { amount0, amount1 } = poolInitialized
    ? amountsForLiquidity(sqrtPriceX96, pos.tickLower, pos.tickUpper, pos.liquidity)
    : { amount0: 0n, amount1: 0n }
  const p0Usd = prices[sym0] ?? null
  const usdValue = (p0Usd !== null ? parseFloat(formatUnits(amount0, dec0)) * p0Usd : 0)
    + (p1Usd !== null ? parseFloat(formatUnits(amount1, dec1)) * p1Usd : 0)

  useEffect(() => { onUsd(pos.tokenId, usdValue > 0 ? usdValue : null) }, [usdValue])

  return (
    <div className="card px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <TokenIcon symbol={sym0} size={36} />
          <TokenIcon symbol={sym1} size={36} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-text-primary">{sym0}/{sym1}</span>
            <span className={clsx('text-2xs px-1.5 py-0.5 rounded-full font-mono font-bold', inRange ? 'bg-emerald-500/15 text-emerald-400' : 'bg-yellow-500/15 text-yellow-400')}>
              {inRange ? '● In Range' : '○ Out of Range'}
            </span>
          </div>
          <div className="flex gap-2 mt-0.5 items-center">
            <span className="text-2xs font-mono font-bold text-violet-400">CL</span>
            <span className="text-2xs text-text-muted font-mono">
              {usdLow !== null && usdHigh !== null ? `${fmtPricePoint(usdLow)} → ${fmtPricePoint(usdHigh)}` : `${priceLow.toPrecision(4)} → ${priceHigh.toPrecision(4)} ${sym1}`}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono text-text-primary">{fmtUsd(usdValue || null)}</div>
        <Link href="/liquidity" className="text-2xs text-aeon-400 hover:underline">Manage →</Link>
      </div>
    </div>
  )
}

function DlmmPoolPositions({ pool, wallet, prices, onUsd }: { pool: typeof DLMM_POOLS[number]; wallet: `0x${string}`; prices: PriceMap; onUsd: (poolAddr: string, usd: number | null) => void }) {
  const { data: activeIdRaw } = useReadContract({
    address: pool.address, abi: LB_PAIR_ABI, functionName: 'getActiveId', query: { refetchInterval: 20000 },
  })
  const activeId = activeIdRaw !== undefined ? Number(activeIdRaw) : undefined
  const { positions } = useDlmmPositions(pool, wallet, activeId)

  const dec0 = TOKENS[pool.token0 as keyof typeof TOKENS].decimals
  const dec1 = TOKENS[pool.token1 as keyof typeof TOKENS].decimals

  const { data: binData } = useReadContracts({
    contracts: positions.flatMap(p => ([
      { address: pool.address, abi: LB_PAIR_ABI, functionName: 'getBin' as const, args: [BigInt(p.id)] as const },
      { address: pool.address, abi: LB_PAIR_ABI, functionName: 'totalSupply' as const, args: [BigInt(p.id)] as const },
    ])),
    query: { enabled: positions.length > 0, refetchInterval: 20000 },
  })

  const p0Usd = prices[pool.token0] ?? null
  const p1Usd = prices[pool.token1] ?? null

  let totalUsd = 0
  let minId = Infinity, maxId = -Infinity
  positions.forEach((p, i) => {
    minId = Math.min(minId, p.id); maxId = Math.max(maxId, p.id)
    const binR = binData?.[i * 2]
    const supplyR = binData?.[i * 2 + 1]
    if (binR?.status !== 'success' || supplyR?.status !== 'success') return
    const [reserveX, reserveY] = binR.result as readonly [bigint, bigint]
    const supply = supplyR.result as bigint
    if (supply === 0n) return
    const myX = (reserveX * p.balance) / supply
    const myY = (reserveY * p.balance) / supply
    if (p0Usd !== null) totalUsd += parseFloat(formatUnits(myX, dec0)) * p0Usd
    if (p1Usd !== null) totalUsd += parseFloat(formatUnits(myY, dec1)) * p1Usd
  })

  useEffect(() => { onUsd(pool.address.toLowerCase(), totalUsd > 0 ? totalUsd : null) }, [totalUsd])

  if (positions.length === 0 || activeId === undefined) return null

  const priceLow  = binIdToPrice(minId, pool.binStep, dec0, dec1)
  const priceHigh = binIdToPrice(maxId, pool.binStep, dec0, dec1)
  const usdLow  = p1Usd !== null ? priceLow  * p1Usd : null
  const usdHigh = p1Usd !== null ? priceHigh * p1Usd : null
  const inRange = activeId >= minId && activeId <= maxId

  return (
    <div className="card px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          <TokenIcon symbol={pool.token0} size={36} />
          <TokenIcon symbol={pool.token1} size={36} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-text-primary">{pool.name}</span>
            <span className={clsx('text-2xs px-1.5 py-0.5 rounded-full font-mono font-bold', inRange ? 'bg-emerald-500/15 text-emerald-400' : 'bg-yellow-500/15 text-yellow-400')}>
              {inRange ? '● In Range' : '○ Out of Range'}
            </span>
          </div>
          <div className="flex gap-2 mt-0.5 items-center">
            <span className="text-2xs font-mono font-bold text-amber-400">DLMM</span>
            <span className="text-2xs text-text-muted font-mono">
              {usdLow !== null && usdHigh !== null ? `${fmtPricePoint(usdLow)} → ${fmtPricePoint(usdHigh)}` : `${priceLow.toPrecision(4)} → ${priceHigh.toPrecision(4)} ${pool.token1}`}
              {' · '}{positions.length} bin{positions.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono text-text-primary">{fmtUsd(totalUsd || null)}</div>
        <Link href="/liquidity" className="text-2xs text-aeon-400 hover:underline">Manage →</Link>
      </div>
    </div>
  )
}

function PortfolioTab({ wallet, prices, lpByAddr, stakedByAddr, tvlByAddr }: {
  wallet?: `0x${string}`
  prices: PriceMap
  lpByAddr: Record<string, bigint>
  stakedByAddr: Record<string, bigint>
  tvlByAddr: Record<string, number | null>
}) {
  const { data: ethBal } = useBalance({ address: wallet, query: { enabled: !!wallet, refetchInterval: 15000 } })

  const tokenEntries = Object.entries(TOKENS).filter(([k]) => k !== 'ETH')
  const { data: tokenBals } = useReadContracts({
    contracts: tokenEntries.map(([, t]) => ({
      address: t.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf' as const,
      args: [wallet!] as [`0x${string}`],
    })),
    query: { enabled: !!wallet, refetchInterval: 15000 },
  })

  const tokens = [
    { key: 'ETH', symbol: 'ETH', name: 'Ether (Native)', decimals: 18,
      balance: ethBal ? parseFloat(formatUnits(ethBal.value, 18)) : null,
      price: prices['ETH'] ?? null },
    ...tokenEntries.map(([key, t], i) => {
      const raw = tokenBals?.[i]?.status === 'success' ? tokenBals[i].result as bigint : null
      return { key, symbol: t.symbol, name: t.name, decimals: t.decimals,
        balance: raw !== null ? parseFloat(formatUnits(raw, t.decimals)) : null,
        price: prices[key] ?? null }
    }),
  ]

  const lpPositions = UNIQUE_POOLS
    .map(pool => {
      const addr = pool.address.toLowerCase()
      const lp   = (lpByAddr[addr] ?? 0n) + (stakedByAddr[addr] ?? 0n)
      return lp > 0n ? { pool, lpUnstaked: lpByAddr[addr] ?? 0n, lpStaked: stakedByAddr[addr] ?? 0n } : null
    })
    .filter(Boolean) as { pool: typeof UNIQUE_POOLS[number]; lpUnstaked: bigint; lpStaked: bigint }[]

  const { data: lpTotalSupplies } = useReadContracts({
    contracts: lpPositions.map(({ pool }) => ({
      address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'totalSupply' as const,
    })),
    query: { enabled: lpPositions.length > 0, refetchInterval: 30000 },
  })

  const lpValues = lpPositions.map(({ pool, lpUnstaked, lpStaked }, i) => {
    const ts = lpTotalSupplies?.[i]?.status === 'success' ? lpTotalSupplies[i].result as bigint : 0n
    const tvl = tvlByAddr[pool.address] ?? null
    const share = ts > 0n ? Number(lpUnstaked + lpStaked) / Number(ts) : 0
    const usd = tvl && share > 0 ? share * tvl : null
    return { pool, lpUnstaked, lpStaked, usd }
  })

  const totalLpUsd = lpValues.reduce((sum, p) => sum + (p.usd ?? 0), 0)

  const tokenOnlyUsd = tokens.reduce((sum, t) => {
    if (t.balance && t.balance > 0.000001 && t.price) return sum + t.balance * t.price
    return sum
  }, 0)

  const hasTokens = tokens.some(t => t.balance && t.balance > 0.000001)

  // CL positions span all CL pools at once; DLMM is tracked per-pool (each
  // pool's bin scan needs that pool's own active bin id).
  const { positions: clPositions } = useClPositions(wallet)
  const [clUsdByTokenId, setClUsdByTokenId] = useState<Record<string, number | null>>({})
  const onClUsd = useCallback((tokenId: bigint, usd: number | null) => {
    setClUsdByTokenId(prev => ({ ...prev, [tokenId.toString()]: usd }))
  }, [])
  const totalClUsd = Object.values(clUsdByTokenId).reduce((s: number, v) => s + (v ?? 0), 0)

  const [dlmmUsdByPool, setDlmmUsdByPool] = useState<Record<string, number | null>>({})
  const onDlmmUsd = useCallback((poolAddr: string, usd: number | null) => {
    setDlmmUsdByPool(prev => ({ ...prev, [poolAddr]: usd }))
  }, [])
  const totalDlmmUsd = Object.values(dlmmUsdByPool).reduce((s: number, v) => s + (v ?? 0), 0)

  const totalTokenUsd = tokenOnlyUsd + totalLpUsd + totalClUsd + totalDlmmUsd

  return (
    <div className="space-y-8">
      <div className="card p-6 bg-gradient-to-r from-aeon-400/5 to-transparent transition-shadow duration-500 hover:shadow-[0_0_40px_-16px_rgba(255,184,0,0.35)]">
        <div className="flex items-center gap-3 mb-3">
          <BarChart3 size={18} className="text-aeon-400" />
          <span className="text-sm text-text-muted">Total Wallet Value</span>
        </div>
        <div className="text-4xl font-display font-bold text-text-primary mb-4">{wallet ? fmtUsd(totalTokenUsd || null) : '$—'}</div>
        {wallet && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-bg-border">
            <div>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider mb-1">Token Balances</div>
              <div className="text-lg font-display font-semibold text-text-primary">{fmtUsd(tokenOnlyUsd || null)}</div>
            </div>
            <div>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider mb-1">
                vAMM LP{lpPositions.length > 0 ? ` · ${lpPositions.length}` : ''}
              </div>
              <div className="text-lg font-display font-semibold text-blue-400">{totalLpUsd > 0 ? fmtUsd(totalLpUsd) : '$—'}</div>
            </div>
            <div>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider mb-1">
                CL Positions{clPositions.length > 0 ? ` · ${clPositions.length}` : ''}
              </div>
              <div className="text-lg font-display font-semibold text-violet-400">{totalClUsd > 0 ? fmtUsd(totalClUsd) : '$—'}</div>
            </div>
            <div>
              <div className="text-2xs font-mono text-text-muted uppercase tracking-wider mb-1">DLMM Positions</div>
              <div className="text-lg font-display font-semibold text-amber-400">{totalDlmmUsd > 0 ? fmtUsd(totalDlmmUsd) : '$—'}</div>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Token Balances</div>
        {!wallet ? (
          <div className="card p-10 text-center text-sm text-text-muted">Connect wallet to view your portfolio</div>
        ) : !hasTokens ? (
          <div className="card p-10 text-center text-sm text-text-muted">No token balances found in this wallet</div>
        ) : (
          <div className="space-y-2">
            {tokens.filter(t => t.balance && t.balance > 0.000001).map(t => {
              const usdVal = t.balance && t.price ? t.balance * t.price : null
              return (
                <div key={t.key} className="card px-4 py-3 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-aeon-400/30 hover:shadow-[0_0_24px_-12px_rgba(255,184,0,0.4)]">
                  <div className="flex items-center gap-3">
                    <TokenIcon symbol={t.symbol} size={40} />
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{t.symbol}</div>
                      <div className="text-2xs text-text-muted">{t.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-text-primary">
                      {t.balance!.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </div>
                    <div className="text-xs font-mono text-text-muted">{usdVal ? fmtUsd(usdVal) : t.price ? fmtUsd(0) : '—'}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {wallet && lpPositions.length > 0 && (
        <div>
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">LP Positions</div>
          <div className="space-y-2">
            {lpPositions.map(({ pool, lpUnstaked, lpStaked }) => (
              <div key={pool.address} className="card px-4 py-3 flex items-center justify-between transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-400/30 hover:shadow-[0_0_24px_-12px_rgba(96,165,250,0.4)]">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <TokenIcon symbol={pool.token0} size={36} />
                    <TokenIcon symbol={pool.token1} size={36} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-text-primary">{pool.name}</div>
                    <div className="flex gap-2 mt-0.5">
                      <span className="text-2xs font-mono font-bold text-blue-400">{pool.type}</span>
                      <span className="text-2xs text-text-muted">{pool.fee}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right space-y-0.5">
                  {lpUnstaked > 0n && (
                    <div className="text-xs font-mono text-text-secondary">
                      {parseFloat(formatUnits(lpUnstaked, 18)).toFixed(8)} LP
                    </div>
                  )}
                  {lpStaked > 0n && (
                    <div className="text-xs font-mono text-emerald-400">
                      {parseFloat(formatUnits(lpStaked, 18)).toFixed(8)} LP staked
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {wallet && clPositions.length > 0 && (
        <div>
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Concentrated Liquidity (CL) Positions</div>
          <div className="space-y-2">
            {clPositions.map(pos => (
              <ClPositionRow key={pos.tokenId.toString()} pos={pos} prices={prices} onUsd={onClUsd} />
            ))}
          </div>
        </div>
      )}

      {wallet && (
        <div className={Object.values(dlmmUsdByPool).some(v => v !== null && v !== undefined) ? '' : 'hidden'}>
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">DLMM Positions</div>
          <div className="space-y-2">
            {DLMM_POOLS.map(pool => (
              <DlmmPoolPositions key={pool.address} pool={pool} wallet={wallet} prices={prices} onUsd={onDlmmUsd} />
            ))}
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

  const [mainTab,   setMainTab]   = useState<'earn' | 'portfolio'>('earn')
  const [filterTab, setFilterTab] = useState<'all' | 'my'>('all')

  const stats     = useEarnStats(isConnected ? address : undefined)
  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const tvlByAddr = Object.fromEntries(poolStats.map(s => [s.address, s.tvlUsd]))
  const volResult = useVolume24h(prices)

  // Trailing-week average, not literal 24h -- see useVolume24h's byPoolWeek
  // comment for why (a pool with real but sporadic trading shouldn't show
  // "—%" just because nothing happened to trade in the exact last 24h).
  const aprByAddr: Record<string, number | null> = {}
  for (const pool of UNIQUE_POOLS) {
    const tvl = tvlByAddr[pool.address] ?? null
    const volWeek = volResult.byPoolWeek[pool.address.toLowerCase()] ?? null
    const feesWeek = volWeek !== null ? volWeek * parseFeeRate(pool.fee) : null
    aprByAddr[pool.address] = (tvl && tvl > 0 && feesWeek !== null)
      ? (feesWeek * (365 / 7) / tvl) * 100
      : null
  }

  const displayPools = filterTab === 'my' && isConnected
    ? UNIQUE_POOLS.filter(p => {
        const addr = p.address.toLowerCase()
        return (stats.lpByAddr[addr] ?? 0n) > 0n || (stats.stakedByAddr[addr] ?? 0n) > 0n
      })
    : UNIQUE_POOLS

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-text-primary mb-1">My Portfolio</h1>
          <p className="text-text-secondary text-sm">Balances, LP positions, earnings, and liquidity management — all in one place.</p>
        </div>
        {!isConnected && (
          <button onClick={() => openConnectModal?.()} className="btn-ghost text-sm py-2 px-4 flex items-center gap-2 shrink-0">
            <Wallet size={14} /> Connect Wallet
          </button>
        )}
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-8 w-fit">
        {(['earn', 'portfolio'] as const).map(t => (
          <button key={t} onClick={() => setMainTab(t)}
            className={clsx(
              'flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all hover:scale-105 active:scale-95',
              mainTab === t ? 'bg-bg-base text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
            )}>
            {t === 'earn' ? <><Coins size={14} /> Earn</> : <><BarChart3 size={14} /> Portfolio</>}
          </button>
        ))}
      </div>

      {mainTab === 'portfolio' ? (
        <PortfolioTab
          wallet={isConnected ? address : undefined}
          prices={prices}
          lpByAddr={stats.lpByAddr}
          stakedByAddr={stats.stakedByAddr}
          tvlByAddr={tvlByAddr}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'My Staked LP',     value: isConnected ? `${stats.fmtLP(stats.totalStaked)} LP`     : '—', sub: 'across all gauges' },
              { label: 'Unstaked LP',      value: isConnected ? `${stats.fmtLP(stats.totalLPUnstaked)} LP`  : '—', sub: 'not yet earning'   },
              { label: 'Claimable Emiss.', value: isConnected ? `${stats.fmtAEON(stats.totalEarned)} AEON`  : '—', sub: 'from staked LP'    },
              { label: 'Pools',            value: `${UNIQUE_POOLS.length}`,                                        sub: 'vAMM at genesis'  },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <div className="stat-label mb-1">{s.label}</div>
                <div className="stat-value text-xl mb-0.5">{s.value}</div>
                <div className="text-2xs text-text-muted">{s.sub}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
              {(['all', 'my'] as const).map(t => (
                <button key={t} onClick={() => setFilterTab(t)}
                  className={clsx('px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all', filterTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
                  {t === 'all' ? 'All Pools' : 'My Positions'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 px-4 mb-2">
            {[['Pool', 'col-span-3'], ['TVL', 'col-span-2 hidden md:block'], ['APR', 'col-span-2'], ['vAPR', 'col-span-2 hidden sm:block'], ['My Stake', 'col-span-2'], ['', 'col-span-1']].map(([h, cls]) => (
              <div key={h} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', cls)}>{h}</div>
            ))}
          </div>

          {filterTab === 'my' && isConnected && displayPools.length === 0 && (
            <div className="card p-8 text-center text-sm text-text-muted">
              No LP positions found. Expand any pool below and click <strong>Add Liquidity</strong> to add your first deposit.
            </div>
          )}

          <div className="space-y-2">
            {displayPools.map(pool => (
              <PoolRow
                key={pool.address}
                pool={pool}
                wallet={isConnected ? address : undefined}
                tvlUsd={tvlByAddr[pool.address]}
                apr={aprByAddr[pool.address]}
                prices={prices}
              />
            ))}
          </div>

          <div className="mt-8">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
              Concentrated Liquidity (CL) Staking
            </div>
            <div className="p-3 mb-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20 text-2xs text-yellow-400">
              Governor-funded rewards, not the automatic vote-weighted emissions vAMM pools get — see docs for why.
            </div>
            <div className="space-y-2">
              {CL_POOLS.map(pool => (
                <ClGaugeRow key={pool.address} pool={pool} wallet={isConnected ? address : undefined} />
              ))}
            </div>
          </div>

          <div className="mt-8">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">DLMM Staking</div>
            <div className="space-y-2">
              {DLMM_POOLS.map(pool => (
                <DlmmGaugeRow key={pool.address} pool={pool} wallet={isConnected ? address : undefined} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
