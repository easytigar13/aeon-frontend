import Link from 'next/link'
import { ArrowRight, Flame, Lock, Vote, TrendingUp, Zap, Shield } from 'lucide-react'

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {[
            { label: 'Total Value Locked', value: '$—',     sub: 'across 46 pools' },
            { label: 'AEON Price',         value: '$—',     sub: 'Chainlink + TWAP' },
            { label: 'Total Burned',        value: '— AEON', sub: 'via buybacks + furnace' },
            { label: 'Epoch APR',           value: '—%',    sub: 'current epoch' },
          ].map(stat => (
            <div key={stat.label} className="card p-4 text-center">
              <div className="stat-value text-2xl mb-1">{stat.value}</div>
              <div className="stat-label mb-1">{stat.label}</div>
              <div className="text-2xs text-text-muted">{stat.sub}</div>
            </div>
          ))}
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
