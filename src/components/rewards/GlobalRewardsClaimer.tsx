'use client'
import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Gift, Sparkles, CheckCircle2, Loader2, Coins, Flame, Layers, AlertCircle, ExternalLink } from 'lucide-react'
import { useAccount, useReadContracts, useWriteContract, usePublicClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits } from 'viem'
import { POOLS, CL_GAUGES, DLMM_GAUGES, CONTRACTS } from '@/config/contracts'
import { VOTER_ABI, GAUGE_ABI, CL_GAUGE_ABI, DLMM_GAUGE_ABI } from '@/config/abis'
import { useToast } from '@/components/layout/ToastContext'
import { useSoundEffects } from '@/hooks/useSoundEffects'
import { usePrices } from '@/hooks/usePrices'
import { clsx } from 'clsx'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

interface GlobalRewardsClaimerProps {
  isOpen: boolean
  onClose: () => void
}

export function GlobalRewardsClaimer({
  isOpen,
  onClose,
}: GlobalRewardsClaimerProps) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { showToast } = useToast()
  const { playClick, playSuccess, playError } = useSoundEffects()
  const prices = usePrices()
  const aeonPrice = prices['AEON'] ?? 0.45

  const [isClaiming, setIsClaiming] = useState(false)
  const [currentStepText, setCurrentStepText] = useState<string>('')
  const [claimedSuccessfully, setClaimedSuccessfully] = useState(false)

  // 1. Query all vAMM gauges from AeonVoter
  const { data: vammGaugeData } = useReadContracts({
    contracts: POOLS.map(p => ({
      address: CONTRACTS.AeonVoter,
      abi: VOTER_ABI,
      functionName: 'gauges' as const,
      args: [p.address as `0x${string}`],
    })),
    query: { enabled: !!address && isOpen },
  })

  const vammGauges = useMemo(() => {
    return (vammGaugeData ?? [])
      .map(r => (r.status === 'success' ? (r.result as `0x${string}`) : null))
      .filter((g): g is `0x${string}` => !!g && g.toLowerCase() !== ZERO_ADDRESS)
  }, [vammGaugeData])

  const clGauges = useMemo(() => Object.values(CL_GAUGES) as `0x${string}`[], [])
  const dlmmGauges = useMemo(() => Object.values(DLMM_GAUGES) as `0x${string}`[], [])

  // 2. Query earned(address) for each active gauge
  const { data: vammEarned, refetch: refetchVamm } = useReadContracts({
    contracts: vammGauges.map(g => ({
      address: g,
      abi: GAUGE_ABI,
      functionName: 'earned' as const,
      args: [address ?? ZERO_ADDRESS],
    })),
    query: { enabled: !!address && vammGauges.length > 0 && isOpen },
  })

  const { data: clEarned, refetch: refetchCl } = useReadContracts({
    contracts: clGauges.map(g => ({
      address: g,
      abi: CL_GAUGE_ABI,
      functionName: 'earned' as const,
      args: [address ?? ZERO_ADDRESS],
    })),
    query: { enabled: !!address && isOpen },
  })

  const { data: dlmmEarned, refetch: refetchDlmm } = useReadContracts({
    contracts: dlmmGauges.map(g => ({
      address: g,
      abi: DLMM_GAUGE_ABI,
      functionName: 'earned' as const,
      args: [address ?? ZERO_ADDRESS],
    })),
    query: { enabled: !!address && isOpen },
  })

  // 3. Aggregate real claimable items
  const claimableGauges = useMemo(() => {
    const targets: { address: `0x${string}`; abi: any; name: string; earnedAeon: number; type: 'vamm' | 'cl' | 'dlmm' }[] = []

    vammGauges.forEach((g, i) => {
      const r = vammEarned?.[i]
      if (r && r.status === 'success' && (r.result as bigint) > 0n) {
        const amt = parseFloat(formatUnits(r.result as bigint, 18))
        targets.push({ address: g, abi: GAUGE_ABI, name: `vAMM Gauge #${i + 1}`, earnedAeon: amt, type: 'vamm' })
      }
    })

    clGauges.forEach((g, i) => {
      const r = clEarned?.[i]
      if (r && r.status === 'success' && (r.result as bigint) > 0n) {
        const amt = parseFloat(formatUnits(r.result as bigint, 18))
        targets.push({ address: g, abi: CL_GAUGE_ABI, name: `CL Gauge #${i + 1}`, earnedAeon: amt, type: 'cl' })
      }
    })

    dlmmGauges.forEach((g, i) => {
      const r = dlmmEarned?.[i]
      if (r && r.status === 'success' && (r.result as bigint) > 0n) {
        const amt = parseFloat(formatUnits(r.result as bigint, 18))
        targets.push({ address: g, abi: DLMM_GAUGE_ABI, name: `DLMM Gauge #${i + 1}`, earnedAeon: amt, type: 'dlmm' })
      }
    })

    return targets
  }, [vammGauges, clGauges, dlmmGauges, vammEarned, clEarned, dlmmEarned])

  const totalGaugeAeon = useMemo(() => {
    return claimableGauges.reduce((sum, g) => sum + g.earnedAeon, 0)
  }, [claimableGauges])

  const totalValueUsd = totalGaugeAeon * aeonPrice
  const hasClaimableRewards = claimableGauges.length > 0

  if (!isOpen) return null

  const handleClaimAll = async () => {
    playClick()
    if (!isConnected || !address) {
      openConnectModal?.()
      return
    }

    if (!hasClaimableRewards) {
      showToast({
        type: 'error',
        title: 'No Rewards to Claim',
        message: 'Your wallet has no unclaimed LP gauge or veNFT rewards at this time.',
      })
      return
    }

    setIsClaiming(true)
    setClaimedSuccessfully(false)

    try {
      showToast({
        type: 'pending',
        title: 'Initiating Wallet Transaction',
        message: `Please confirm the claim transaction in your wallet (1 of ${claimableGauges.length})...`,
      })

      let lastHash = ''
      for (let i = 0; i < claimableGauges.length; i++) {
        const target = claimableGauges[i]
        setCurrentStepText(`Confirming ${i + 1} of ${claimableGauges.length}: ${target.name}...`)

        const hash = await writeContractAsync({
          address: target.address,
          abi: target.abi,
          functionName: 'getReward',
          args: target.type === 'vamm' ? [address] : [],
        })
        lastHash = hash

        if (publicClient) {
          setCurrentStepText(`Waiting for block confirmation ${i + 1}/${claimableGauges.length}...`)
          await publicClient.waitForTransactionReceipt({ hash })
        }
      }

      setIsClaiming(false)
      setClaimedSuccessfully(true)
      setCurrentStepText('')
      playSuccess()
      showToast({
        type: 'success',
        title: 'All Rewards Claimed Successfully!',
        message: `Successfully collected ${totalGaugeAeon.toFixed(4)} AEON into your wallet.`,
        txHash: lastHash,
      })

      refetchVamm()
      refetchCl()
      refetchDlmm()
    } catch (err: any) {
      setIsClaiming(false)
      setCurrentStepText('')
      playError()
      showToast({
        type: 'error',
        title: 'Claim Cancelled or Failed',
        message: err?.shortMessage || err?.message || 'Transaction rejected by user.',
      })
    }
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm cursor-pointer"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative bg-[#0E1424] border border-[#1E2C48] rounded-2xl p-5 sm:p-6 w-full max-w-md shadow-2xl text-white z-10 space-y-5"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1A253C] pb-3">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Gift className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base text-white">Global Rewards Hub</h3>
                <p className="text-xs text-slate-400">1-Click protocol earnings collection</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Total Claimable Value Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/15 via-[#10B981]/10 to-amber-500/15 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                Total Unclaimed Earnings
              </span>
              <span className="text-2xl font-mono font-extrabold text-white">
                {isConnected ? `$${totalValueUsd.toFixed(2)}` : '$—'}
              </span>
            </div>
            <span className="text-xs font-mono text-emerald-400 px-2.5 py-1 rounded-lg bg-[#0E1424] border border-emerald-500/40 font-bold">
              {isConnected ? `${claimableGauges.length} Active Gauges` : 'Connect Wallet'}
            </span>
          </div>

          {/* Rewards Categories Breakdown */}
          <div className="space-y-2">
            {/* LP Gauge Emissions */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className="font-semibold text-white block">LP Gauge Emissions</span>
                  <span className="text-[10px] text-slate-400">Live on-chain earned emissions</span>
                </div>
              </div>
              <span className="font-mono font-bold text-emerald-400">
                {isConnected ? `${totalGaugeAeon.toFixed(4)} AEON` : '—'}
              </span>
            </div>

            {/* veNFT Bribes & Trading Fees */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Coins className="w-4 h-4 text-sky-400" />
                <div>
                  <span className="font-semibold text-white block">veNFT Voter Bribes & Fees</span>
                  <span className="text-[10px] text-slate-400">Distributed at weekly epoch flip</span>
                </div>
              </div>
              <span className="font-mono font-bold text-sky-400">
                {isConnected ? `$0.00` : '—'}
              </span>
            </div>

            {/* Furnace Burn Rewards */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-amber-400" />
                <div>
                  <span className="font-semibold text-white block">Furnace Burn Dividends</span>
                  <span className="text-[10px] text-slate-400">5% fee-anchor distribution</span>
                </div>
              </div>
              <span className="font-mono font-bold text-amber-400">
                {isConnected ? `0.00 AEON` : '—'}
              </span>
            </div>
          </div>

          {/* Status / Instruction text */}
          {!isConnected ? (
            <div className="text-xs text-amber-400/90 font-mono bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Connect your wallet to inspect and claim your live protocol rewards.</span>
            </div>
          ) : !hasClaimableRewards ? (
            <div className="text-xs text-slate-400 font-mono bg-[#111728] p-3 rounded-xl border border-[#1E2B44] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>No unclaimed rewards found. Stake LP in Earn or lock AEON to start earning.</span>
            </div>
          ) : null}

          {currentStepText && (
            <div className="text-xs font-mono text-emerald-400 bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/30 animate-pulse text-center">
              {currentStepText}
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={isConnected ? handleClaimAll : openConnectModal}
            disabled={isClaiming || (isConnected && !hasClaimableRewards)}
            className={clsx(
              'w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer',
              !isConnected
                ? 'btn-primary'
                : claimedSuccessfully
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : !hasClaimableRewards
                ? 'bg-[#18243A] text-slate-500 border border-[#233554] cursor-not-allowed'
                : 'btn-primary'
            )}
          >
            {isClaiming && <Loader2 className="w-4 h-4 animate-spin" />}
            {!isConnected ? (
              <span>Connect Wallet to Claim</span>
            ) : claimedSuccessfully ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> All Rewards Claimed!
              </span>
            ) : !hasClaimableRewards ? (
              <span>No Rewards to Claim ($0.00)</span>
            ) : (
              <span>Claim All Rewards (${totalValueUsd.toFixed(2)})</span>
            )}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

