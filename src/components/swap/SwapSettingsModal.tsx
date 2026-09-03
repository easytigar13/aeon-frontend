'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Settings, AlertTriangle, ShieldCheck, Clock } from 'lucide-react'
import { clsx } from 'clsx'

interface SwapSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  slippage: number // e.g. 0.5 for 0.5%
  onSlippageChange: (val: number) => void
  deadline: number // in minutes
  onDeadlineChange: (val: number) => void
}

const PRESET_SLIPPAGES = [0.1, 0.5, 1.0]

export function SwapSettingsModal({
  isOpen,
  onClose,
  slippage,
  onSlippageChange,
  deadline,
  onDeadlineChange,
}: SwapSettingsModalProps) {
  const [customSlippageInput, setCustomSlippageInput] = useState<string>(
    PRESET_SLIPPAGES.includes(slippage) ? '' : slippage.toString()
  )

  if (!isOpen) return null

  const handleCustomChange = (valStr: string) => {
    setCustomSlippageInput(valStr)
    const parsed = parseFloat(valStr)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
      onSlippageChange(parsed)
    }
  }

  const isHighSlippage = slippage > 3
  const isLowSlippage = slippage < 0.1

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative bg-[#0E1424] border border-[#1E2C48] rounded-2xl p-5 w-full max-w-md shadow-2xl text-white z-10 space-y-5"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1A253C] pb-3">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-400" />
              <h3 className="font-display font-bold text-base text-white">Transaction Settings</h3>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Slippage tolerance */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">Slippage Tolerance</span>
              <span className="font-mono text-emerald-400 font-bold">{slippage}%</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {PRESET_SLIPPAGES.map(val => (
                <button
                  key={val}
                  onClick={() => {
                    setCustomSlippageInput('')
                    onSlippageChange(val)
                  }}
                  className={clsx(
                    'py-2 px-3 rounded-xl text-xs font-mono font-semibold transition-all border',
                    slippage === val && !customSlippageInput
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_12px_-3px_rgba(16,185,129,0.5)]'
                      : 'bg-[#12192C] text-slate-300 border-[#202E4B] hover:border-slate-500'
                  )}
                >
                  {val}%
                </button>
              ))}

              <div className="relative">
                <input
                  type="number"
                  placeholder="Custom"
                  value={customSlippageInput}
                  onChange={e => handleCustomChange(e.target.value)}
                  step="0.1"
                  min="0.01"
                  max="50"
                  className={clsx(
                    'w-full py-2 px-2.5 pr-6 rounded-xl text-xs font-mono font-semibold bg-[#12192C] border text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-400 transition-all',
                    customSlippageInput
                      ? 'border-emerald-500/50 text-emerald-400'
                      : 'border-[#202E4B]'
                  )}
                />
                <span className="absolute right-2 top-2.5 text-xs text-slate-500 font-mono">%</span>
              </div>
            </div>

            {/* Warnings */}
            {isHighSlippage && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>High slippage may result in an unfavorable rate or frontrunning.</span>
              </div>
            )}
            {isLowSlippage && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 text-xs">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Very low slippage may cause your transaction to fail on volatile swaps.</span>
              </div>
            )}
          </div>

          {/* Transaction Deadline */}
          <div className="space-y-2 pt-2 border-t border-[#1A253C]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Transaction Deadline
              </span>
              <span className="font-mono text-slate-300">{deadline} minutes</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={deadline}
                onChange={e => onDeadlineChange(Math.max(1, parseInt(e.target.value) || 20))}
                min="1"
                max="120"
                className="w-24 py-1.5 px-3 rounded-xl text-xs font-mono bg-[#12192C] border border-[#202E4B] text-white focus:outline-none focus:border-emerald-400"
              />
              <span className="text-xs text-slate-400">minutes after submission</span>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-[0_0_15px_-3px_rgba(16,185,129,0.5)]"
          >
            Save Settings
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
