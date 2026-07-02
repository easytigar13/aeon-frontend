'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Minus, ChevronDown, Loader2, CheckCircle2, Lock } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, TOKENS, CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { ERC20_ABI, LIQUIDITY_HELPER_ABI, PAIR_ABI, WHITELIST_ABI } from '@/config/abis'
import { TokenIcon } from '@/components/TokenIcon'

// vAMM only — CL pools for the same pairs are planned as a follow-up.
type Tab = 'add' | 'remove'
type Step = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done' | 'approve_lp' | 'approve_lp_wait' | 'remove' | 'remove_wait' | 'remove_done'

const HELPER = CONTRACTS.LiquidityHelper

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

function useAllowance(tokenAddr: `0x${string}` | undefined, owner: `0x${string}` | undefined) {
  const { data } = useReadContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner ? [owner, HELPER] : undefined,
    query: { enabled: !!tokenAddr && !!owner },
  })
  return (data as bigint | undefined) ?? 0n
}

export default function LiquidityPage() {
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

  const allowance0 = useAllowance(token0Addr, address)
  const allowance1 = useAllowance(token1Addr, address)

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

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity</h1>
          <p className="text-sm text-text-muted mt-0.5">Provide liquidity to AEON's vAMM pools</p>
        </div>
      </div>

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
    </div>
  )
}
