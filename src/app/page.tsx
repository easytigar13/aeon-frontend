import Link from 'next/link'
import { ArrowRight, Flame, Lock, TrendingUp, Zap, Shield, Crown, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { LiveHomepageStats } from '@/components/LiveHomepageStats'

export default function HomePage() {
  return (
    <div className="relative">
      {/* Background glow */}
      <div className="absolute inset-0 bg-aeon-glow pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px]
                      bg-aeon-400/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                        bg-aeon-400/10 border border-aeon-400/20 mb-8">
          <Zap size={12} className="text-aeon-400" />
          <span className="text-xs font-mono text-aeon-400 font-bold tracking-wider uppercase">
            Fair Launch — Deployer holds 0 AEON
          </span>
        </div>

        <h1 className="font-display font-bold text-5xl md:text-7xl leading-none mb-6">
          <span className="text-text-primary">The DEX that</span>
          <br />
          <span className="text-gradient-aeon">earns before it prints</span>
        </h1>

        <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          AEON is a ve(3,3) DEX on Avalanche where emissions are anchored to real trading fees.
          <br />
          <span className="font-mono text-aeon-400">Weekly Emissions = Last Epoch Fees ÷ 10</span>
        </p>

        <div className="flex flex-wrap justify-center gap-3 mb-16">
          <Link href="/swap" className="btn-primary flex items-center gap-2">
            Start Trading <ArrowRight size={16} />
          </Link>
          <Link href="/lock" className="btn-secondary flex items-center gap-2">
            Lock & Earn
          </Link>
          <Link href="/dashboard" className="btn-ghost flex items-center gap-2">
            View Stats <TrendingUp size={16} />
          </Link>
        </div>

        {/* Live stats bar */}
        <LiveHomepageStats />
      </section>

      {/* Why AEON is Different — The Core Pitch */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
            <AlertTriangle size={12} className="text-red-400" />
            <span className="text-xs font-mono text-red-400 font-bold tracking-wider uppercase">Why most ve(3,3) fail</span>
          </div>
          <h2 className="font-display font-bold text-4xl md:text-5xl text-text-primary mb-6 leading-tight">
            Farmers killed every<br />protocol before this one.
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed">
            Mercenary capital arrives, chases the highest APR, dumps the token, and leaves.
            The protocol bleeds to zero. It's happened every single time — until now.
          </p>
        </div>

        {/* The flip */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* Before / broken model */}
          <div className="card p-8 border-red-500/20 bg-red-500/5 relative overflow-hidden">
            <div className="absolute top-4 right-4 text-xs font-mono text-red-400/40 font-bold uppercase tracking-widest">Every other ve(3,3)</div>
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center mb-5">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
            <h3 className="font-display font-bold text-xl text-text-primary mb-4">The broken loop</h3>
            <div className="space-y-3">
              {[
                'Farmer arrives for the highest APR',
                'Farmer votes for their own pool',
                'Farmer earns emissions → sells',
                'Token price collapses',
                'APR collapses. Everyone leaves.',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-2xs font-mono text-red-400">{i + 1}</span>
                  </div>
                  <span className="text-sm text-text-secondary">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <span className="text-xs font-mono text-red-400">Result: −99% in 3 months. Every time.</span>
            </div>
          </div>

          {/* AEON model */}
          <div className="card p-8 border-aeon-400/20 bg-aeon-400/5 relative overflow-hidden">
            <div className="absolute top-4 right-4 text-xs font-mono text-aeon-400/40 font-bold uppercase tracking-widest">AEON</div>
            <div className="w-10 h-10 rounded-xl bg-aeon-400/10 flex items-center justify-center mb-5">
              <Crown size={20} className="text-aeon-400" />
            </div>
            <h3 className="font-display font-bold text-xl text-text-primary mb-4">Farmers serve token holders</h3>
            <div className="space-y-3">
              {[
                'Farmer must provide real LP first',
                'LP generates real trading fees',
                'Fees flow to veNFT voters (token holders)',
                'Token holders vote → decide who earns',
                'Farmers who serve holders get rewarded',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-aeon-400/20 border border-aeon-400/30 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={10} className="text-aeon-400" />
                  </div>
                  <span className="text-sm text-text-secondary">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20">
              <span className="text-xs font-mono text-aeon-400">Token holders are the bosses. Always.</span>
            </div>
          </div>
        </div>

        {/* The big insight */}
        <div className="card-raised border-gradient p-10 md:p-14 text-center relative overflow-hidden mb-16">
          <div className="absolute inset-0 bg-gradient-to-br from-aeon-400/5 via-transparent to-violet-500/5 pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-aeon-400/10 border border-aeon-400/20 mb-6">
              <Zap size={12} className="text-aeon-400" />
              <span className="text-xs font-mono text-aeon-400 font-bold tracking-wider uppercase">The Inversion</span>
            </div>
            <h2 className="font-display font-bold text-4xl md:text-5xl text-text-primary mb-6 leading-tight">
              You can't farm AEON<br />
              <span className="text-gradient-aeon">without feeding the holders first.</span>
            </h2>
            <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed mb-10">
              Every emission in AEON is backed by a fee that already happened.
              Every farmer that wants a reward must first create value for someone who already holds.
              That's not a rule — it's the architecture.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/lock" className="btn-primary flex items-center gap-2">
                Become a Holder <Crown size={16} />
              </Link>
              <Link href="/earn" className="btn-secondary flex items-center gap-2">
                Provide Liquidity <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </div>

        {/* The Sticky LP Flywheel teaser */}
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          {[
            {
              icon: <TrendingUp size={20} className="text-aeon-400" />,
              title: 'APR with a floor',
              body: 'If APR is 20% and price is $1, price is defended for the entire year — every emission is paid for by fees that already exist. No dilution from thin air.',
              color: 'aeon',
            },
            {
              icon: <Crown size={20} className="text-violet-400" />,
              title: 'Sticky LP magnet',
              body: 'LPs who earn real fees don\'t leave. Holders who earn from those fees don\'t sell. Both groups reinforce each other. That\'s the magnet.',
              color: 'violet',
            },
            {
              icon: <Flame size={20} className="text-emerald-400" />,
              title: 'Flywheel, not spiral',
              body: 'Once the loop is running, more LP → more fees → more holder yield → higher price → better APR for everyone. Upward only.',
              color: 'emerald',
            },
          ].map(item => (
            <div key={item.title} className={`card p-6 border-${item.color === 'aeon' ? 'aeon-400' : item.color === 'violet' ? 'violet-400' : 'emerald-400'}/10`}>
              <div className="w-10 h-10 rounded-xl bg-bg-raised flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-text-primary mb-2">{item.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <p className="font-display font-bold text-2xl text-text-primary">
            Join the revolution of the new era ve(3,3). <span className="text-gradient-aeon">Be early. Be a holder.</span>
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl text-text-primary mb-3">
            The Flywheel
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            Every component reinforces every other. Real yield creates real value.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <TrendingUp className="text-aeon-400" size={24} />,
              title: 'Trade & Generate Fees',
              body: '46 pools across vAMM, CL, and DLMM. 95% of fees go to veNFT voters of each pool in the pool\'s native tokens.',
              accent: 'aeon',
            },
            {
              icon: <Lock className="text-violet-400" size={24} />,
              title: 'Lock AEON, Vote, Earn',
              body: 'Lock AEON for up to 4 years to get a veNFT. Vote for gauges to direct emissions and earn trading fees from voted pools.',
              accent: 'violet',
            },
            {
              icon: <Flame className="text-emerald-400" size={24} />,
              title: 'Buybacks Burn Forever',
              body: '5% of all fees are used to buy AEON on the open market and burn it permanently. Less supply = more value per token.',
              accent: 'emerald',
            },
          ].map(item => (
            <div key={item.title} className="card p-6 hover:border-bg-hover transition-colors">
              <div className="w-10 h-10 rounded-xl bg-bg-raised flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-lg text-text-primary mb-2">
                {item.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The Furnace */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="card-raised border-gradient p-8 md:p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-aeon-400/5 via-transparent to-violet-500/5 pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 mb-6">
              <Flame size={20} className="text-aeon-400" />
              <span className="font-display font-bold text-aeon-400 uppercase tracking-widest text-sm">
                The Furnace
              </span>
            </div>
            <h2 className="font-display font-bold text-4xl text-text-primary mb-4">
              Burn AEON.<br />Never lose your voice.
            </h2>
            <p className="text-text-secondary text-lg max-w-xl mx-auto mb-8">
              Burn AEON permanently to receive a soulbound NFT with static voting power that never decays.
              Earn 95% of protocol fee share + 5% emission bonus — forever.
            </p>
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {[
                { label: 'Voting Power', value: '1:1 with burned' },
                { label: 'Power Decay', value: 'Never' },
                { label: 'Fee Share', value: '95% of all fees' },
                { label: 'Transferable', value: 'No — Soulbound' },
              ].map(item => (
                <div key={item.label} className="card px-4 py-3 text-center min-w-[140px]">
                  <div className="text-sm font-bold text-text-primary mb-0.5">{item.value}</div>
                  <div className="text-2xs text-text-muted uppercase tracking-wider">{item.label}</div>
                </div>
              ))}
            </div>
            <Link href="/lock" className="btn-primary inline-flex items-center gap-2">
              Enter The Furnace <Flame size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* Pool types */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl text-text-primary mb-3">
            46 Pools at Launch
          </h2>
          <p className="text-text-secondary">Three pool types for every strategy</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              type: 'vAMM',
              label: 'Constant Product',
              desc: 'Classic x*y=k pools. Zero management, full range liquidity. Best for retail buying and aggregator routing.',
              pools: ['AEON/AVAX 1%', 'AEON/USDC 1%', 'AVAX/USDC 0.3%'],
              badge: 'pool-type-vamm',
              count: '3 pools',
            },
            {
              type: 'CL',
              label: 'Concentrated Liquidity',
              desc: 'Uniswap V3 style. Provide in ±2.5%, ±5%, ±10%, or full range. Higher capital efficiency, higher fees.',
              pools: ['AEON/AVAX', 'AEON/USDC', 'WAVAX/USDC', '+17 more'],
              badge: 'pool-type-cl',
              count: '20 pools',
            },
            {
              type: 'DLMM',
              label: 'Discrete Liquidity Bins',
              desc: 'Trader Joe LB style. Zero slippage within active bin. Bin steps from 1bps (stables) to 100bps (volatile).',
              pools: ['USDC/USDT 1bps', 'AEON/AVAX 100bps', 'WBTCB/WBTCE 5bps', '+20 more'],
              badge: 'pool-type-dlmm',
              count: '23 pools',
            },
          ].map(item => (
            <div key={item.type} className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <span className={item.badge}>{item.type}</span>
                <span className="text-xs text-text-muted font-mono">{item.count}</span>
              </div>
              <h3 className="font-display font-semibold text-text-primary mb-2">{item.label}</h3>
              <p className="text-text-secondary text-sm mb-4 leading-relaxed">{item.desc}</p>
              <div className="space-y-1">
                {item.pools.map(p => (
                  <div key={p} className="text-xs font-mono text-text-muted flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-bg-border" />
                    {p}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pre-Genesis Protocol Liquidity */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <div className="card p-8 border-aeon-400/20 bg-gradient-to-r from-aeon-400/5 to-transparent">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-aeon-400/15 flex items-center justify-center shrink-0">
              <TrendingUp size={24} className="text-aeon-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-bold text-xl text-text-primary mb-2">
                Protocol-Owned Liquidity — Forever
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed max-w-2xl">
                10% of the total AEON supply is held by the protocol at genesis. This allocation is never sold — it is permanently deployed as liquidity in the AEON/USDC pool and continuously compounds. Every epoch, fees earned are re-added to the pool. This ensures baseline liquidity exists at all times and grows with the protocol, with no team extraction ever.
              </p>
              <div className="flex gap-4 mt-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-aeon-400" />
                  <span className="text-xs font-mono text-text-muted">10% of supply, protocol-controlled</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-mono text-text-muted">100% compounding into AEON/USDC</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-violet-400" />
                  <span className="text-xs font-mono text-text-muted">Never withdrawable, never sold</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="max-w-7xl mx-auto px-4 py-16 pb-24">
        <div className="card p-8 flex flex-col md:flex-row items-center gap-8">
          <div className="w-16 h-16 rounded-2xl bg-bg-raised flex items-center justify-center shrink-0">
            <Shield size={28} className="text-aeon-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-bold text-xl text-text-primary mb-2">
              232 Tests. 232,000+ Executions.
            </h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Every attack vector tested: flash loans, oracle manipulation, MEV sandwiching, governance takeover,
              reentrancy, gas griefing, approve race conditions, checkpoint DoS, and 15 additional edge cases.
              All 232 tests passing with 1,000 fuzz runs each before mainnet deploy.
            </p>
          </div>
          <a
            href="https://github.com/easytigar13/aeon-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary shrink-0 text-sm"
          >
            View on GitHub
          </a>
        </div>
      </section>
    </div>
  )
}
