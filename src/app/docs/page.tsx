'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { CONTRACTS, TOKENS, EPOCH_CONFIG } from '@/config/contracts'

const NAV = [
  { id: 'overview',       label: 'Overview' },
  { id: 'how-it-works',  label: 'How It Works' },
  { id: 'pool-architectures', label: 'Pool Architectures' },
  { id: 'the-furnace',   label: 'The Furnace' },
  { id: 'tokenomics',    label: 'Tokenomics' },
  { id: 'guide-swap',    label: '→ How to Swap',            indent: true },
  { id: 'guide-earn',    label: '→ Earn (LP + Gauge)',      indent: true },
  { id: 'guide-lock',    label: '→ Lock (veNFT)',           indent: true },
  { id: 'guide-vote',    label: '→ Vote',                   indent: true },
  { id: 'guide-create-pool', label: '→ Create a Pool',      indent: true },
  { id: 'contracts',     label: 'Contract Addresses' },
  { id: 'integrations',  label: 'Integrations & Tools' },
]

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="font-display font-bold text-2xl text-text-primary mt-12 mb-4 scroll-mt-24 border-b border-bg-border pb-3">
      {children}
    </h2>
  )
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-display font-semibold text-lg text-text-primary mt-8 mb-3">{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-text-secondary leading-relaxed mb-4">{children}</p>
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 p-4 rounded-xl bg-aeon-400/5 border border-aeon-400/20 text-sm text-text-secondary leading-relaxed">
      {children}
    </div>
  )
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-aeon-400/10 border border-aeon-400/30 flex items-center justify-center text-sm font-bold font-mono text-aeon-400">{n}</div>
      <div>
        <div className="font-medium text-text-primary mb-1">{title}</div>
        <div className="text-sm text-text-secondary leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
function Addr({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-bg-border last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-xs font-mono text-aeon-400">{address.slice(0, 8)}…{address.slice(-6)}</span>
    </div>
  )
}

