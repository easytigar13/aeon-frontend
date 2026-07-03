import Link from 'next/link'
import { ArrowRight, Flame, Lock, TrendingUp, Zap, Shield, Crown, AlertTriangle, CheckCircle2, ChevronRight, Percent, Users, Unlock, ShieldCheck, Coins, Layers, Rocket, Route } from 'lucide-react'
import { LiveHomepageStats } from '@/components/LiveHomepageStats'
import { FlywheelDiagram } from '@/components/FlywheelDiagram'
import { Reveal } from '@/components/Reveal'

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-aeon-glow pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px]
                      bg-aeon-400/5 blur-[120px] rounded-full pointer-events-none animate-pulse-slow" />
      <div className="absolute top-40 -left-40 w-[400px] h-[400px]
                      bg-violet-500/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute top-96 -right-40 w-[400px] h-[400px]
                      bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-4 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                        bg-aeon-400/10 border border-aeon-400/20 mb-8 animate-fade-in">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-aeon-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-aeon-400" />
          </span>
          <span className="text-xs font-mono text-aeon-400 font-bold tracking-wider uppercase">
            Live on Robinhood Chain — Genesis Epoch 0
          </span>
        </div>

        <h1 className="font-display font-bold text-5xl md:text-7xl leading-none mb-6 animate-fade-in" style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}>
          <span className="text-text-primary">The DEX that</span>
          <br />
          <span className="text-gradient-aeon">earns before it prints</span>
        </h1>

        <p className="text-text-secondary text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in" style={{ animationDelay: '160ms', animationFillMode: 'backwards' }}>
          AEON is a ve(3,3) DEX on Robinhood Chain where emissions are anchored to real trading fees.
          <br />
          <span className="font-mono text-aeon-400">Weekly Emissions = Last Epoch Fees ÷ 10</span>
        </p>

        <div className="flex flex-wrap justify-center gap-3 mb-4 animate-fade-in" style={{ animationDelay: '240ms', animationFillMode: 'backwards' }}>
          <Link href="/swap" className="btn-primary flex items-center gap-2 hover:shadow-[0_0_30px_rgba(255,184,0,0.35)] hover:scale-[1.03] active:scale-[0.97]">
            Start Trading <ArrowRight size={16} />
          </Link>
          <Link href="/lock" className="btn-secondary flex items-center gap-2 hover:scale-[1.03] active:scale-[0.97]">
            Lock & Earn
          </Link>
          <Link href="/dashboard" className="btn-ghost flex items-center gap-2 hover:scale-[1.03] active:scale-[0.97]">
            View Stats <TrendingUp size={16} />
          </Link>
        </div>

        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mb-16 text-2xs font-mono text-text-muted animate-fade-in" style={{ animationDelay: '300ms', animationFillMode: 'backwards' }}>
          <span>Zero team allocation</span>
          <span className="text-bg-border">·</span>
          <span>80% of fees to voters</span>
          <span className="text-bg-border">·</span>
          <span>50,000 AEON burned at genesis</span>
        </div>

        {/* Live stats bar */}
        <LiveHomepageStats />
      </section>

      {/* Why AEON is Different — The Core Pitch */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-bg-raised border border-bg-border mb-6">
            <AlertTriangle size={12} className="text-text-muted" />
            <span className="text-xs font-mono text-text-muted font-bold tracking-wider uppercase">A known failure mode</span>
          </div>
          <h2 className="font-display font-bold text-4xl md:text-5xl text-text-primary mb-6 leading-tight">
            Most ve(3,3) protocols don't<br />survive their own farmers.
          </h2>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto leading-relaxed">
            Mercenary capital arrives, chases the highest APR, dumps the token, and leaves.
            It's the most common failure pattern in ve(3,3) design — AEON's fee-before-emission
            structure exists specifically to break that loop.
          </p>
        </Reveal>

        {/* The flip */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* AEON model — left side */}
          <Reveal className="card p-8 border-emerald-400/20 bg-emerald-400/5 relative overflow-hidden transition-transform duration-300 hover:-translate-y-1">
            <div className="absolute top-4 right-4 text-xs font-mono text-emerald-400/40 font-bold uppercase tracking-widest">AEON</div>
            <div className="w-10 h-10 rounded-xl bg-emerald-400/10 flex items-center justify-center mb-5">
              <Crown size={20} className="text-emerald-400" />
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
                  <div className="w-5 h-5 rounded-full bg-emerald-400/20 border border-emerald-400/30 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={10} className="text-emerald-400" />
                  </div>
                  <span className="text-sm text-text-secondary">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 rounded-xl bg-emerald-400/10 border border-emerald-400/20">
              <span className="text-xs font-mono text-emerald-400">By contract, token holders get paid first — every time.</span>
            </div>
          </Reveal>

          {/* Before / broken model — right side */}
          <Reveal delay={120} className="card p-8 border-yellow-500/20 bg-yellow-500/5 relative overflow-hidden transition-transform duration-300 hover:-translate-y-1">
            <div className="absolute top-4 right-4 text-xs font-mono text-yellow-400/50 font-bold uppercase tracking-widest">Every other ve(3,3)</div>
            <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center mb-5">
              <AlertTriangle size={20} className="text-yellow-400" />
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
                  <div className="w-5 h-5 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-2xs font-mono text-yellow-400">{i + 1}</span>
                  </div>
                  <span className="text-sm text-text-secondary">{step}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <span className="text-xs font-mono text-yellow-400">Typical outcome: token collapses, protocol dies.</span>
            </div>
          </Reveal>
        </div>

        {/* The big insight */}
        <Reveal className="card-raised border-gradient p-10 md:p-14 text-center relative overflow-hidden mb-16">
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
              <Link href="/lock" className="btn-primary flex items-center gap-2 hover:scale-[1.03] active:scale-[0.97]">
                Become a Holder <Crown size={16} />
              </Link>
              <Link href="/earn" className="btn-secondary flex items-center gap-2 hover:scale-[1.03] active:scale-[0.97]">
                Provide Liquidity <ChevronRight size={16} />
              </Link>
            </div>
          </div>
        </Reveal>

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
          ].map((item, i) => (
            <Reveal key={item.title} delay={i * 100} className={`card p-6 border-${item.color === 'aeon' ? 'aeon-400' : item.color === 'violet' ? 'violet-400' : 'emerald-400'}/10 transition-all duration-300 hover:-translate-y-1 hover:border-opacity-40`}>
              <div className="w-10 h-10 rounded-xl bg-bg-raised flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-text-primary mb-2">{item.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </Reveal>
          ))}
        </div>

        <Reveal className="text-center mt-8">
          <p className="font-display font-bold text-2xl text-text-primary">
            Join the revolution of the new era ve(3,3). <span className="text-gradient-aeon">Be early. Be a holder.</span>
          </p>
        </Reveal>
      </section>

      {/* Why buy AEON */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl md:text-4xl text-text-primary mb-3">
            Why buy AEON
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            Not a pitch about price. A pitch about mechanics you can read in the contracts.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <TrendingUp size={20} className="text-aeon-400" />,
              title: 'Fees fund emissions, not thin air',
              body: 'New AEON each epoch is minted as last epoch\'s trading fees ÷ 10 — computed from fees that already happened. No trading, no new supply.',
            },
            {
              icon: <Percent size={20} className="text-aeon-400" />,
              title: '80% of every fee, by contract',
              body: 'Every swap fee splits 80/20 — 80% straight to veAEON voters, 20% to buybacks. Not a setting someone can quietly change later — the contract.',
            },
            {
              icon: <Flame size={20} className="text-aeon-400" />,
              title: 'Two burn mechanisms, running forever',
              body: 'Buybacks burn AEON on every trade. The Furnace lets anyone burn AEON for permanent voting power. Both are one-way, real supply sinks.',
            },
            {
              icon: <Users size={20} className="text-aeon-400" />,
              title: 'Zero team allocation',
              body: 'All 90,000 genesis AEON went to pool liquidity or was burned. None held back for a team — no vesting cliff waiting to dump on holders.',
            },
            {
              icon: <Lock size={20} className="text-aeon-400" />,
              title: 'Locking is real governance',
              body: 'veAEON votes decide which pools get emissions and fee share — a vote with direct financial consequences, not a symbolic poll.',
            },
          ].map((item, i) => (
            <Reveal key={item.title} delay={i * 80} className="card p-6 transition-all duration-300 hover:border-aeon-400/30 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-aeon-400/10 flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-lg text-text-primary mb-2">{item.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="text-center mb-4">
          <h2 className="font-display font-bold text-3xl text-text-primary mb-3">
            The Flywheel
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            Every component reinforces every other. Real yield creates real value.
          </p>
        </Reveal>

        <Reveal delay={100} className="mb-8">
          <FlywheelDiagram />
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <TrendingUp className="text-aeon-400" size={24} />,
              title: 'Trade & Generate Fees',
              body: '3 pools at genesis — AEON/ETH, AEON/USDG, ETH/USDG. 80% of every fee goes straight to veNFT voters of that pool.',
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
              title: 'Buybacks Burn & Reward',
              body: '20% of fees route to the buyback engine — half swapped to AEON and burned forever, half redistributed in liquid AEON to Furnace burners.',
              accent: 'emerald',
            },
          ].map((item, i) => (
            <Reveal key={item.title} delay={i * 100} className="card p-6 transition-all duration-300 hover:border-bg-hover hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-bg-raised flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-lg text-text-primary mb-2">
                {item.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* The 80/20 statement */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <Reveal className="text-center py-10">
          <p className="text-xs font-mono text-text-muted uppercase tracking-widest mb-4">Every single fee, every single swap</p>
          <div className="flex items-center justify-center gap-6 md:gap-12 flex-wrap">
            <div>
              <div className="font-display font-bold text-6xl md:text-8xl text-gradient-aeon leading-none">80%</div>
              <div className="text-sm text-text-secondary mt-2">straight to voters</div>
            </div>
            <div className="text-3xl text-text-muted font-display">+</div>
            <div>
              <div className="font-display font-bold text-6xl md:text-8xl text-gradient-violet leading-none">20%</div>
              <div className="text-sm text-text-secondary mt-2">burned & redistributed</div>
            </div>
          </div>
          <p className="text-text-muted text-sm mt-6 max-w-lg mx-auto">Forever, by contract — not by promise.</p>
        </Reveal>
      </section>

      {/* The Furnace */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="card-raised border-gradient p-8 md:p-12 text-center relative overflow-hidden">
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
              Earn a share of every emission's Furnace bonus, plus liquid AEON from buyback redistribution — forever.
            </p>
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {[
                { label: 'Voting Power', value: '1:1 with burned' },
                { label: 'Power Decay', value: 'Never' },
                { label: 'Rewards', value: 'Emission bonus + buyback share' },
                { label: 'Transferable', value: 'No — Soulbound' },
              ].map(item => (
                <div key={item.label} className="card px-4 py-3 text-center min-w-[140px] transition-all duration-300 hover:border-aeon-400/30 hover:-translate-y-0.5">
                  <div className="text-sm font-bold text-text-primary mb-0.5">{item.value}</div>
                  <div className="text-2xs text-text-muted uppercase tracking-wider">{item.label}</div>
                </div>
              ))}
            </div>
            <Link href="/lock" className="btn-primary inline-flex items-center gap-2 hover:shadow-[0_0_30px_rgba(255,184,0,0.35)] hover:scale-[1.03] active:scale-[0.97]">
              Enter The Furnace <Flame size={16} />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Why provide liquidity */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl md:text-4xl text-text-primary mb-3">
            Why provide liquidity
          </h2>
          <p className="text-text-secondary max-w-xl mx-auto">
            No paywall, no admin switch on your fees, and a router that actually finds you.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              icon: <Unlock size={20} className="text-violet-400" />,
              title: 'No more paywall',
              body: 'The 100 AEON whitelist to add liquidity is gone. Any wallet can deposit into any pool right now, no approval needed.',
            },
            {
              icon: <ShieldCheck size={20} className="text-violet-400" />,
              title: 'Fees settle to you, no admin switch',
              body: "Fee accrual is a direct port of Aerodrome's audited-pattern design — claimFees() is fully permissionless and pays out exactly what your LP earned.",
            },
            {
              icon: <Coins size={20} className="text-violet-400" />,
              title: 'Stake for a second income stream',
              body: 'Unstaked LPs earn organic fees. Staked LPs earn those fees plus AEON emissions — and since emissions are fee-funded, that stream is real too.',
            },
            {
              icon: <Layers size={20} className="text-violet-400" />,
              title: 'Pick your liquidity style',
              body: "Full-range vAMM, concentrated CL ranges, or discrete DLMM bins — same pairs, three shapes. You're never locked into one strategy.",
            },
            {
              icon: <Rocket size={20} className="text-violet-400" />,
              title: 'Early LPs get a bigger slice',
              body: "Every new pair starts thin. The earlier you're in, the larger your share of that pool's fees before liquidity fills in behind you.",
            },
            {
              icon: <Route size={20} className="text-violet-400" />,
              title: 'Routing finds your liquidity automatically',
              body: 'Swaps search every path across every vAMM pool and execute whichever route pays out the most — liquidity you provide actually gets used.',
            },
          ].map((item, i) => (
            <Reveal key={item.title} delay={i * 80} className="card p-6 transition-all duration-300 hover:border-violet-400/30 hover:-translate-y-1">
              <div className="w-10 h-10 rounded-xl bg-violet-400/10 flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="font-display font-semibold text-lg text-text-primary mb-2">{item.title}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Pools */}
      <section className="max-w-7xl mx-auto px-4 py-16">
        <Reveal className="text-center mb-12">
          <h2 className="font-display font-bold text-3xl text-text-primary mb-3">
            3 Pools at Genesis
          </h2>
          <p className="text-text-secondary">vAMM to start — concentrated liquidity pools land next</p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { name: 'AEON / ETH',  desc: 'Seeded at genesis with 20,000 AEON paired against ETH.', fee: '1%' },
            { name: 'AEON / USDG', desc: 'Seeded at genesis with 20,000 AEON paired against USDG.', fee: '1%' },
            { name: 'ETH / USDG',  desc: 'The base trading pair between the chain\'s native asset and USDG.', fee: '0.3%' },
          ].map((item, i) => (
            <Reveal key={item.name} delay={i * 100} className="card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-bg-hover">
              <div className="flex items-center justify-between mb-4">
                <span className="pool-type-vamm">vAMM</span>
                <span className="text-xs text-text-muted font-mono">{item.fee} fee</span>
              </div>
              <h3 className="font-display font-semibold text-text-primary mb-2">{item.name}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{item.desc}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Genesis Epoch */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        <Reveal className="card p-8 border-aeon-400/20 bg-gradient-to-r from-aeon-400/5 to-transparent">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-aeon-400/15 flex items-center justify-center shrink-0">
              <TrendingUp size={24} className="text-aeon-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-display font-bold text-xl text-text-primary mb-2">
                Genesis Epoch — 90,000 AEON, Zero to the Team
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed max-w-2xl">
                At genesis, the protocol minted 90,000 AEON exactly once. 20,000 went into AEON/ETH liquidity, 20,000 into AEON/USDG liquidity,
                and 50,000 was burned via the Furnace and immediately voted 25,000/25,000 across both AEON pools — guaranteeing gauge weight
                from day one. None of it went to a deployer wallet or a team allocation. After genesis, the protocol runs on pure fee-anchored
                emissions, forever.
              </p>
              <div className="flex gap-4 mt-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-aeon-400" />
                  <span className="text-xs font-mono text-text-muted">40,000 AEON seeded as pool liquidity</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-mono text-text-muted">50,000 AEON burned permanently</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-violet-400" />
                  <span className="text-xs font-mono text-text-muted">0 AEON to the team</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Security */}
      <section className="max-w-7xl mx-auto px-4 py-16 pb-24">
        <Reveal className="card p-8 flex flex-col md:flex-row items-center gap-8">
          <div className="w-16 h-16 rounded-2xl bg-bg-raised flex items-center justify-center shrink-0">
            <Shield size={28} className="text-aeon-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-bold text-xl text-text-primary mb-2">
              Built and Tested Against Live Chain State
            </h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Every contract was tested against a live Robinhood Chain mainnet fork before deployment — TWAP directionality, oracle pricing,
              fee accounting, and the exact genesis mint/burn/vote split were all verified on-chain before a single transaction broadcast.
            </p>
          </div>
          <a
            href="https://github.com/easytigar13/aeon-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary shrink-0 text-sm hover:scale-[1.03] active:scale-[0.97]"
          >
            View on GitHub
          </a>
        </Reveal>
      </section>
    </div>
  )
}
