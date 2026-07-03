'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Minus, ChevronDown, Loader2, CheckCircle2, Lock, Layers, Waves, Grid3x3 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { POOLS, CL_POOLS, CL_RANGE_PRESETS, DLMM_CONTRACTS, DLMM_POOLS, TOKENS, CONTRACTS, ALGEBRA_CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { ERC20_ABI, LIQUIDITY_HELPER_ABI, PAIR_ABI, WHITELIST_ABI, ALGEBRA_POOL_ABI, ALGEBRA_POSITION_MANAGER_ABI, ALGEBRA_PM_ENUMERABLE_ABI, LB_PAIR_ABI, LB_ROUTER_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { TokenIcon } from '@/components/TokenIcon'
import { priceOffsetToTick, pairedAmount, rangeSide, liquidityForAmounts, tickToSqrtPriceX96, tickToPrice, priceToTick } from '@/lib/clMath'
import { binIdToPrice } from '@/lib/dlmmMath'

type PoolMode = 'vAMM' | 'CL' | 'DLMM'
type Tab = 'add' | 'remove'
type Step = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done' | 'approve_lp' | 'approve_lp_wait' | 'remove' | 'remove_wait' | 'remove_done'
type ClStep = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'mint' | 'mint_wait' | 'done'
type DlmmStep = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done'

const HELPER = CONTRACTS.LiquidityHelper
const PM = ALGEBRA_CONTRACTS.nonfungiblePositionManager
const MAX_UINT128 = 2n ** 128n - 1n
const DLMM_ROUTER = DLMM_CONTRACTS.router

function parseFeeRate(fee: string): number { return parseFloat(fee.replace('%', '')) / 100 }
function fmtApr(apr: number | null): string {
  if (apr === null || !isFinite(apr)) return '—%'
  if (apr >= 1000) return '>1000%'
  return apr.toFixed(2) + '%'
}
function fmtUsd(n: number | null): string {
  if (n === null || n <= 0 || !isFinite(n)) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function useTokenBal(tokenAddr: `0x${string}` | undefined, wallet: `0x${string}` | undefined) {
  const isNative = tokenAddr === NATIVE_SENTINEL
  const { data } = useBalance({
    address: wallet,
    token: isNative ? undefined : tokenAddr,
    query: { enabled: !!wallet && !!tokenAddr },
  })
  if (!wallet || !data) return { formatted: '—', decimals: 18, raw: 0n }
  return { formatted: parseFloat(formatUnits(data.value, data.decimals)).toFixed(4), decimals: data.decimals, raw: data.value }
}

function useAllowance(tokenAddr: `0x${string}` | undefined, owner: `0x${string}` | undefined, spender: `0x${string}`) {
  const { data } = useReadContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    query: { enabled: !!tokenAddr && !!owner },
  })
  return (data as bigint | undefined) ?? 0n
}

