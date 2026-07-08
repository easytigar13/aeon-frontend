'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Minus, ChevronDown, Loader2, CheckCircle2, Layers, Waves, Grid3x3, Search, ArrowLeft, Repeat } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useBalance, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits, maxUint256 } from 'viem'
import { POOLS, CL_POOLS, CL_RANGE_PRESETS, DLMM_CONTRACTS, DLMM_POOLS, TOKENS, CONTRACTS, ALGEBRA_CONTRACTS, NATIVE_SENTINEL } from '@/config/contracts'
import { ERC20_ABI, LIQUIDITY_HELPER_V2_ABI, PAIR_ABI, AEON_FACTORY_ABI, ALGEBRA_POOL_ABI, ALGEBRA_POSITION_MANAGER_ABI, ALGEBRA_PM_ENUMERABLE_ABI, ALGEBRA_SWAP_ROUTER_ABI, ALGEBRA_QUOTER_ABI, LB_PAIR_ABI, LB_ROUTER_ABI } from '@/config/abis'
import { usePrices } from '@/hooks/usePrices'
import { useAllPools } from '@/hooks/useAllPools'
import { usePoolStats, useClPoolStats, useDlmmPoolStats } from '@/hooks/usePoolStats'
import { useVolume24h } from '@/hooks/useVolume24h'
import { useClPositions } from '@/hooks/useClPositions'
import { useDlmmPositions } from '@/hooks/useDlmmPositions'
import { TokenIcon } from '@/components/TokenIcon'
import { priceOffsetToTick, pairedAmount, rangeSide, liquidityForAmounts, amountsForLiquidity, tickToSqrtPriceX96, tickToPrice, priceToTick } from '@/lib/clMath'
import { binIdToPrice, dlmmRangeSide, computeSpotDistribution } from '@/lib/dlmmMath'

type PoolMode = 'vAMM' | 'CL' | 'DLMM'
type Tab = 'add' | 'remove' | 'swap'
type Step = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done' | 'approve_lp' | 'approve_lp_wait' | 'remove' | 'remove_wait' | 'remove_done'
type ClStep = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'mint' | 'mint_wait' | 'done'
type DlmmStep = 'idle' | 'approve0' | 'approve0_wait' | 'approve1' | 'approve1_wait' | 'addliq' | 'addliq_wait' | 'done'

const HELPER = CONTRACTS.LiquidityHelperV2
const PM = ALGEBRA_CONTRACTS.nonfungiblePositionManager
const MAX_UINT128 = 2n ** 128n - 1n
const DLMM_ROUTER = DLMM_CONTRACTS.router

// Slippage tolerance applied to vAMM add/remove liquidity — protects against
// reserve shifts between quoting and confirmation. LiquidityHelperV2 reverts
// if the actual outcome misses these bounds rather than silently accepting
// whatever the pool computes.
const LIQ_SLIPPAGE_BPS = 50n // 0.5%
const withSlippage = (wei: bigint) => wei * (10000n - LIQ_SLIPPAGE_BPS) / 10000n
const liqDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200)