export default function DocsPage() {
  const [active, setActive] = useState('overview')
  const observer = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observer.current = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id)
        }
      },
      { rootMargin: '-30% 0px -60% 0px' }
    )
    NAV.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.current?.observe(el)
    })
    return () => observer.current?.disconnect()
  }, [])

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      <div className="flex gap-12">

        {/* Sidebar */}
        <aside className="hidden lg:block w-52 flex-shrink-0">
          <div className="sticky top-24 space-y-0.5">
            <div className="text-2xs font-mono text-text-muted uppercase tracking-widest mb-3 px-2">Documentation</div>
            {NAV.map(({ id, label, indent }) => (
              <a
                key={id}
                href={`#${id}`}
                className={clsx(
                  'block px-3 py-2 rounded-lg text-sm transition-all',
                  indent ? 'ml-3 text-xs' : '',
                  active === id
                    ? 'bg-aeon-400/10 text-aeon-400 font-medium'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-raised'
                )}
              >
                {label}
              </a>
            ))}
          </div>
        </aside>

        {/* Content */}
        <article className="flex-1 min-w-0 max-w-3xl">

          {/* Overview */}
          <div id="overview" className="scroll-mt-24">
            <div className="mb-2">
              <span className="text-2xs font-mono text-aeon-400 uppercase tracking-widest">Documentation</span>
            </div>
            <h1 className="font-display font-bold text-4xl text-text-primary mb-4">AEON Protocol</h1>
            <P>
              AEON is a ve(3,3) decentralized exchange on <strong className="text-text-primary">Robinhood Chain</strong> built around a simple rule: <strong className="text-text-primary">the USD value of emissions can never exceed 1/10th of a rolling 3-epoch average of fees</strong>. This anchors token value to real protocol revenue — no phantom yields, no inflation without demand.
            </P>
            <P>
              The protocol combines automated market making with a governance layer where locked AEON holders vote on where emissions go — and earn the fees from the pools they back. AEON launched fresh on Robinhood Chain (chain ID 4663) with a one-time genesis mint and zero allocation to the team.
            </P>
            <Note>
              <strong className="text-text-primary">Core rule:</strong> Each epoch's emission budget = (3-epoch rolling average of fees) ÷ {EPOCH_CONFIG.emissionRatio}, converted to AEON at the current oracle price and capped at 3× the previous epoch's mint. If the DEX averages $10,000 in fees per week, a maximum of $1,000 worth of AEON is emitted that epoch. Emissions are self-limiting.
            </Note>
          </div>

          {/* How It Works */}
          <H2 id="how-it-works">How It Works</H2>
          <P>
            AEON uses the ve(3,3) model — a combination of vote-escrow governance and game-theoretic staking — but with one critical fix: the emission rate is tied to actual revenue instead of being a fixed schedule.
          </P>

          <H3>The Flywheel</H3>
          <div className="my-6 p-5 rounded-xl bg-bg-raised border border-bg-border">
            <div className="grid grid-cols-3 gap-4 text-center text-sm">
              {[
                { icon: '💧', label: 'LPs add liquidity', sub: 'Earn trading fees' },
                { icon: '🗳️', label: 'Voters direct emissions', sub: `Earn ${EPOCH_CONFIG.feeVoterSplit}% of fees from voted pools` },
                { icon: '🔥', label: 'Furnace burns AEON', sub: 'Earn emission bonus + buyback share' },
              ].map(({ icon, label, sub }) => (
                <div key={label} className="flex flex-col items-center gap-2">
                  <div className="text-2xl">{icon}</div>
                  <div className="font-medium text-text-primary">{label}</div>
                  <div className="text-2xs text-text-muted">{sub}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-bg-border text-center text-xs text-text-muted font-mono">
              More volume → more fees → more emissions → more incentive to LP → more volume
            </div>
          </div>

          <H3>Fee Distribution — 80/20</H3>
          <P>
            Every swap generates a fee that is split at the protocol level:
          </P>
          <ul className="space-y-2 mb-4 ml-4">
            {[
              [`${EPOCH_CONFIG.feeVoterSplit}%`, 'goes directly to veNFT holders who voted for that pool'],
              [`${EPOCH_CONFIG.feeBuybackSplit}%`, 'routes to the Buyback Engine, split 50/50:'],
            ].map(([pct, desc]) => (
              <li key={pct} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="font-mono font-bold text-aeon-400 flex-shrink-0 w-8">{pct}</span>
                <span>{desc}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-2 mb-4 ml-12">
            {[
              ['burn', '10% of fees', 'swapped to AEON and burned forever'],
              ['redistribute', '10% of fees', 'swapped to AEON and redistributed to Furnace burners — liquid AEON, no unstaking required'],
            ].map(([id, pct, desc]) => (
              <li key={id} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="font-mono font-bold text-violet-400 flex-shrink-0 w-24">{pct}</span>
                <span>{desc}</span>
              </li>
            ))}
          </ul>

          <H3>Epoch Cycle</H3>
          <P>
            The protocol runs on weekly epochs. At the end of each epoch:
          </P>
          <ol className="space-y-2 mb-4 ml-4 list-decimal text-sm text-text-secondary">
            <li>Protocol tallies all fees collected across every pool</li>
            <li>New AEON is minted so its USD value equals a rolling 3-epoch average of fees ÷ {EPOCH_CONFIG.emissionRatio}, converted through AEON's oracle price and capped at 3× the previous epoch's mint</li>
            <li>{EPOCH_CONFIG.emissionVoterSplit}% of that mint goes to gauges proportional to vote weight, {EPOCH_CONFIG.emissionFurnaceSplit}% goes to the Furnace as a bonus</li>
            <li>LPs staked in those gauges earn AEON emissions throughout the next epoch</li>
          </ol>

          {/* Pool Architectures */}
          <H2 id="pool-architectures">Pool Architectures</H2>
          <P>
            AEON's pools are standard vAMM (constant-product, x*y=k) — deposit both tokens, earn fees across the entire price curve, zero management. Same audited-pattern fee accounting as Aerodrome/Velodrome, and the only architecture that feeds AEON's official vote-weighted emissions (veNFT holders vote for vAMM gauges specifically, and LPs staked there earn AEON on top of trading fees).
          </P>
          <Note>
            Concentrated Liquidity (Algebra Integral) and DLMM (Trader Joe Liquidity Book) pools also exist on-chain for some pairs, but aren't currently available to deposit into through this app — their reward model (a separate, manually-funded AEON stream rather than the automatic weekly vote-weighted emissions vAMM pools get) isn't ready for general use yet. If you already hold a CL or DLMM position from before, it remains fully yours and safe on-chain; management through this UI is temporarily limited while this gets sorted out.
          </Note>

          {/* The Furnace */}
          <H2 id="the-furnace">The Furnace</H2>
          <P>
            The Furnace is a separate rewards track for users who want permanent exposure to protocol fees without locking up liquidity.
          </P>

          <H3>Burn → Soulbound NFT → Passive Income</H3>
          <P>
            When you burn AEON in The Furnace, you receive a soulbound NFT that cannot be transferred or sold. Your share of Furnace rewards is proportional to your burned amount relative to all AEON ever burned. Voting power from burned tokens never decays, and it stacks with the protocol's own genesis burn — the protocol itself burned 50,000 AEON at launch and votes that weight every epoch.
          </P>

          <div className="my-6 grid grid-cols-2 gap-4">
            {[
              { title: 'Lock (veNFT)', items: ['Power decays over time', 'Transferable', 'Can withdraw after lock expires', `Earn ${EPOCH_CONFIG.feeVoterSplit}% of fees from voted pools`], color: 'violet' },
              { title: 'Furnace (Burn)', items: ['Power never decays', 'Soulbound — non-transferable', 'Cannot withdraw — permanent', 'Earn emission bonus + buyback redistribution'], color: 'aeon', highlight: true },
            ].map(col => (
              <div key={col.title} className={clsx('card p-4', col.highlight && 'border-aeon-400/20')}>
                <div className={clsx('text-sm font-display font-semibold mb-3', col.color === 'aeon' ? 'text-aeon-400' : 'text-violet-400')}>{col.title}</div>
                <ul className="space-y-1.5">
                  {col.items.map(i => <li key={i} className="text-xs text-text-secondary flex gap-1.5"><span>·</span>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>

          <Note>
            Burning is permanent and irreversible. Only burn what you are comfortable never getting back. The NFT and its rewards are tied to your wallet forever.
          </Note>

          {/* Tokenomics */}
          <H2 id="tokenomics">Tokenomics</H2>
          <P>
            AEON launched on Robinhood Chain with a one-time genesis mint of 90,000 AEON. All supply beyond genesis is earned through protocol emissions — there was no team treasury and no allocation held back.
          </P>

          <H3>Genesis Epoch</H3>
          <ul className="space-y-2 mb-6 ml-4">
            {[
              ['Total minted',      '90,000 AEON — once, at genesis'],
              ['AEON/ETH liquidity', '20,000 AEON seeded, paired against ETH'],
              ['AEON/USDG liquidity','20,000 AEON seeded, paired against USDG'],
              ['Burned at genesis', '50,000 AEON — burned via the Furnace, then voted 25,000/25,000 across both AEON pools'],
              ['Team allocation',   '0 AEON'],
            ].map(([k, v]) => (
              <li key={k} className="flex items-start gap-2 text-sm">
                <span className="text-text-muted w-40 flex-shrink-0">{k}</span>
                <span className="font-mono text-text-primary">{v}</span>
              </li>
            ))}
          </ul>

          <H3>Supply Mechanics</H3>
          <ul className="space-y-2 mb-6 ml-4">
            {[
              ['New supply',     `Emissions only — capped at a rolling 3-epoch fee average ÷ ${EPOCH_CONFIG.emissionRatio} (USD terms, oracle-priced), forever after genesis`],
              ['Deflationary',   'Burned AEON is gone forever — supply can only shrink via the Furnace and buyback burns'],
            ].map(([k, v]) => (
              <li key={k} className="flex items-start gap-2 text-sm">
                <span className="text-text-muted w-32 flex-shrink-0">{k}</span>
                <span className="font-mono text-text-primary">{v}</span>
              </li>
            ))}
          </ul>

          <H3>Why This Model Works</H3>
          <P>
            Traditional ve(3,3) protocols inflate supply on a fixed schedule regardless of usage. AEON inverts this — token printing only accelerates when the DEX is actually used. Low volume = low emissions = less sell pressure. High volume = high fees = more reward for holders.
          </P>

          {/* Guides */}
          <H2 id="guide-swap">How to Swap</H2>
          <Step n={1} title="Connect your wallet">
            Click <strong>Connect Wallet</strong> in the top-right navbar. AEON supports all major EVM wallets. Make sure you are on <strong>Robinhood Chain</strong> (chain ID 4663).
          </Step>
          <Step n={2} title="Go to Swap">
            Navigate to the <Link href="/swap" className="text-aeon-400 hover:underline">Swap</Link> page. Select the token you want to sell and the token you want to receive.
          </Step>
          <Step n={3} title="Review the route">
            AEON automatically finds the best route — direct or multi-hop via WETH/USDG. Price impact and fee are shown before you confirm.
          </Step>
          <Step n={4} title="Approve and swap">
            If this is your first swap with a token, you will need to approve it first. Then confirm the swap in your wallet.
          </Step>
          <Note>
            The router only swaps ERC-20 tokens. If you're starting from native ETH and swapping into anything other than WETH, wrap ETH → WETH first on the Swap page (flip to the ETH/WETH pair), then swap from WETH.
          </Note>

          <H2 id="guide-earn">Earn (LP + Gauge Staking)</H2>
          <Step n={1} title="Add liquidity">
            Go to <Link href="/earn" className="text-aeon-400 hover:underline">Earn</Link>, expand a pool, and open the <strong>Add Liquidity</strong> tab. Enter the amounts for both tokens and confirm. You receive LP tokens representing your share.
          </Step>
          <Step n={2} title="Stake LP in the gauge">
            Switch to the <strong>Earn</strong> tab inside the same pool. Approve your LP tokens, then stake them. Your LP is now earning AEON emissions every block.
          </Step>
          <Step n={3} title="Claim emissions">
            Claimable AEON accrues in real time. Click <strong>Claim</strong> at any time to receive it.
          </Step>

          <H2 id="guide-lock">Lock (veNFT)</H2>
          <Step n={1} title="Go to Lock">
            Navigate to <Link href="/lock" className="text-aeon-400 hover:underline">Lock & Burn</Link> and select the <strong>Lock</strong> tab.
          </Step>
          <Step n={2} title="Choose amount and duration">
            Enter how much AEON to lock and for how long (up to 4 years). Longer locks give more voting power. Power decays linearly until the lock expires.
          </Step>
          <Step n={3} title="Approve and lock">
            Approve AEON, then confirm the lock transaction. You receive a veNFT representing your position.
          </Step>
          <Step n={4} title="Vote with your veNFT">
            Once locked, go to the <Link href="/vote" className="text-aeon-400 hover:underline">Vote</Link> page to direct your voting power to pools. This determines which pools receive emissions and earns you fee rewards.
          </Step>
          <Note>
            Locked AEON cannot be withdrawn until the lock expires. You can always increase the lock amount or extend the duration, but you cannot shorten it.
          </Note>

          <H2 id="guide-vote">Vote</H2>
          <Step n={1} title="Hold a veNFT">
            You need a veNFT to vote. Lock AEON first on the <Link href="/lock" className="text-aeon-400 hover:underline">Lock</Link> page.
          </Step>
          <Step n={2} title="Go to Vote">
            Navigate to <Link href="/vote" className="text-aeon-400 hover:underline">Vote</Link>. Your veNFT and its current voting power are shown at the top.
          </Step>
          <Step n={3} title="Allocate votes to pools">
            Add pools and assign a percentage weight to each. You can split across up to 6 pools. Total must equal 100%.
          </Step>
          <Step n={4} title="Submit your vote">
            Confirm the transaction. Your vote is locked for the rest of the epoch. At epoch end, pools you voted for receive AEON emissions proportional to your weight.
          </Step>
          <Step n={5} title="Claim your fee rewards">
            Fees from your voted pools accumulate in real time and are claimable directly from the FeeDistributor contract for each pool/epoch you voted in.
          </Step>

          <H2 id="guide-create-pool">Create a Pool</H2>
          <P>
            Anyone can permissionlessly create a new vAMM pool for any token pair — gated by a one-time 100 AEON whitelist fee to keep spam pools out. CL and DLMM pools for a pair are added by the team on request once real vAMM liquidity exists for it.
          </P>
          <Step n={1} title="Get whitelisted">
            Go to <Link href="/liquidity" className="text-aeon-400 hover:underline">Liquidity</Link> → <strong>Create Pool</strong>. If your wallet isn't whitelisted yet, approve and pay the one-time 100 AEON fee.
          </Step>
          <Step n={2} title="Choose your pair and fee tier">
            Enter both token addresses and pick a fee tier. The page checks both factories for an existing pool at that exact pair + fee before letting you create a duplicate.
          </Step>
          <Step n={3} title="Create and seed liquidity">
            Confirm pool creation, then add the initial liquidity in the same flow. The new pool appears on Liquidity/Earn/Swap automatically — no manual listing step.
          </Step>
          <Note>
            New pools deploy through the current factory, which has correct, working fee accounting from pool #1 — swap fees route to voters immediately, the same as every existing pool.
          </Note>

          {/* Contracts */}
          <H2 id="contracts">Contract Addresses</H2>
          <P>All contracts are deployed on Robinhood Chain (chain ID 4663).</P>

          <div className="card p-4 mb-6">
            <Addr label="AEON Token"          address={CONTRACTS.AeonToken} />
            <Addr label="Minter Proxy"        address={CONTRACTS.MinterProxy} />
            <Addr label="VotingEscrow (veNFT)" address={CONTRACTS.AeonVotingEscrow} />
            <Addr label="Voter"               address={CONTRACTS.AeonVoter} />
            <Addr label="The Furnace"         address={CONTRACTS.TheFurnace} />
            <Addr label="Emissions Engine"    address={CONTRACTS.EmissionsEngine} />
            <Addr label="Fee Distributor"     address={CONTRACTS.FeeDistributor} />
            <Addr label="Buyback Engine"      address={CONTRACTS.BuybackEngine} />
            <Addr label="Oracle"              address={CONTRACTS.AeonOracle} />
            <Addr label="Factory (current, used for new pools)" address={CONTRACTS.AeonFactoryV2} />
            <Addr label="Factory (legacy, reads only)" address={CONTRACTS.AeonFactory} />
            <Addr label="Router (vAMM only)"  address={CONTRACTS.AeonRouter} />
            <Addr label="Universal Router (vAMM + CL + DLMM)" address={CONTRACTS.UniversalRouter} />
            <Addr label="Gauge Factory"       address={CONTRACTS.AeonGaugeFactory} />
            <Addr label="Liquidity Helper"    address={CONTRACTS.LiquidityHelperV2} />
            <Addr label="Pool-Creation Whitelist" address={CONTRACTS.Whitelist} />
            <Addr label="Tower Defense Arena" address={CONTRACTS.TowerDefenseArena} />
          </div>
          <Note>
            The legacy factory's earliest pools have an older <code>AeonPoolRH</code> bytecode without working fee-claim accounting. Every pool created through the current factory (including all pools created from 2026-07-09 onward) has correct fee accounting from day one — check a pool's own listing on <Link href="/liquidity" className="text-aeon-400 hover:underline">Liquidity</Link> rather than assuming from the factory alone.
          </Note>

          <H3>Token Addresses</H3>
          <div className="card p-4">
            {Object.entries(TOKENS).filter(([, t]) => t.symbol !== 'ETH').map(([sym, t]) => (
              <Addr key={sym} label={`${t.name} (${t.symbol})`} address={t.address} />
            ))}
          </div>

          {/* Integrations */}
          <H2 id="integrations">Integrations & Tools</H2>
          <P>
            AEON exposes machine-readable endpoints for aggregators, explorers, and bots to index the protocol directly — no manual listing or static snapshot required.
          </P>
          <ul className="space-y-2 mb-6 ml-4">
            {[
              ['DEX Screener Adapter', 'Full spec implementation (/latest-block, /asset, /pair, /events) at /api/dexscreener/* — live, real-time, on-chain-verified. Covers all vAMM pools.'],
              ['Machine-readable pool list', '/api/v1/pools — live reserves + token metadata for every pool, for aggregators and custom bots.'],
              ['1inch aggregation', 'Wired in as a 4th swap venue on the Swap page — AEON compares its own routing against 1inch\'s pathfinding and uses whichever quote is better.'],
            ].map(([title, desc]) => (
              <li key={title} className="text-sm">
                <span className="font-mono text-aeon-400">{title}</span>
                <span className="text-text-secondary"> — {desc}</span>
              </li>
            ))}
          </ul>

          <div className="mt-12 pt-8 border-t border-bg-border text-center text-sm text-text-muted">
            Built on Robinhood Chain · {new Date().getFullYear()} AEON Protocol
          </div>

        </article>
      </div>
    </div>
  )
}
