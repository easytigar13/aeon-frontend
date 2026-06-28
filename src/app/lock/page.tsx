'use client'
import { useState } from 'react'
import { Lock, Flame, Info, ArrowRight } from 'lucide-react'
import { clsx } from 'clsx'

type Tab = 'lock' | 'furnace'

const LOCK_DURATIONS = [
  { label: '1 Week',   days: 7,    multiplier: 0.003 },
  { label: '1 Month',  days: 30,   multiplier: 0.019 },
  { label: '6 Months', days: 182,  multiplier: 0.125 },
  { label: '1 Year',   days: 365,  multiplier: 0.250 },
  { label: '2 Years',  days: 730,  multiplier: 0.500 },
  { label: '4 Years',  days: 1461, multiplier: 1.000 },
]

export default function LockPage() {
  const [tab,        setTab]        = useState<Tab>('lock')
  const [lockAmount, setLockAmount] = useState('')
  const [lockDays,   setLockDays]   = useState(1461)
  const [burnAmount, setBurnAmount] = useState('')

  const MAXTIME = 4 * 365
  const multiplier = Math.min(lockDays / MAXTIME, 1)
  const votingPower = lockAmount ? (parseFloat(lockAmount) * multiplier).toFixed(4) : '0'

  const preset = LOCK_DURATIONS.find(d => d.days === lockDays)

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="font-display font-bold text-3xl text-text-primary mb-2">Lock & Burn</h1>
        <p className="text-text-secondary">
          Lock AEON to get voting power. Or burn permanently for eternal rewards.
        </p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-6">
        <button
          onClick={() => setTab('lock')}
          className={clsx(
            'flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
            tab === 'lock'
              ? 'bg-bg-base text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          <Lock size={14} />
          Lock (veNFT)
        </button>
        <button
          onClick={() => setTab('furnace')}
          className={clsx(
            'flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
            tab === 'furnace'
              ? 'bg-bg-base text-text-primary shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          <Flame size={14} className={tab === 'furnace' ? 'text-aeon-400' : ''} />
          The Furnace
        </button>
      </div>

      {tab === 'lock' ? (
        <LockPanel
          amount={lockAmount}
          setAmount={setLockAmount}
          lockDays={lockDays}
          setLockDays={setLockDays}
          votingPower={votingPower}
          multiplier={multiplier}
          preset={preset}
        />
      ) : (
        <FurnacePanel
          amount={burnAmount}
          setAmount={setBurnAmount}
        />
      )}

      {/* Your positions */}
      <div className="card p-4 mt-6">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
          Your Positions
        </div>
        <div className="text-center py-6 text-text-muted text-sm">
          Connect wallet to view your veNFTs and Furnace position
        </div>
      </div>
    </div>
  )
}

function LockPanel({
  amount, setAmount, lockDays, setLockDays, votingPower, multiplier, preset
}: {
  amount: string
  setAmount: (v: string) => void
  lockDays: number
  setLockDays: (v: number) => void
  votingPower: string
  multiplier: number
  preset: typeof LOCK_DURATIONS[number] | undefined
}) {
  const MAXTIME = 4 * 365

  return (
    <div className="space-y-4">
      {/* Amount */}
      <div className="card p-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
          Amount to Lock
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.0"
            className="flex-1 bg-transparent text-2xl font-mono text-text-primary
                       placeholder-text-muted focus:outline-none"
          />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-raised border border-bg-border">
              <div className="w-6 h-6 rounded-full bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
              <span className="font-display font-semibold text-sm">AEON</span>
            </div>
            <span className="text-2xs text-text-muted font-mono">Balance: —</span>
          </div>
        </div>
        <div className="flex gap-1 mt-2">
          {['25%', '50%', '75%', 'MAX'].map(p => (
            <button key={p} className="text-2xs text-text-muted hover:text-aeon-400 px-2 py-0.5
                                       rounded border border-bg-border hover:border-aeon-400/30
                                       transition-all font-mono">
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Duration */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider">
            Lock Duration
          </div>
          <span className="text-xs font-mono text-text-secondary">
            {preset?.label || `${lockDays} days`}
          </span>
        </div>

        {/* Presets */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {LOCK_DURATIONS.map(d => (
            <button
              key={d.days}
              onClick={() => setLockDays(d.days)}
              className={clsx(
                'py-2 rounded-xl text-sm font-medium transition-all text-center',
                lockDays === d.days
                  ? 'bg-aeon-400/15 text-aeon-400 border border-aeon-400/30'
                  : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover'
              )}
            >
              <div className="font-semibold">{d.label}</div>
              <div className="text-2xs opacity-70">{(d.multiplier * 100).toFixed(0)}% power</div>
            </button>
          ))}
        </div>

        {/* Custom slider */}
        <div>
          <input
            type="range"
            min={7}
            max={1461}
            value={lockDays}
            onChange={e => setLockDays(parseInt(e.target.value))}
            className="w-full accent-aeon-400"
          />
          <div className="flex justify-between text-2xs text-text-muted font-mono mt-1">
            <span>7 days</span>
            <span>4 years</span>
          </div>
        </div>
      </div>

      {/* Voting power preview */}
      <div className="card-raised p-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
          You will receive
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-2xl font-display font-bold text-text-primary num">{votingPower}</div>
            <div className="text-xs text-text-muted mt-0.5">veAEON (voting power)</div>
          </div>
          <div>
            <div className="text-2xl font-display font-bold text-aeon-400">{(multiplier * 100).toFixed(0)}%</div>
            <div className="text-xs text-text-muted mt-0.5">of max power</div>
          </div>
        </div>

        {/* Power bar */}
        <div className="mt-3 h-2 bg-bg-base rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-aeon-600 to-aeon-400 rounded-full transition-all"
            style={{ width: `${multiplier * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-2xs text-text-muted font-mono mt-1">
          <span>Expires: {lockDays} days from now</span>
          <span>Power decays linearly</span>
        </div>
      </div>

      <div className="bg-bg-raised border border-bg-border rounded-xl p-3 flex gap-2">
        <Info size={14} className="text-text-muted shrink-0 mt-0.5" />
        <p className="text-xs text-text-muted leading-relaxed">
          Voting power decays linearly over the lock period. You can extend or add more AEON at any time.
          You must reset your vote before withdrawing after lock expires.
        </p>
      </div>

      <button
        disabled={!amount || parseFloat(amount) <= 0}
        className="btn-primary w-full flex items-center justify-center gap-2 py-4"
      >
        <Lock size={16} />
        Lock AEON & Mint veNFT
      </button>
    </div>
  )
}

function FurnacePanel({ amount, setAmount }: { amount: string; setAmount: (v: string) => void }) {
  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="card-raised border-gradient p-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-aeon-400/5 to-transparent pointer-events-none" />
        <div className="relative">
          <Flame size={32} className="text-aeon-400 mx-auto mb-3" />
          <h2 className="font-display font-bold text-xl text-text-primary mb-2">The Furnace</h2>
          <p className="text-sm text-text-secondary leading-relaxed">
            Burn AEON permanently. Receive a soulbound NFT with static voting power that never decays.
            Earn your share of 95% of all protocol fees forever.
          </p>
        </div>
      </div>

      {/* Comparison */}
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            title: 'veNFT (Lock)',
            items: ['Power decays over time', 'Transferable NFT', 'Can withdraw after expiry', 'Time-weighted rewards'],
            color: 'violet',
          },
          {
            title: 'Furnace (Burn)',
            items: ['Power never decays', 'Soulbound — non-transferable', 'Cannot withdraw — permanent', 'Static proportional rewards'],
            color: 'aeon',
            highlight: true,
          },
        ].map(col => (
          <div key={col.title} className={clsx(
            'card p-4',
            col.highlight && 'border-aeon-400/20 bg-aeon-400/5'
          )}>
            <div className={clsx(
              'text-sm font-display font-semibold mb-3',
              col.color === 'aeon' ? 'text-aeon-400' : 'text-violet-400'
            )}>
              {col.title}
            </div>
            <ul className="space-y-1.5">
              {col.items.map(item => (
                <li key={item} className="text-xs text-text-secondary flex gap-1.5">
                  <span className={col.color === 'aeon' ? 'text-aeon-400' : 'text-violet-400'}>•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Burn amount */}
      <div className="card p-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
          Amount to Burn
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.0"
            className="flex-1 bg-transparent text-2xl font-mono text-text-primary
                       placeholder-text-muted focus:outline-none"
          />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-raised border border-bg-border">
              <div className="w-6 h-6 rounded-full bg-aeon-400/20 flex items-center justify-center text-2xs font-bold text-aeon-400">A</div>
              <span className="font-display font-semibold text-sm">AEON</span>
            </div>
            <span className="text-2xs text-text-muted font-mono">Balance: —</span>
          </div>
        </div>
      </div>

      {/* Preview */}
      {amount && parseFloat(amount) > 0 && (
        <div className="card-raised p-4 animate-fade-in">
          <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You receive</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-display font-bold text-aeon-400 num">{amount}</div>
              <div className="text-xs text-text-muted">Furnace voting power (permanent)</div>
            </div>
            <div>
              <div className="text-2xl font-display font-bold text-text-primary">1</div>
              <div className="text-xs text-text-muted">Soulbound NFT</div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex gap-2">
        <Info size={14} className="text-red-400 shrink-0 mt-0.5" />
        <p className="text-xs text-red-400 leading-relaxed">
          <strong>This action is irreversible.</strong> Burned AEON goes to the dead address permanently.
          You receive a soulbound NFT — it cannot be transferred, sold, or recovered.
        </p>
      </div>

      <button
        disabled={!amount || parseFloat(amount) <= 0}
        className="w-full py-4 rounded-xl bg-aeon-400 hover:bg-aeon-300 text-bg-base font-semibold
                   transition-all flex items-center justify-center gap-2
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Flame size={16} />
        Burn AEON Forever
      </button>
    </div>
  )
}
