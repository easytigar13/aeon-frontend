'use client'
import { useState, useMemo } from 'react'
import { Calculator, Sparkles, TrendingUp, Shield, HelpCircle, ArrowRight } from 'lucide-react'
import { POOLS, CL_POOLS, DLMM_POOLS } from '@/config/contracts'
import { usePrices } from '@/hooks/usePrices'
import { clsx } from 'clsx'

export function VoteSimulator() {
  const [lockAmount, setLockAmount] = useState<string>('5000')
  const [lockWeeks, setLockWeeks] = useState<number>(208) // 4 years = 208 weeks
  const [selectedPoolIndex, setSelectedPoolIndex] = useState<number>(0)
  const [estimatedWeeklyFees, setEstimatedWeeklyFees] = useState<number>(12500) // $12.5k estimated weekly protocol fees

  const prices = usePrices()
  const aeonPrice = prices['AEON'] || 0.45

  const allPools = useMemo(() => {
    return [
      { name: 'AEON / ETH', type: 'vAMM', fee: '1.0%', address: '0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3', aprEstimate: 48.5 },
      { name: 'AEON / USDG', type: 'vAMM', fee: '1.0%', address: '0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434', aprEstimate: 52.0 },
      { name: 'ETH / USDG', type: 'vAMM', fee: '0.3%', address: '0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2', aprEstimate: 24.2 },
      { name: 'AEON / VIRTUAL', type: 'CL Pool', fee: '0.3%', address: '0xAlgebraPool', aprEstimate: 65.0 },
    ]
  }, [])

  // Calculations
  const numericLock = parseFloat(lockAmount) || 0
  const lockYears = (lockWeeks / 52).toFixed(1)
  const maxWeeks = 208 // 4 years

  // Voting power: linear decay from 4 years
  const veVotingPower = numericLock * (lockWeeks / maxWeeks)
  const initialValueUsd = numericLock * aeonPrice

  // Estimated 80% fee pass-through to voters + 5% furnace rewards
  // If user holds ~X% of voting power, they capture that fraction of pool fees
  const simulatedTotalVeSupply = 150000 // hypothetical active voting power
  const userVotingShare = veVotingPower / (simulatedTotalVeSupply + veVotingPower)
  
  const weeklyRewardUsd = estimatedWeeklyFees * 0.8 * userVotingShare
  const annualRewardUsd = weeklyRewardUsd * 52
  const projectedVotingApr = initialValueUsd > 0 ? (annualRewardUsd / initialValueUsd) * 100 : 0
  const monthsToBreakeven = annualRewardUsd > 0 ? (initialValueUsd / (annualRewardUsd / 12)).toFixed(1) : '—'

  return (
    <div className="bg-[#0B0F1A] border border-[#1C2840] rounded-2xl p-5 sm:p-6 shadow-2xl text-white space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#182337] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg text-white">ve(3,3) ROI & Voting Simulator</h3>
            <p className="text-xs text-slate-400">Project your voting APR, weekly bribes, and veAEON power</p>
          </div>
        </div>
        <div className="text-2xs font-mono px-3 py-1 rounded-full bg-[#121B2F] border border-[#23355A] text-slate-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>AEON Price: ${aeonPrice.toFixed(4)}</span>
        </div>
      </div>

      {/* Inputs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Lock Amount */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span>AEON to Lock</span>
            <span className="font-mono text-slate-400 text-2xs">≈ ${initialValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          </label>
          <div className="relative">
            <input
              type="number"
              value={lockAmount}
              onChange={e => setLockAmount(e.target.value)}
              placeholder="5000"
              className="w-full bg-[#101728] border border-[#1E2B44] rounded-xl px-4 py-2.5 font-mono text-sm text-white focus:outline-none focus:border-emerald-400"
            />
            <span className="absolute right-3.5 top-2.5 text-xs font-mono font-bold text-emerald-400">AEON</span>
          </div>
          <div className="flex gap-1.5 pt-1">
            {['1000', '5000', '10000', '25000'].map(amt => (
              <button
                key={amt}
                onClick={() => setLockAmount(amt)}
                className="px-2.5 py-1 rounded-lg bg-[#141E34] border border-[#233558] text-2xs font-mono text-slate-300 hover:border-emerald-400/40"
              >
                {amt}
              </button>
            ))}
          </div>
        </div>

        {/* Lock Duration Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Lock Duration</span>
            <span className="font-mono text-emerald-400 font-bold">{lockYears} Years ({lockWeeks} Weeks)</span>
          </div>
          <input
            type="range"
            min="4"
            max="208"
            step="4"
            value={lockWeeks}
            onChange={e => setLockWeeks(parseInt(e.target.value))}
            className="w-full h-2 bg-[#121A2C] rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
          <div className="flex justify-between text-[10px] font-mono text-slate-500">
            <span>1 Month</span>
            <span>1 Year</span>
            <span>2 Years</span>
            <span className="text-emerald-400 font-bold">4 Years (1:1 veAEON)</span>
          </div>
        </div>
      </div>

      {/* Target Gauge Pool Selection */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-slate-300">Target Gauge Pool to Vote On</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {allPools.map((pool, idx) => (
            <button
              key={pool.name}
              onClick={() => setSelectedPoolIndex(idx)}
              className={clsx(
                'p-2.5 rounded-xl border text-left transition-all',
                selectedPoolIndex === idx
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-white shadow-[0_0_15px_-5px_rgba(16,185,129,0.5)]'
                  : 'bg-[#101728] border-[#1E2B44] text-slate-400 hover:border-slate-600'
              )}
            >
              <div className="font-bold text-xs text-white">{pool.name}</div>
              <div className="flex items-center justify-between text-[10px] mt-1">
                <span className="font-mono text-slate-400">{pool.type}</span>
                <span className="font-mono text-emerald-400 font-semibold">{pool.fee}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Results Card */}
      <div className="bg-[#0E1526] border border-[#202E4B] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          <div className="bg-[#121B30] p-3 rounded-xl border border-[#23355A]">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">Voting Power</span>
            <span className="text-lg font-mono font-extrabold text-white">
              {veVotingPower.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[10px] text-emerald-400 block font-mono">veAEON</span>
          </div>

          <div className="bg-[#121B30] p-3 rounded-xl border border-[#23355A]">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">Weekly Bribes/Fees</span>
            <span className="text-lg font-mono font-extrabold text-emerald-400">
              ${weeklyRewardUsd.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">per epoch</span>
          </div>

          <div className="bg-[#121B30] p-3 rounded-xl border border-[#23355A]">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">Estimated Voting APR</span>
            <span className="text-lg font-mono font-extrabold text-sky-400">
              {projectedVotingApr.toFixed(1)}%
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">Annualized</span>
          </div>

          <div className="bg-[#121B30] p-3 rounded-xl border border-[#23355A]">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">Est. 1-Year Yield</span>
            <span className="text-lg font-mono font-extrabold text-white">
              ${annualRewardUsd.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-400 block font-mono">in 100% liquid tokens</span>
          </div>
        </div>

        {/* ve(3,3) Mechanism summary */}
        <div className="text-2xs text-slate-400 leading-relaxed border-t border-[#1C2840] pt-3 flex items-start gap-2">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>The ve(3,3) Advantage:</strong> 80% of pool trading fees are distributed weekly to veNFT voters in liquid assets (ETH, USDG, AEON). The remaining 20% powers the automatic Furnace buyback & burn engine.
          </span>
        </div>
      </div>
    </div>
  )
}
