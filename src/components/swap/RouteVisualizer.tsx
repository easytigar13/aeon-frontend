'use client'
import { RouteStep } from '@/hooks/useRouting'
import { ArrowRight, Zap, ShieldCheck, Layers, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

interface RouteVisualizerProps {
  steps: RouteStep[]
  fromSymbol: string
  toSymbol: string
  priceImpact?: number
  minOutputFormatted?: string
  toAmountFormatted?: string
}

export function RouteVisualizer({
  steps,
  fromSymbol,
  toSymbol,
  priceImpact = 0,
  minOutputFormatted,
  toAmountFormatted,
}: RouteVisualizerProps) {
  if (!steps || steps.length === 0) {
    return null
  }

  const isMultiHop = steps.length > 1

  return (
    <div className="bg-[#0D1322] border border-[#1C2942] rounded-xl p-3.5 space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-slate-200">
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span>Optimal Route Order</span>
        </div>
        <span className="text-2xs font-mono text-slate-400 flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
          {isMultiHop ? `${steps.length}-Hop Smart Route` : 'Direct Pool Route'}
        </span>
      </div>

      {/* Visual node flowchart */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
        {steps.map((step, idx) => {
          const poolTypeLabel =
            step.kind === 'vamm'
              ? 'vAMM'
              : step.kind === 'cl'
              ? 'Algebra CL'
              : step.kind === 'dlmm'
              ? 'DLMM'
              : 'Direct Pool'

          const poolTypeBadgeClass =
            step.kind === 'vamm'
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              : step.kind === 'cl'
              ? 'bg-violet-500/20 text-violet-400 border-violet-500/30'
              : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'

          return (
            <div key={idx} className="flex items-center gap-2 shrink-0">
              {/* Node Card */}
              <div className="bg-[#121A2E] border border-[#223354] rounded-lg p-2 flex flex-col gap-1 min-w-[125px]">
                <div className="flex items-center justify-between text-2xs">
                  <span className="font-bold text-white">
                    {step.tokenInSymbol} → {step.tokenOutSymbol}
                  </span>
                  <span className={clsx('px-1.5 py-0.2 rounded font-mono text-[9px] border', poolTypeBadgeClass)}>
                    {poolTypeLabel}
                  </span>
                </div>
                {step.feePpm && (
                  <span className="text-[10px] font-mono text-slate-400">
                    Fee: {(step.feePpm / 10000).toFixed(2)}%
                  </span>
                )}
              </div>

              {/* Connecting arrow if not last step */}
              {idx < steps.length - 1 && (
                <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
            </div>
          )
        })}
      </div>

      {/* Details footer */}
      <div className="pt-2 border-t border-[#1C2942] flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <div>
          <span>Price Impact: </span>
          <span
            className={clsx(
              'font-semibold',
              priceImpact > 3
                ? 'text-red-400'
                : priceImpact > 1
                ? 'text-amber-400'
                : 'text-emerald-400'
            )}
          >
            {priceImpact < 0.01 ? '<0.01%' : `${priceImpact.toFixed(2)}%`}
          </span>
        </div>
        {minOutputFormatted && (
          <div>
            <span>Min Received: </span>
            <span className="text-slate-200 font-semibold">{minOutputFormatted} {toSymbol}</span>
          </div>
        )}
      </div>
    </div>
  )
}
