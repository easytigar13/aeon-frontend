'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Gift, Sparkles, CheckCircle2, Loader2, Coins, Flame, Layers, ArrowRight } from 'lucide-react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { CONTRACTS } from '@/config/contracts'
import { useToast } from '@/components/layout/ToastContext'
import { useSoundEffects } from '@/hooks/useSoundEffects'
import { clsx } from 'clsx'

interface GlobalRewardsClaimerProps {
  isOpen: boolean
  onClose: () => void
  veBribesUsd?: number
  furnaceRewardsAeon?: number
  lpEmissionsAeon?: number
  clFeesUsd?: number
}

export function GlobalRewardsClaimer({
  isOpen,
  onClose,
  veBribesUsd = 42.50,
  furnaceRewardsAeon = 128.4,
  lpEmissionsAeon = 345.2,
  clFeesUsd = 18.75,
}: GlobalRewardsClaimerProps) {
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { showToast } = useToast()
  const { playClick, playSuccess, playError } = useSoundEffects()

  const [isClaiming, setIsClaiming] = useState(false)
  const [claimedSuccessfully, setClaimedSuccessfully] = useState(false)

  if (!isOpen) return null

  const aeonPrice = 0.45
  const totalValueUsd =
    veBribesUsd +
    furnaceRewardsAeon * aeonPrice +
    lpEmissionsAeon * aeonPrice +
    clFeesUsd

  const handleClaimAll = async () => {
    playClick()
    if (!isConnected) {
      openConnectModal?.()
      return
    }

    setIsClaiming(true)
    showToast({
      type: 'pending',
      title: 'Batch Claiming Rewards',
      message: 'Processing batch claims across Voter, Furnace, and Gauges...',
    })

    // Simulate batch execution pipeline
    setTimeout(() => {
      setIsClaiming(false)
      setClaimedSuccessfully(true)
      playSuccess()
      showToast({
        type: 'success',
        title: 'All Rewards Claimed Successfully!',
        message: `Claimed $${totalValueUsd.toFixed(2)} in AEON, ETH, and USDG into your wallet.`,
      })
    }, 2500)
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
          className="fixed inset-0 bg-black/80 backdrop-blur-sm"
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
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
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
                ${totalValueUsd.toFixed(2)}
              </span>
            </div>
            <span className="text-xs font-mono text-emerald-400 px-2.5 py-1 rounded-lg bg-[#0E1424] border border-emerald-500/40 font-bold">
              4 Sources
            </span>
          </div>

          {/* Rewards Categories Breakdown */}
          <div className="space-y-2">
            {/* veNFT Bribes */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Coins className="w-4 h-4 text-sky-400" />
                <div>
                  <span className="font-semibold text-white block">veNFT Voter Bribes & Fees</span>
                  <span className="text-[10px] text-slate-400">Liquid ETH / USDG share</span>
                </div>
              </div>
              <span className="font-mono font-bold text-sky-400">${veBribesUsd.toFixed(2)}</span>
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
                {furnaceRewardsAeon.toFixed(1)} AEON
              </span>
            </div>

            {/* LP Gauge Emissions */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-emerald-400" />
                <div>
                  <span className="font-semibold text-white block">LP Gauge Emissions</span>
                  <span className="text-[10px] text-slate-400">vAMM & DLMM gauges</span>
                </div>
              </div>
              <span className="font-mono font-bold text-emerald-400">
                {lpEmissionsAeon.toFixed(1)} AEON
              </span>
            </div>

            {/* CL Fees */}
            <div className="p-3 rounded-xl bg-[#12192C] border border-[#1E2B44] flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <div>
                  <span className="font-semibold text-white block">Algebra CL Position Fees</span>
                  <span className="text-[10px] text-slate-400">Uncollected in-range fees</span>
                </div>
              </div>
              <span className="font-mono font-bold text-violet-400">${clFeesUsd.toFixed(2)}</span>
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleClaimAll}
            disabled={isClaiming || claimedSuccessfully}
            className={clsx(
              'w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg',
              claimedSuccessfully
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                : 'btn-primary'
            )}
          >
            {isClaiming && <Loader2 className="w-4 h-4 animate-spin" />}
            {claimedSuccessfully ? (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" /> All Rewards Claimed!
              </span>
            ) : (
              <span>Claim All Rewards (${totalValueUsd.toFixed(2)})</span>
            )}
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
