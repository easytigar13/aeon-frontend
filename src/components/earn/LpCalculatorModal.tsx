'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calculator, TrendingUp, AlertCircle, Percent, ShieldCheck } from 'lucide-react'
import { clsx } from 'clsx'

interface LpCalculatorModalProps {
  isOpen: boolean
  onClose: () => void
  pairName?: string
  defaultFee?: string
}

export function LpCalculatorModal({
  isOpen,
  onClose,
  pairName = 'AEON / ETH',
  defaultFee = '1.0%',
}: LpCalculatorModalProps) {
  const [depositAmount, setDepositAmount] = useState<string>('1000')
  const [tokenAPriceChange, setTokenAPriceChange] = useState<number>(50) // +50%
  const [poolType, setPoolType] = useState<'vamm' | 'cl'>('vamm')
  const [poolFeeBps, setPoolFeeBps] = useState<number>(100) // 1% = 100 bps
  const [estimatedDailyVolume, setEstimatedDailyVolume] = useState<number>(50000)
  const [poolTvl, setPoolTvl] = useState<number>(250000)

  if (!isOpen) return null

  const deposit = parseFloat(depositAmount) || 0
  const k = (100 + tokenAPriceChange) / 100 // price ratio

  // Impermanent Loss standard formula: 2 * sqrt(k) / (1 + k) - 1
  let ilDecimal = (2 * Math.sqrt(k)) / (1 + k) - 1
  let ilPercent = ilDecimal * 100

  // For concentrated liquidity, IL is magnified by range width
  if (poolType === 'cl') {
    ilPercent = Math.min(-100, ilPercent * 2.5)
  }

  // Estimated fee share
  const userShareOfPool = deposit / (poolTvl + deposit)
  const dailyFeePool = (estimatedDailyVolume * poolFeeBps) / 10000
  const userDailyFees = dailyFeePool * userShareOfPool
  const userYearlyFees = userDailyFees * 365

  // Net PnL vs HODL
  // Value if HODL = 50% in Token A (up by k) + 50% in Token B (flat)
  const hodlValue = deposit * (0.5 * k + 0.5)
  const lpValueWithoutFees = deposit * Math.sqrt(k)
  const lpValueWithFees1Year = lpValueWithoutFees + userYearlyFees
  const netAdvantageVsHodl = lpValueWithFees1Year - hodlValue

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative bg-[#0E1424] border border-[#1E2C48] rounded-2xl p-5 sm:p-6 w-full max-w-lg shadow-2xl text-white z-10 space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1A253C] pb-3">
            <div className="flex items-center gap-2">
              <Calculator className="w-5 h-5 text-emerald-400" />
              <div>
                <h3 className="font-display font-bold text-base text-white">LP & Impermanent Loss Calculator</h3>
                <span className="text-xs text-slate-400 font-mono">{pairName}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Deposit */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Initial Deposit ($ USD)</label>
              <div className="relative">
                <input
                  type="number"
                  value={depositAmount}
                  onChange={e => setDepositAmount(e.target.value)}
                  className="w-full bg-[#12192C] border border-[#202E4B] rounded-xl px-4 py-2.5 font-mono text-sm text-white focus:outline-none focus:border-emerald-400"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-mono text-slate-400">USD</span>
              </div>
            </div>

            {/* Price change slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Token Price Change</span>
                <span className={clsx('font-mono font-bold', tokenAPriceChange >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {tokenAPriceChange >= 0 ? `+${tokenAPriceChange}%` : `${tokenAPriceChange}%`}
                </span>
              </div>
              <input
                type="range"
                min="-80"
                max="300"
                step="5"
                value={tokenAPriceChange}
                onChange={e => setTokenAPriceChange(parseInt(e.target.value))}
                className="w-full h-2 bg-[#121A2C] rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>-80%</span>
                <span>0% (No Change)</span>
                <span>+100% (2x)</span>
                <span>+300% (4x)</span>
              </div>
            </div>

            {/* Pool Model */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPoolType('vamm')}
                className={clsx(
                  'py-2 px-3 rounded-xl text-xs font-mono font-semibold border transition-all',
                  poolType === 'vamm'
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                    : 'bg-[#12192C] text-slate-400 border-[#202E4B]'
                )}
              >
                Standard vAMM (Full Range)
              </button>
              <button
                onClick={() => setPoolType('cl')}
                className={clsx(
                  'py-2 px-3 rounded-xl text-xs font-mono font-semibold border transition-all',
                  poolType === 'cl'
                    ? 'bg-violet-500/20 text-violet-400 border-violet-500/50'
                    : 'bg-[#12192C] text-slate-400 border-[#202E4B]'
                )}
              >
                Concentrated Liquidity (CL)
              </button>
            </div>
          </div>

          {/* Results Summary */}
          <div className="bg-[#101729] border border-[#1F2C46] rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="bg-[#141C30] p-3 rounded-xl border border-[#223250]">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Impermanent Loss</span>
                <span className={clsx('text-base font-mono font-bold', ilPercent < -1 ? 'text-red-400' : 'text-slate-200')}>
                  {ilPercent.toFixed(2)}%
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  ≈ -${Math.abs((deposit * (ilPercent / 100))).toFixed(2)}
                </span>
              </div>

              <div className="bg-[#141C30] p-3 rounded-xl border border-[#223250]">
                <span className="text-[10px] uppercase font-mono text-slate-400 block">Est. 1Y Fee Income</span>
                <span className="text-base font-mono font-bold text-emerald-400">
                  +${userYearlyFees.toFixed(2)}
                </span>
                <span className="text-[10px] font-mono text-emerald-400/80">
                  {(deposit > 0 ? (userYearlyFees / deposit) * 100 : 0).toFixed(1)}% Fee APR
                </span>
              </div>
            </div>

            {/* Comparison vs HODL */}
            <div className="pt-2 border-t border-[#1C2840] space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between text-slate-300">
                <span>Value if 50/50 HODL:</span>
                <span className="text-white font-bold">${hodlValue.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>Value as LP (After 1Y Fees):</span>
                <span className="text-emerald-400 font-bold">${lpValueWithFees1Year.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#18243A]">
                <span className="text-slate-400">Net LP Edge vs HODL:</span>
                <span className={clsx('font-bold', netAdvantageVsHodl >= 0 ? 'text-emerald-400' : 'text-amber-400')}>
                  {netAdvantageVsHodl >= 0 ? `+$${netAdvantageVsHodl.toFixed(2)} (Profitable)` : `-$${Math.abs(netAdvantageVsHodl).toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all"
          >
            Close Calculator
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
