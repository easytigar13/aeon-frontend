'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Minus, ChevronDown, Loader2, CheckCircle2, Layers, Search, Sparkles, ArrowRight, ShieldCheck, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useReadContract, useReadContracts, useWriteContract, usePublicClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import { POOLS, CL_POOLS, DLMM_POOLS, TOKENS, CONTRACTS, ALGEBRA_CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { ERC20_ABI, LIQUIDITY_HELPER_V2_ABI, PAIR_ABI, ALGEBRA_POSITION_MANAGER_ABI, ALGEBRA_POOL_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { usePoolStats, useClPoolStats, useDlmmPoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { TokenIcon } from '@/components/TokenIcon'
import { useToast } from '@/components/layout/ToastContext'
import { useSoundEffects } from '@/hooks/useSoundEffects'
import { ConfettiBurst } from '@/components/ConfettiBurst'

const HELPER = CONTRACTS.LiquidityHelperV2
const POSITION_MANAGER = ALGEBRA_CONTRACTS.nonfungiblePositionManager
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const LIQ_SLIPPAGE_BPS = 50n // 0.5%
const withSlippage = (wei: bigint) => (wei * (10000n - LIQ_SLIPPAGE_BPS)) / 10000n
const liqDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200)

export function UnifiedLiquidityHub() {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { showToast } = useToast()
  const { playClick, playSuccess, playError } = useSoundEffects()

  const prices = usePrices()
  const poolStats = usePoolStats(prices)
  const clPoolStats = useClPoolStats(prices)
  const dlmmPoolStats = useDlmmPoolStats(prices)
  const volResult = useVolume24h(prices)

  // Combine all pools into one comprehensive list
  const allPools = useMemo(() => {
    const list: Array<{
      id: string
      name: string
      token0: string
      token1: string
      token0Address: `0x${string}`
      token1Address: `0x${string}`
      address: `0x${string}`
      fee: string
      type: 'vAMM' | 'CL' | 'DLMM'
    }> = []

    POOLS.forEach(p => {
      const t0 = TOKENS[p.token0 as keyof typeof TOKENS]
      const t1 = TOKENS[p.token1 as keyof typeof TOKENS]
      if (t0 && t1) {
        list.push({
          id: p.address,
          name: p.name,
          token0: p.token0,
          token1: p.token1,
          token0Address: t0.address as `0x${string}`,
          token1Address: t1.address as `0x${string}`,
          address: p.address as `0x${string}`,
          fee: p.fee,
          type: 'vAMM',
        })
      }
    })

    CL_POOLS.forEach(p => {
      const t0 = TOKENS[p.token0 as keyof typeof TOKENS]
      const t1 = TOKENS[p.token1 as keyof typeof TOKENS]
      if (t0 && t1) {
        list.push({
          id: p.address,
          name: p.name,
          token0: p.token0,
          token1: p.token1,
          token0Address: t0.address as `0x${string}`,
          token1Address: t1.address as `0x${string}`,
          address: p.address as `0x${string}`,
          fee: p.fee,
          type: 'CL',
        })
      }
    })

    return list
  }, [])

  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add')
  const [selectedPoolAddress, setSelectedPoolAddress] = useState<string>(allPools[0]?.address ?? '')
  const [showPoolModal, setShowPoolModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Form Inputs
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [clPreset, setClPreset] = useState<'full' | 'wide' | 'narrow'>('full')
  const [removePct, setRemovePct] = useState<number>(50)

  // Transaction State
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [showCelebrate, setShowCelebrate] = useState(false)

  const currentPool = useMemo(() => {
    return allPools.find(p => p.address.toLowerCase() === selectedPoolAddress.toLowerCase()) ?? allPools[0]
  }, [allPools, selectedPoolAddress])

  const token0Key = currentPool?.token0 as keyof typeof TOKENS
  const token1Key = currentPool?.token1 as keyof typeof TOKENS
  const token0Info = TOKENS[token0Key]
  const token1Info = TOKENS[token1Key]

  // Balances
  const { data: bal0Data, refetch: refetchBal0 } = useBalance({
    address,
    token: token0Info?.address !== NATIVE_SENTINEL ? token0Info?.address as `0x${string}` : undefined,
    query: { enabled: !!address && !!token0Info },
  })

  const { data: bal1Data, refetch: refetchBal1 } = useBalance({
    address,
    token: token1Info?.address !== NATIVE_SENTINEL ? token1Info?.address as `0x${string}` : undefined,
    query: { enabled: !!address && !!token1Info },
  })

  const bal0Formatted = bal0Data ? parseFloat(formatUnits(bal0Data.value, bal0Data.decimals)).toFixed(4) : '0.00'
  const bal1Formatted = bal1Data ? parseFloat(formatUnits(bal1Data.value, bal1Data.decimals)).toFixed(4) : '0.00'

  // Read vAMM Reserves
  const isVamm = currentPool?.type === 'vAMM'
  const isCl = currentPool?.type === 'CL'

  const { data: reserves, refetch: refetchReserves } = useReadContract({
    address: currentPool?.address,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    query: { enabled: isVamm && !!currentPool?.address, refetchInterval: 10000 },
  })

  const { data: poolToken0Addr } = useReadContract({
    address: currentPool?.address,
    abi: PAIR_ABI,
    functionName: 'token0',
    query: { enabled: isVamm && !!currentPool?.address },
  })

  const isToken0First = !poolToken0Addr || poolToken0Addr.toLowerCase() === currentPool?.token0Address.toLowerCase()
  const [r0raw, r1raw] = (reserves as [bigint, bigint, number] | undefined) ?? [0n, 0n, 0]
  const reserve0 = isToken0First ? r0raw : r1raw
  const reserve1 = isToken0First ? r1raw : r0raw
  const hasLiquidity = reserve0 > 0n && reserve1 > 0n

  // User LP Token Balance (for vAMM pools)
  const { data: userLpBalanceRaw, refetch: refetchLpBal } = useReadContract({
    address: currentPool?.address,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isVamm && !!currentPool?.address },
  })

  const userLpBalance = (userLpBalanceRaw as bigint | undefined) ?? 0n
  const userLpBalanceFormatted = parseFloat(formatUnits(userLpBalance, 18)).toFixed(6)

  // Total Supply
  const { data: totalSupplyRaw } = useReadContract({
    address: currentPool?.address,
    abi: ERC20_ABI,
    functionName: 'totalSupply',
    query: { enabled: isVamm && !!currentPool?.address },
  })
  const totalSupply = (totalSupplyRaw as bigint | undefined) ?? 0n

  // Allowances
  const spenderAddress = isVamm ? HELPER : POSITION_MANAGER

  const { data: allowance0Raw, refetch: refetchAllow0 } = useReadContract({
    address: currentPool?.token0Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, spenderAddress] : undefined,
    query: { enabled: !!address && !!currentPool?.token0Address },
  })

  const { data: allowance1Raw, refetch: refetchAllow1 } = useReadContract({
    address: currentPool?.token1Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, spenderAddress] : undefined,
    query: { enabled: !!address && !!currentPool?.token1Address },
  })

  const { data: allowanceLpRaw, refetch: refetchAllowLp } = useReadContract({
    address: currentPool?.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, HELPER] : undefined,
    query: { enabled: !!address && isVamm && !!currentPool?.address },
  })

  const allowance0 = (allowance0Raw as bigint | undefined) ?? 0n
  const allowance1 = (allowance1Raw as bigint | undefined) ?? 0n
  const allowanceLp = (allowanceLpRaw as bigint | undefined) ?? 0n

  // Auto-Balancing Math
  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (!val || parseFloat(val) <= 0 || !hasLiquidity) return
    try {
      const wei0 = parseUnits(val, token0Info.decimals)
      const wei1 = (wei0 * reserve1) / reserve0
      setAmount1(parseFloat(formatUnits(wei1, token1Info.decimals)).toFixed(6))
    } catch {}
  }

  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (!val || parseFloat(val) <= 0 || !hasLiquidity) return
    try {
      const wei1 = parseUnits(val, token1Info.decimals)
      const wei0 = (wei1 * reserve0) / reserve1
      setAmount0(parseFloat(formatUnits(wei0, token0Info.decimals)).toFixed(6))
    } catch {}
  }

  // Parse input amounts to BigInt
  const amount0Wei = useMemo(() => {
    if (!amount0 || parseFloat(amount0) <= 0 || !token0Info) return 0n
    try {
      return parseUnits(amount0, token0Info.decimals)
    } catch {
      return 0n
    }
  }, [amount0, token0Info])

  const amount1Wei = useMemo(() => {
    if (!amount1 || parseFloat(amount1) <= 0 || !token1Info) return 0n
    try {
      return parseUnits(amount1, token1Info.decimals)
    } catch {
      return 0n
    }
  }, [amount1, token1Info])

  // Approval checks
  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  // Remove liquidity calculations
  const removeLpAmountWei = useMemo(() => {
    if (userLpBalance === 0n) return 0n
    return (userLpBalance * BigInt(removePct)) / 100n
  }, [userLpBalance, removePct])

  const needApproveLp = removeLpAmountWei > 0n && allowanceLp < removeLpAmountWei

  const estimatedReturn0 = useMemo(() => {
    if (totalSupply === 0n || removeLpAmountWei === 0n) return '0.00'
    const return0Wei = (removeLpAmountWei * reserve0) / totalSupply
    return parseFloat(formatUnits(return0Wei, token0Info?.decimals ?? 18)).toFixed(4)
  }, [totalSupply, removeLpAmountWei, reserve0, token0Info])

  const estimatedReturn1 = useMemo(() => {
    if (totalSupply === 0n || removeLpAmountWei === 0n) return '0.00'
    const return1Wei = (removeLpAmountWei * reserve1) / totalSupply
    return parseFloat(formatUnits(return1Wei, token1Info?.decimals ?? 18)).toFixed(4)
  }, [totalSupply, removeLpAmountWei, reserve1, token1Info])

  // Pool Stats
  const stat = useMemo(() => {
    const all = [...poolStats, ...clPoolStats, ...dlmmPoolStats]
    return all.find(s => s.address.toLowerCase() === currentPool?.address.toLowerCase())
  }, [poolStats, clPoolStats, dlmmPoolStats, currentPool])

  // Filtered Pools for Modal
  const filteredPools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allPools
    return allPools.filter(p => p.name.toLowerCase().includes(q) || p.type.toLowerCase().includes(q))
  }, [allPools, searchQuery])

  // 1-Click Unified Add Liquidity Handler
  const handleAddLiquidity = async () => {
    playClick()
    if (!isConnected || !address) {
      openConnectModal?.()
      return
    }

    if (amount0Wei === 0n || amount1Wei === 0n) {
      showToast({ type: 'error', title: 'Invalid Amounts', message: 'Please enter valid amounts for both tokens.' })
      return
    }

    setIsProcessing(true)

    try {
      // Step 1: Approve Token 0 if needed
      if (needApprove0) {
        setStatusMessage(`Approving ${token0Info.symbol}...`)
        showToast({ type: 'pending', title: 'Wallet Approval', message: `Approving ${token0Info.symbol} for liquidity helper...` })
        const hash0 = await writeContractAsync({
          address: currentPool.token0Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress, 2n ** 256n - 1n],
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: hash0 })
        await refetchAllow0()
      }

      // Step 2: Approve Token 1 if needed
      if (needApprove1) {
        setStatusMessage(`Approving ${token1Info.symbol}...`)
        showToast({ type: 'pending', title: 'Wallet Approval', message: `Approving ${token1Info.symbol} for liquidity helper...` })
        const hash1 = await writeContractAsync({
          address: currentPool.token1Address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spenderAddress, 2n ** 256n - 1n],
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: hash1 })
        await refetchAllow1()
      }

      // Step 3: Deposit Liquidity
      setStatusMessage(`Adding liquidity to ${currentPool.name}...`)
      showToast({ type: 'pending', title: 'Adding Liquidity', message: `Broadcasting deposit to Robinhood Chain...` })

      let txHash = ''

      if (isVamm) {
        const addToken0 = isToken0First ? currentPool.token0Address : currentPool.token1Address
        const addToken1 = isToken0First ? currentPool.token1Address : currentPool.token0Address
        const addAmount0Wei = isToken0First ? amount0Wei : amount1Wei
        const addAmount1Wei = isToken0First ? amount1Wei : amount0Wei

        txHash = await writeContractAsync({
          address: HELPER,
          abi: LIQUIDITY_HELPER_V2_ABI,
          functionName: 'addLiquidity',
          args: [
            currentPool.address,
            addToken0,
            addAmount0Wei,
            addAmount1Wei,
            0n,
            0n,
            addToken1,
            address,
            liqDeadline(),
          ],
        })
      } else if (isCl) {
        // Algebra Concentrated Liquidity Mint
        const tickLower = clPreset === 'full' ? -887220 : clPreset === 'wide' ? -20000 : -5000
        const tickUpper = clPreset === 'full' ? 887220 : clPreset === 'wide' ? 20000 : 5000

        txHash = await writeContractAsync({
          address: POSITION_MANAGER,
          abi: ALGEBRA_POSITION_MANAGER_ABI,
          functionName: 'mint',
          args: [{
            token0: currentPool.token0Address,
            token1: currentPool.token1Address,
            deployer: ZERO_ADDRESS,
            tickLower,
            tickUpper,
            amount0Desired: amount0Wei,
            amount1Desired: amount1Wei,
            amount0Min: withSlippage(amount0Wei),
            amount1Min: withSlippage(amount1Wei),
            recipient: address,
            deadline: liqDeadline(),
          }],
        })
      }

      if (publicClient && txHash) {
        setStatusMessage('Confirming block on Robinhood Chain...')
        await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
      }

      playSuccess()
      setShowCelebrate(true)
      setTimeout(() => setShowCelebrate(false), 4000)

      showToast({
        type: 'success',
        title: 'Liquidity Added Successfully!',
        message: `Deposited ${amount0} ${token0Info.symbol} + ${amount1} ${token1Info.symbol} into ${currentPool.name}.`,
        txHash,
      })

      setAmount0('')
      setAmount1('')
      refetchBal0()
      refetchBal1()
      refetchReserves()
      refetchLpBal()
    } catch (err: any) {
      playError()
      showToast({
        type: 'error',
        title: 'Deposit Failed or Cancelled',
        message: err?.shortMessage || err?.message || 'Transaction was rejected.',
      })
    } finally {
      setIsProcessing(false)
      setStatusMessage('')
    }
  }

  // 1-Click Unified Remove Liquidity Handler
  const handleRemoveLiquidity = async () => {
    playClick()
    if (!isConnected || !address) {
      openConnectModal?.()
      return
    }

    if (removeLpAmountWei === 0n) {
      showToast({ type: 'error', title: 'No LP Balance', message: 'You have no LP tokens to withdraw from this pool.' })
      return
    }

    setIsProcessing(true)

    try {
      // Approve LP token if needed
      if (needApproveLp) {
        setStatusMessage('Approving LP tokens...')
        showToast({ type: 'pending', title: 'Approving LP Token', message: 'Please approve LP token for withdrawal...' })
        const hashLp = await writeContractAsync({
          address: currentPool.address,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [HELPER, 2n ** 256n - 1n],
        })
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: hashLp })
        await refetchAllowLp()
      }

      setStatusMessage('Removing liquidity...')
      showToast({ type: 'pending', title: 'Removing Liquidity', message: 'Withdrawing tokens to your wallet...' })

      const txHash = await writeContractAsync({
        address: HELPER,
        abi: LIQUIDITY_HELPER_V2_ABI,
        functionName: 'removeLiquidity',
        args: [
          currentPool.address,
          removeLpAmountWei,
          0n,
          0n,
          address,
          liqDeadline(),
        ],
      })

      if (publicClient) {
        setStatusMessage('Waiting for confirmation...')
        await publicClient.waitForTransactionReceipt({ hash: txHash })
      }

      playSuccess()
      showToast({
        type: 'success',
        title: 'Liquidity Removed Successfully!',
        message: `Withdrew ${estimatedReturn0} ${token0Info.symbol} and ${estimatedReturn1} ${token1Info.symbol}.`,
        txHash,
      })

      refetchBal0()
      refetchBal1()
      refetchReserves()
      refetchLpBal()
    } catch (err: any) {
      playError()
      showToast({
        type: 'error',
        title: 'Withdraw Failed',
        message: err?.shortMessage || err?.message || 'Transaction was rejected.',
      })
    } finally {
      setIsProcessing(false)
      setStatusMessage('')
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {showCelebrate && <ConfettiBurst />}

      {/* Main Unified Card */}
      <div className="bg-[#0B0F19]/95 border border-[#182337] rounded-3xl p-5 sm:p-7 backdrop-blur-xl shadow-2xl relative space-y-6">
        {/* Card Header & Tabs */}
        <div className="flex items-center justify-between border-b border-[#182337] pb-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('add')}
              className={clsx(
                'px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer',
                activeTab === 'add'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-[0_0_15px_-4px_rgba(16,185,129,0.5)]'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              + Add Liquidity
            </button>
            <button
              onClick={() => setActiveTab('remove')}
              className={clsx(
                'px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer',
                activeTab === 'remove'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/40 shadow-[0_0_15px_-4px_rgba(239,68,68,0.5)]'
                  : 'text-slate-400 hover:text-white'
              )}
            >
              - Withdraw Liquidity
            </button>
          </div>

          <span className="text-2xs font-mono text-slate-400 px-2.5 py-1 rounded-full bg-[#12192C] border border-[#1E2B44]">
            Robinhood Chain
          </span>
        </div>

        {/* Selected Pool Selector Trigger */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Target Liquidity Pool</label>
          <button
            onClick={() => setShowPoolModal(true)}
            className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#101728] border border-[#1E2C48] hover:border-emerald-500/50 transition-all cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                <TokenIcon symbol={currentPool?.token0 ?? 'AEON'} size={28} />
                <TokenIcon symbol={currentPool?.token1 ?? 'ETH'} size={28} />
              </div>
              <div className="text-left">
                <span className="font-display font-bold text-sm text-white block group-hover:text-emerald-400 transition-colors">
                  {currentPool?.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {currentPool?.type} Pool • Fee {currentPool?.fee}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/30">
                {stat?.apr ? `${stat.apr.toFixed(1)}% APR` : 'Active'}
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-white" />
            </div>
          </button>
        </div>

        {/* TAB 1: ADD LIQUIDITY */}
        {activeTab === 'add' && (
          <div className="space-y-4">
            {/* Token 0 Input */}
            <div className="p-4 rounded-2xl bg-[#101728] border border-[#1E2B44] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Deposit {token0Info?.symbol}</span>
                <div className="flex items-center gap-1.5 font-mono text-slate-400 text-2xs">
                  <span>Bal: {bal0Formatted}</span>
                  <button
                    onClick={() => handleAmount0Change(bal0Formatted === '—' ? '0' : bal0Formatted)}
                    className="text-emerald-400 hover:underline font-bold cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  value={amount0}
                  onChange={e => handleAmount0Change(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-transparent text-xl sm:text-2xl font-mono font-bold text-white placeholder-slate-600 focus:outline-none"
                />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141E34] border border-[#23355A] shrink-0">
                  <TokenIcon symbol={token0Info?.symbol ?? 'AEON'} size={20} />
                  <span className="font-bold text-sm text-white font-mono">{token0Info?.symbol}</span>
                </div>
              </div>
            </div>

            {/* Token 1 Input */}
            <div className="p-4 rounded-2xl bg-[#101728] border border-[#1E2B44] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Deposit {token1Info?.symbol} (Auto-Balanced)</span>
                <div className="flex items-center gap-1.5 font-mono text-slate-400 text-2xs">
                  <span>Bal: {bal1Formatted}</span>
                  <button
                    onClick={() => handleAmount1Change(bal1Formatted === '—' ? '0' : bal1Formatted)}
                    className="text-emerald-400 hover:underline font-bold cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  value={amount1}
                  onChange={e => handleAmount1Change(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-transparent text-xl sm:text-2xl font-mono font-bold text-white placeholder-slate-600 focus:outline-none"
                />
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141E34] border border-[#23355A] shrink-0">
                  <TokenIcon symbol={token1Info?.symbol ?? 'ETH'} size={20} />
                  <span className="font-bold text-sm text-white font-mono">{token1Info?.symbol}</span>
                </div>
              </div>
            </div>

            {/* Quick Percentage Buttons */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => {
                    const max0 = parseFloat(bal0Formatted) || 0
                    const target = (max0 * pct) / 100
                    handleAmount0Change(target > 0 ? target.toFixed(4) : '')
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-[#121A2C] border border-[#1E2C48] hover:border-emerald-500/40 text-xs font-mono text-slate-300 transition-all cursor-pointer"
                >
                  {pct === 100 ? 'MAX' : `${pct}%`}
                </button>
              ))}
            </div>

            {/* Concentrated Liquidity Presets (if CL) */}
            {isCl && (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold text-slate-300">Price Range Profile</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'full', label: 'Full Range', sub: 'Passive / Safe' },
                    { id: 'wide', label: 'Wide (±20%)', sub: 'Balanced Yield' },
                    { id: 'narrow', label: 'Narrow (±5%)', sub: 'Max Capital Edge' },
                  ].map(p => (
                    <button
                      key={p.id}
                      onClick={() => setClPreset(p.id as any)}
                      className={clsx(
                        'p-2.5 rounded-xl border text-center transition-all cursor-pointer',
                        clPreset === p.id
                          ? 'bg-violet-500/20 border-violet-500/50 text-violet-300'
                          : 'bg-[#101728] border-[#1E2B44] text-slate-400'
                      )}
                    >
                      <div className="text-xs font-bold">{p.label}</div>
                      <div className="text-[10px] text-slate-500">{p.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Deposit Summary Box */}
            <div className="p-3.5 rounded-xl bg-[#0E1526] border border-[#1D2B44] text-xs font-mono space-y-1.5">
              <div className="flex justify-between text-slate-400">
                <span>Fee Tier:</span>
                <span className="text-white font-bold">{currentPool?.fee}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Pool TVL:</span>
                <span className="text-white">${(stat?.tvlUsd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Slippage Tolerance:</span>
                <span className="text-emerald-400 font-bold">0.5% (Protected)</span>
              </div>
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div className="text-xs font-mono text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/30 animate-pulse text-center">
                {statusMessage}
              </div>
            )}

            {/* Main Action Button */}
            <button
              onClick={isConnected ? handleAddLiquidity : openConnectModal}
              disabled={isProcessing || (isConnected && (amount0Wei === 0n || amount1Wei === 0n))}
              className={clsx(
                'w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-xl cursor-pointer',
                !isConnected
                  ? 'btn-primary'
                  : amount0Wei === 0n || amount1Wei === 0n
                  ? 'bg-[#18243A] text-slate-500 border border-[#233554] cursor-not-allowed'
                  : 'btn-primary'
              )}
            >
              {isProcessing && <Loader2 className="w-5 h-5 animate-spin" />}
              {!isConnected ? (
                <span>Connect Wallet to Deposit</span>
              ) : needApprove0 ? (
                <span>Approve {token0Info?.symbol} & Deposit</span>
              ) : needApprove1 ? (
                <span>Approve {token1Info?.symbol} & Deposit</span>
              ) : (
                <span>Deposit Liquidity</span>
              )}
            </button>
          </div>
        )}

        {/* TAB 2: REMOVE LIQUIDITY */}
        {activeTab === 'remove' && (
          <div className="space-y-4">
            {/* Balance Overview */}
            <div className="p-4 rounded-2xl bg-[#101728] border border-[#1E2B44] space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Your Staked LP Tokens</span>
                <span className="font-mono text-white font-bold">{userLpBalanceFormatted} LP</span>
              </div>

              {/* Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">Amount to Withdraw</span>
                  <span className="text-lg font-mono font-extrabold text-red-400">{removePct}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="100"
                  step="5"
                  value={removePct}
                  onChange={e => setRemovePct(parseInt(e.target.value))}
                  className="w-full h-2 bg-[#121A2C] rounded-lg appearance-none cursor-pointer accent-red-400"
                />
                <div className="flex gap-2 pt-1">
                  {[25, 50, 75, 100].map(pct => (
                    <button
                      key={pct}
                      onClick={() => setRemovePct(pct)}
                      className={clsx(
                        'flex-1 py-1 rounded-lg border text-2xs font-mono transition-all cursor-pointer',
                        removePct === pct
                          ? 'bg-red-500/20 border-red-500/40 text-red-400 font-bold'
                          : 'bg-[#141E34] border-[#23355A] text-slate-400'
                      )}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Payout Preview Box */}
            <div className="p-4 rounded-2xl bg-[#0E1526] border border-[#1D2B44] space-y-2 text-xs font-mono">
              <span className="text-slate-400 block text-2xs uppercase tracking-wider">Estimated Tokens to Receive</span>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">{token0Info?.symbol}:</span>
                <span className="text-white font-bold text-sm">+{estimatedReturn0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-300">{token1Info?.symbol}:</span>
                <span className="text-white font-bold text-sm">+{estimatedReturn1}</span>
              </div>
            </div>

            {/* Status Message */}
            {statusMessage && (
              <div className="text-xs font-mono text-red-400 bg-red-500/10 p-2.5 rounded-xl border border-red-500/30 animate-pulse text-center">
                {statusMessage}
              </div>
            )}

            {/* Remove Action Button */}
            <button
              onClick={isConnected ? handleRemoveLiquidity : openConnectModal}
              disabled={isProcessing || (isConnected && userLpBalance === 0n)}
              className={clsx(
                'w-full py-4 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-xl cursor-pointer',
                !isConnected
                  ? 'btn-primary'
                  : userLpBalance === 0n
                  ? 'bg-[#18243A] text-slate-500 border border-[#233554] cursor-not-allowed'
                  : 'bg-red-500 hover:bg-red-400 text-white shadow-[0_0_20px_-5px_rgba(239,68,68,0.5)]'
              )}
            >
              {isProcessing && <Loader2 className="w-5 h-5 animate-spin" />}
              {!isConnected ? (
                <span>Connect Wallet to Withdraw</span>
              ) : userLpBalance === 0n ? (
                <span>No LP Tokens in Wallet</span>
              ) : (
                <span>Withdraw {removePct}% Liquidity</span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Select Pool Modal */}
      {showPoolModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div onClick={() => setShowPoolModal(false)} className="fixed inset-0 bg-black/80 backdrop-blur-sm cursor-pointer" />
          <div className="relative bg-[#0E1424] border border-[#1E2C48] rounded-2xl p-5 w-full max-w-md shadow-2xl text-white z-10 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[#1A253C] pb-3">
              <h3 className="font-display font-bold text-base text-white">Select a Liquidity Pool</h3>
              <button onClick={() => setShowPoolModal(false)} className="text-slate-400 hover:text-white cursor-pointer">
                <Minus className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search by token name or pool type..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#12192C] border border-[#202E4B] rounded-xl pl-9 pr-4 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
              />
            </div>

            <div className="overflow-y-auto space-y-1.5 flex-1 pr-1 custom-scrollbar">
              {filteredPools.map(p => {
                const isSelected = p.address.toLowerCase() === selectedPoolAddress.toLowerCase()
                return (
                  <button
                    key={p.address}
                    onClick={() => {
                      setSelectedPoolAddress(p.address)
                      setShowPoolModal(false)
                      setAmount0('')
                      setAmount1('')
                    }}
                    className={clsx(
                      'w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left cursor-pointer',
                      isSelected
                        ? 'bg-emerald-500/15 border-emerald-500/50 text-white'
                        : 'bg-[#101728] border-[#1E2B44] text-slate-300 hover:border-slate-600'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex -space-x-1.5">
                        <TokenIcon symbol={p.token0} size={24} />
                        <TokenIcon symbol={p.token1} size={24} />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-white">{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{p.type} • Fee {p.fee}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      Select
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
