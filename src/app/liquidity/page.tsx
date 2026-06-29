'use client'
import { useState, useEffect } from 'react'
import { Plus, Minus, ChevronDown, Loader2, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, TOKENS, CONTRACTS } from '@/config/contracts'
import { ERC20_ABI, LIQUIDITY_HELPER_ABI, PAIR_ABI } from '@/config/abis'

type Tab = 'add' | 'remove'
type PoolType = 'vAMM' | 'CL' | 'DLMM'
type Step = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done' | 'remove' | 'remove_wait' | 'remove_done'

const HELPER = CONTRACTS.LiquidityHelper
const MAX_UINT = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

function useTokenBal(tokenAddr: `0x${string}` | undefined, wallet: `0x${string}` | undefined) {
  const isNative = tokenAddr === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
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
    query: { enabled: !!tokenAddr && !!owner && HELPER !== '0x0000000000000000000000000000000000000000' },
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
  const [poolType,       setPoolType]       = useState<PoolType>('vAMM')
  const [selectedPool,   setSelectedPool]   = useState(POOLS[0])
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [numBins,        setNumBins]        = useState(200)
  const [removeAmount,   setRemoveAmount]   = useState(50)
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<Step>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const filteredPools = POOLS.filter(p => p.type === poolType)

  // Use pool config key directly (not symbol — they can differ e.g. SPX vs SPX6900)
  const token0Key  = selectedPool.token0 in TOKENS ? selectedPool.token0 as keyof typeof TOKENS : undefined
  const token1Key  = selectedPool.token1 in TOKENS ? selectedPool.token1 as keyof typeof TOKENS : undefined
  const token0Addr = token0Key ? TOKENS[token0Key].address : undefined
  const token1Addr = token1Key ? TOKENS[token1Key].address : undefined
  const token0Dec  = token0Key ? TOKENS[token0Key].decimals : 18
  const token1Dec  = token1Key ? TOKENS[token1Key].decimals : 18

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)

  const allowance0 = useAllowance(token0Addr, address)
  const allowance1 = useAllowance(token1Addr, address)

  // Read pool reserves + actual on-chain token addresses
  const { data: reserves } = useReadContract({
    address: selectedPool.address,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { refetchInterval: 15000 },
  })
  const { data: poolToken0Addr } = useReadContract({
    address: selectedPool.address,
    abi: PAIR_ABI,
    functionName: 'token0',
  })
  const { data: poolToken1Addr } = useReadContract({
    address: selectedPool.address,
    abi: PAIR_ABI,
    functionName: 'token1',
  })

  // Detect if configured token addresses match what the pool actually holds on-chain
  const poolT0 = poolToken0Addr?.toLowerCase() ?? ''
  const poolT1 = poolToken1Addr?.toLowerCase() ?? ''
  const cfgA0  = token0Addr?.toLowerCase() ?? ''
  const cfgA1  = token1Addr?.toLowerCase() ?? ''

  const poolAddrsLoaded  = !!poolToken0Addr && !!poolToken1Addr && !!token0Addr && !!token1Addr
  const cfgMatchesDirect  = poolT0 === cfgA0 && poolT1 === cfgA1
  const cfgMatchesFlipped = poolT0 === cfgA1  && poolT1 === cfgA0
  const tokenMismatch     = poolAddrsLoaded && !cfgMatchesDirect && !cfgMatchesFlipped

  // Always use pool's actual on-chain addresses for the addLiquidity call
  const actualToken0Addr  = (poolToken0Addr ?? token0Addr) as `0x${string}` | undefined
  const actualToken1Addr  = (poolToken1Addr ?? token1Addr) as `0x${string}` | undefined
  // (actualAmountXWei are computed below after amount0Wei/amount1Wei are declared)

  // Determine which reserve maps to token0/token1 in our display order
  const isToken0First = !poolToken0Addr || !token0Addr ||
    poolToken0Addr.toLowerCase() === token0Addr.toLowerCase()
  const reserve0 = reserves ? (isToken0First ? reserves[0] : reserves[1]) : 0n
  const reserve1 = reserves ? (isToken0First ? reserves[1] : reserves[0]) : 0n
  const hasLiquidity = reserve0 > 0n && reserve1 > 0n

  // Auto-calculate paired amount from reserves ratio
  function calcPaired(inputWei: bigint, rIn: bigint, rOut: bigint, decOut: number): string {
    if (!hasLiquidity || rIn === 0n) return ''
    const out = inputWei * rOut / rIn
    const str = formatUnits(out, decOut)
    // trim trailing zeros but keep up to 6 decimals
    return parseFloat(parseFloat(str).toFixed(6)).toString()
  }

  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (!val || !hasLiquidity) return  // new pool: let user set both freely
    try {
      const wei = parseUnits(val, token0Dec)
      setAmount1(calcPaired(wei, reserve0, reserve1, token1Dec))
    } catch {}
  }

  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (!val || !hasLiquidity) return  // new pool: let user set both freely
    try {
      const wei = parseUnits(val, token1Dec)
      setAmount0(calcPaired(wei, reserve1, reserve0, token0Dec))
    } catch {}
  }

  // Reset amounts when pool changes
  useEffect(() => { setAmount0(''); setAmount1('') }, [selectedPool.address])

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)
  // Amount ordering for addLiquidity: if pool tokens are flipped vs our display, swap amounts
  const actualAmount0Wei  = cfgMatchesFlipped ? amount1Wei : amount0Wei
  const actualAmount1Wei  = cfgMatchesFlipped ? amount0Wei : amount1Wei

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const helperReady = HELPER !== '0x0000000000000000000000000000000000000000'

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()

  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: !!txHash },
  })

  // Advance step state when tx confirms
  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait')  { setStep('approve1'); return }
    if (step === 'approve1_wait')  { setStep('addliq');   return }
    if (step === 'addliq_wait')    { setStep('done');      setAmount0(''); setAmount1(''); return }
    if (step === 'remove_wait')    { setStep('remove_done'); return }
  }, [txSuccess])

  // Execute the right tx for the current step
  useEffect(() => {
    if (!address || !token0Addr || !token1Addr) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, MAX_UINT] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, MAX_UINT] })
      setStep('approve1_wait')
    }
    if (step === 'addliq') {
      if (tokenMismatch || !actualToken0Addr || !actualToken1Addr) {
        setErrMsg('Token address mismatch — pool on-chain tokens differ from config. Cannot add safely.')
        setStep('idle')
        return
      }
      writeContract({
        address: HELPER,
        abi: LIQUIDITY_HELPER_ABI,
        functionName: 'addLiquidity',
        args: [selectedPool.address, actualToken0Addr, actualAmount0Wei, actualToken1Addr, actualAmount1Wei, address],
      })
      setStep('addliq_wait')
    }
    if (step === 'remove') {
      // For remove: user needs LP token balance — we pass a placeholder of removing removeAmount% of nothing for now
      // This requires knowing the LP balance; for now we just call with 0 to show the flow
      setStep('remove_wait')
    }
  }, [step])

  useEffect(() => {
    if (writeError) { setErrMsg(writeError.message.slice(0, 120)); setStep('idle') }
  }, [writeError])

  function startAddLiquidity() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!amount0 || !amount1) return  // BOTH amounts required
    setStep('idle')
    setErrMsg('')
    if (needApprove0) { setStep('approve0'); return }
    if (needApprove1) { setStep('approve1'); return }
    setStep('addliq')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!helperReady) return 'Helper Not Deployed Yet'
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
    const steps = [] as {label: string, done: boolean, active: boolean}[]
    if (needApprove0 || ['approve0', 'approve0_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token0}`, done: !needApprove0 || ['approve1','approve1_wait','addliq','addliq_wait','done'].includes(step), active: step === 'approve0' || step === 'approve0_wait' })
    if (needApprove1 || ['approve1', 'approve1_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token1}`, done: !needApprove1 || ['addliq','addliq_wait','done'].includes(step), active: step === 'approve1' || step === 'approve1_wait' })
    steps.push({ label: 'Add Liquidity', done: step === 'done', active: step === 'addliq' || step === 'addliq_wait' })
    return steps
  }

  const showProgress = isProcessing || step === 'done'

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity</h1>
          <p className="text-sm text-text-muted mt-0.5">Provide liquidity and stake LP tokens to earn</p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        {(['vAMM', 'CL', 'DLMM'] as PoolType[]).map(t => (
          <button key={t} onClick={() => { setPoolType(t); setSelectedPool(POOLS.find(p => p.type === t) || POOLS[0]); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium transition-all relative', poolType === t ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
            {t}
          </button>
        ))}
      </div>

      {/* Pool selector */}
      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <div className="w-7 h-7 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-xs font-bold z-10">{selectedPool.token0.startsWith('WBTC') ? '₿' : selectedPool.token0[0]}</div>
              <div className="w-7 h-7 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-xs font-bold">{selectedPool.token1.startsWith('WBTC') ? '₿' : selectedPool.token1[0]}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {filteredPools.map(pool => (
              <button key={pool.address + pool.fee} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && selectedPool.fee === pool.fee && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <div className="w-6 h-6 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-2xs font-bold z-10">{pool.token0.startsWith('WBTC') ? '₿' : pool.token0[0]}</div>
                  <div className="w-6 h-6 rounded-full bg-bg-base border border-bg-border flex items-center justify-center text-2xs font-bold">{pool.token1.startsWith('WBTC') ? '₿' : pool.token1[0]}</div>
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
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && handleAmount0Change(bal0.formatted.replace(',',''))}>
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
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && handleAmount1Change(bal1.formatted.replace(',',''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount1} onChange={e => handleAmount1Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
          </div>

          {!hasLiquidity && (
            <div className="p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20 text-xs text-aeon-400">
              New pool — no existing liquidity. Enter both token amounts manually to set your initial price ratio.
            </div>
          )}

          {poolType === 'CL' && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-violet-400" />
                <span className="text-xs font-semibold text-violet-300">CL Pool — Full-Range Liquidity</span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                AeonDEX CL pools use a <strong className="text-text-secondary">0.3% fee tier</strong> and provide liquidity across the full price range (equivalent to Uniswap V2 mechanics). Tick-based concentrated ranges are not yet supported by this implementation.
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { label: 'Fee Tier', value: selectedPool.fee },
                  { label: 'Range',    value: 'Full Range' },
                  { label: 'In Range', value: 'Always' },
                ].map(s => (
                  <div key={s.label} className="bg-bg-raised rounded-lg p-2 text-center">
                    <div className="text-2xs text-text-muted">{s.label}</div>
                    <div className="text-xs font-mono text-violet-300 font-bold">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {poolType === 'DLMM' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs font-semibold text-emerald-300">DLMM Pool — Full-Range Liquidity</span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                AeonDEX DLMM pools use a <strong className="text-text-secondary">1% fee tier</strong> with a fixed bin step of <strong className="text-text-secondary">{'binStep' in selectedPool ? `${(selectedPool as any).binStep} bps` : '800 bps'}</strong>. Liquidity is provided across the full price range. Discrete bin positioning is not yet supported by this implementation.
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {[
                  { label: 'Fee Tier', value: selectedPool.fee },
                  { label: 'Bin Step', value: 'binStep' in selectedPool ? `${(selectedPool as any).binStep} bps` : '—' },
                  { label: 'Range',    value: 'Full Range' },
                ].map(s => (
                  <div key={s.label} className="bg-bg-raised rounded-lg p-2 text-center">
                    <div className="text-2xs text-text-muted">{s.label}</div>
                    <div className="text-xs font-mono text-emerald-300 font-bold">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Progress steps */}
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

          {!helperReady && (
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              LiquidityHelper contract deploying — paste the address in contracts.ts to enable.
            </div>
          )}

          {/* Insufficient balance warnings */}
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

          {/* Rabby / wallet simulation warning notice */}
          <div className="p-3 rounded-xl bg-bg-raised border border-bg-border text-xs text-text-muted">
            💡 Some wallets (Rabby, MetaMask) may show a simulation warning for this pool. This is a known false positive — the transaction is safe to sign.
          </div>

          {tokenMismatch && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
              ⚠ Token address mismatch — this pool uses different token contracts than configured.
              Pool expects: <span className="font-mono">{poolToken0Addr?.slice(0,10)}…</span> / <span className="font-mono">{poolToken1Addr?.slice(0,10)}…</span>
            </div>
          )}

          <button
            onClick={startAddLiquidity}
            disabled={isConnected && (isProcessing || (!amount0 || !amount1) || !helperReady || tokenMismatch)}
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

          <div className="card p-4">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You Receive</div>
            <div className="space-y-2">
              <div className="flex justify-between"><span className="text-sm text-text-muted">{selectedPool.token0}</span><span className="font-mono text-text-primary">—</span></div>
              <div className="flex justify-between"><span className="text-sm text-text-muted">{selectedPool.token1}</span><span className="font-mono text-text-primary">—</span></div>
            </div>
          </div>

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          <button
            onClick={() => { if (!isConnected) { openConnectModal?.(); return } }}
            disabled={isConnected && !helperReady}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Minus size={16} />
            {!isConnected ? 'Connect Wallet' : !helperReady ? 'Helper Not Deployed' : 'Remove Liquidity'}
          </button>
        </div>
      )}
    </div>
  )
}