export default function LiquidityPage() {
  const [mode, setMode] = useState<PoolMode>('vAMM')

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {mode === 'vAMM' ? "Provide liquidity to AEON's vAMM pools" : mode === 'CL' ? 'Provide concentrated liquidity via Algebra Integral' : 'Provide bin-based liquidity via Liquidity Book (DLMM)'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => setMode('vAMM')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'vAMM' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Waves size={14} /> vAMM
        </button>
        <button onClick={() => setMode('CL')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'CL' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Layers size={14} /> Concentrated
        </button>
        <button onClick={() => setMode('DLMM')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'DLMM' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Grid3x3 size={14} /> DLMM
        </button>
      </div>

      {mode === 'vAMM' ? <VammLiquidity /> : mode === 'CL' ? <ClLiquidity /> : <DlmmLiquidity />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// vAMM — full-range constant-product pools
// ─────────────────────────────────────────────────────────────────────────

function VammLiquidity() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(POOLS[0])
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [removeAmount,   setRemoveAmount]   = useState(50)
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<Step>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const volResult = useVolume24h(prices)

  const token0Key  = selectedPool.token0 as keyof typeof TOKENS
  const token1Key  = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = TOKENS[token0Key].address
  const token1Addr = TOKENS[token1Key].address
  const token0Dec  = TOKENS[token0Key].decimals
  const token1Dec  = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)

  const { data: isWhitelistedRaw } = useReadContract({
    address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'isWhitelisted',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const isWhitelisted = !!isWhitelistedRaw

  // LP token balance for remove tab
  const { data: lpBalRaw, refetch: refetchLpBal } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const lpBal = (lpBalRaw as bigint | undefined) ?? 0n
  const lpBalFormatted = parseFloat(formatUnits(lpBal, 18)).toFixed(8)

  const { data: lpAllowanceRaw } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, HELPER] : undefined, query: { enabled: !!address },
  })
  const lpAllowance = (lpAllowanceRaw as bigint | undefined) ?? 0n

  const { data: totalSupplyRaw } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'totalSupply',
    query: { refetchInterval: 15000 },
  })
  const totalSupply = (totalSupplyRaw as bigint | undefined) ?? 0n

  const allowance0 = useAllowance(token0Addr, address, HELPER)
  const allowance1 = useAllowance(token1Addr, address, HELPER)

  const { data: reserves } = useReadContract({
    address: selectedPool.address, abi: PAIR_ABI, functionName: 'getReserves',
    query: { refetchInterval: 15000 },
  })
  const { data: poolToken0Addr } = useReadContract({
    address: selectedPool.address, abi: PAIR_ABI, functionName: 'token0',
  })

  const isToken0First = !poolToken0Addr || poolToken0Addr.toLowerCase() === token0Addr.toLowerCase()
  const [r0raw, r1raw] = (reserves as [bigint, bigint, number] | undefined) ?? [0n, 0n, 0]
  const reserve0 = isToken0First ? r0raw : r1raw
  const reserve1 = isToken0First ? r1raw : r0raw
  const hasLiquidity = reserve0 > 0n && reserve1 > 0n

  function calcPaired(inputWei: bigint, rIn: bigint, rOut: bigint, decOut: number): string {
    if (!hasLiquidity || rIn === 0n) return ''
    const out = inputWei * rOut / rIn
    const str = formatUnits(out, decOut)
    return parseFloat(parseFloat(str).toFixed(6)).toString()
  }

  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (!val || !hasLiquidity) return
    try {
      const wei = parseUnits(val, token0Dec)
      setAmount1(calcPaired(wei, reserve0, reserve1, token1Dec))
    } catch {}
  }
  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (!val || !hasLiquidity) return
    try {
      const wei = parseUnits(val, token1Dec)
      setAmount0(calcPaired(wei, reserve1, reserve0, token0Dec))
    } catch {}
  }

  useEffect(() => { setAmount0(''); setAmount1('') }, [selectedPool.address])

  const currentPrice = reserve0 > 0n && reserve1 > 0n
    ? parseFloat(formatUnits(reserve1, token1Dec)) / parseFloat(formatUnits(reserve0, token0Dec))
    : null

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait')    { setStep('approve1'); return }
    if (step === 'approve1_wait')    { setStep('addliq');   return }
    if (step === 'addliq_wait')      { setStep('done');      setAmount0(''); setAmount1(''); return }
    if (step === 'approve_lp_wait')  { setStep('remove');    return }
    if (step === 'remove_wait')      { setStep('remove_done'); refetchLpBal(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address || !token0Addr || !token1Addr) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'addliq') {
      writeContract({
        address: HELPER, abi: LIQUIDITY_HELPER_ABI, functionName: 'addLiquidity',
        args: [selectedPool.address, token0Addr, amount0Wei, token1Addr, amount1Wei, address],
      })
      setStep('addliq_wait')
    }
    if (step === 'approve_lp') {
      writeContract({ address: selectedPool.address, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, lpBal] })
      setStep('approve_lp_wait')
    }
    if (step === 'remove') {
      const lpToRemove = lpBal * BigInt(removeAmount) / 100n
      if (lpToRemove === 0n) { setStep('idle'); return }
      writeContract({ address: HELPER, abi: LIQUIDITY_HELPER_ABI, functionName: 'removeLiquidity', args: [selectedPool.address, lpToRemove, address!] })
      setStep('remove_wait')
    }
  }, [step])

  useEffect(() => {
    if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') }
  }, [writeError])

  function startAddLiquidity() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!amount0 || !amount1 || !isWhitelisted) return
    setStep('idle')
    setErrMsg('')
    if (needApprove0) { setStep('approve0'); return }
    if (needApprove1) { setStep('approve1'); return }
    setStep('addliq')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!isWhitelisted) return 'Join Whitelist to Add Liquidity'
    if (!amount0 && !amount1) return 'Enter amounts'
    if (!amount1) return `Enter ${selectedPool.token1} amount`
    if (!amount0) return `Enter ${selectedPool.token0} amount`
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'addliq'   || step === 'addliq_wait')  return 'Adding Liquidity…'
    if (step === 'done') return '✓ Liquidity Added!'
    if (needApprove0) return `1. Approve ${selectedPool.token0}`
    if (needApprove1) return `2. Approve ${selectedPool.token1}`
    return 'Add Liquidity'
  }

  function progressSteps() {
    const steps = [] as { label: string, done: boolean, active: boolean }[]
    if (needApprove0 || ['approve0', 'approve0_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token0}`, done: !needApprove0 || ['approve1', 'approve1_wait', 'addliq', 'addliq_wait', 'done'].includes(step), active: step === 'approve0' || step === 'approve0_wait' })
    if (needApprove1 || ['approve1', 'approve1_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token1}`, done: !needApprove1 || ['addliq', 'addliq_wait', 'done'].includes(step), active: step === 'approve1' || step === 'approve1_wait' })
    steps.push({ label: 'Add Liquidity', done: step === 'done', active: step === 'addliq' || step === 'addliq_wait' })
    return steps
  }

  const showProgress = isProcessing || step === 'done'

  // ── APR estimate ──
  const tvlUsd    = poolStats.find(s => s.address === selectedPool.address)?.tvlUsd ?? null
  const dayVolUsd = volResult.byPool[selectedPool.address.toLowerCase()] ?? null
  const baseApr   = (tvlUsd !== null && tvlUsd > 0 && dayVolUsd !== null)
    ? (dayVolUsd * parseFeeRate(selectedPool.fee) * 365 / tvlUsd) * 100
    : null
  const p0 = prices[selectedPool.token0] ?? null
  const p1 = prices[selectedPool.token1] ?? null
  const depositUsd = (p0 !== null && amount0 ? parseFloat(amount0 || '0') * p0 : 0) + (p1 !== null && amount1 ? parseFloat(amount1 || '0') * p1 : 0)
  const dilutedApr = baseApr !== null && tvlUsd !== null
    ? baseApr * tvlUsd / (tvlUsd + depositUsd)
    : baseApr
  const yearlyEarn = dilutedApr !== null && depositUsd > 0 ? depositUsd * dilutedApr / 100 : null

  return (
    <>
      {isConnected && !isWhitelisted && (
        <div className="card p-4 mb-4 border-violet-400/20 bg-violet-400/5 flex items-start gap-3">
          <Lock size={16} className="text-violet-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-text-primary mb-1">Whitelist required</div>
            <p className="text-xs text-text-muted leading-relaxed mb-2">
              Adding liquidity is gated by a one-time 100 AEON payment to the protocol. Once paid, your wallet can add liquidity forever.
            </p>
            <Link href="/whitelist" className="text-xs font-mono text-violet-400 hover:underline">Join Whitelist →</Link>
          </div>
        </div>
      )}

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      {/* Pool selector */}
      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {POOLS.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">{pool.fee}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && handleAmount0Change(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount0} onChange={e => handleAmount0Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && handleAmount1Change(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount1} onChange={e => handleAmount1Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
            {currentPrice && (
              <div className="text-2xs text-text-muted text-center font-mono">
                1 {selectedPool.token0} = {currentPrice < 0.001 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)} {selectedPool.token1}
              </div>
            )}
          </div>

          {!hasLiquidity && (
            <div className="p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20 text-xs text-aeon-400">
              New pool — no existing liquidity. Enter both token amounts manually to set your initial price ratio.
            </div>
          )}

          <div className="card p-4 space-y-2.5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Estimated Returns</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-muted">Current Pool APR</span>
              <span className="font-mono text-sm text-text-primary">{fmtApr(baseApr)}</span>
            </div>
            {depositUsd > 0 && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Your Est. APR <span className="text-2xs text-text-muted">(after deposit)</span></span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{fmtApr(dilutedApr)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-bg-border">
                  <span className="text-sm text-text-muted">Est. Yearly Earnings</span>
                  <span className="font-mono text-sm text-aeon-400">{fmtUsd(yearlyEarn)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Est. Daily Earnings</span>
                  <span className="font-mono text-xs text-text-secondary">{yearlyEarn !== null ? fmtUsd(yearlyEarn / 365) : '—'}</span>
                </div>
              </>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              Modeled from trailing swap volume × pool fee rate, diluted by your deposit's added share of pool TVL. Actual returns move with trading activity. Stake your LP in a gauge on the{' '}
              <Link href="/earn" className="text-aeon-400 hover:underline">Earn</Link> page for additional AEON emissions (vAPR) on top of this.
            </div>
          </div>

          {showProgress && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {progressSteps().map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {s.done
                      ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                      : s.active
                        ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />
                        : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />
                    }
                    <span className={clsx('text-sm', s.done ? 'text-emerald-400' : s.active ? 'text-aeon-400' : 'text-text-muted')}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          {amount0Wei > 0n && bal0.raw > 0n && amount0Wei > bal0.raw && (
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              ⚠ Insufficient {selectedPool.token0} balance. You have {bal0.formatted}.
            </div>
          )}
          {amount1Wei > 0n && bal1.raw > 0n && amount1Wei > bal1.raw && (
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              ⚠ Insufficient {selectedPool.token1} balance. You have {bal1.formatted}.
            </div>
          )}

          <button
            onClick={startAddLiquidity}
            disabled={isConnected && (isProcessing || !amount0 || !amount1 || !isWhitelisted)}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Remove Amount</div>
            <div className="text-center mb-4">
              <div className="text-5xl font-display font-bold text-text-primary mb-1">{removeAmount}%</div>
              <div className="text-sm text-text-muted">of your position</div>
            </div>
            <input type="range" min={0} max={100} value={removeAmount} onChange={e => setRemoveAmount(parseInt(e.target.value))} className="w-full accent-aeon-400 mb-3" />
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => setRemoveAmount(p)} className={clsx('flex-1 py-2 rounded-xl text-sm font-medium transition-all', removeAmount === p ? 'bg-aeon-400/15 text-aeon-400 border border-aeon-400/30' : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover')}>
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const lpToRemove = lpBal * BigInt(removeAmount) / 100n
            const recv0 = totalSupply > 0n ? lpToRemove * reserve0 / totalSupply : 0n
            const recv1 = totalSupply > 0n ? lpToRemove * reserve1 / totalSupply : 0n
            return (
              <div className="card p-4">
                <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You Receive</div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-text-muted">{selectedPool.token0}</span>
                    <span className="font-mono text-text-primary">{lpBal > 0n ? parseFloat(formatUnits(recv0, token0Dec)).toFixed(6) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-muted">{selectedPool.token1}</span>
                    <span className="font-mono text-text-primary">{lpBal > 0n ? parseFloat(formatUnits(recv1, token1Dec)).toFixed(6) : '—'}</span>
                  </div>
                </div>
                {isConnected && lpBal > 0n && (
                  <div className="mt-3 pt-3 border-t border-bg-border text-xs text-text-muted flex justify-between">
                    <span>LP Balance</span>
                    <span className="font-mono">{lpBalFormatted}</span>
                  </div>
                )}
              </div>
            )
          })()}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          {step === 'remove_done' && (
            <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 font-mono flex items-center gap-2">
              <CheckCircle2 size={14} /> Liquidity removed successfully!
            </div>
          )}

          <button
            onClick={() => {
              if (!isConnected) { openConnectModal?.(); return }
              if (lpBal === 0n) return
              setErrMsg('')
              if (lpAllowance < lpBal * BigInt(removeAmount) / 100n) {
                setStep('approve_lp')
              } else {
                setStep('remove')
              }
            }}
            disabled={isConnected && (lpBal === 0n || ['approve_lp', 'approve_lp_wait', 'remove', 'remove_wait'].includes(step))}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Minus size={16} />
            {!isConnected ? 'Connect Wallet'
              : lpBal === 0n ? 'No LP Balance'
              : step === 'approve_lp' || step === 'approve_lp_wait' ? 'Approving LP…'
              : step === 'remove' || step === 'remove_wait' ? 'Removing…'
              : 'Remove Liquidity'}
          </button>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// CL — Algebra Integral concentrated liquidity
// ─────────────────────────────────────────────────────────────────────────

function useClPositions(owner: `0x${string}` | undefined) {
  const MAX_SLOTS = 15
  const { data: balData } = useReadContract({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'balanceOf',
    args: owner ? [owner] : undefined, query: { enabled: !!owner, refetchInterval: 20000 },
  })
  const balance = Math.min(Number((balData as bigint | undefined) ?? 0n), MAX_SLOTS)

  const idxContracts = Array.from({ length: MAX_SLOTS }, (_, i) => ({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'tokenOfOwnerByIndex' as const,
    args: owner ? [owner, BigInt(i)] as const : undefined,
  }))
  const { data: tokenIdData } = useReadContracts({ contracts: idxContracts, query: { enabled: !!owner && balance > 0 } })
  const tokenIds = (tokenIdData ?? []).slice(0, balance).filter(r => r.status === 'success').map(r => r.result as bigint)

  const posContracts = tokenIds.map(id => ({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'positions' as const, args: [id] as const,
  }))
  const { data: posData, refetch } = useReadContracts({ contracts: posContracts, query: { enabled: tokenIds.length > 0, refetchInterval: 20000 } })

  const positions = tokenIds.map((id, i) => {
    const r = posData?.[i]
    if (!r || r.status !== 'success') return null
    const result = r.result as readonly [bigint, string, string, string, string, number, number, bigint, bigint, bigint, bigint, bigint]
    const [, , token0, token1, , tickLower, tickUpper, liquidity] = result
    return { tokenId: id, token0, token1, tickLower, tickUpper, liquidity }
  }).filter((p): p is NonNullable<typeof p> => p !== null && p.liquidity > 0n)

  return { positions, refetch }
}

function PositionCard({ pos, onDone }: { pos: { tokenId: bigint, token0: string, token1: string, tickLower: number, tickUpper: number, liquidity: bigint }, onDone: () => void }) {
  const { address } = useAccount()
  const [step, setStep] = useState<'idle' | 'decrease' | 'decrease_wait' | 'collect' | 'collect_wait' | 'done'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'decrease_wait') { setStep('collect'); return }
    if (step === 'collect_wait')  { setStep('done'); onDone(); return }
  }, [txSuccess])

  useEffect(() => {
    setErrMsg('')
    if (step === 'decrease') {
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'decreaseLiquidity',
        args: [{ tokenId: pos.tokenId, liquidity: pos.liquidity, amount0Min: 0n, amount1Min: 0n, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200) }],
      })
      setStep('decrease_wait')
    }
    if (step === 'collect') {
      if (!address) { setStep('idle'); return }
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'collect',
        args: [{ tokenId: pos.tokenId, recipient: address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      })
      setStep('collect_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  const sym0 = Object.values(TOKENS).find(t => t.address.toLowerCase() === pos.token0.toLowerCase())?.symbol ?? '?'
  const sym1 = Object.values(TOKENS).find(t => t.address.toLowerCase() === pos.token1.toLowerCase())?.symbol ?? '?'
  const busy = step !== 'idle' && step !== 'done'

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-text-secondary">#{pos.tokenId.toString()}</span>
        <span className="text-text-muted font-mono">liquidity {pos.liquidity.toString()}</span>
      </div>
      <div className="text-2xs text-text-muted font-mono">ticks [{pos.tickLower}, {pos.tickUpper}] · {sym0}/{sym1}</div>
      {step === 'done' ? (
        <div className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={13} /> Closed — tokens returned to your wallet</div>
      ) : (
        <button
          disabled={busy}
          onClick={() => { setStep('decrease') }}
          className="btn-ghost w-full text-xs py-2 border border-bg-border flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {step === 'decrease' || step === 'decrease_wait' ? 'Removing liquidity…' : step === 'collect' || step === 'collect_wait' ? 'Collecting tokens…' : 'Remove & Collect (100%)'}
        </button>
      )}
      {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
    </div>
  )
}

function ClLiquidity() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(CL_POOLS[0])
  const [rangeKey,       setRangeKey]       = useState<string>(CL_RANGE_PRESETS[1].key)
  const [customMin,      setCustomMin]      = useState('')
  const [customMax,      setCustomMax]      = useState('')
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<ClStep>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const isCustomRange = rangeKey === 'custom'
  const preset = CL_RANGE_PRESETS.find(p => p.key === rangeKey)

  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const volResult = useVolume24h(prices)

  const { data: isWhitelistedRaw } = useReadContract({
    address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'isWhitelisted',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const isWhitelisted = !!isWhitelistedRaw

  const token0Key  = selectedPool.token0 as keyof typeof TOKENS
  const token1Key  = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = TOKENS[token0Key].address
  const token1Addr = TOKENS[token1Key].address
  const token0Dec  = TOKENS[token0Key].decimals
  const token1Dec  = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)
  const allowance0 = useAllowance(token0Addr, address, PM)
  const allowance1 = useAllowance(token1Addr, address, PM)

  const { data: poolData } = useReadContracts({
    contracts: [
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'globalState' },
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'tickSpacing' },
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'liquidity' },
      { address: selectedPool.address, abi: PAIR_ABI, functionName: 'token0' },
    ],
    query: { refetchInterval: 15000 },
  })
  const globalState  = poolData?.[0]?.status === 'success' ? poolData[0].result as readonly [bigint, number, number, number, number, boolean] : undefined
  const tickSpacing  = poolData?.[1]?.status === 'success' ? poolData[1].result as number : 60
  const poolLiquidity = poolData?.[2]?.status === 'success' ? poolData[2].result as bigint : 0n
  const onChainToken0 = poolData?.[3]?.status === 'success' ? poolData[3].result as string : undefined

  const sqrtPriceX96 = globalState?.[0] ?? 0n
  const currentTick  = globalState?.[1] ?? 0
  const poolInitialized = sqrtPriceX96 > 0n

  const isDisp0First = !onChainToken0 || onChainToken0.toLowerCase() === token0Addr.toLowerCase()

  // display price = display-token1 per 1 display-token0 — what the custom
  // min/max inputs are expressed in, and what "Current Price" below shows.
  const displayCurrentPrice = poolInitialized
    ? (isDisp0First ? tickToPrice(currentTick, token0Dec, token1Dec) : 1 / tickToPrice(currentTick, token1Dec, token0Dec))
    : null

  // Converts a display-terms price into an on-chain tick, accounting for the
  // possible token0/token1 flip between display order and on-chain order.
  function displayPriceToTick(price: number, roundUp: boolean): number {
    return isDisp0First
      ? priceToTick(price, token0Dec, token1Dec, tickSpacing, roundUp)
      : priceToTick(1 / price, token1Dec, token0Dec, tickSpacing, !roundUp)
  }

  let tickLower: number | undefined
  let tickUpper: number | undefined
  if (poolInitialized) {
    if (isCustomRange) {
      const minP = parseFloat(customMin)
      const maxP = parseFloat(customMax)
      if (minP > 0 && maxP > 0) {
        const tA = displayPriceToTick(minP, false)
        const tB = displayPriceToTick(maxP, true)
        tickLower = Math.min(tA, tB)
        tickUpper = Math.max(tA, tB)
      }
    } else if (preset) {
      tickLower = priceOffsetToTick(currentTick, preset.pctLow, tickSpacing, false)
      tickUpper = priceOffsetToTick(currentTick, preset.pctHigh, tickSpacing, true)
    }
  }

  const side = (tickLower !== undefined && tickUpper !== undefined) ? rangeSide(tickLower, currentTick, tickUpper) : 'both'
  const displaySide: 'display0' | 'display1' | 'both' =
    side === 'both' ? 'both' :
    (side === 'token0') === isDisp0First ? 'display0' : 'display1'

  useEffect(() => { setAmount0(''); setAmount1(''); setErrMsg('') }, [selectedPool.address, rangeKey, customMin, customMax])
  useEffect(() => { setCustomMin(''); setCustomMax('') }, [selectedPool.address])

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }

  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (displaySide === 'display1') return
    if (!val || tickLower === undefined || tickUpper === undefined || displaySide !== 'both') { if (displaySide === 'display0') setAmount1('0'); return }
    try {
      const wei = parseUnits(val, token0Dec)
      const paired = pairedAmount({ amountIn: wei, isAmount0: isDisp0First, tickLower, tickUpper, currentTick, sqrtPriceX96 })
      setAmount1(parseFloat(formatUnits(paired, token1Dec)).toFixed(8))
    } catch {}
  }
  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (displaySide === 'display0') return
    if (!val || tickLower === undefined || tickUpper === undefined || displaySide !== 'both') { if (displaySide === 'display1') setAmount0('0'); return }
    try {
      const wei = parseUnits(val, token1Dec)
      const paired = pairedAmount({ amountIn: wei, isAmount0: !isDisp0First, tickLower, tickUpper, currentTick, sqrtPriceX96 })
      setAmount0(parseFloat(formatUnits(paired, token0Dec)).toFixed(8))
    } catch {}
  }

  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  // on-chain-ordered amounts for the mint() call itself
  const mintToken0 = isDisp0First ? token0Addr : token1Addr
  const mintToken1 = isDisp0First ? token1Addr : token0Addr
  const mintAmount0Wei = isDisp0First ? amount0Wei : amount1Wei
  const mintAmount1Wei = isDisp0First ? amount1Wei : amount0Wei

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait') { setStep('approve1'); return }
    if (step === 'approve1_wait') { setStep('mint');      return }
    if (step === 'mint_wait')     { setStep('done'); setAmount0(''); setAmount1(''); refetchPositions(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [PM, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [PM, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'mint') {
      if (tickLower === undefined || tickUpper === undefined) { setStep('idle'); return }
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'mint',
        args: [{
          token0: mintToken0, token1: mintToken1,
          deployer: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          tickLower, tickUpper,
          amount0Desired: mintAmount0Wei, amount1Desired: mintAmount1Wei,
          amount0Min: (mintAmount0Wei * 98n) / 100n, amount1Min: (mintAmount1Wei * 98n) / 100n,
          recipient: address, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      })
      setStep('mint_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  function startMint() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!isWhitelisted) return
    if (mintAmount0Wei === 0n && mintAmount1Wei === 0n) return
    setErrMsg('')
    if (needApprove0 && mintAmount0Wei > 0n) { setStep('approve0'); return }
    if (needApprove1 && mintAmount1Wei > 0n) { setStep('approve1'); return }
    setStep('mint')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'mint', 'mint_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!isWhitelisted) return 'Join Whitelist to Add Liquidity'
    if (!poolInitialized) return 'Pool not initialized'
    if (mintAmount0Wei === 0n && mintAmount1Wei === 0n) return 'Enter an amount'
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'mint' || step === 'mint_wait') return 'Minting Position…'
    if (step === 'done') return '✓ Position Minted!'
    if (needApprove0 && mintAmount0Wei > 0n) return `1. Approve ${selectedPool.token0}`
    if (needApprove1 && mintAmount1Wei > 0n) return `2. Approve ${selectedPool.token1}`
    return 'Add Concentrated Liquidity'
  }

  // ── APR estimate — modeled off the paired vAMM pool's trading volume ──
  const sisterVamm = POOLS.find(p => p.name === selectedPool.name)
  const sisterVol   = sisterVamm ? volResult.byPool[sisterVamm.address.toLowerCase()] ?? null : null
  const clFeeRate    = parseFeeRate(selectedPool.fee)
  const estDailyFeesUsd = sisterVol !== null ? sisterVol * clFeeRate : null

  const yourL = (tickLower !== undefined && tickUpper !== undefined && poolInitialized)
    ? liquidityForAmounts(sqrtPriceX96, tickLower, tickUpper, mintAmount0Wei, mintAmount1Wei)
    : 0n
  const totalL = yourL + poolLiquidity
  const yourShare = totalL > 0n ? Number(yourL) / Number(totalL) : 0

  const p0 = prices[selectedPool.token0] ?? null
  const p1 = prices[selectedPool.token1] ?? null
  const depositUsd = (p0 !== null ? parseFloat(amount0 || '0') * p0 : 0) + (p1 !== null ? parseFloat(amount1 || '0') * p1 : 0)
  const yourYearlyFeesUsd = estDailyFeesUsd !== null ? estDailyFeesUsd * 365 * yourShare : null
  const clApr = yourYearlyFeesUsd !== null && depositUsd > 0 ? (yourYearlyFeesUsd / depositUsd) * 100 : null

  const { positions, refetch: refetchPositions } = useClPositions(isConnected ? address : undefined)
  const poolPositions = positions.filter(p =>
    (p.token0.toLowerCase() === token0Addr.toLowerCase() && p.token1.toLowerCase() === token1Addr.toLowerCase()) ||
    (p.token0.toLowerCase() === token1Addr.toLowerCase() && p.token1.toLowerCase() === token0Addr.toLowerCase())
  )

  return (
    <>
      {isConnected && !isWhitelisted && (
        <div className="card p-4 mb-4 border-violet-400/20 bg-violet-400/5 flex items-start gap-3">
          <Lock size={16} className="text-violet-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-text-primary mb-1">Whitelist required</div>
            <p className="text-xs text-text-muted leading-relaxed mb-2">
              Adding liquidity is gated by a one-time 100 AEON payment to the protocol. Once paid, your wallet can add liquidity forever.
            </p>
            <Link href="/whitelist" className="text-xs font-mono text-violet-400 hover:underline">Join Whitelist →</Link>
          </div>
        </div>
      )}

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {CL_POOLS.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">{pool.fee}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Price Range</div>
            {displayCurrentPrice !== null && (
              <div className="text-2xs text-text-muted text-center font-mono">
                Current Price: 1 {selectedPool.token0} = {displayCurrentPrice < 0.001 ? displayCurrentPrice.toExponential(2) : displayCurrentPrice.toFixed(6)} {selectedPool.token1}
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              {CL_RANGE_PRESETS.map(p => (
                <button key={p.key} onClick={() => setRangeKey(p.key)} className={clsx('py-2.5 rounded-xl text-center transition-all border', rangeKey === p.key ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className="text-2xs font-mono mt-0.5">{p.desc}</div>
                </button>
              ))}
              <button onClick={() => setRangeKey('custom')} className={clsx('py-2.5 rounded-xl text-center transition-all border', isCustomRange ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                <div className="text-xs font-semibold">Custom</div>
                <div className="text-2xs font-mono mt-0.5">min/max</div>
              </button>
            </div>

            {isCustomRange && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Min Price ({selectedPool.token1} per {selectedPool.token0})</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={customMin} onChange={e => setCustomMin(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2 font-mono" />
                    {displayCurrentPrice !== null && (
                      <button onClick={() => setCustomMin((displayCurrentPrice * 0.9).toPrecision(6))} className="text-2xs text-aeon-400 font-mono hover:underline shrink-0">-10%</button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Max Price ({selectedPool.token1} per {selectedPool.token0})</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={customMax} onChange={e => setCustomMax(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2 font-mono" />
                    {displayCurrentPrice !== null && (
                      <button onClick={() => setCustomMax((displayCurrentPrice * 1.1).toPrecision(6))} className="text-2xs text-aeon-400 font-mono hover:underline shrink-0">+10%</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tickLower !== undefined && tickUpper !== undefined ? (
              <div className="text-2xs text-text-muted text-center font-mono">tick range [{tickLower}, {tickUpper}] · current tick {currentTick}</div>
            ) : isCustomRange && poolInitialized ? (
              <div className="text-2xs text-text-muted text-center">Enter both a min and max price to set your range</div>
            ) : null}
            {displaySide !== 'both' && poolInitialized && (
              <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-2xs text-yellow-400">
                This range is entirely {displaySide === 'display0' ? selectedPool.token0 : selectedPool.token1} at the current price — only one side is needed. You won't earn fees until the price moves into range.
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', displaySide === 'display1' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && handleAmount0Change(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={displaySide === 'display1'} type="number" value={amount0} onChange={e => handleAmount0Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', displaySide === 'display0' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && handleAmount1Change(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={displaySide === 'display0'} type="number" value={amount1} onChange={e => handleAmount1Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-2.5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Estimated Returns</div>
            {displaySide !== 'both' ? (
              <div className="text-xs text-text-muted">Range doesn't include the current price — no fee estimate until it does.</div>
            ) : depositUsd > 0 ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Your Est. APR <span className="text-2xs text-text-muted">(while in range)</span></span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{fmtApr(clApr)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-bg-border">
                  <span className="text-sm text-text-muted">Est. Yearly Earnings</span>
                  <span className="font-mono text-sm text-aeon-400">{fmtUsd(yourYearlyFeesUsd)}</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted">Enter an amount to estimate your yearly earnings.</div>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              {sisterVamm
                ? `Estimated from the paired vAMM ${selectedPool.name} pool's trailing volume at this pool's ${selectedPool.fee} fee tier, scaled by your share of in-range liquidity. This CL pool is brand new — the real rate will depend on actual trading activity here once it builds up.`
                : `This pool has no vAMM equivalent to estimate volume from yet, so no APR estimate is shown until this CL pool builds up its own trading history.`}
            </div>
          </div>

          {isProcessing && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {(needApprove0 && mintAmount0Wei > 0n) && (
                  <div className="flex items-center gap-3">
                    {['approve1', 'approve1_wait', 'mint', 'mint_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token0}</span>
                  </div>
                )}
                {(needApprove1 && mintAmount1Wei > 0n) && (
                  <div className="flex items-center gap-3">
                    {['mint', 'mint_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : (step === 'approve1' || step === 'approve1_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token1}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {(step === 'mint' || step === 'mint_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                  <span className="text-sm text-text-muted">Mint Position</span>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          <button
            onClick={startMint}
            disabled={isConnected && (isProcessing || (mintAmount0Wei === 0n && mintAmount1Wei === 0n) || !isWhitelisted)}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!isConnected ? (
            <div className="card p-8 text-center text-sm text-text-muted">Connect your wallet to view positions</div>
          ) : poolPositions.length === 0 ? (
            <div className="card p-8 text-center text-sm text-text-muted">No open {selectedPool.name} CL positions found in this wallet.</div>
          ) : (
            poolPositions.map(pos => <PositionCard key={pos.tokenId.toString()} pos={pos} onDone={refetchPositions} />)
          )}
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// DLMM — Trader Joe / LFJ Liquidity Book (joe-v2)
// ─────────────────────────────────────────────────────────────────────────

// The exact symmetric 3-bin "spot" shape used to seed these pools at launch:
// bin-1 gets Y only, the active bin gets both, bin+1 gets X only.
const DLMM_DELTA_IDS = [-1, 0, 1] as const
const DLMM_DIST_X = [0n, 500000000000000000n, 500000000000000000n] as const
const DLMM_DIST_Y = [500000000000000000n, 500000000000000000n, 0n] as const
const DLMM_BIN_SCAN_RADIUS = 20

function useDlmmPositions(pool: typeof DLMM_POOLS[number], owner: `0x${string}` | undefined, activeId: number | undefined) {
  const ids = activeId !== undefined
    ? Array.from({ length: DLMM_BIN_SCAN_RADIUS * 2 + 1 }, (_, i) => activeId - DLMM_BIN_SCAN_RADIUS + i)
    : []

  const { data, refetch } = useReadContracts({
    contracts: ids.map(id => ({
      address: pool.address, abi: LB_PAIR_ABI, functionName: 'balanceOf' as const,
      args: owner ? [owner, BigInt(id)] as const : undefined,
    })),
    query: { enabled: !!owner && ids.length > 0, refetchInterval: 20000 },
  })

  const positions = ids
    .map((id, i) => {
      const r = data?.[i]
      const bal = r?.status === 'success' ? r.result as bigint : 0n
      return bal > 0n ? { id, balance: bal } : null
    })
    .filter((p): p is { id: number, balance: bigint } => p !== null)

  return { positions, refetch }
}

function DlmmPositionCard({ pool, pos, owner, onDone }: { pool: typeof DLMM_POOLS[number], pos: { id: number, balance: bigint }, owner: `0x${string}`, onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'approve' | 'approve_wait' | 'remove' | 'remove_wait' | 'done'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const token0Addr = TOKENS[pool.token0 as keyof typeof TOKENS].address
  const token1Addr = TOKENS[pool.token1 as keyof typeof TOKENS].address

  const { data: isApproved } = useReadContract({
    address: pool.address, abi: LB_PAIR_ABI, functionName: 'isApprovedForAll',
    args: [owner, DLMM_ROUTER], query: { enabled: !!owner },
  })

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve_wait') { setStep('remove'); return }
    if (step === 'remove_wait')  { setStep('done'); onDone(); return }
  }, [txSuccess])

  useEffect(() => {
    setErrMsg('')
    if (step === 'approve') {
      writeContract({ address: pool.address, abi: LB_PAIR_ABI, functionName: 'approveForAll', args: [DLMM_ROUTER, true] })
      setStep('approve_wait')
    }
    if (step === 'remove') {
      writeContract({
        address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'removeLiquidity',
        args: [token0Addr, token1Addr, pool.binStep, 0n, 0n, [BigInt(pos.id)], [pos.balance], owner, BigInt(Math.floor(Date.now() / 1000) + 1200)],
      })
      setStep('remove_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  const busy = step !== 'idle' && step !== 'done'

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-text-secondary">bin #{pos.id}</span>
        <span className="text-text-muted font-mono">shares {pos.balance.toString()}</span>
      </div>
      {step === 'done' ? (
        <div className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={13} /> Removed — tokens returned to your wallet</div>
      ) : (
        <button
          disabled={busy}
          onClick={() => setStep(isApproved ? 'remove' : 'approve')}
          className="btn-ghost w-full text-xs py-2 border border-bg-border flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {step === 'approve' || step === 'approve_wait' ? 'Approving…' : step === 'remove' || step === 'remove_wait' ? 'Removing…' : 'Remove Liquidity'}
        </button>
      )}
      {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
    </div>
  )
}

function DlmmLiquidity() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(DLMM_POOLS[0])
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<DlmmStep>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const { data: isWhitelistedRaw } = useReadContract({
    address: CONTRACTS.Whitelist, abi: WHITELIST_ABI, functionName: 'isWhitelisted',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const isWhitelisted = !!isWhitelistedRaw

  const token0Key = selectedPool.token0 as keyof typeof TOKENS
  const token1Key = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = TOKENS[token0Key].address
  const token1Addr = TOKENS[token1Key].address
  const token0Dec = TOKENS[token0Key].decimals
  const token1Dec = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)
  const allowance0 = useAllowance(token0Addr, address, DLMM_ROUTER)
  const allowance1 = useAllowance(token1Addr, address, DLMM_ROUTER)

  const { data: poolData } = useReadContracts({
    contracts: [
      { address: selectedPool.address, abi: LB_PAIR_ABI, functionName: 'getActiveId' },
      { address: selectedPool.address, abi: LB_PAIR_ABI, functionName: 'getReserves' },
    ],
    query: { refetchInterval: 15000 },
  })
  const activeId = poolData?.[0]?.status === 'success' ? Number(poolData[0].result) : undefined
  const reserves = poolData?.[1]?.status === 'success' ? poolData[1].result as readonly [bigint, bigint] : undefined
  const hasLiquidity = !!reserves && (reserves[0] > 0n || reserves[1] > 0n)

  const currentPrice = activeId !== undefined ? binIdToPrice(activeId, selectedPool.binStep, token0Dec, token1Dec) : null

  useEffect(() => { setAmount0(''); setAmount1(''); setErrMsg('') }, [selectedPool.address])

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait') { setStep('approve1'); return }
    if (step === 'approve1_wait') { setStep('addliq');   return }
    if (step === 'addliq_wait')   { setStep('done'); setAmount0(''); setAmount1(''); refetchPositions(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address || activeId === undefined) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [DLMM_ROUTER, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [DLMM_ROUTER, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'addliq') {
      writeContract({
        address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'addLiquidity',
        args: [{
          tokenX: token0Addr, tokenY: token1Addr, binStep: BigInt(selectedPool.binStep),
          amountX: amount0Wei, amountY: amount1Wei,
          amountXMin: 0n, amountYMin: 0n,
          activeIdDesired: BigInt(activeId), idSlippage: 5n,
          deltaIds: DLMM_DELTA_IDS.map(BigInt),
          distributionX: [...DLMM_DIST_X], distributionY: [...DLMM_DIST_Y],
          to: address, refundTo: address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      })
      setStep('addliq_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  function startAdd() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!isWhitelisted || (amount0Wei === 0n && amount1Wei === 0n)) return
    setErrMsg('')
    if (needApprove0) { setStep('approve0'); return }
    if (needApprove1) { setStep('approve1'); return }
    setStep('addliq')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!isWhitelisted) return 'Join Whitelist to Add Liquidity'
    if (amount0Wei === 0n && amount1Wei === 0n) return 'Enter amounts'
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'addliq' || step === 'addliq_wait') return 'Adding Liquidity…'
    if (step === 'done') return '✓ Liquidity Added!'
    if (needApprove0) return `1. Approve ${selectedPool.token0}`
    if (needApprove1) return `2. Approve ${selectedPool.token1}`
    return 'Add Liquidity'
  }

  const { positions, refetch: refetchPositions } = useDlmmPositions(selectedPool, isConnected ? address : undefined, activeId)

  return (
    <>
      {isConnected && !isWhitelisted && (
        <div className="card p-4 mb-4 border-violet-400/20 bg-violet-400/5 flex items-start gap-3">
          <Lock size={16} className="text-violet-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-medium text-text-primary mb-1">Whitelist required</div>
            <p className="text-xs text-text-muted leading-relaxed mb-2">
              Adding liquidity is gated by a one-time 100 AEON payment to the protocol. Once paid, your wallet can add liquidity forever.
            </p>
            <Link href="/whitelist" className="text-xs font-mono text-violet-400 hover:underline">Join Whitelist →</Link>
          </div>
        </div>
      )}

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">DLMM · bin step {selectedPool.binStep}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {DLMM_POOLS.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">bin step {pool.binStep}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && setAmount0(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount0} onChange={e => setAmount0(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && setAmount1(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount1} onChange={e => setAmount1(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
            {currentPrice !== null && (
              <div className="text-2xs text-text-muted text-center font-mono">
                Current Price: 1 {selectedPool.token0} = {currentPrice < 0.001 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)} {selectedPool.token1} · active bin #{activeId}
              </div>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              Deposits spread across 3 bins around the current price (below = {selectedPool.token1} only, current = both, above = {selectedPool.token0} only) — the same shape this pool was seeded with. Amounts don't need to match a fixed ratio; unused tokens are refunded.
            </div>
          </div>

          {!hasLiquidity && (
            <div className="p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20 text-xs text-aeon-400">
              New pool — no existing liquidity. Enter both token amounts manually.
            </div>
          )}

          {isProcessing && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {needApprove0 && (
                  <div className="flex items-center gap-3">
                    {['approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token0}</span>
                  </div>
                )}
                {needApprove1 && (
                  <div className="flex items-center gap-3">
                    {['addliq', 'addliq_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : (step === 'approve1' || step === 'approve1_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token1}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {(step === 'addliq' || step === 'addliq_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                  <span className="text-sm text-text-muted">Add Liquidity</span>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          <button
            onClick={startAdd}
            disabled={isConnected && (isProcessing || (amount0Wei === 0n && amount1Wei === 0n) || !isWhitelisted)}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {!isConnected ? (
            <div className="card p-8 text-center text-sm text-text-muted">Connect your wallet to view positions</div>
          ) : positions.length === 0 ? (
            <div className="card p-8 text-center text-sm text-text-muted">No open {selectedPool.name} DLMM positions found in this wallet.</div>
          ) : (
            positions.map(pos => <DlmmPositionCard key={pos.id} pool={selectedPool} pos={pos} owner={address!} onDone={refetchPositions} />)
          )}
        </div>
      )}
    </>
  )
}