function parseFeeRate(fee: string): number { return parseFloat(fee.replace('%', '')) / 100 }
function fmtApr(apr: number | null): string {
  if (apr === null || !isFinite(apr)) return '—%'
  if (apr >= 1000) return '>1000%'
  return apr.toFixed(2) + '%'
}
function fmtUsd(n: number | null): string {
  if (n === null || n <= 0 || !isFinite(n)) return '$—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Formats a single price POINT (e.g. one end of a range), not a total value —
// unlike fmtUsd, never collapses a real sub-cent price down to "$0.00".
function fmtPricePoint(n: number | null): string {
  if (n === null || !isFinite(n) || n <= 0) return '—'
  if (n >= 1_000_000_000 || n < 1e-9) return '$' + n.toExponential(2)
  if (n >= 1) return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function useTokenBal(tokenAddr: `0x${string}` | undefined, wallet: `0x${string}` | undefined) {
  const isNative = tokenAddr === NATIVE_SENTINEL
  const { data } = useBalance({
    address: wallet,
    token: isNative ? undefined : tokenAddr,
    query: { enabled: !!wallet && !!tokenAddr },
  })
  if (!wallet || !data) return { formatted: '—', decimals: 18, raw: 0n }
  return { formatted: parseFloat(formatUnits(data.value, data.decimals)).toFixed(4), decimals: data.decimals, raw: data.value }
}

function useAllowance(tokenAddr: `0x${string}` | undefined, owner: `0x${string}` | undefined, spender: `0x${string}`) {
  const { data } = useReadContract({
    address: tokenAddr,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: owner ? [owner, spender] : undefined,
    query: { enabled: !!tokenAddr && !!owner },
  })
  return (data as bigint | undefined) ?? 0n
}

export default function LiquidityPage() {
  const [view,        setView]        = useState<'list' | 'detail' | 'create'>('list')
  const [mode,        setMode]        = useState<PoolMode>('vAMM')
  const [initialPool, setInitialPool] = useState<string | undefined>(undefined)

  function handleDeposit(m: PoolMode, address: string) {
    setMode(m)
    setInitialPool(address)
    setView('detail')
  }

  function handleCreated(address: string) {
    if (!address) { setView('list'); return }
    setMode('vAMM')
    setInitialPool(address)
    setView('detail')
  }

  if (view === 'list') {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12">
        <PoolListView onDeposit={handleDeposit} onCreatePool={() => setView('create')} />
      </div>
    )
  }

  if (view === 'create') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <button
          onClick={() => setView('list')}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-4"
        >
          <ArrowLeft size={14} /> Back to All Pools
        </button>
        <div className="mb-6">
          <h1 className="font-display font-bold text-2xl text-text-primary">Create Pool</h1>
          <p className="text-sm text-text-muted mt-0.5">Deploy a new vAMM pool for any pair and seed it, directly from your wallet.</p>
        </div>
        <CreatePoolView onCreated={handleCreated} />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <button
        onClick={() => setView('list')}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Back to All Pools
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {mode === 'vAMM' ? "Provide liquidity to AEON's vAMM pools" : mode === 'CL' ? 'Provide concentrated liquidity via Algebra Integral' : 'Provide bin-based liquidity via Liquidity Book (DLMM)'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => setMode('vAMM')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'vAMM' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Waves size={14} /> vAMM
        </button>
        <button onClick={() => setMode('CL')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'CL' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Layers size={14} /> Concentrated
        </button>
        <button onClick={() => setMode('DLMM')} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', mode === 'DLMM' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Grid3x3 size={14} /> DLMM
        </button>
      </div>

      {mode === 'vAMM' ? <VammLiquidity initialPool={initialPool} /> : mode === 'CL' ? <ClLiquidity initialPool={initialPool} /> : <DlmmLiquidity initialPool={initialPool} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Pool discovery table — lists every pool across all three pool types with
// real on-chain TVL, and (where a volume tracker exists — vAMM only, see
// useVolume24h.ts) real 24h volume/fees/APR. CL and DLMM rows honestly show
// "—" for those columns rather than fabricating numbers.
// ─────────────────────────────────────────────────────────────────────────

interface UnifiedPool {
  type: PoolMode
  name: string
  token0: string
  token1: string
  address: `0x${string}`
  feeLabel: string
  tvlUsd: number | null
  volUsd: number | null
  feesUsd: number | null
  aprPct: number | null
}

type ListFilter = 'ALL' | PoolMode

function usePoolListData(): UnifiedPool[] {
  const prices        = usePrices()
  const poolStats      = usePoolStats(prices)
  const clPoolStats    = useClPoolStats(prices)
  const dlmmPoolStats  = useDlmmPoolStats(prices)
  const volResult      = useVolume24h(prices)
  const { discovered }  = useAllPools()

  const vamm: UnifiedPool[] = POOLS.map(p => {
    const tvlUsd = poolStats.find(s => s.address === p.address)?.tvlUsd ?? null
    const volUsd = volResult.byPool[p.address.toLowerCase()] ?? null
    const feeRate = parseFeeRate(p.fee)
    const feesUsd = volUsd !== null ? volUsd * feeRate : null
    const aprPct = (tvlUsd !== null && tvlUsd > 0 && volUsd !== null)
      ? (volUsd * feeRate * 365 / tvlUsd) * 100
      : null
    return { type: 'vAMM', name: p.name, token0: p.token0, token1: p.token1, address: p.address, feeLabel: p.fee, tvlUsd, volUsd, feesUsd, aprPct }
  })

  // Pools anyone created themselves via Create Pool, discovered live from
  // AeonFactoryRH.allPools() rather than hardcoded -- no gauge/TVL indexing
  // yet (those still key off the static POOLS list), but they show up and
  // are addable/swappable immediately instead of being invisible until
  // someone manually wires them into contracts.ts.
  const vammDiscovered: UnifiedPool[] = discovered.map(p => ({
    type: 'vAMM', name: p.name, token0: p.token0, token1: p.token1, address: p.address,
    feeLabel: p.fee, tvlUsd: null, volUsd: null, feesUsd: null, aprPct: null,
  }))

  const cl: UnifiedPool[] = CL_POOLS.map(p => {
    const tvlUsd = clPoolStats.find(s => s.address === p.address)?.tvlUsd ?? null
    const volUsd = volResult.byPool[p.address.toLowerCase()] ?? null
    const feeRate = parseFeeRate(p.fee)
    const feesUsd = volUsd !== null ? volUsd * feeRate : null
    const aprPct = (tvlUsd !== null && tvlUsd > 0 && volUsd !== null)
      ? (volUsd * feeRate * 365 / tvlUsd) * 100
      : null
    return { type: 'CL', name: p.name, token0: p.token0, token1: p.token1, address: p.address, feeLabel: p.fee, tvlUsd, volUsd, feesUsd, aprPct }
  })

  const dlmm: UnifiedPool[] = DLMM_POOLS.map(p => {
    const tvlUsd = dlmmPoolStats.find(s => s.address === p.address)?.tvlUsd ?? null
    const volUsd = volResult.byPool[p.address.toLowerCase()] ?? null
    const feeRate = parseFeeRate(p.fee)
    const feesUsd = volUsd !== null ? volUsd * feeRate : null
    const aprPct = (tvlUsd !== null && tvlUsd > 0 && volUsd !== null)
      ? (volUsd * feeRate * 365 / tvlUsd) * 100
      : null
    return { type: 'DLMM', name: p.name, token0: p.token0, token1: p.token1, address: p.address, feeLabel: `${p.binStep}bp bins`, tvlUsd, volUsd, feesUsd, aprPct }
  })

  return [...vamm, ...vammDiscovered, ...cl, ...dlmm]
}

const TYPE_BADGE: Record<PoolMode, string> = {
  vAMM: 'bg-sky-400/10 text-sky-400 border-sky-400/20',
  CL:   'bg-violet-400/10 text-violet-400 border-violet-400/20',
  DLMM: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
}

function PoolListView({ onDeposit, onCreatePool }: { onDeposit: (mode: PoolMode, address: string) => void; onCreatePool: () => void }) {
  const [filter, setFilter] = useState<ListFilter>('ALL')
  const [search, setSearch] = useState('')

  const pools = usePoolListData()
  const poolCount = pools.length

  const filtered = pools.filter(p => {
    if (filter !== 'ALL' && p.type !== filter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !p.token0.toLowerCase().includes(q) && !p.token1.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display font-bold text-2xl text-text-primary">Liquidity Pools</h1>
          <p className="text-sm text-text-muted mt-0.5">There are {poolCount} pools listed currently</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search pools or tokens…"
              className="bg-bg-raised border border-bg-border rounded-xl pl-9 pr-3 py-2 text-sm w-full sm:w-64 text-text-primary placeholder-text-muted focus:outline-none focus:border-aeon-400/40"
            />
          </div>
          <button onClick={onCreatePool} className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={14} /> Create Pool
          </button>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4 w-fit">
        {(['ALL', 'vAMM', 'CL', 'DLMM'] as ListFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx('px-4 py-2 rounded-lg text-sm font-medium transition-all', filter === f ? 'bg-bg-base text-text-primary' : 'text-text-muted hover:text-text-primary')}
          >
            {f === 'ALL' ? 'All' : f === 'CL' ? 'Concentrated' : f}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-bg-border text-left text-xs font-mono text-text-muted uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Liquidity Pool</th>
              <th className="px-4 py-3 font-medium text-right">APR</th>
              <th className="px-4 py-3 font-medium text-right">TVL</th>
              <th className="px-4 py-3 font-medium text-right">Volume (24h)</th>
              <th className="px-4 py-3 font-medium text-right">Fees (24h)</th>
              <th className="px-4 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={`${p.type}-${p.address}`} className="border-b border-bg-border last:border-0 hover:bg-bg-raised/50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      <TokenIcon symbol={p.token0} size={26} />
                      <TokenIcon symbol={p.token1} size={26} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">{p.name}</span>
                        <span className="text-2xs font-mono text-text-muted">{p.feeLabel}</span>
                      </div>
                      <span className={clsx('inline-block mt-0.5 text-2xs font-mono px-1.5 py-0.5 rounded border', TYPE_BADGE[p.type])}>{p.type}</span>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmtApr(p.aprPct)}</td>
                <td className="px-4 py-3 text-right font-mono text-text-primary">{fmtUsd(p.tvlUsd)}</td>
                <td className="px-4 py-3 text-right font-mono text-text-muted">{fmtUsd(p.volUsd)}</td>
                <td className="px-4 py-3 text-right font-mono text-text-muted">{fmtUsd(p.feesUsd)}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onDeposit(p.type, p.address)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-aeon-400 text-bg-base hover:bg-aeon-300 transition-colors"
                  >
                    DEPOSIT
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted text-sm">No pools match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Create Pool — self-service vAMM pool deployment. AeonFactoryRH.createPool()
// and LiquidityHelperRH.addLiquidity() are both fully permissionless, so any
// connected wallet can deploy a brand-new pool and seed it directly, no
// team/deployer involvement needed. What this CANNOT do: register the pool
// with AeonVoterV2 or create its gauge — both are governor-only, so a
// self-created pool trades immediately but earns no emissions until the
// team registers it separately. CL/DLMM creation isn't offered here (their
// factories need a starting price/active-bin choice, meaningfully more
// involved than a vAMM pool's plain constant-product seed ratio).
// ─────────────────────────────────────────────────────────────────────────

const FEE_TIER_OPTIONS = [
  { bps: 30,  label: '0.3%' },
  { bps: 100, label: '1%' },
  { bps: 200, label: '2%' },
]

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const KNOWN_TOKENS = Object.entries(TOKENS).filter(([, t]) => t.address !== NATIVE_SENTINEL)

function isAddr(v: string): v is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(v)
}

function TokenSlot({ label, addr, onAddr, amount, onAmount, wallet, resolvedSymbol, resolvedDecimals, metaLoading }: {
  label: string
  addr: string
  onAddr: (v: string) => void
  amount: string
  onAmount: (v: string) => void
  wallet: `0x${string}` | undefined
  resolvedSymbol: string | undefined
  resolvedDecimals: number | undefined
  metaLoading: boolean
}) {
  const valid = isAddr(addr)
  const bal = useTokenBal(valid ? addr as `0x${string}` : undefined, wallet)

  return (
    <div className="bg-bg-raised rounded-xl p-4">
      <div className="text-xs text-text-muted mb-2">{label}</div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {KNOWN_TOKENS.map(([key, t]) => (
          <button key={key} onClick={() => onAddr(t.address)} className={clsx('px-2 py-1 rounded-lg text-2xs font-mono border transition-all', addr.toLowerCase() === t.address.toLowerCase() ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-base border-bg-border text-text-muted hover:border-bg-hover')}>
            {t.symbol}
          </button>
        ))}
      </div>
      <input
        value={addr}
        onChange={e => onAddr(e.target.value.trim())}
        placeholder="Paste any ERC-20 contract address…"
        className="input-base w-full text-xs font-mono py-2 mb-1"
      />
      {addr && !valid && <div className="text-2xs text-red-400 mb-1">Not a valid address</div>}
      {valid && metaLoading && <div className="text-2xs text-text-muted mb-1">Reading token…</div>}
      {valid && !metaLoading && resolvedSymbol === undefined && <div className="text-2xs text-red-400 mb-1">Doesn't look like an ERC-20 (symbol()/decimals() failed)</div>}
      {valid && resolvedSymbol && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-emerald-400">✓ {resolvedSymbol}</span>
          <span className="text-2xs font-mono text-text-muted">Balance: {bal.formatted}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="number" value={amount} onChange={e => onAmount(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-lg font-mono text-text-primary placeholder-text-muted focus:outline-none" />
        {valid && resolvedSymbol && (
          <button onClick={() => onAmount(bal.formatted === '—' ? '' : bal.formatted)} className="text-2xs text-aeon-400 hover:underline font-mono">MAX</button>
        )}
      </div>
    </div>
  )
}

function CreatePoolView({ onCreated }: { onCreated: (address: string) => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tokenA, setTokenA] = useState<string>(CONTRACTS.AeonToken)
  const [tokenB, setTokenB] = useState<string>('')
  const [amountA, setAmountA] = useState('')
  const [amountB, setAmountB] = useState('')
  const [feeBps, setFeeBps] = useState(100)
  const [step, setStep] = useState<'idle' | 'approveA' | 'approveA_wait' | 'approveB' | 'approveB_wait' | 'create' | 'create_wait' | 'addliq' | 'addliq_wait' | 'done'>('idle')
  const [errMsg, setErrMsg] = useState('')
  const [createdPool, setCreatedPool] = useState<`0x${string}` | undefined>(undefined)

  const validA = isAddr(tokenA)
  const validB = isAddr(tokenB)
  const sameToken = validA && validB && tokenA.toLowerCase() === tokenB.toLowerCase()

  const { data: symA, isLoading: symALoading } = useReadContract({ address: validA ? tokenA as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'symbol', query: { enabled: validA } })
  const { data: decARaw } = useReadContract({ address: validA ? tokenA as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'decimals', query: { enabled: validA } })
  const { data: symB, isLoading: symBLoading } = useReadContract({ address: validB ? tokenB as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'symbol', query: { enabled: validB } })
  const { data: decBRaw } = useReadContract({ address: validB ? tokenB as `0x${string}` : undefined, abi: ERC20_ABI, functionName: 'decimals', query: { enabled: validB } })

  const decimalsA = (decARaw as number | undefined) ?? 18
  const decimalsB = (decBRaw as number | undefined) ?? 18

  const { data: existingPoolRaw } = useReadContract({
    address: CONTRACTS.AeonFactory, abi: AEON_FACTORY_ABI, functionName: 'getPoolFor',
    args: (validA && validB && !sameToken) ? [tokenA as `0x${string}`, tokenB as `0x${string}`, feeBps] : undefined,
    query: { enabled: validA && validB && !sameToken },
  })
  const poolExists = existingPoolRaw && (existingPoolRaw as string) !== ZERO_ADDR

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amountAWei = safeParseUnits(amountA, decimalsA)
  const amountBWei = safeParseUnits(amountB, decimalsB)

  const allowA = useAllowance(validA ? tokenA as `0x${string}` : undefined, address, HELPER)
  const allowB = useAllowance(validB ? tokenB as `0x${string}` : undefined, address, HELPER)
  const needApproveA = amountAWei > 0n && allowA < amountAWei
  const needApproveB = amountBWei > 0n && allowB < amountBWei

  const readyToCreate = validA && validB && !sameToken && !poolExists && symA && symB && amountAWei > 0n && amountBWei > 0n

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  const { data: poolLookup, refetch: refetchPoolLookup } = useReadContract({
    address: CONTRACTS.AeonFactory, abi: AEON_FACTORY_ABI, functionName: 'getPoolFor',
    args: (validA && validB) ? [tokenA as `0x${string}`, tokenB as `0x${string}`, feeBps] : undefined,
    query: { enabled: false },
  })

  const { data: createdPoolToken0 } = useReadContract({
    address: createdPool, abi: PAIR_ABI, functionName: 'token0', query: { enabled: !!createdPool },
  })

  useEffect(() => {
    if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') }
  }, [writeError])

  useEffect(() => {
    if (!txSuccess) return
    setErrMsg('')
    if (step === 'approveA_wait') { setStep('approveB'); return }
    if (step === 'approveB_wait') { setStep('create'); return }
    if (step === 'create_wait') {
      refetchPoolLookup().then(res => {
        const pool = res.data as `0x${string}` | undefined
        if (pool && pool !== ZERO_ADDR) { setCreatedPool(pool); setStep('addliq') }
        else { setErrMsg('Pool created but address lookup failed — check the transaction on the explorer.'); setStep('idle') }
      })
      return
    }
    if (step === 'addliq_wait') { setStep('done'); onCreated(createdPool ?? ''); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address) return
    setErrMsg('')
    if (step === 'approveA') { writeContract({ address: tokenA as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amountAWei] }); setStep('approveA_wait') }
    if (step === 'approveB') { writeContract({ address: tokenB as `0x${string}`, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amountBWei] }); setStep('approveB_wait') }
    if (step === 'create')   { writeContract({ address: CONTRACTS.AeonFactory, abi: AEON_FACTORY_ABI, functionName: 'createPool', args: [tokenA as `0x${string}`, tokenB as `0x${string}`, feeBps] }); setStep('create_wait') }
  }, [step])

  // addLiquidity needs the pool's real on-chain token0/token1 order, which
  // doesn't always match the order tokenA/tokenB were entered in (pools sort
  // by address) — the same TokenMismatch bug class fixed earlier elsewhere.
  useEffect(() => {
    if (step !== 'addliq' || !createdPool || !createdPoolToken0 || !address) return
    const isAFirst = (createdPoolToken0 as string).toLowerCase() === tokenA.toLowerCase()
    const [addr0, amt0, addr1, amt1] = isAFirst
      ? [tokenA, amountAWei, tokenB, amountBWei]
      : [tokenB, amountBWei, tokenA, amountAWei]
    // Brand-new pool has zero reserves — there's no existing ratio to slip
    // against, so min amounts are 0 (this deposit itself sets the price).
    writeContract({
      address: HELPER, abi: LIQUIDITY_HELPER_V2_ABI, functionName: 'addLiquidity',
      args: [createdPool, addr0 as `0x${string}`, amt0, amt1, 0n, 0n, addr1 as `0x${string}`, address, liqDeadline()],
    })
    setStep('addliq_wait')
  }, [step, createdPool, createdPoolToken0])

  const isBusy = isPending || (step !== 'idle' && step !== 'done')

  function handleSubmit() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!readyToCreate) return
    if (needApproveA) { setStep('approveA'); return }
    if (needApproveB) { setStep('approveB'); return }
    setStep('create')
  }

  function label() {
    if (!isConnected) return 'Connect Wallet'
    if (sameToken) return 'Tokens must be different'
    if (poolExists) return 'Pool already exists'
    if (step === 'approveA' || step === 'approveA_wait') return `Approving ${symA ?? 'Token A'}…`
    if (step === 'approveB' || step === 'approveB_wait') return `Approving ${symB ?? 'Token B'}…`
    if (step === 'create' || step === 'create_wait') return 'Creating pool…'
    if (step === 'addliq' || step === 'addliq_wait') return 'Seeding liquidity…'
    if (step === 'done') return '✓ Pool live!'
    if (!validA || !validB) return 'Enter both token addresses'
    if (!symA || !symB) return 'Waiting on token metadata…'
    if (amountAWei === 0n || amountBWei === 0n) return 'Enter seed amounts'
    if (needApproveA) return `Approve ${symA}`
    if (needApproveB) return `Approve ${symB}`
    return 'Create Pool'
  }

  if (step === 'done' && createdPool) {
    return (
      <div className="card p-8 text-center border-emerald-400/20 bg-emerald-400/5">
        <div className="text-lg font-display font-bold text-text-primary mb-2">Pool is live</div>
        <p className="text-sm text-text-secondary mb-4">
          {symA}/{symB} is now trading. It has no gauge yet, so it won't earn AEON emissions until the team registers it —
          organic trading fees work immediately regardless.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => onCreated(createdPool)} className="btn-primary text-sm">View Pool</button>
          <button onClick={() => { setStep('idle'); setCreatedPool(undefined); setTokenB(''); setAmountA(''); setAmountB('') }} className="btn-secondary text-sm">Create Another</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-1">
      <div className="p-4 space-y-3">
        <TokenSlot label="Token A" addr={tokenA} onAddr={setTokenA} amount={amountA} onAmount={setAmountA} wallet={address} resolvedSymbol={symA as string | undefined} resolvedDecimals={decimalsA} metaLoading={symALoading} />
        <TokenSlot label="Token B" addr={tokenB} onAddr={setTokenB} amount={amountB} onAmount={setAmountB} wallet={address} resolvedSymbol={symB as string | undefined} resolvedDecimals={decimalsB} metaLoading={symBLoading} />

        <div>
          <div className="text-xs text-text-muted mb-2">Fee Tier</div>
          <div className="flex gap-2">
            {FEE_TIER_OPTIONS.map(t => (
              <button key={t.bps} onClick={() => setFeeBps(t.bps)} className={clsx('flex-1 py-2 rounded-lg text-sm font-mono border transition-all', feeBps === t.bps ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {sameToken && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">Token A and Token B must be different.</div>
        )}
        {poolExists && !sameToken && (
          <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
            A pool for this pair and fee tier already exists at {(existingPoolRaw as string).slice(0, 6)}…{(existingPoolRaw as string).slice(-4)} — use Add Liquidity on it instead of creating a duplicate.
          </div>
        )}
        <div className="p-3 rounded-xl bg-bg-base text-2xs text-text-muted leading-relaxed">
          Anyone can create a pool — it trades immediately once seeded. It won't have a gauge or earn AEON emissions until the team registers it separately. This action is irreversible; double-check both addresses before creating.
        </div>
        {errMsg && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>}

        <button
          onClick={handleSubmit}
          disabled={isConnected && (isBusy || sameToken || !!poolExists || !readyToCreate)}
          className="btn-primary w-full py-3.5 flex items-center justify-center gap-2"
        >
          {isBusy && <Loader2 size={16} className="animate-spin" />}
          {label()}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// vAMM — full-range constant-product pools
// ─────────────────────────────────────────────────────────────────────────

function VammLiquidity({ initialPool }: { initialPool?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  // Includes pools anyone created via Create Pool (discovered live from
  // AeonFactoryRH.allPools()), not just the hardcoded POOLS list -- so a
  // pool a user just deployed is immediately selectable/depositable here,
  // not just visible-but-broken in the list above.
  const { discovered } = useAllPools()
  const allVammPools = useMemo(() => [
    ...POOLS.map(p => ({
      ...p,
      token0Address: TOKENS[p.token0 as keyof typeof TOKENS]?.address,
      token1Address: TOKENS[p.token1 as keyof typeof TOKENS]?.address,
    })),
    ...discovered,
  ], [discovered])

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(() => allVammPools.find(p => p.address === initialPool) ?? allVammPools[0])
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [removeAmount,   setRemoveAmount]   = useState(50)
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<Step>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  // Once discovered pools load in (they arrive a beat after the static
  // list on first render), pick up a match for initialPool if we didn't
  // have one yet -- otherwise deep-linking straight to a just-created pool
  // would get stuck showing whatever pool happened to be first.
  useEffect(() => {
    if (!initialPool || selectedPool.address.toLowerCase() === initialPool.toLowerCase()) return
    const match = allVammPools.find(p => p.address.toLowerCase() === initialPool.toLowerCase())
    if (match) setSelectedPool(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allVammPools, initialPool])

  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const volResult = useVolume24h(prices)

  const token0Key  = selectedPool.token0 as keyof typeof TOKENS
  const token1Key  = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = selectedPool.token0Address ?? TOKENS[token0Key]?.address
  const token1Addr = selectedPool.token1Address ?? TOKENS[token1Key]?.address
  const token0Dec  = TOKENS[token0Key].decimals
  const token1Dec  = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)

  // LP token balance for remove tab
  const { data: lpBalRaw, refetch: refetchLpBal } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const lpBal = (lpBalRaw as bigint | undefined) ?? 0n
  const lpBalFormatted = parseFloat(formatUnits(lpBal, 18)).toFixed(8)

  const { data: lpAllowanceRaw } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, HELPER] : undefined, query: { enabled: !!address },
  })
  const lpAllowance = (lpAllowanceRaw as bigint | undefined) ?? 0n

  const { data: totalSupplyRaw } = useReadContract({
    address: selectedPool.address, abi: ERC20_ABI, functionName: 'totalSupply',
    query: { refetchInterval: 15000 },
  })
  const totalSupply = (totalSupplyRaw as bigint | undefined) ?? 0n

  const allowance0 = useAllowance(token0Addr, address, HELPER)
  const allowance1 = useAllowance(token1Addr, address, HELPER)

  const { data: reserves } = useReadContract({
    address: selectedPool.address, abi: PAIR_ABI, functionName: 'getReserves',
    query: { refetchInterval: 15000 },
  })
  const { data: poolToken0Addr } = useReadContract({
    address: selectedPool.address, abi: PAIR_ABI, functionName: 'token0',
  })

  const isToken0First = !poolToken0Addr || poolToken0Addr.toLowerCase() === token0Addr.toLowerCase()
  const [r0raw, r1raw] = (reserves as [bigint, bigint, number] | undefined) ?? [0n, 0n, 0]
  const reserve0 = isToken0First ? r0raw : r1raw
  const reserve1 = isToken0First ? r1raw : r0raw
  const hasLiquidity = reserve0 > 0n && reserve1 > 0n

  function calcPaired(inputWei: bigint, rIn: bigint, rOut: bigint, decOut: number): string {
    if (!hasLiquidity || rIn === 0n) return ''
    const out = inputWei * rOut / rIn
    const str = formatUnits(out, decOut)
    return parseFloat(parseFloat(str).toFixed(6)).toString()
  }

  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (!val || !hasLiquidity) return
    try {
      const wei = parseUnits(val, token0Dec)
      setAmount1(calcPaired(wei, reserve0, reserve1, token1Dec))
    } catch {}
  }
  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (!val || !hasLiquidity) return
    try {
      const wei = parseUnits(val, token1Dec)
      setAmount0(calcPaired(wei, reserve1, reserve0, token0Dec))
    } catch {}
  }

  useEffect(() => { setAmount0(''); setAmount1('') }, [selectedPool.address])

  const currentPrice = reserve0 > 0n && reserve1 > 0n
    ? parseFloat(formatUnits(reserve1, token1Dec)) / parseFloat(formatUnits(reserve0, token0Dec))
    : null

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  // on-chain-ordered args for the addLiquidity() call itself — LiquidityHelperRH
  // reverts TokenMismatch() unless token0/token1 exactly match the pool's own
  // token0()/token1(), which isn't always this config's declared order (pools
  // sort by address, "AEON/ETH" doesn't guarantee AEON is token0).
  const addToken0     = isToken0First ? token0Addr  : token1Addr
  const addToken1     = isToken0First ? token1Addr  : token0Addr
  const addAmount0Wei = isToken0First ? amount0Wei  : amount1Wei
  const addAmount1Wei = isToken0First ? amount1Wei  : amount0Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait')    { setStep('approve1'); return }
    if (step === 'approve1_wait')    { setStep('addliq');   return }
    if (step === 'addliq_wait')      { setStep('done');      setAmount0(''); setAmount1(''); return }
    if (step === 'approve_lp_wait')  { setStep('remove');    return }
    if (step === 'remove_wait')      { setStep('remove_done'); refetchLpBal(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address || !token0Addr || !token1Addr) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'addliq') {
      writeContract({
        address: HELPER, abi: LIQUIDITY_HELPER_V2_ABI, functionName: 'addLiquidity',
        args: [
          selectedPool.address, addToken0, addAmount0Wei, addAmount1Wei,
          withSlippage(addAmount0Wei), withSlippage(addAmount1Wei), addToken1, address, liqDeadline(),
        ],
      })
      setStep('addliq_wait')
    }
    if (step === 'approve_lp') {
      writeContract({ address: selectedPool.address, abi: ERC20_ABI, functionName: 'approve', args: [HELPER, lpBal] })
      setStep('approve_lp_wait')
    }
    if (step === 'remove') {
      const lpToRemove = lpBal * BigInt(removeAmount) / 100n
      if (lpToRemove === 0n) { setStep('idle'); return }
      const quotedRecv0 = totalSupply > 0n ? lpToRemove * reserve0 / totalSupply : 0n
      const quotedRecv1 = totalSupply > 0n ? lpToRemove * reserve1 / totalSupply : 0n
      writeContract({
        address: HELPER, abi: LIQUIDITY_HELPER_V2_ABI, functionName: 'removeLiquidity',
        args: [selectedPool.address, lpToRemove, withSlippage(quotedRecv0), withSlippage(quotedRecv1), address!, liqDeadline()],
      })
      setStep('remove_wait')
    }
  }, [step])

  useEffect(() => {
    if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') }
  }, [writeError])

  function startAddLiquidity() {
    if (!isConnected) { openConnectModal?.(); return }
    if (!amount0 || !amount1) return
    setStep('idle')
    setErrMsg('')
    if (needApprove0) { setStep('approve0'); return }
    if (needApprove1) { setStep('approve1'); return }
    setStep('addliq')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!amount0 && !amount1) return 'Enter amounts'
    if (!amount1) return `Enter ${selectedPool.token1} amount`
    if (!amount0) return `Enter ${selectedPool.token0} amount`
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'addliq'   || step === 'addliq_wait')  return 'Adding Liquidity…'
    if (step === 'done') return '✓ Liquidity Added!'
    if (needApprove0) return `1. Approve ${selectedPool.token0}`
    if (needApprove1) return `2. Approve ${selectedPool.token1}`
    return 'Add Liquidity'
  }

  function progressSteps() {
    const steps = [] as { label: string, done: boolean, active: boolean }[]
    if (needApprove0 || ['approve0', 'approve0_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token0}`, done: !needApprove0 || ['approve1', 'approve1_wait', 'addliq', 'addliq_wait', 'done'].includes(step), active: step === 'approve0' || step === 'approve0_wait' })
    if (needApprove1 || ['approve1', 'approve1_wait'].includes(step))
      steps.push({ label: `Approve ${selectedPool.token1}`, done: !needApprove1 || ['addliq', 'addliq_wait', 'done'].includes(step), active: step === 'approve1' || step === 'approve1_wait' })
    steps.push({ label: 'Add Liquidity', done: step === 'done', active: step === 'addliq' || step === 'addliq_wait' })
    return steps
  }

  const showProgress = isProcessing || step === 'done'

  // ── APR estimate ──
  const tvlUsd    = poolStats.find(s => s.address === selectedPool.address)?.tvlUsd ?? null
  const dayVolUsd = volResult.byPool[selectedPool.address.toLowerCase()] ?? null
  const baseApr   = (tvlUsd !== null && tvlUsd > 0 && dayVolUsd !== null)
    ? (dayVolUsd * parseFeeRate(selectedPool.fee) * 365 / tvlUsd) * 100
    : null
  const p0 = prices[selectedPool.token0] ?? null
  const p1 = prices[selectedPool.token1] ?? null
  const depositUsd = (p0 !== null && amount0 ? parseFloat(amount0 || '0') * p0 : 0) + (p1 !== null && amount1 ? parseFloat(amount1 || '0') * p1 : 0)
  const dilutedApr = baseApr !== null && tvlUsd !== null
    ? baseApr * tvlUsd / (tvlUsd + depositUsd)
    : baseApr
  const yearlyEarn = dilutedApr !== null && depositUsd > 0 ? depositUsd * dilutedApr / 100 : null

  return (
    <>
      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
      </div>

      {/* Pool selector */}
      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {allVammPools.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">{pool.fee}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && handleAmount0Change(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount0} onChange={e => handleAmount0Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className="bg-bg-raised rounded-xl p-3">
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && handleAmount1Change(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount1} onChange={e => handleAmount1Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
            {currentPrice && (
              <div className="text-2xs text-text-muted text-center font-mono">
                1 {selectedPool.token0} = {currentPrice < 0.001 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)} {selectedPool.token1}
              </div>
            )}
          </div>

          {!hasLiquidity && (
            <div className="p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20 text-xs text-aeon-400">
              New pool — no existing liquidity. Enter both token amounts manually to set your initial price ratio.
            </div>
          )}

          <div className="card p-4 space-y-2.5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Estimated Returns</div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-muted">Current Pool APR</span>
              <span className="font-mono text-sm text-text-primary">{fmtApr(baseApr)}</span>
            </div>
            {depositUsd > 0 && (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Your Est. APR <span className="text-2xs text-text-muted">(after deposit)</span></span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{fmtApr(dilutedApr)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-bg-border">
                  <span className="text-sm text-text-muted">Est. Yearly Earnings</span>
                  <span className="font-mono text-sm text-aeon-400">{fmtUsd(yearlyEarn)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Est. Daily Earnings</span>
                  <span className="font-mono text-xs text-text-secondary">{yearlyEarn !== null ? fmtUsd(yearlyEarn / 365) : '—'}</span>
                </div>
              </>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              Modeled from trailing swap volume × pool fee rate, diluted by your deposit's added share of pool TVL. Actual returns move with trading activity. Stake your LP in a gauge on the{' '}
              <Link href="/earn" className="text-aeon-400 hover:underline">Earn</Link> page for additional AEON emissions (vAPR) on top of this.
            </div>
          </div>

          {showProgress && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {progressSteps().map((s, i) => (
                  <div key={i} className="flex items-center gap-3">
                    {s.done
                      ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                      : s.active
                        ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />
                        : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />
                    }
                    <span className={clsx('text-sm', s.done ? 'text-emerald-400' : s.active ? 'text-aeon-400' : 'text-text-muted')}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          {amount0Wei > 0n && bal0.raw > 0n && amount0Wei > bal0.raw && (
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              ⚠ Insufficient {selectedPool.token0} balance. You have {bal0.formatted}.
            </div>
          )}
          {amount1Wei > 0n && bal1.raw > 0n && amount1Wei > bal1.raw && (
            <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
              ⚠ Insufficient {selectedPool.token1} balance. You have {bal1.formatted}.
            </div>
          )}

          <button
            onClick={startAddLiquidity}
            disabled={isConnected && (isProcessing || !amount0 || !amount1)}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-4">Remove Amount</div>
            <div className="text-center mb-4">
              <div className="text-5xl font-display font-bold text-text-primary mb-1">{removeAmount}%</div>
              <div className="text-sm text-text-muted">of your position</div>
            </div>
            <input type="range" min={0} max={100} value={removeAmount} onChange={e => setRemoveAmount(parseInt(e.target.value))} className="w-full accent-aeon-400 mb-3" />
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(p => (
                <button key={p} onClick={() => setRemoveAmount(p)} className={clsx('flex-1 py-2 rounded-xl text-sm font-medium transition-all', removeAmount === p ? 'bg-aeon-400/15 text-aeon-400 border border-aeon-400/30' : 'bg-bg-raised text-text-muted border border-bg-border hover:border-bg-hover')}>
                  {p === 100 ? 'MAX' : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const lpToRemove = lpBal * BigInt(removeAmount) / 100n
            const recv0 = totalSupply > 0n ? lpToRemove * reserve0 / totalSupply : 0n
            const recv1 = totalSupply > 0n ? lpToRemove * reserve1 / totalSupply : 0n
            return (
              <div className="card p-4">
                <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">You Receive</div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-text-muted">{selectedPool.token0}</span>
                    <span className="font-mono text-text-primary">{lpBal > 0n ? parseFloat(formatUnits(recv0, token0Dec)).toFixed(6) : '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-text-muted">{selectedPool.token1}</span>
                    <span className="font-mono text-text-primary">{lpBal > 0n ? parseFloat(formatUnits(recv1, token1Dec)).toFixed(6) : '—'}</span>
                  </div>
                </div>
                {isConnected && lpBal > 0n && (
                  <div className="mt-3 pt-3 border-t border-bg-border text-xs text-text-muted flex justify-between">
                    <span>LP Balance</span>
                    <span className="font-mono">{lpBalFormatted}</span>
                  </div>
                )}
              </div>
            )
          })()}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          {step === 'remove_done' && (
            <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 text-xs text-green-400 font-mono flex items-center gap-2">
              <CheckCircle2 size={14} /> Liquidity removed successfully!
            </div>
          )}

          <button
            onClick={() => {
              if (!isConnected) { openConnectModal?.(); return }
              if (lpBal === 0n) return
              setErrMsg('')
              if (lpAllowance < lpBal * BigInt(removeAmount) / 100n) {
                setStep('approve_lp')
              } else {
                setStep('remove')
              }
            }}
            disabled={isConnected && (lpBal === 0n || ['approve_lp', 'approve_lp_wait', 'remove', 'remove_wait'].includes(step))}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Minus size={16} />
            {!isConnected ? 'Connect Wallet'
              : lpBal === 0n ? 'No LP Balance'
              : step === 'approve_lp' || step === 'approve_lp_wait' ? 'Approving LP…'
              : step === 'remove' || step === 'remove_wait' ? 'Removing…'
              : 'Remove Liquidity'}
          </button>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// CL — Algebra Integral concentrated liquidity
// ─────────────────────────────────────────────────────────────────────────


function PositionCard({ pos, onDone }: { pos: { tokenId: bigint, token0: string, token1: string, tickLower: number, tickUpper: number, liquidity: bigint }, onDone: () => void }) {
  const { address } = useAccount()
  const [step, setStep] = useState<'idle' | 'decrease' | 'decrease_wait' | 'collect' | 'collect_wait' | 'done'>('idle')
  const [errMsg, setErrMsg] = useState('')

  // Same TokenMismatch-class fix as vAMM's LiquidityHelperV2 — decreaseLiquidity
  // previously passed amount0Min/amount1Min as 0, meaning a reserve shift
  // between load and confirmation (or a same-block sandwich) could hand back
  // far less than the position was actually worth with no floor at all.
  const pool = CL_POOLS.find(cp => {
    const a0 = TOKENS[cp.token0 as keyof typeof TOKENS]?.address.toLowerCase()
    const a1 = TOKENS[cp.token1 as keyof typeof TOKENS]?.address.toLowerCase()
    const p0 = pos.token0.toLowerCase(), p1 = pos.token1.toLowerCase()
    return (a0 === p0 && a1 === p1) || (a0 === p1 && a1 === p0)
  })
  const { data: globalStateData } = useReadContract({
    address: pool?.address, abi: ALGEBRA_POOL_ABI, functionName: 'globalState',
    query: { enabled: !!pool, refetchInterval: 15000 },
  })
  const curSqrtPriceX96 = (globalStateData as readonly [bigint, number, number, number, number, boolean] | undefined)?.[0] ?? 0n
  const expected = curSqrtPriceX96 > 0n
    ? amountsForLiquidity(curSqrtPriceX96, pos.tickLower, pos.tickUpper, pos.liquidity)
    : { amount0: 0n, amount1: 0n }

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'decrease_wait') { setStep('collect'); return }
    if (step === 'collect_wait')  { setStep('done'); onDone(); return }
  }, [txSuccess])

  useEffect(() => {
    setErrMsg('')
    if (step === 'decrease') {
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'decreaseLiquidity',
        args: [{
          tokenId: pos.tokenId, liquidity: pos.liquidity,
          amount0Min: withSlippage(expected.amount0), amount1Min: withSlippage(expected.amount1),
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      })
      setStep('decrease_wait')
    }
    if (step === 'collect') {
      if (!address) { setStep('idle'); return }
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'collect',
        args: [{ tokenId: pos.tokenId, recipient: address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      })
      setStep('collect_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  const sym0 = Object.values(TOKENS).find(t => t.address.toLowerCase() === pos.token0.toLowerCase())?.symbol ?? '?'
  const sym1 = Object.values(TOKENS).find(t => t.address.toLowerCase() === pos.token1.toLowerCase())?.symbol ?? '?'
  const busy = step !== 'idle' && step !== 'done'

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-text-secondary">#{pos.tokenId.toString()}</span>
        <span className="text-text-muted font-mono">liquidity {pos.liquidity.toString()}</span>
      </div>
      <div className="text-2xs text-text-muted font-mono">ticks [{pos.tickLower}, {pos.tickUpper}] · {sym0}/{sym1}</div>
      {step === 'done' ? (
        <div className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={13} /> Closed — tokens returned to your wallet</div>
      ) : (
        <button
          disabled={busy}
          onClick={() => { setStep('decrease') }}
          className="btn-ghost w-full text-xs py-2 border border-bg-border flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {step === 'decrease' || step === 'decrease_wait' ? 'Removing liquidity…' : step === 'collect' || step === 'collect_wait' ? 'Collecting tokens…' : 'Remove & Collect (100%)'}
        </button>
      )}
      {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
    </div>
  )
}

// Single-pool swap via Algebra's own deployed SwapRouter/QuoterV2 -- our own
// AeonRouterRH can't execute CL swaps (it only knows AeonPoolRH's constant-
// product interface), but Algebra's real periphery contracts work directly,
// no new contract needed. Not part of the main Swap page's route search —
// single pool only, not combined with vAMM hops.
function ClSwapPanel({ pool, wallet }: { pool: typeof CL_POOLS[number]; wallet: `0x${string}` | undefined }) {
  const { openConnectModal } = useConnectModal()
  const [flipped,  setFlipped]  = useState(false)
  const [amountIn, setAmountIn] = useState('')
  const [step,    setStep]    = useState<'idle' | 'approve' | 'approve_wait' | 'swap' | 'swap_wait' | 'done'>('idle')
  const [errMsg,  setErrMsg]  = useState('')

  const tokenInKey  = (flipped ? pool.token1 : pool.token0) as keyof typeof TOKENS
  const tokenOutKey = (flipped ? pool.token0 : pool.token1) as keyof typeof TOKENS
  const tokenIn  = TOKENS[tokenInKey]
  const tokenOut = TOKENS[tokenOutKey]

  const balIn   = useTokenBal(tokenIn.address, wallet)
  const allowIn = useAllowance(tokenIn.address, wallet, ALGEBRA_CONTRACTS.swapRouter)

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amountInWei = safeParseUnits(amountIn, tokenIn.decimals)

  // quoteExactInputSingle isn't `view` on-chain (it reverts internally to
  // compute its result) but behaves identically via eth_call either way —
  // verified against a traced fork simulation before relying on it here.
  const { data: quoteData } = useReadContract({
    address: ALGEBRA_CONTRACTS.quoterV2, abi: ALGEBRA_QUOTER_ABI, functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: tokenIn.address, tokenOut: tokenOut.address, deployer: ZERO_ADDR as `0x${string}`, amountIn: amountInWei, limitSqrtPrice: 0n }],
    query: { enabled: amountInWei > 0n, refetchInterval: 10000 },
  })
  const amountOutWei = (quoteData as readonly [bigint, bigint, bigint, number, bigint, number] | undefined)?.[0] ?? 0n

  const needApprove = amountInWei > 0n && allowIn < amountInWei

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])
  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve_wait') { setStep('swap'); return }
    if (step === 'swap_wait') { setStep('done'); setAmountIn(''); return }
  }, [txSuccess])

  useEffect(() => {
    if (!wallet) return
    setErrMsg('')
    if (step === 'approve') {
      writeContract({ address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve', args: [ALGEBRA_CONTRACTS.swapRouter, maxUint256] })
      setStep('approve_wait')
    }
    if (step === 'swap') {
      const minOut = amountOutWei > 0n ? (amountOutWei * 98n) / 100n : 0n
      writeContract({
        address: ALGEBRA_CONTRACTS.swapRouter, abi: ALGEBRA_SWAP_ROUTER_ABI, functionName: 'exactInputSingle',
        args: [{
          tokenIn: tokenIn.address, tokenOut: tokenOut.address, deployer: ZERO_ADDR as `0x${string}`,
          recipient: wallet, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
          amountIn: amountInWei, amountOutMinimum: minOut, limitSqrtPrice: 0n,
        }],
      })
      setStep('swap_wait')
    }
  }, [step])

  const busy = step !== 'idle' && step !== 'done'

  function handleClick() {
    if (!wallet) { openConnectModal?.(); return }
    if (amountInWei === 0n) return
    if (needApprove) { setStep('approve'); return }
    setStep('swap')
  }

  function label() {
    if (!wallet) return 'Connect Wallet'
    if (step === 'approve' || step === 'approve_wait') return `Approving ${tokenIn.symbol}…`
    if (step === 'swap' || step === 'swap_wait') return 'Swapping…'
    if (step === 'done') return '✓ Swapped!'
    if (amountInWei === 0n) return 'Enter an amount'
    if (needApprove) return `Approve ${tokenIn.symbol}`
    return `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
  }

  return (
    <div className="space-y-3">
      <div className="bg-bg-raised rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">You pay</span>
          <span className="text-xs text-text-muted font-mono">Balance: {balIn.formatted}</span>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" value={amountIn} onChange={e => setAmountIn(e.target.value)} disabled={busy} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-60" />
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border shrink-0">
            <TokenIcon symbol={tokenInKey} size={22} />
            <span className="font-medium text-sm">{tokenIn.symbol}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-center -my-1 relative z-10">
        <button onClick={() => { setFlipped(!flipped); setAmountIn(''); setStep('idle') }} disabled={busy} className="w-8 h-8 rounded-xl bg-bg-base border border-bg-border hover:border-aeon-400/50 hover:text-aeon-400 transition-all flex items-center justify-center text-text-muted disabled:opacity-60">
          <Repeat size={14} />
        </button>
      </div>

      <div className="bg-bg-raised rounded-xl p-4">
        <div className="text-xs text-text-muted mb-2">You receive</div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-xl font-mono text-text-primary">
            {amountOutWei > 0n ? parseFloat(formatUnits(amountOutWei, tokenOut.decimals)).toFixed(6) : <span className="text-text-muted">0.0</span>}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border shrink-0">
            <TokenIcon symbol={tokenOutKey} size={22} />
            <span className="font-medium text-sm">{tokenOut.symbol}</span>
          </div>
        </div>
      </div>

      <div className="text-2xs text-text-muted px-1 leading-relaxed">
        Swaps directly through this CL pool via Algebra's own router — single pool only, not combined with other AEON pools in one route.
      </div>

      {errMsg && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>}

      <button onClick={handleClick} disabled={!!wallet && (busy || amountInWei === 0n)} className="btn-primary w-full py-3.5 flex items-center justify-center gap-2">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {label()}
      </button>
    </div>
  )
}

function ClLiquidity({ initialPool }: { initialPool?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(() => CL_POOLS.find(p => p.address === initialPool) ?? CL_POOLS[0])
  const [rangeKey,       setRangeKey]       = useState<string>(CL_RANGE_PRESETS[1].key)
  const [customMin,      setCustomMin]      = useState('')
  const [customMax,      setCustomMax]      = useState('')
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<ClStep>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const isCustomRange = rangeKey === 'custom'
  const preset = CL_RANGE_PRESETS.find(p => p.key === rangeKey)

  const prices    = usePrices()
  const poolStats = usePoolStats(prices)
  const volResult = useVolume24h(prices)

  const token0Key  = selectedPool.token0 as keyof typeof TOKENS
  const token1Key  = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = TOKENS[token0Key].address
  const token1Addr = TOKENS[token1Key].address
  const token0Dec  = TOKENS[token0Key].decimals
  const token1Dec  = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)
  const allowance0 = useAllowance(token0Addr, address, PM)
  const allowance1 = useAllowance(token1Addr, address, PM)

  const { data: poolData } = useReadContracts({
    contracts: [
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'globalState' },
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'tickSpacing' },
      { address: selectedPool.address, abi: ALGEBRA_POOL_ABI, functionName: 'liquidity' },
      { address: selectedPool.address, abi: PAIR_ABI, functionName: 'token0' },
    ],
    query: { refetchInterval: 15000 },
  })
  const globalState  = poolData?.[0]?.status === 'success' ? poolData[0].result as readonly [bigint, number, number, number, number, boolean] : undefined
  const tickSpacing  = poolData?.[1]?.status === 'success' ? poolData[1].result as number : 60
  const poolLiquidity = poolData?.[2]?.status === 'success' ? poolData[2].result as bigint : 0n
  const onChainToken0 = poolData?.[3]?.status === 'success' ? poolData[3].result as string : undefined

  const sqrtPriceX96 = globalState?.[0] ?? 0n
  const currentTick  = globalState?.[1] ?? 0
  const poolInitialized = sqrtPriceX96 > 0n

  const isDisp0First = !onChainToken0 || onChainToken0.toLowerCase() === token0Addr.toLowerCase()

  // display price = display-token1 per 1 display-token0 — what the custom
  // min/max inputs are expressed in, and what "Current Price" below shows.
  const displayCurrentPrice = poolInitialized
    ? (isDisp0First ? tickToPrice(currentTick, token0Dec, token1Dec) : 1 / tickToPrice(currentTick, token1Dec, token0Dec))
    : null

  // Converts a display-terms price into an on-chain tick, accounting for the
  // possible token0/token1 flip between display order and on-chain order.
  function displayPriceToTick(price: number, roundUp: boolean): number {
    return isDisp0First
      ? priceToTick(price, token0Dec, token1Dec, tickSpacing, roundUp)
      : priceToTick(1 / price, token1Dec, token0Dec, tickSpacing, !roundUp)
  }

  let tickLower: number | undefined
  let tickUpper: number | undefined
  if (poolInitialized) {
    if (isCustomRange) {
      const minP = parseFloat(customMin)
      const maxP = parseFloat(customMax)
      if (minP > 0 && maxP > 0) {
        const tA = displayPriceToTick(minP, false)
        const tB = displayPriceToTick(maxP, true)
        tickLower = Math.min(tA, tB)
        tickUpper = Math.max(tA, tB)
      }
    } else if (preset) {
      tickLower = priceOffsetToTick(currentTick, preset.pctLow, tickSpacing, false)
      tickUpper = priceOffsetToTick(currentTick, preset.pctHigh, tickSpacing, true)
    }
  }

  const side = (tickLower !== undefined && tickUpper !== undefined) ? rangeSide(tickLower, currentTick, tickUpper) : 'both'
  const displaySide: 'display0' | 'display1' | 'both' =
    side === 'both' ? 'both' :
    (side === 'token0') === isDisp0First ? 'display0' : 'display1'

  // Same tick->price conversion as displayCurrentPrice, applied to the range
  // bounds — then to a real USD price by multiplying by token1's own USD
  // price (e.g. for ETH/USDC, this ratio already IS ETH's USD price; for any
  // other pair it's token0's price implied at that point in the range).
  function tickToDisplayPrice(tick: number): number {
    return isDisp0First ? tickToPrice(tick, token0Dec, token1Dec) : 1 / tickToPrice(tick, token1Dec, token0Dec)
  }
  const rangeDisplayLow  = tickLower !== undefined && tickUpper !== undefined ? Math.min(tickToDisplayPrice(tickLower), tickToDisplayPrice(tickUpper)) : null
  const rangeDisplayHigh = tickLower !== undefined && tickUpper !== undefined ? Math.max(tickToDisplayPrice(tickLower), tickToDisplayPrice(tickUpper)) : null
  const token1UsdPrice = prices[selectedPool.token1] ?? null
  const rangeUsdLow  = rangeDisplayLow  !== null && token1UsdPrice !== null ? rangeDisplayLow  * token1UsdPrice : null
  const rangeUsdHigh = rangeDisplayHigh !== null && token1UsdPrice !== null ? rangeDisplayHigh * token1UsdPrice : null

  useEffect(() => { setAmount0(''); setAmount1(''); setErrMsg('') }, [selectedPool.address, rangeKey, customMin, customMax])
  useEffect(() => { setCustomMin(''); setCustomMax('') }, [selectedPool.address])

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }

  function handleAmount0Change(val: string) {
    setAmount0(val)
    if (displaySide === 'display1') return
    if (!val || tickLower === undefined || tickUpper === undefined || displaySide !== 'both') { if (displaySide === 'display0') setAmount1('0'); return }
    try {
      const wei = parseUnits(val, token0Dec)
      const paired = pairedAmount({ amountIn: wei, isAmount0: isDisp0First, tickLower, tickUpper, currentTick, sqrtPriceX96 })
      setAmount1(parseFloat(formatUnits(paired, token1Dec)).toFixed(8))
    } catch {}
  }
  function handleAmount1Change(val: string) {
    setAmount1(val)
    if (displaySide === 'display0') return
    if (!val || tickLower === undefined || tickUpper === undefined || displaySide !== 'both') { if (displaySide === 'display1') setAmount0('0'); return }
    try {
      const wei = parseUnits(val, token1Dec)
      const paired = pairedAmount({ amountIn: wei, isAmount0: !isDisp0First, tickLower, tickUpper, currentTick, sqrtPriceX96 })
      setAmount0(parseFloat(formatUnits(paired, token0Dec)).toFixed(8))
    } catch {}
  }

  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  // on-chain-ordered amounts for the mint() call itself
  const mintToken0 = isDisp0First ? token0Addr : token1Addr
  const mintToken1 = isDisp0First ? token1Addr : token0Addr
  const mintAmount0Wei = isDisp0First ? amount0Wei : amount1Wei
  const mintAmount1Wei = isDisp0First ? amount1Wei : amount0Wei

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait') { setStep('approve1'); return }
    if (step === 'approve1_wait') { setStep('mint');      return }
    if (step === 'mint_wait')     { setStep('done'); setAmount0(''); setAmount1(''); refetchPositions(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [PM, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [PM, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'mint') {
      if (tickLower === undefined || tickUpper === undefined) { setStep('idle'); return }
      writeContract({
        address: PM, abi: ALGEBRA_POSITION_MANAGER_ABI, functionName: 'mint',
        args: [{
          token0: mintToken0, token1: mintToken1,
          deployer: '0x0000000000000000000000000000000000000000' as `0x${string}`,
          tickLower, tickUpper,
          amount0Desired: mintAmount0Wei, amount1Desired: mintAmount1Wei,
          amount0Min: (mintAmount0Wei * 98n) / 100n, amount1Min: (mintAmount1Wei * 98n) / 100n,
          recipient: address, deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      })
      setStep('mint_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  function startMint() {
    if (!isConnected) { openConnectModal?.(); return }
    if (mintAmount0Wei === 0n && mintAmount1Wei === 0n) return
    setErrMsg('')
    if (needApprove0 && mintAmount0Wei > 0n) { setStep('approve0'); return }
    if (needApprove1 && mintAmount1Wei > 0n) { setStep('approve1'); return }
    setStep('mint')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'mint', 'mint_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (!poolInitialized) return 'Pool not initialized'
    if (mintAmount0Wei === 0n && mintAmount1Wei === 0n) return 'Enter an amount'
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'mint' || step === 'mint_wait') return 'Minting Position…'
    if (step === 'done') return '✓ Position Minted!'
    if (needApprove0 && mintAmount0Wei > 0n) return `1. Approve ${selectedPool.token0}`
    if (needApprove1 && mintAmount1Wei > 0n) return `2. Approve ${selectedPool.token1}`
    return 'Add Concentrated Liquidity'
  }

  // ── APR estimate — modeled off the paired vAMM pool's trading volume ──
  const sisterVamm = POOLS.find(p => p.name === selectedPool.name)
  const sisterVol   = sisterVamm ? volResult.byPool[sisterVamm.address.toLowerCase()] ?? null : null
  const clFeeRate    = parseFeeRate(selectedPool.fee)
  const estDailyFeesUsd = sisterVol !== null ? sisterVol * clFeeRate : null

  const yourL = (tickLower !== undefined && tickUpper !== undefined && poolInitialized)
    ? liquidityForAmounts(sqrtPriceX96, tickLower, tickUpper, mintAmount0Wei, mintAmount1Wei)
    : 0n
  const totalL = yourL + poolLiquidity
  const yourShare = totalL > 0n ? Number(yourL) / Number(totalL) : 0

  const p0 = prices[selectedPool.token0] ?? null
  const p1 = prices[selectedPool.token1] ?? null
  const depositUsd = (p0 !== null ? parseFloat(amount0 || '0') * p0 : 0) + (p1 !== null ? parseFloat(amount1 || '0') * p1 : 0)
  const yourYearlyFeesUsd = estDailyFeesUsd !== null ? estDailyFeesUsd * 365 * yourShare : null
  const clApr = yourYearlyFeesUsd !== null && depositUsd > 0 ? (yourYearlyFeesUsd / depositUsd) * 100 : null

  const { positions, refetch: refetchPositions } = useClPositions(isConnected ? address : undefined)
  const poolPositions = positions.filter(p =>
    (p.token0.toLowerCase() === token0Addr.toLowerCase() && p.token1.toLowerCase() === token1Addr.toLowerCase()) ||
    (p.token0.toLowerCase() === token1Addr.toLowerCase() && p.token1.toLowerCase() === token0Addr.toLowerCase())
  )

  return (
    <>
      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
        <button onClick={() => { setTab('swap'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'swap' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Repeat size={14} /> Swap
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">{selectedPool.type} · {selectedPool.fee}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {CL_POOLS.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">{pool.fee}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Price Range</div>
            {displayCurrentPrice !== null && (
              <div className="text-2xs text-text-muted text-center font-mono">
                Current Price: 1 {selectedPool.token0} = {displayCurrentPrice < 0.001 ? displayCurrentPrice.toExponential(2) : displayCurrentPrice.toFixed(6)} {selectedPool.token1}
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              {CL_RANGE_PRESETS.map(p => (
                <button key={p.key} onClick={() => setRangeKey(p.key)} className={clsx('py-2.5 rounded-xl text-center transition-all border', rangeKey === p.key ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className="text-2xs font-mono mt-0.5">{p.desc}</div>
                </button>
              ))}
              <button onClick={() => setRangeKey('custom')} className={clsx('py-2.5 rounded-xl text-center transition-all border', isCustomRange ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                <div className="text-xs font-semibold">Custom</div>
                <div className="text-2xs font-mono mt-0.5">min/max</div>
              </button>
            </div>

            {isCustomRange && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Min Price ({selectedPool.token1} per {selectedPool.token0})</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={customMin} onChange={e => setCustomMin(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2 font-mono" />
                    {displayCurrentPrice !== null && (
                      <button onClick={() => setCustomMin((displayCurrentPrice * 0.9).toPrecision(6))} className="text-2xs text-aeon-400 font-mono hover:underline shrink-0">-10%</button>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Max Price ({selectedPool.token1} per {selectedPool.token0})</label>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={customMax} onChange={e => setCustomMax(e.target.value)} placeholder="0.0" className="input-base w-full text-sm py-2 font-mono" />
                    {displayCurrentPrice !== null && (
                      <button onClick={() => setCustomMax((displayCurrentPrice * 1.1).toPrecision(6))} className="text-2xs text-aeon-400 font-mono hover:underline shrink-0">+10%</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tickLower !== undefined && tickUpper !== undefined ? (
              <div className="text-center">
                {rangeUsdLow !== null && rangeUsdHigh !== null ? (
                  <div className="text-sm font-mono font-semibold text-text-primary">
                    {fmtPricePoint(rangeUsdLow)} <span className="text-text-muted">→</span> {fmtPricePoint(rangeUsdHigh)}
                  </div>
                ) : rangeDisplayLow !== null && rangeDisplayHigh !== null ? (
                  <div className="text-sm font-mono font-semibold text-text-primary">
                    {rangeDisplayLow.toPrecision(6)} <span className="text-text-muted">→</span> {rangeDisplayHigh.toPrecision(6)} {selectedPool.token1}
                  </div>
                ) : null}
                <div className="text-2xs text-text-muted font-mono mt-0.5">tick [{tickLower}, {tickUpper}] · current tick {currentTick}</div>
              </div>
            ) : isCustomRange && poolInitialized ? (
              <div className="text-2xs text-text-muted text-center">Enter both a min and max price to set your range</div>
            ) : null}
            {displaySide !== 'both' && poolInitialized && (
              <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-2xs text-yellow-400">
                This range is entirely {displaySide === 'display0' ? selectedPool.token0 : selectedPool.token1} at the current price — only one side is needed. You won't earn fees until the price moves into range.
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', displaySide === 'display1' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && handleAmount0Change(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={displaySide === 'display1'} type="number" value={amount0} onChange={e => handleAmount0Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', displaySide === 'display0' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && handleAmount1Change(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={displaySide === 'display0'} type="number" value={amount1} onChange={e => handleAmount1Change(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-2.5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Estimated Returns</div>
            {displaySide !== 'both' ? (
              <div className="text-xs text-text-muted">Range doesn't include the current price — no fee estimate until it does.</div>
            ) : depositUsd > 0 ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Your Est. APR <span className="text-2xs text-text-muted">(while in range)</span></span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{fmtApr(clApr)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-bg-border">
                  <span className="text-sm text-text-muted">Est. Yearly Earnings</span>
                  <span className="font-mono text-sm text-aeon-400">{fmtUsd(yourYearlyFeesUsd)}</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted">Enter an amount to estimate your yearly earnings.</div>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              {sisterVamm
                ? `Estimated from the paired vAMM ${selectedPool.name} pool's trailing volume at this pool's ${selectedPool.fee} fee tier, scaled by your share of in-range liquidity. This CL pool is brand new — the real rate will depend on actual trading activity here once it builds up.`
                : `This pool has no vAMM equivalent to estimate volume from yet, so no APR estimate is shown until this CL pool builds up its own trading history.`}
            </div>
          </div>

          {isProcessing && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {(needApprove0 && mintAmount0Wei > 0n) && (
                  <div className="flex items-center gap-3">
                    {['approve1', 'approve1_wait', 'mint', 'mint_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token0}</span>
                  </div>
                )}
                {(needApprove1 && mintAmount1Wei > 0n) && (
                  <div className="flex items-center gap-3">
                    {['mint', 'mint_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : (step === 'approve1' || step === 'approve1_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token1}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {(step === 'mint' || step === 'mint_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                  <span className="text-sm text-text-muted">Mint Position</span>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          <button
            onClick={startMint}
            disabled={isConnected && (isProcessing || (mintAmount0Wei === 0n && mintAmount1Wei === 0n))}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : tab === 'swap' ? (
        <ClSwapPanel pool={selectedPool} wallet={address} />
      ) : (
        <div className="space-y-3">
          {!isConnected ? (
            <div className="card p-8 text-center text-sm text-text-muted">Connect your wallet to view positions</div>
          ) : poolPositions.length === 0 ? (
            <div className="card p-8 text-center text-sm text-text-muted">No open {selectedPool.name} CL positions found in this wallet.</div>
          ) : (
            poolPositions.map(pos => <PositionCard key={pos.tokenId.toString()} pos={pos} onDone={refetchPositions} />)
          )}
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// DLMM — Trader Joe / LFJ Liquidity Book (joe-v2)
// ─────────────────────────────────────────────────────────────────────────

// Bin-range presets — how many bins on each side of the active bin to spread
// a "spot" (uniform) deposit across. "Single Bin" concentrates everything in
// exactly the active bin, like a limit order at the current price.
const DLMM_RANGE_PRESETS = [
  { key: 'single', label: 'Single Bin', desc: '1 bin',   lower: 0,   upper: 0   },
  { key: 'narrow', label: 'Narrow',     desc: '±5 bins',  lower: -5,  upper: 5   },
  { key: 'normal', label: 'Normal',     desc: '±10 bins', lower: -10, upper: 10  },
  { key: 'wide',   label: 'Wide',       desc: '±20 bins', lower: -20, upper: 20  },
]

function DlmmPositionCard({ pool, pos, owner, onDone }: { pool: typeof DLMM_POOLS[number], pos: { id: number, balance: bigint }, owner: `0x${string}`, onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'approve' | 'approve_wait' | 'remove' | 'remove_wait' | 'done'>('idle')
  const [errMsg, setErrMsg] = useState('')

  const token0Addr = TOKENS[pool.token0 as keyof typeof TOKENS].address
  const token1Addr = TOKENS[pool.token1 as keyof typeof TOKENS].address

  const { data: isApproved } = useReadContract({
    address: pool.address, abi: LB_PAIR_ABI, functionName: 'isApprovedForAll',
    args: [owner, DLMM_ROUTER], query: { enabled: !!owner },
  })

  // Same slippage-protection fix as the vAMM/CL remove flows — removeLiquidity
  // previously passed amountXMin/amountYMin as 0, so a same-block sandwich or
  // just unlucky timing around a bin-shifting trade could hand back far less
  // than the position was actually worth with no floor at all.
  const { data: binData } = useReadContracts({
    contracts: [
      { address: pool.address, abi: LB_PAIR_ABI, functionName: 'getBin' as const, args: [pos.id] },
      { address: pool.address, abi: LB_PAIR_ABI, functionName: 'totalSupply' as const, args: [BigInt(pos.id)] },
    ],
    query: { refetchInterval: 15000 },
  })
  const [binReserveX, binReserveY] = binData?.[0]?.status === 'success' ? binData[0].result as [bigint, bigint] : [0n, 0n]
  const binTotalSupply = binData?.[1]?.status === 'success' ? binData[1].result as bigint : 0n
  const expectedX = binTotalSupply > 0n ? binReserveX * pos.balance / binTotalSupply : 0n
  const expectedY = binTotalSupply > 0n ? binReserveY * pos.balance / binTotalSupply : 0n

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve_wait') { setStep('remove'); return }
    if (step === 'remove_wait')  { setStep('done'); onDone(); return }
  }, [txSuccess])

  useEffect(() => {
    setErrMsg('')
    if (step === 'approve') {
      writeContract({ address: pool.address, abi: LB_PAIR_ABI, functionName: 'approveForAll', args: [DLMM_ROUTER, true] })
      setStep('approve_wait')
    }
    if (step === 'remove') {
      writeContract({
        address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'removeLiquidity',
        args: [token0Addr, token1Addr, pool.binStep, withSlippage(expectedX), withSlippage(expectedY), [BigInt(pos.id)], [pos.balance], owner, BigInt(Math.floor(Date.now() / 1000) + 1200)],
      })
      setStep('remove_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  const busy = step !== 'idle' && step !== 'done'

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono text-text-secondary">bin #{pos.id}</span>
        <span className="text-text-muted font-mono">shares {pos.balance.toString()}</span>
      </div>
      {step === 'done' ? (
        <div className="text-xs text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={13} /> Removed — tokens returned to your wallet</div>
      ) : (
        <button
          disabled={busy}
          onClick={() => setStep(isApproved ? 'remove' : 'approve')}
          className="btn-ghost w-full text-xs py-2 border border-bg-border flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {step === 'approve' || step === 'approve_wait' ? 'Approving…' : step === 'remove' || step === 'remove_wait' ? 'Removing…' : 'Remove Liquidity'}
        </button>
      )}
      {errMsg && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-2xs text-red-400 font-mono break-all">{errMsg}</div>}
    </div>
  )
}

// Single-pool swap via Trader Joe/LFJ's own deployed LB Router -- verified
// on-chain that this specific deployment only has its V2_2 factory slot
// populated (getFactory() matches our real DLMM_CONTRACTS.factory; V1/V2/
// V2_1 all resolve to the zero address), so the swap Path's version MUST be
// 3 (V2_2) -- any other value makes the router look up a pair via an unset
// factory and revert. Confirmed with a traced fork simulation before
// shipping this. Not part of the main Swap page's route search — single
// pool only.
function DlmmSwapPanel({ pool, wallet }: { pool: typeof DLMM_POOLS[number]; wallet: `0x${string}` | undefined }) {
  const { openConnectModal } = useConnectModal()
  const [flipped,  setFlipped]  = useState(false)
  const [amountIn, setAmountIn] = useState('')
  const [step,    setStep]    = useState<'idle' | 'approve' | 'approve_wait' | 'swap' | 'swap_wait' | 'done'>('idle')
  const [errMsg,  setErrMsg]  = useState('')

  // contracts.ts: DLMM token0/token1 match on-chain tokenX/tokenY exactly
  // (LB doesn't sort by address, unlike vAMM/CL) -- no extra on-chain check needed.
  const tokenInKey  = (flipped ? pool.token1 : pool.token0) as keyof typeof TOKENS
  const tokenOutKey = (flipped ? pool.token0 : pool.token1) as keyof typeof TOKENS
  const tokenIn  = TOKENS[tokenInKey]
  const tokenOut = TOKENS[tokenOutKey]
  const swapForY = !flipped // token0(X) -> token1(Y) when not flipped

  const balIn   = useTokenBal(tokenIn.address, wallet)
  const allowIn = useAllowance(tokenIn.address, wallet, DLMM_ROUTER)

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amountInWei = safeParseUnits(amountIn, tokenIn.decimals)

  const { data: quoteData } = useReadContract({
    address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'getSwapOut',
    args: [pool.address, amountInWei, swapForY],
    query: { enabled: amountInWei > 0n, refetchInterval: 10000 },
  })
  const quote          = quoteData as readonly [bigint, bigint, bigint] | undefined
  const amountInLeft   = quote?.[0] ?? 0n
  const amountOutWei   = quote?.[1] ?? 0n
  const insufficientDepth = amountInWei > 0n && amountInLeft > 0n

  const needApprove = amountInWei > 0n && allowIn < amountInWei

  const { writeContract, data: txHash, error: writeError } = useWriteContract()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])
  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve_wait') { setStep('swap'); return }
    if (step === 'swap_wait') { setStep('done'); setAmountIn(''); return }
  }, [txSuccess])

  useEffect(() => {
    if (!wallet) return
    setErrMsg('')
    if (step === 'approve') {
      writeContract({ address: tokenIn.address, abi: ERC20_ABI, functionName: 'approve', args: [DLMM_ROUTER, maxUint256] })
      setStep('approve_wait')
    }
    if (step === 'swap') {
      const minOut = amountOutWei > 0n ? (amountOutWei * 98n) / 100n : 0n
      writeContract({
        address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'swapExactTokensForTokens',
        args: [
          amountInWei, minOut,
          { pairBinSteps: [BigInt(pool.binStep)], versions: [3], tokenPath: [tokenIn.address, tokenOut.address] },
          wallet, BigInt(Math.floor(Date.now() / 1000) + 1200),
        ],
      })
      setStep('swap_wait')
    }
  }, [step])

  const busy = step !== 'idle' && step !== 'done'

  function handleClick() {
    if (!wallet) { openConnectModal?.(); return }
    if (amountInWei === 0n) return
    if (needApprove) { setStep('approve'); return }
    setStep('swap')
  }

  function label() {
    if (!wallet) return 'Connect Wallet'
    if (step === 'approve' || step === 'approve_wait') return `Approving ${tokenIn.symbol}…`
    if (step === 'swap' || step === 'swap_wait') return 'Swapping…'
    if (step === 'done') return '✓ Swapped!'
    if (amountInWei === 0n) return 'Enter an amount'
    if (needApprove) return `Approve ${tokenIn.symbol}`
    return `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
  }

  return (
    <div className="space-y-3">
      <div className="bg-bg-raised rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">You pay</span>
          <span className="text-xs text-text-muted font-mono">Balance: {balIn.formatted}</span>
        </div>
        <div className="flex items-center gap-3">
          <input type="number" value={amountIn} onChange={e => setAmountIn(e.target.value)} disabled={busy} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-60" />
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border shrink-0">
            <TokenIcon symbol={tokenInKey} size={22} />
            <span className="font-medium text-sm">{tokenIn.symbol}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-center -my-1 relative z-10">
        <button onClick={() => { setFlipped(!flipped); setAmountIn(''); setStep('idle') }} disabled={busy} className="w-8 h-8 rounded-xl bg-bg-base border border-bg-border hover:border-aeon-400/50 hover:text-aeon-400 transition-all flex items-center justify-center text-text-muted disabled:opacity-60">
          <Repeat size={14} />
        </button>
      </div>

      <div className="bg-bg-raised rounded-xl p-4">
        <div className="text-xs text-text-muted mb-2">You receive</div>
        <div className="flex items-center gap-3">
          <div className="flex-1 text-xl font-mono text-text-primary">
            {amountOutWei > 0n ? parseFloat(formatUnits(amountOutWei, tokenOut.decimals)).toFixed(6) : <span className="text-text-muted">0.0</span>}
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-base border border-bg-border shrink-0">
            <TokenIcon symbol={tokenOutKey} size={22} />
            <span className="font-medium text-sm">{tokenOut.symbol}</span>
          </div>
        </div>
      </div>

      {insufficientDepth && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
          This pool's nearby bins don't have enough depth to fill your full amount — try a smaller amount for a better rate.
        </div>
      )}

      <div className="text-2xs text-text-muted px-1 leading-relaxed">
        Swaps directly through this DLMM pool via Trader Joe/LFJ's own router — single pool only, not combined with other AEON pools in one route.
      </div>

      {errMsg && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>}

      <button onClick={handleClick} disabled={!!wallet && (busy || amountInWei === 0n)} className="btn-primary w-full py-3.5 flex items-center justify-center gap-2">
        {busy && <Loader2 size={16} className="animate-spin" />}
        {label()}
      </button>
    </div>
  )
}

function DlmmLiquidity({ initialPool }: { initialPool?: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [tab,            setTab]            = useState<Tab>('add')
  const [selectedPool,   setSelectedPool]   = useState(() => DLMM_POOLS.find(p => p.address === initialPool) ?? DLMM_POOLS[0])
  const [rangeKey,       setRangeKey]       = useState<string>(DLMM_RANGE_PRESETS[2].key)
  const [customLower,    setCustomLower]    = useState('-10')
  const [customUpper,    setCustomUpper]    = useState('10')
  const [amount0,        setAmount0]        = useState('')
  const [amount1,        setAmount1]        = useState('')
  const [showPoolPicker, setShowPoolPicker] = useState(false)
  const [step,           setStep]           = useState<DlmmStep>('idle')
  const [errMsg,         setErrMsg]         = useState('')

  const isCustomRange = rangeKey === 'custom'
  const preset = DLMM_RANGE_PRESETS.find(p => p.key === rangeKey)

  const prices        = usePrices()
  const volResult     = useVolume24h(prices)
  const dlmmPoolStats = useDlmmPoolStats(prices)

  const token0Key = selectedPool.token0 as keyof typeof TOKENS
  const token1Key = selectedPool.token1 as keyof typeof TOKENS
  const token0Addr = TOKENS[token0Key].address
  const token1Addr = TOKENS[token1Key].address
  const token0Dec = TOKENS[token0Key].decimals
  const token1Dec = TOKENS[token1Key].decimals

  const bal0 = useTokenBal(token0Addr, address)
  const bal1 = useTokenBal(token1Addr, address)
  const allowance0 = useAllowance(token0Addr, address, DLMM_ROUTER)
  const allowance1 = useAllowance(token1Addr, address, DLMM_ROUTER)

  const { data: poolData } = useReadContracts({
    contracts: [
      { address: selectedPool.address, abi: LB_PAIR_ABI, functionName: 'getActiveId' },
      { address: selectedPool.address, abi: LB_PAIR_ABI, functionName: 'getReserves' },
    ],
    query: { refetchInterval: 15000 },
  })
  const activeId = poolData?.[0]?.status === 'success' ? Number(poolData[0].result) : undefined
  const reserves = poolData?.[1]?.status === 'success' ? poolData[1].result as readonly [bigint, bigint] : undefined
  const hasLiquidity = !!reserves && (reserves[0] > 0n || reserves[1] > 0n)

  const currentPrice = activeId !== undefined ? binIdToPrice(activeId, selectedPool.binStep, token0Dec, token1Dec) : null

  const binOffsetLower = isCustomRange ? (parseInt(customLower, 10) || 0) : preset!.lower
  const binOffsetUpperRaw = isCustomRange ? (parseInt(customUpper, 10) || 0) : preset!.upper
  const binOffsetUpper = Math.max(binOffsetLower, binOffsetUpperRaw) // guard against an inverted custom range
  const side = dlmmRangeSide(binOffsetLower, binOffsetUpper)

  // Same "1 token0 = X token1" conversion as currentPrice, applied to the
  // range's bin bounds, then to a real USD price via token1's own price.
  const rangeLowPrice  = activeId !== undefined ? binIdToPrice(activeId + binOffsetLower, selectedPool.binStep, token0Dec, token1Dec) : null
  const rangeHighPrice = activeId !== undefined ? binIdToPrice(activeId + binOffsetUpper, selectedPool.binStep, token0Dec, token1Dec) : null
  const token1UsdPrice = prices[selectedPool.token1] ?? null
  const rangeUsdLow  = rangeLowPrice  !== null && token1UsdPrice !== null ? rangeLowPrice  * token1UsdPrice : null
  const rangeUsdHigh = rangeHighPrice !== null && token1UsdPrice !== null ? rangeHighPrice * token1UsdPrice : null

  // ── APR estimate — modeled off the paired vAMM pool's trading volume, same
  // approach as the CL panel. Uses a plain your-deposit-vs-pool-TVL share
  // rather than a bin-concentration multiplier — honest simplification since
  // we don't pull enough per-bin reserve data here to model concentration
  // precisely the way CL's tick-based liquidity math does.
  const sisterVamm = POOLS.find(p => p.name === selectedPool.name)
  const sisterVol  = sisterVamm ? volResult.byPool[sisterVamm.address.toLowerCase()] ?? null : null
  const dlmmFeeRate = parseFeeRate(selectedPool.fee)
  const estDailyFeesUsd = sisterVol !== null ? sisterVol * dlmmFeeRate : null

  const p0 = prices[selectedPool.token0] ?? null
  const p1 = prices[selectedPool.token1] ?? null
  const depositUsd = (p0 !== null && amount0 ? parseFloat(amount0 || '0') * p0 : 0) + (p1 !== null && amount1 ? parseFloat(amount1 || '0') * p1 : 0)
  const poolTvlUsd = dlmmPoolStats.find(s => s.address === selectedPool.address)?.tvlUsd ?? null
  const yourShare = poolTvlUsd !== null && poolTvlUsd > 0 ? depositUsd / (depositUsd + poolTvlUsd) : (depositUsd > 0 ? 1 : 0)
  const yourYearlyFeesUsd = estDailyFeesUsd !== null ? estDailyFeesUsd * 365 * yourShare : null
  const dlmmApr = yourYearlyFeesUsd !== null && depositUsd > 0 ? (yourYearlyFeesUsd / depositUsd) * 100 : null

  useEffect(() => { setAmount0(''); setAmount1(''); setErrMsg('') }, [selectedPool.address, rangeKey, customLower, customUpper])

  function safeParseUnits(val: string, dec: number): bigint {
    if (!val || parseFloat(val) <= 0) return 0n
    try { return parseUnits(val, dec) } catch {
      const [int, frac = ''] = val.split('.')
      return parseUnits(`${int}.${frac.slice(0, dec)}`, dec)
    }
  }
  const amount0Wei = safeParseUnits(amount0, token0Dec)
  const amount1Wei = safeParseUnits(amount1, token1Dec)

  const needApprove0 = amount0Wei > 0n && allowance0 < amount0Wei
  const needApprove1 = amount1Wei > 0n && allowance1 < amount1Wei

  const { writeContract, data: txHash, isPending, error: writeError } = useWriteContract()
  const { isLoading: txWaiting, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  useEffect(() => {
    if (!txSuccess) return
    if (step === 'approve0_wait') { setStep('approve1'); return }
    if (step === 'approve1_wait') { setStep('addliq');   return }
    if (step === 'addliq_wait')   { setStep('done'); setAmount0(''); setAmount1(''); refetchPositions(); return }
  }, [txSuccess])

  useEffect(() => {
    if (!address || activeId === undefined) return
    setErrMsg('')
    if (step === 'approve0') {
      writeContract({ address: token0Addr, abi: ERC20_ABI, functionName: 'approve', args: [DLMM_ROUTER, amount0Wei] })
      setStep('approve0_wait')
    }
    if (step === 'approve1') {
      writeContract({ address: token1Addr, abi: ERC20_ABI, functionName: 'approve', args: [DLMM_ROUTER, amount1Wei] })
      setStep('approve1_wait')
    }
    if (step === 'addliq') {
      const { deltaIds, distributionX, distributionY } = computeSpotDistribution(binOffsetLower, binOffsetUpper)
      writeContract({
        address: DLMM_ROUTER, abi: LB_ROUTER_ABI, functionName: 'addLiquidity',
        args: [{
          tokenX: token0Addr, tokenY: token1Addr, binStep: BigInt(selectedPool.binStep),
          amountX: amount0Wei, amountY: amount1Wei,
          amountXMin: 0n, amountYMin: 0n,
          activeIdDesired: BigInt(activeId), idSlippage: 5n,
          deltaIds: deltaIds.map(BigInt),
          distributionX, distributionY,
          to: address, refundTo: address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 1200),
        }],
      })
      setStep('addliq_wait')
    }
  }, [step])

  useEffect(() => { if (writeError) { setErrMsg(writeError.message.slice(0, 150)); setStep('idle') } }, [writeError])

  function startAdd() {
    if (!isConnected) { openConnectModal?.(); return }
    if (amount0Wei === 0n && amount1Wei === 0n) return
    setErrMsg('')
    if (needApprove0) { setStep('approve0'); return }
    if (needApprove1) { setStep('approve1'); return }
    setStep('addliq')
  }

  const isProcessing = ['approve0', 'approve0_wait', 'approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step)

  function stepLabel() {
    if (!isConnected) return 'Connect Wallet'
    if (amount0Wei === 0n && amount1Wei === 0n) return 'Enter amounts'
    if (step === 'approve0' || step === 'approve0_wait') return `Approving ${selectedPool.token0}…`
    if (step === 'approve1' || step === 'approve1_wait') return `Approving ${selectedPool.token1}…`
    if (step === 'addliq' || step === 'addliq_wait') return 'Adding Liquidity…'
    if (step === 'done') return '✓ Liquidity Added!'
    if (needApprove0) return `1. Approve ${selectedPool.token0}`
    if (needApprove1) return `2. Approve ${selectedPool.token1}`
    return 'Add Liquidity'
  }

  const { positions, refetch: refetchPositions } = useDlmmPositions(selectedPool, isConnected ? address : undefined, activeId)

  return (
    <>
      <div className="flex gap-1 p-1 bg-bg-raised border border-bg-border rounded-xl mb-4">
        <button onClick={() => { setTab('add'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'add' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Plus size={14} /> Add
        </button>
        <button onClick={() => { setTab('remove'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'remove' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Minus size={14} /> Remove
        </button>
        <button onClick={() => { setTab('swap'); setStep('idle') }} className={clsx('flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-all', tab === 'swap' ? 'bg-bg-base text-text-primary' : 'text-text-muted')}>
          <Repeat size={14} /> Swap
        </button>
      </div>

      <div className="card p-4 mb-4">
        <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-2">Pool</div>
        <button onClick={() => setShowPoolPicker(!showPoolPicker)} className="w-full flex items-center justify-between p-3 bg-bg-raised rounded-xl border border-bg-border hover:border-bg-hover transition-all">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              <TokenIcon symbol={selectedPool.token0} size={28} />
              <TokenIcon symbol={selectedPool.token1} size={28} />
            </div>
            <div>
              <div className="text-sm font-medium text-text-primary">{selectedPool.name}</div>
              <div className="text-2xs text-text-muted font-mono">DLMM · bin step {selectedPool.binStep}</div>
            </div>
          </div>
          <ChevronDown size={16} className={clsx('text-text-muted transition-transform', showPoolPicker && 'rotate-180')} />
        </button>

        {showPoolPicker && (
          <div className="mt-2 space-y-1">
            {DLMM_POOLS.map(pool => (
              <button key={pool.address} onClick={() => { setSelectedPool(pool); setShowPoolPicker(false); setStep('idle') }} className={clsx('w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-bg-raised transition-colors text-left', selectedPool.address === pool.address && 'bg-aeon-400/5 border border-aeon-400/20')}>
                <div className="flex -space-x-1">
                  <TokenIcon symbol={pool.token0} size={24} />
                  <TokenIcon symbol={pool.token1} size={24} />
                </div>
                <span className="text-sm text-text-primary">{pool.name}</span>
                <span className="text-xs text-text-muted font-mono ml-auto">bin step {pool.binStep}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'add' ? (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Bin Range</div>
            {currentPrice !== null && (
              <div className="text-2xs text-text-muted text-center font-mono">
                Current Price: 1 {selectedPool.token0} = {currentPrice < 0.001 || currentPrice >= 1_000_000_000 ? currentPrice.toExponential(2) : currentPrice.toFixed(6)} {selectedPool.token1} · active bin #{activeId}
                {(currentPrice < 1e-9 || currentPrice >= 1e9) && (
                  <span className="block mt-1 text-amber-400">⚠ This pool's active bin looks far from a realistic price — it may have been seeded incorrectly. Deposits here may not behave as expected.</span>
                )}
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              {DLMM_RANGE_PRESETS.map(p => (
                <button key={p.key} onClick={() => setRangeKey(p.key)} className={clsx('py-2.5 rounded-xl text-center transition-all border', rangeKey === p.key ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                  <div className="text-xs font-semibold">{p.label}</div>
                  <div className="text-2xs font-mono mt-0.5">{p.desc}</div>
                </button>
              ))}
              <button onClick={() => setRangeKey('custom')} className={clsx('py-2.5 rounded-xl text-center transition-all border', isCustomRange ? 'bg-aeon-400/15 border-aeon-400/30 text-aeon-400' : 'bg-bg-raised border-bg-border text-text-muted hover:border-bg-hover')}>
                <div className="text-xs font-semibold">Custom</div>
                <div className="text-2xs font-mono mt-0.5">pick bins</div>
              </button>
            </div>

            {isCustomRange && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Bins Below Active</label>
                  <input type="number" value={customLower} onChange={e => setCustomLower(e.target.value)} placeholder="-10" className="input-base w-full text-sm py-2 font-mono" />
                </div>
                <div>
                  <label className="text-2xs text-text-muted mb-1 block">Bins Above Active</label>
                  <input type="number" value={customUpper} onChange={e => setCustomUpper(e.target.value)} placeholder="10" className="input-base w-full text-sm py-2 font-mono" />
                </div>
                <div className="col-span-2 text-2xs text-text-muted leading-relaxed">
                  Positive = above the active bin (more expensive), negative = below (cheaper). Use e.g. 5 / 15 to place a range entirely above the current price, or 0 / 0 for a single bin.
                </div>
              </div>
            )}

            {activeId !== undefined && (
              <div className="text-center">
                {rangeUsdLow !== null && rangeUsdHigh !== null ? (
                  <div className="text-sm font-mono font-semibold text-text-primary">
                    {fmtPricePoint(rangeUsdLow)} <span className="text-text-muted">→</span> {fmtPricePoint(rangeUsdHigh)}
                  </div>
                ) : rangeLowPrice !== null && rangeHighPrice !== null ? (
                  <div className="text-sm font-mono font-semibold text-text-primary">
                    {rangeLowPrice.toPrecision(6)} <span className="text-text-muted">→</span> {rangeHighPrice.toPrecision(6)} {selectedPool.token1}
                  </div>
                ) : null}
                <div className="text-2xs text-text-muted font-mono mt-0.5">
                  bin [{activeId + binOffsetLower}, {activeId + binOffsetUpper}] · {binOffsetUpper - binOffsetLower + 1} bin{binOffsetUpper - binOffsetLower === 0 ? '' : 's'}
                </div>
              </div>
            )}
            {side !== 'both' && (
              <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-2xs text-yellow-400">
                This range is entirely {side === 'x' ? selectedPool.token0 : selectedPool.token1} at the current price — only one side is needed. You won't earn fees until the price moves into range.
              </div>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Deposit Amounts</div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', side === 'y' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token0}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal0.formatted !== '—' && setAmount0(bal0.formatted.replace(',', ''))}>
                  Balance: {bal0.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={side === 'y'} type="number" value={amount0} onChange={e => setAmount0(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token0}</span>
              </div>
            </div>
            <div className="flex justify-center"><span className="text-text-muted text-sm">+</span></div>
            <div className={clsx('bg-bg-raised rounded-xl p-3', side === 'x' && 'opacity-40')}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-text-muted">{selectedPool.token1}</span>
                <button className="text-xs text-text-muted font-mono hover:text-aeon-400" onClick={() => bal1.formatted !== '—' && setAmount1(bal1.formatted.replace(',', ''))}>
                  Balance: {bal1.formatted}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input disabled={side === 'x'} type="number" value={amount1} onChange={e => setAmount1(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent text-xl font-mono text-text-primary placeholder-text-muted focus:outline-none disabled:cursor-not-allowed" />
                <span className="text-sm font-bold text-text-secondary">{selectedPool.token1}</span>
              </div>
            </div>
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              Spread evenly (uniform "spot" shape) across the bins in your chosen range. Amounts don't need to match a fixed ratio; unused tokens are refunded.
            </div>
          </div>

          <div className="card p-4 space-y-2.5">
            <div className="text-xs font-mono text-text-muted uppercase tracking-wider">Estimated Returns</div>
            {side !== 'both' ? (
              <div className="text-xs text-text-muted">Range doesn't include the current price — no fee estimate until it does.</div>
            ) : depositUsd > 0 ? (
              <>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Your Est. APR <span className="text-2xs text-text-muted">(while in range)</span></span>
                  <span className="font-mono text-sm font-bold text-emerald-400">{fmtApr(dlmmApr)}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-bg-border">
                  <span className="text-sm text-text-muted">Est. Yearly Earnings</span>
                  <span className="font-mono text-sm text-aeon-400">{fmtUsd(yourYearlyFeesUsd)}</span>
                </div>
              </>
            ) : (
              <div className="text-xs text-text-muted">Enter an amount to estimate your yearly earnings.</div>
            )}
            <div className="text-2xs text-text-muted leading-relaxed pt-1">
              {sisterVamm
                ? `Estimated from the paired vAMM ${selectedPool.name} pool's trailing volume at this pool's ${selectedPool.fee} base fee, scaled by your deposit's share of pool TVL. Doesn't model the extra boost from concentrating into fewer bins — actual APR for a tight range will be higher than this. This DLMM pool is brand new — the real rate will depend on actual trading activity here once it builds up.`
                : `This pool has no vAMM equivalent to estimate volume from yet, so no APR estimate is shown until this DLMM pool builds up its own trading history.`}
            </div>
          </div>

          {!hasLiquidity && (
            <div className="p-3 rounded-xl bg-aeon-400/10 border border-aeon-400/20 text-xs text-aeon-400">
              New pool — no existing liquidity. Enter both token amounts manually.
            </div>
          )}

          {isProcessing && (
            <div className="card p-4">
              <div className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Transaction Progress</div>
              <div className="space-y-2">
                {needApprove0 && (
                  <div className="flex items-center gap-3">
                    {['approve1', 'approve1_wait', 'addliq', 'addliq_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token0}</span>
                  </div>
                )}
                {needApprove1 && (
                  <div className="flex items-center gap-3">
                    {['addliq', 'addliq_wait'].includes(step) ? <CheckCircle2 size={16} className="text-emerald-400 shrink-0" /> : (step === 'approve1' || step === 'approve1_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                    <span className="text-sm text-text-secondary">Approve {selectedPool.token1}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  {(step === 'addliq' || step === 'addliq_wait') ? <Loader2 size={16} className="text-aeon-400 animate-spin shrink-0" /> : <div className="w-4 h-4 rounded-full border border-bg-border shrink-0" />}
                  <span className="text-sm text-text-muted">Add Liquidity</span>
                </div>
              </div>
            </div>
          )}

          {errMsg && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400 font-mono break-all">{errMsg}</div>
          )}

          <button
            onClick={startAdd}
            disabled={isConnected && (isProcessing || (amount0Wei === 0n && amount1Wei === 0n))}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            {(isProcessing || (isPending && step !== 'idle') || txWaiting) && <Loader2 size={16} className="animate-spin" />}
            {stepLabel()}
          </button>
        </div>
      ) : tab === 'swap' ? (
        <DlmmSwapPanel pool={selectedPool} wallet={address} />
      ) : (
        <div className="space-y-3">
          {!isConnected ? (
            <div className="card p-8 text-center text-sm text-text-muted">Connect your wallet to view positions</div>
          ) : positions.length === 0 ? (
            <div className="card p-8 text-center text-sm text-text-muted">No open {selectedPool.name} DLMM positions found in this wallet.</div>
          ) : (
            positions.map(pos => <DlmmPositionCard key={pos.id} pool={selectedPool} pos={pos} owner={address!} onDone={refetchPositions} />)
          )}
        </div>
      )}
    </>
  )
}
