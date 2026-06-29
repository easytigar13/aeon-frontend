'use client'
import { useState, useEffect } from 'react'
import { Coins, ChevronDown, ChevronUp, Loader2, Wallet, Droplets, BarChart3 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { POOLS, CONTRACTS, TOKENS } from '@/config/contracts'
import { ERC20_ABI, GAUGE_ABI, GAUGE_FACTORY_ABI, PAIR_ABI, LIQUIDITY_HELPER_ABI, VOTER_ABI, BRIBE_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'

type PriceMap = Record<string, number | null>

function fmtUsd(n: number | null): string {
  if (n === null || n <= 0) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function tokenIcon(sym: string) {
  if (sym.startsWith('WBTC')) return '₿'
  return sym[0]
}

const UNIQUE_POOLS = POOLS.filter((p, _, arr) => arr.findIndex(x => x.address === p.address) === arr.indexOf(p))

type Step    = 'idle' | 'approving' | 'approve_wait' | 'staking' | 'stake_wait' | 'done' | 'unstaking' | 'unstake_wait' | 'claiming' | 'claim_wait' | 'fee_claiming' | 'fee_claim_wait'
type LiqStep = 'idle' | 'app0' | 'app0_wait' | 'app1' | 'app1_wait' | 'adding' | 'adding_wait' | 'rem_app' | 'rem_app_wait' | 'removing' | 'removing_wait' | 'done'

function parseFeeRate(fee: string): number { return parseFloat(fee.replace('%', '')) / 100 }
function fmtApr(apr: number | null): string {
  if (apr === null) return '—%'
  if (apr >= 1000) return '>1000%'
  return apr.toFixed(2) + '%'
}

// ─── Pool Price Hook ──────────────────────────────────────────────────────────

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
  const sym0  = cfgT0?.symbol ?? pool.token0
  const sym1  = cfgT1?.symbol ?? pool.token1
  const priceLabel = price < 0.001
    ? `1 ${sym1} = ${(1 / price).toFixed(2)} ${sym0}`
    : `1 ${sym1} = ${price < 1 ? price.toFixed(6) : price.toFixed(4)} ${sym0}`
  return { hasLiquidity, price, priceLabel }
}

// ─── Inline Liquidity Panel ───────────────────────────────────────────────────

function LiquidityPanel({ pool, wallet, prices, tvlUsd, onDone }: {
  pool: typeof UNIQUE_POOLS[number]
  wallet: `0x${string}`
  prices: PriceMap
  tvlUsd?: number | null
  onDone?: () => void
}) {
  const [amt0,      setAmt0]      = useState('')
  const [amt1,      setAmt1]      = useState('')
  const [removeAmt, setRemoveAmt] = useState('')
  const [liqStep,   setLiqStep]   = useState<LiqStep>('idle')
  const [liqErr,    setLiqErr]    = useState('')

  const t0 = TOKENS[pool.token0 as keyof typeof TOKENS]
  const t1 = TOKENS[pool.token1 as keyof typeof TOKENS]

  const { data: bal0Raw,    refetch: refBal0   } = useReadContract({ address: t0?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { enabled: !!t0, refetchInterval: 15000 } })
  const { data: bal1Raw,    refetch: refBal1   } = useReadContract({ address: t1?.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { enabled: !!t1, refetchInterval: 15000 } })
  const { data: lpBalRaw,   refetch: refLpBal  } = useReadContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet], query: { refetchInterval: 15000 } })
  const { data: lpTsRaw                        } = useReadContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'totalSupply', query: { refetchInterval: 30000 } })
  const { data: allow0Raw,  refetch: refAllow0 } = useReadContract({ address: t0?.address, abi: ERC20_ABI, functionName: 'allowance', args: [wallet, CONTRACTS.LiquidityHelper], query: { enabled: !!t0 } })
  const { data: allow1Raw,  refetch: refAllow1 } = useReadContract({ address: t1?.address, abi: ERC20_ABI, functionName: 'allowance', args: [wallet, CONTRACTS.LiquidityHelper], query: { enabled: !!t1 } })
  const { data: lpAllowRaw, refetch: refLpAl   } = useReadContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'allowance', args: [wallet, CONTRACTS.LiquidityHelper] })

  const bal0    = (bal0Raw    as bigint | undefined) ?? 0n
  const bal1    = (bal1Raw    as bigint | undefined) ?? 0n
  const lpBal   = (lpBalRaw  as bigint | undefined) ?? 0n
  const lpTs    = (lpTsRaw   as bigint | undefined) ?? 0n
  const allow0  = (allow0Raw as bigint | undefined) ?? 0n
  const allow1  = (allow1Raw as bigint | undefined) ?? 0n
  const lpAllow = (lpAllowRaw as bigint | undefined) ?? 0n

  const bal0Fmt = t0 ? parseFloat(formatUnits(bal0, t0.decimals)).toFixed(6) : '0'
  const bal1Fmt = t1 ? parseFloat(formatUnits(bal1, t1.decimals)).toFixed(6) : '0'
  const lpFmt   = parseFloat(formatUnits(lpBal, 18)).toFixed(8)
  const lpShare = lpTs > 0n ? Number(lpBal) / Number(lpTs) : 0
  const lpUsd   = tvlUsd && lpShare > 0 ? lpShare * tvlUsd : null

  const { writeContract: liqWrite, data: liqHash, error: liqWriteErr } = useWriteContract()
  const { isSuccess: liqSuccess } = useWaitForTransactionReceipt({ hash: liqHash })

  useEffect(() => {
    if (!liqSuccess) return
    refBal0(); refBal1(); refLpBal(); refAllow0(); refAllow1(); refLpAl(); onDone?.()
    if (liqStep === 'app0_wait')     { setLiqStep('app1');     return }
    if (liqStep === 'app1_wait')     { setLiqStep('adding');   return }
    if (liqStep === 'adding_wait')   { setLiqStep('done');     setAmt0(''); setAmt1(''); return }
    if (liqStep === 'rem_app_wait')  { setLiqStep('removing'); return }
    if (liqStep === 'removing_wait') { setLiqStep('idle');     setRemoveAmt(''); return }
  }, [liqSuccess])

  useEffect(() => {
    if (!liqWriteErr) return
    setLiqErr(liqWriteErr.message.slice(0, 180))
    setLiqStep('idle')
  }, [liqWriteErr])

  useEffect(() => {
    if (!t0 || !t1) return
    setLiqErr('')
    if (liqStep === 'app0')    { liqWrite({ address: t0.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.LiquidityHelper, maxUint256] }); setLiqStep('app0_wait') }
    if (liqStep === 'app1')    { liqWrite({ address: t1.address, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.LiquidityHelper, maxUint256] }); setLiqStep('app1_wait') }
    if (liqStep === 'adding')  {
      const a0 = parseUnits(amt0 || '0', t0.decimals)
      const a1 = parseUnits(amt1 || '0', t1.decimals)
      liqWrite({ address: CONTRACTS.LiquidityHelper, abi: LIQUIDITY_HELPER_ABI, functionName: 'addLiquidity', args: [pool.address as `0x${string}`, t0.address, a0, t1.address, a1, wallet] })
      setLiqStep('adding_wait')
    }
    if (liqStep === 'rem_app') { liqWrite({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.LiquidityHelper, maxUint256] }); setLiqStep('rem_app_wait') }
    if (liqStep === 'removing') {
      const amt = parseUnits(removeAmt || '0', 18)
      liqWrite({ address: CONTRACTS.LiquidityHelper, abi: LIQUIDITY_HELPER_ABI, functionName: 'removeLiquidity', args: [pool.address as `0x${string}`, amt, wallet] })
      setLiqStep('removing_wait')
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
  function handleRemove() {
    if (!removeAmt || parseFloat(removeAmt) <= 0) return
    if (lpAllow < parseUnits(removeAmt, 18)) { setLiqStep('rem_app'); return }
    setLiqStep('removing')
  }

  const addBusy = ['app0','app0_wait','app1','app1_wait','adding','adding_wait'].includes(liqStep)
  const remBusy = ['rem_app','rem_app_wait','removing','removing_wait'].includes(liqStep)

  function addLabel() {
    if (liqStep === 'app0' || liqStep === 'app0_wait') return `Approving ${t0?.symbol}…`
    if (liqStep === 'app1' || liqStep === 'app1_wait') return `Approving ${t1?.symbol}…`
    if (liqStep === 'adding' || liqStep === 'adding_wait') return 'Adding…'
    if (liqStep === 'done') return '✓ Added!'
    const na0 = amt0 && t0 && parseFloat(amt0) > 0 && parseUnits(amt0, t0.decimals) > allow0
    const na1 = amt1 && t1 && parseFloat(amt1) > 0 && parseUnits(amt1, t1.decimals) > allow1
    if (na0 || na1) return 'Approve & Add'
    return 'Add Liquidity'
  }

  return (
    <div className="space-y-5">
      {lpBal > 0n && (
        <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center justify-between text-xs">
          <span className="text-text-muted">Your LP Position</span>
          <div className="text-right">
            <div className="font-mono text-emerald-400 font-bold">{lpFmt} LP</div>
            <div className="text-text-muted font-mono">{lpUsd ? fmtUsd(lpUsd) : `${(lpShare * 100).toFixed(4)}% of pool`}</div>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Add */}
        <div className="space-y-2">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Add Liquidity</div>
          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-1">
              <span>{t0?.symbol ?? pool.token0}</span>
              <button onClick={() => autoFill0(bal0Fmt)} className="text-aeon-400 font-mono hover:underline">MAX {bal0Fmt}</button>
            </div>
            <input type="number" value={amt0} onChange={e => autoFill0(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2" />
          </div>
          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-1">
              <span>{t1?.symbol ?? pool.token1}</span>
              <button onClick={() => autoFill1(bal1Fmt)} className="text-aeon-400 font-mono hover:underline">MAX {bal1Fmt}</button>
            </div>
            <input type="number" value={amt1} onChange={e => autoFill1(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2" />
          </div>
          {!prices[pool.token0] && !prices[pool.token1] && (
            <div className="text-2xs text-yellow-400 font-mono px-1">No price feed yet — enter both amounts manually to set the initial ratio</div>
          )}
          <button
            disabled={!amt0 || !amt1 || parseFloat(amt0 || '0') <= 0 || parseFloat(amt1 || '0') <= 0 || addBusy || remBusy}
            onClick={handleAdd}
            className="btn-primary w-full text-sm py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {addBusy && <Loader2 size={12} className="animate-spin" />}
            {addLabel()}
          </button>
        </div>

        {/* Remove */}
        <div className="space-y-2">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Remove Liquidity</div>
          <div>
            <div className="flex justify-between text-2xs text-text-muted mb-1">
              <span>LP Token Amount</span>
              <button onClick={() => setRemoveAmt(lpFmt)} className="text-text-muted font-mono hover:underline hover:text-text-secondary">MAX {lpFmt}</button>
            </div>
            <input type="number" value={removeAmt} onChange={e => setRemoveAmt(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2" />
          </div>
          <div className="text-2xs text-text-muted">
            {lpBal > 0n
              ? `Your LP: ${lpFmt}${lpUsd ? ` (${fmtUsd(lpUsd)})` : ''}`
              : 'You have no LP tokens in this pool'}
          </div>
          <button
            disabled={!removeAmt || parseFloat(removeAmt || '0') <= 0 || lpBal === 0n || addBusy || remBusy}
            onClick={handleRemove}
            className="btn-ghost border border-bg-border w-full text-sm py-2.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {remBusy && <Loader2 size={12} className="animate-spin" />}
            {liqStep === 'rem_app' || liqStep === 'rem_app_wait' ? 'Approving LP…'
              : liqStep === 'removing' || liqStep === 'removing_wait' ? 'Removing…'
              : 'Remove Liquidity'}
          </button>
        </div>
      </div>

      {liqErr && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{liqErr}</div>}
      <div className="text-2xs text-text-muted text-center">Full-range liquidity · {pool.fee} fee tier · amounts auto-estimated from prices</div>
    </div>
  )
}

// ─── Pool Row ─────────────────────────────────────────────────────────────────

function PoolRow({ pool, wallet, tvlUsd, apr, prices }: {
  pool: typeof UNIQUE_POOLS[number]
  wallet?: `0x${string}`
  tvlUsd?: number | null
  apr?: number | null
  prices: PriceMap
}) {
  const [expanded,   setExpanded]   = useState(false)
  const [poolTab,    setPoolTab]    = useState<'earn' | 'liquidity'>('earn')
  const [stakeAmt,   setStakeAmt]   = useState('')
  const [unstakeAmt, setUnstakeAmt] = useState('')
  const [step,       setStep]       = useState<Step>('idle')
  const [errMsg,     setErrMsg]     = useState('')

  const poolPrice = usePoolPrice(pool)

  const { data: gaugeAddr } = useReadContract({
    address: CONTRACTS.AeonGaugeFactory, abi: GAUGE_FACTORY_ABI, functionName: 'gaugeForPool',
    args: [pool.address], query: { enabled: expanded },
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

  // vAPR — gauge emission rate vs pool TVL
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
  const vApr = isEmitting && rewardRate > 0n && aeonPrice !== null && tvlUsd && tvlUsd > 0
    ? (Number(formatUnits(rewardRate, 18)) * 365 * 24 * 3600 * aeonPrice) / tvlUsd * 100
    : null

  // Fee rewards — for veNFT voters
  const { data: tokenIdRaw } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'lastVotedTokenId',
    args: wallet ? [wallet] : undefined, query: { enabled: !!wallet && expanded, refetchInterval: 30000 },
  })
  const veTokenId = (tokenIdRaw as bigint | undefined)

  const { data: bribeAddrRaw } = useReadContract({
    address: CONTRACTS.AeonVoter, abi: VOTER_ABI, functionName: 'internalBribes',
    args: gauge ? [gauge] : undefined, query: { enabled: !!gauge && expanded },
  })
  const bribe = bribeAddrRaw && bribeAddrRaw !== '0x0000000000000000000000000000000000000000'
    ? bribeAddrRaw as `0x${string}` : undefined

  const tok0Addr = TOKENS[pool.token0 as keyof typeof TOKENS]?.address
  const tok1Addr = TOKENS[pool.token1 as keyof typeof TOKENS]?.address
  const tok0Dec  = TOKENS[pool.token0 as keyof typeof TOKENS]?.decimals ?? 18
  const tok1Dec  = TOKENS[pool.token1 as keyof typeof TOKENS]?.decimals ?? 18

  const { data: feeEarned0Raw, refetch: refetchFee0 } = useReadContract({
    address: bribe, abi: BRIBE_ABI, functionName: 'earned',
    args: veTokenId && tok0Addr ? [veTokenId, tok0Addr] : undefined,
    query: { enabled: !!bribe && !!veTokenId && !!tok0Addr && veTokenId > 0n, refetchInterval: 30000 },
  })
  const { data: feeEarned1Raw, refetch: refetchFee1 } = useReadContract({
    address: bribe, abi: BRIBE_ABI, functionName: 'earned',
    args: veTokenId && tok1Addr ? [veTokenId, tok1Addr] : undefined,
    query: { enabled: !!bribe && !!veTokenId && !!tok1Addr && veTokenId > 0n, refetchInterval: 30000 },
  })
  const fee0 = (feeEarned0Raw as bigint | undefined) ?? 0n
  const fee1 = (feeEarned1Raw as bigint | undefined) ?? 0n
  const fee0Fmt = fee0 > 0n ? parseFloat(formatUnits(fee0, tok0Dec)).toFixed(4) : '0'
  const fee1Fmt = fee1 > 0n ? parseFloat(formatUnits(fee1, tok1Dec)).toFixed(4) : '0'
  const hasFeeRewards = fee0 > 0n || fee1 > 0n

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (!txSuccess) return
    refetchLP(); refetchStaked(); refetchEarned(); refetchAllowance()
    if (step === 'approve_wait')    { setStep('staking');  return }
    if (step === 'stake_wait')      { setStep('done');     setStakeAmt('');   return }
    if (step === 'unstake_wait')    { setStep('idle');     setUnstakeAmt(''); return }
    if (step === 'claim_wait')      { setStep('idle');     return }
    if (step === 'fee_claim_wait')  { setStep('idle');     refetchFee0(); refetchFee1(); return }
  }, [txSuccess])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  useEffect(() => {
    if (!wallet || !gauge) return
    setErrMsg('')
    if (step === 'approving') {
      writeContract({ address: pool.address as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [gauge, maxUint256] })
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
    if (step === 'fee_claiming') {
      if (!bribe || !veTokenId || !tok0Addr || !tok1Addr) { setStep('idle'); return }
      writeContract({ address: bribe, abi: BRIBE_ABI, functionName: 'getReward', args: [veTokenId, [tok0Addr, tok1Addr] as `0x${string}`[]] })
      setStep('fee_claim_wait')
    }
  }, [step])

  function handleStake() {
    if (!stakeAmt || !gauge) return
    if (allowance < parseUnits(stakeAmt, 18)) { setStep('approving'); return }
    setStep('staking')
  }

  const isBusy = ['approving','approve_wait','staking','stake_wait','unstaking','unstake_wait','claiming','claim_wait','fee_claiming','fee_claim_wait'].includes(step)

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
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold z-10">{tokenIcon(pool.token0)}</div>
            <div className="w-7 h-7 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-xs font-bold">{tokenIcon(pool.token1)}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-text-primary">{pool.name}</span>
              {poolPrice.hasLiquidity
                ? <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-mono font-bold">● Active</span>
                : <span className="text-2xs px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 font-mono font-bold">● Empty</span>}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span>
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
          <div className="text-2xs text-text-muted">Fee APR</div>
        </div>
        <div className="col-span-2 hidden sm:block">
          <div className="text-sm font-mono font-bold text-violet-400">{fmtApr(vApr)}</div>
          <div className="text-2xs text-text-muted">vAPR</div>
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
          {/* Sub-tabs */}
          <div className="flex gap-1 px-4 pt-3">
            {(['earn', 'liquidity'] as const).map(t => (
              <button key={t} onClick={() => setPoolTab(t)}
                className={clsx(
                  'flex items-center gap-1.5 px-4 py-1.5 rounded-t-lg text-xs font-medium border border-b-0 transition-all',
                  poolTab === t ? 'bg-bg-base border-bg-border text-text-primary' : 'bg-transparent border-transparent text-text-muted hover:text-text-secondary'
                )}>
                {t === 'earn' ? <><Coins size={11} /> Earn</> : <><Droplets size={11} /> Liquidity</>}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4 pt-0 bg-bg-base">
            {/* Pool status bar */}
            <div className={clsx('my-4 p-3 rounded-xl flex items-center justify-between text-xs font-mono',
              poolPrice.hasLiquidity ? 'bg-emerald-500/5 border border-emerald-500/20' : 'bg-red-500/5 border border-red-500/20'
            )}>
              <span className={poolPrice.hasLiquidity ? 'text-emerald-400' : 'text-red-400'}>
                {poolPrice.hasLiquidity ? '● Pool active — earning fees on every trade' : '● Pool empty — add liquidity to start earning'}
              </span>
              {poolPrice.priceLabel && <span className="text-text-muted hidden sm:inline">{poolPrice.priceLabel}</span>}
            </div>

            {poolTab === 'liquidity' ? (
              !wallet
                ? <div className="p-4 text-center text-sm text-text-muted">Connect wallet to manage liquidity</div>
                : <LiquidityPanel pool={pool} wallet={wallet} prices={prices} tvlUsd={tvlUsd} onDone={refetchLP} />
            ) : (
              !wallet
                ? <div className="p-4 text-center text-sm text-text-muted">Connect wallet to stake and earn</div>
                : !gauge
                  ? <div className="p-4 text-center text-xs text-yellow-400">Gauge not yet deployed for this pool</div>
                  : (
                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Stake LP — Earn AEON Emissions</h4>
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
                      </div>
                      <div>
                        <h4 className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Fee Rewards — From Your veNFT Vote</h4>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-3 bg-bg-raised rounded-xl">
                            <span className="text-sm text-text-muted">{pool.token0} fees</span>
                            <span className={`font-mono text-sm ${fee0 > 0n ? 'text-emerald-400 font-bold' : 'text-text-muted'}`}>{fee0Fmt}</span>
                          </div>
                          <div className="flex items-center justify-between p-3 bg-bg-raised rounded-xl">
                            <span className="text-sm text-text-muted">{pool.token1} fees</span>
                            <span className={`font-mono text-sm ${fee1 > 0n ? 'text-emerald-400 font-bold' : 'text-text-muted'}`}>{fee1Fmt}</span>
                          </div>
                          {veTokenId && veTokenId > 0n ? (
                            <button
                              disabled={!hasFeeRewards || isBusy || !bribe}
                              onClick={() => setStep('fee_claiming')}
                              className="w-full btn-ghost border border-bg-border text-sm py-2 flex items-center justify-center gap-1.5 disabled:opacity-40 text-emerald-400"
                            >
                              {(step === 'fee_claiming' || step === 'fee_claim_wait') && <Loader2 size={12} className="animate-spin" />}
                              {hasFeeRewards ? 'Claim Fee Rewards' : 'No fee rewards yet'}
                            </button>
                          ) : (
                            <div className="text-2xs text-text-muted text-center pt-1">Vote for this pool with your veNFT to earn fee rewards</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
            )}

            <div className="mt-4 pt-3 border-t border-bg-border flex items-center justify-between">
              <span className="text-2xs text-text-muted font-mono">{pool.address.slice(0,10)}…{pool.address.slice(-8)}</span>
              <a href={`https://snowtrace.io/address/${pool.address}`} target="_blank" rel="noreferrer" className="text-2xs text-aeon-400 hover:underline font-mono">Snowtrace ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Earn Stats Hook ──────────────────────────────────────────────────────────

function useEarnStats(wallet?: `0x${string}`) {
  const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`
  const { data: lpBalances } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({ address: p.address as `0x${string}`, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [wallet!] as [`0x${string}`] })),
    query: { enabled: !!wallet, refetchInterval: 30000 },
  })
  const { data: gaugeAddrs } = useReadContracts({
    contracts: UNIQUE_POOLS.map(p => ({ address: CONTRACTS.AeonGaugeFactory as `0x${string}`, abi: GAUGE_FACTORY_ABI, functionName: 'gaugeForPool' as const, args: [p.address as `0x${string}`] })),
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

// ─── Portfolio Tab ────────────────────────────────────────────────────────────

function PortfolioTab({ wallet, prices, lpByAddr, stakedByAddr }: {
  wallet?: `0x${string}`
  prices: PriceMap
  lpByAddr: Record<string, bigint>
  stakedByAddr: Record<string, bigint>
}) {
  const { data: avaxBal } = useBalance({ address: wallet, query: { enabled: !!wallet, refetchInterval: 15000 } })

  const tokenEntries = Object.entries(TOKENS).filter(([k]) => k !== 'AVAX')
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
    { key: 'AVAX', symbol: 'AVAX', name: 'Avalanche (Native)', decimals: 18,
      balance: avaxBal ? parseFloat(formatUnits(avaxBal.value, 18)) : null,
      price: prices['WAVAX'] ?? null },
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

  const totalTokenUsd = tokens.reduce((sum, t) => {
    if (t.balance && t.balance > 0.000001 && t.price) return sum + t.balance * t.price
    return sum
  }, 0)

  const hasTokens = tokens.some(t => t.balance && t.balance > 0.000001)

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="card p-6 bg-gradient-to-r from-aeon-400/5 to-transparent">
        <div className="flex items-center gap-3 mb-1">
          <BarChart3 size={18} className="text-aeon-400" />
          <span className="text-sm text-text-muted">Total Wallet Value (tokens)</span>
        </div>
        <div className="text-4xl font-display font-bold text-text-primary mb-1">{wallet ? fmtUsd(totalTokenUsd || null) : '$—'}</div>
        {lpPositions.length > 0 && (
          <div className="text-xs text-text-muted">+ {lpPositions.length} LP position{lpPositions.length !== 1 ? 's' : ''} (scroll down)</div>
        )}
      </div>

      {/* Tokens */}
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
                <div key={t.key} className="card px-4 py-3 flex items-center justify-between hover:border-bg-hover transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center font-bold">
                      {tokenIcon(t.symbol)}
                    </div>
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

      {/* LP Positions */}
      {wallet && lpPositions.length > 0 && (
        <div>
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">LP Positions</div>
          <div className="space-y-2">
            {lpPositions.map(({ pool, lpUnstaked, lpStaked }) => (
              <div key={pool.address} className="card px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <div className="w-9 h-9 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-sm font-bold z-10">{tokenIcon(pool.token0)}</div>
                    <div className="w-9 h-9 rounded-full bg-bg-raised border border-bg-border flex items-center justify-center text-sm font-bold">{tokenIcon(pool.token1)}</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-text-primary">{pool.name}</div>
                    <div className="flex gap-2 mt-0.5">
                      <span className={clsx('text-2xs font-mono font-bold', pool.type === 'vAMM' ? 'text-blue-400' : pool.type === 'CL' ? 'text-violet-400' : 'text-emerald-400')}>{pool.type}</span>
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
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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

  const aprByAddr: Record<string, number | null> = {}
  for (const pool of UNIQUE_POOLS) {
    const tvl = tvlByAddr[pool.address] ?? null
    const vol = volResult.byPool[pool.address.toLowerCase()] ?? null
    aprByAddr[pool.address] = (tvl && tvl > 0 && vol !== null)
      ? (vol * parseFeeRate(pool.fee) * 365 / tvl) * 100
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

      {/* Top-level tabs */}
      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-8 w-fit">
        {(['earn', 'portfolio'] as const).map(t => (
          <button key={t} onClick={() => setMainTab(t)}
            className={clsx(
              'flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all',
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
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'My Staked LP',     value: isConnected ? `${stats.fmtLP(stats.totalStaked)} LP`     : '—', sub: 'across all gauges' },
              { label: 'Unstaked LP',      value: isConnected ? `${stats.fmtLP(stats.totalLPUnstaked)} LP`  : '—', sub: 'not yet earning'   },
              { label: 'Claimable Emiss.', value: isConnected ? `${stats.fmtAEON(stats.totalEarned)} AEON`  : '—', sub: 'from staked LP'    },
              { label: 'Claimable Fees',   value: '— AEON',                                                         sub: 'from voted pools'  },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <div className="stat-label mb-1">{s.label}</div>
                <div className="stat-value text-xl mb-0.5">{s.value}</div>
                <div className="text-2xs text-text-muted">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Filter + claim all */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl">
              {(['all', 'my'] as const).map(t => (
                <button key={t} onClick={() => setFilterTab(t)}
                  className={clsx('px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all', filterTab === t ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
                  {t === 'all' ? 'All Pools' : 'My Positions'}
                </button>
              ))}
            </div>
            <button disabled className="btn-primary text-sm py-2 px-4 flex items-center gap-2 opacity-40">
              <Coins size={14} /> Claim All
            </button>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-12 gap-2 px-4 mb-2">
            {[['Pool','col-span-3'],['TVL','col-span-2 hidden md:block'],['APR','col-span-2'],['vAPR','col-span-2 hidden sm:block'],['My Stake','col-span-2'],['','col-span-1']].map(([h,cls]) => (
              <div key={h} className={clsx('text-2xs font-mono text-text-muted uppercase tracking-wider', cls)}>{h}</div>
            ))}
          </div>

          {filterTab === 'my' && isConnected && displayPools.length === 0 && (
            <div className="card p-8 text-center text-sm text-text-muted">
              No LP positions found. Expand any pool below and click <strong>Liquidity</strong> to add your first deposit.
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
        </>
      )}
    </div>
  )
}
