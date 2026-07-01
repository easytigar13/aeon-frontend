'use client'
import { useState, useEffect } from 'react'
import { ArrowRight, ExternalLink, Flame, Loader2, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useBalance, usePublicClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { formatUnits, parseUnits } from 'viem'
import Link from 'next/link'
import { CONTRACTS, TOKENS, POOLS, LEGACY_V1, LEGACY_GAUGES } from '@/config/contracts'
import { ERC20_ABI, AEON_SWAP_ABI, FURNACE_ABI, ALGEBRA_PM_ENUMERABLE_ABI, GAUGE_ABI } from '@/config/abis'

function poolLabel(poolAddr: string): string {
  const known = POOLS.find(p => p.address.toLowerCase() === poolAddr.toLowerCase())
  if (known) return `${known.name} (${known.type})`
  return `Unlisted pool ${poolAddr.slice(0, 6)}…${poolAddr.slice(-4)}`
}

const AEON_V1 = TOKENS.AEON.address
const AEON_V2 = CONTRACTS.AeonTokenV2
const SWAP    = CONTRACTS.AeonSwap
const PM      = CONTRACTS.AlgebraPositionManager

type Step = 'idle' | 'approve' | 'approve_wait' | 'migrate' | 'migrate_wait' | 'done'

export default function MigratePage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { address, isConnected: _isConnected } = useAccount()
  const isConnected = mounted && _isConnected
  const { openConnectModal } = useConnectModal()

  const [amount, setAmount] = useState('')
  const [step, setStep] = useState<Step>('idle')
  const { writeContract, data: hash, error: writeErr } = useWriteContract()
  const { isSuccess: txDone } = useWaitForTransactionReceipt({ hash })

  // ── AEON v1 -> v2 swap state ──────────────────────────────────────────────
  const { data: v1Bal, refetch: refetchV1 } = useReadContract({
    address: AEON_V1, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const { data: v2Bal, refetch: refetchV2 } = useReadContract({
    address: AEON_V2, abi: ERC20_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const { data: allowance, refetch: refetchAllow } = useReadContract({
    address: AEON_V1, abi: ERC20_ABI, functionName: 'allowance',
    args: address ? [address, SWAP] : undefined, query: { enabled: !!address },
  })
  const { data: swapCapacity } = useReadContract({
    address: SWAP, abi: AEON_SWAP_ABI, functionName: 'remainingCapacity',
  })

  const v1BalFmt = v1Bal ? parseFloat(formatUnits(v1Bal as bigint, 18)) : 0
  const v2BalFmt = v2Bal ? parseFloat(formatUnits(v2Bal as bigint, 18)) : 0
  const capacityFmt = swapCapacity ? parseFloat(formatUnits(swapCapacity as bigint, 18)) : 0
  const amountWei = (() => { try { return amount ? parseUnits(amount, 18) : 0n } catch { return 0n } })()
  const needApprove = amountWei > 0n && ((allowance as bigint | undefined) ?? 0n) < amountWei

  useEffect(() => {
    if (!txDone) return
    if (step === 'approve_wait') { refetchAllow(); setStep('migrate') }
    if (step === 'migrate_wait') { refetchV1(); refetchV2(); setStep('done') }
  }, [txDone]) // eslint-disable-line react-hooks/exhaustive-deps

  function doApprove() {
    setStep('approve')
    writeContract({ address: AEON_V1, abi: ERC20_ABI, functionName: 'approve', args: [SWAP, amountWei] })
    setStep('approve_wait')
  }
  function doMigrate() {
    setStep('migrate')
    writeContract({ address: SWAP, abi: AEON_SWAP_ABI, functionName: 'migrate', args: [amountWei] })
    setStep('migrate_wait')
  }

  // ── Legacy Furnace burn (v1) — visibility only, not recoverable ────────────
  const { data: legacyTokenId } = useReadContract({
    address: LEGACY_V1.TheFurnace, abi: FURNACE_ABI, functionName: 'addressToTokenId',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const hasLegacyBurn = !!legacyTokenId && (legacyTokenId as bigint) > 0n
  const { data: legacyBurned } = useReadContract({
    address: LEGACY_V1.TheFurnace, abi: FURNACE_ABI, functionName: 'burnedByToken',
    args: hasLegacyBurn ? [legacyTokenId as bigint] : undefined, query: { enabled: hasLegacyBurn },
  })
  const legacyBurnedFmt = legacyBurned ? parseFloat(formatUnits(legacyBurned as bigint, 18)) : 0

  // ── Legacy staked LP (real gauges from the old GaugeFactory, orphaned from ─
  //    the current Voter but still fully functional — deposit()/withdraw()
  //    both still work, LP tokens are genuinely sitting in these contracts) ──
  //    Fetched manually (not via useReadContracts) so a flaky RPC response on
  //    a 44-entry multicall surfaces as a visible error instead of silently
  //    rendering as "nothing staked" — that was the actual bug here.
  const publicClient = usePublicClient()
  const [legacyStakedAll, setLegacyStakedAll] = useState<{ gauge: `0x${string}`; pool: `0x${string}`; staked: bigint; earned: bigint }[] | null>(null)
  const [legacyFetchError, setLegacyFetchError] = useState<string | null>(null)
  const [legacyFetchNonce, setLegacyFetchNonce] = useState(0)

  useEffect(() => {
    if (!address || !publicClient) return
    let cancelled = false
    setLegacyFetchError(null)
    setLegacyStakedAll(null)

    async function fetchChunked() {
      const CHUNK = 8
      const results: { gauge: `0x${string}`; pool: `0x${string}`; staked: bigint; earned: bigint }[] = []
      try {
        for (let i = 0; i < LEGACY_GAUGES.length; i += CHUNK) {
          const chunk = LEGACY_GAUGES.slice(i, i + CHUNK)
          const [stakedRes, earnedRes] = await Promise.all([
            publicClient!.multicall({
              contracts: chunk.map(g => ({ address: g.gauge, abi: GAUGE_ABI, functionName: 'balanceOf' as const, args: [address!] })),
              allowFailure: true,
            }),
            publicClient!.multicall({
              contracts: chunk.map(g => ({ address: g.gauge, abi: GAUGE_ABI, functionName: 'earned' as const, args: [address!] })),
              allowFailure: true,
            }),
          ])
          chunk.forEach((g, j) => {
            const staked = (stakedRes[j]?.status === 'success' ? stakedRes[j].result as bigint : 0n)
            const earned = (earnedRes[j]?.status === 'success' ? earnedRes[j].result as bigint : 0n)
            results.push({ ...g, staked, earned })
          })
        }
        if (!cancelled) setLegacyStakedAll(results)
      } catch (e: any) {
        if (!cancelled) setLegacyFetchError(e?.shortMessage || e?.message || 'Failed to load legacy positions')
      }
    }
    fetchChunked()
    return () => { cancelled = true }
  }, [address, publicClient, legacyFetchNonce])

  const legacyStaked = (legacyStakedAll ?? []).filter(g => g.staked > 0n || g.earned > 0n)
  const refetchLegacyStaked = () => setLegacyFetchNonce(n => n + 1)

  const [unstakeStep, setUnstakeStep] = useState<Record<string, 'idle' | 'pending' | 'done'>>({})
  const { writeContract: writeUnstake, data: unstakeHash } = useWriteContract()
  const { isSuccess: unstakeDone } = useWaitForTransactionReceipt({ hash: unstakeHash })
  const [pendingGauge, setPendingGauge] = useState<string | null>(null)

  useEffect(() => {
    if (unstakeDone && pendingGauge) {
      setUnstakeStep(s => ({ ...s, [pendingGauge]: 'done' }))
      setPendingGauge(null)
      refetchLegacyStaked()
    }
  }, [unstakeDone]) // eslint-disable-line react-hooks/exhaustive-deps

  function withdrawAndClaim(gauge: `0x${string}`, amount: bigint) {
    setUnstakeStep(s => ({ ...s, [gauge]: 'pending' }))
    setPendingGauge(gauge)
    writeUnstake({ address: gauge, abi: GAUGE_ABI, functionName: 'withdraw', args: [amount] })
  }
  function claimOnly(gauge: `0x${string}`) {
    setUnstakeStep(s => ({ ...s, [gauge]: 'pending' }))
    setPendingGauge(gauge)
    writeUnstake({ address: gauge, abi: GAUGE_ABI, functionName: 'getReward', args: [address!] })
  }

  // ── Existing pool positions ──────────────────────────────────────────────
  const vammPools = POOLS.filter(p => p.type === 'vAMM')
  const clPools    = POOLS.filter(p => p.type === 'CL')
  const dlmmPools  = POOLS.filter(p => p.type === 'DLMM')

  const { data: vammBalances } = useReadContracts({
    contracts: vammPools.map(p => ({ address: p.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: address ? [address] : undefined })),
    query: { enabled: !!address },
  })

  const { data: clNftCount } = useReadContract({
    address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'balanceOf',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })
  const clCount = clNftCount ? Number(clNftCount as bigint) : 0
  const { data: clTokenIds } = useReadContracts({
    contracts: Array.from({ length: clCount }, (_, i) => ({
      address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'tokenOfOwnerByIndex' as const,
      args: address ? [address, BigInt(i)] : undefined,
    })),
    query: { enabled: !!address && clCount > 0 },
  })
  const ids = (clTokenIds ?? []).map(r => r.result as bigint | undefined).filter(Boolean) as bigint[]
  const { data: clPositions } = useReadContracts({
    contracts: ids.map(id => ({ address: PM, abi: ALGEBRA_PM_ENUMERABLE_ABI, functionName: 'positions' as const, args: [id] })),
    query: { enabled: ids.length > 0 },
  })

  const vammHeld = vammPools.map((p, i) => ({ pool: p, bal: (vammBalances?.[i]?.result as bigint | undefined) ?? 0n })).filter(x => x.bal > 0n)
  const clHeld = (clPositions ?? [])
    .map((r, i) => ({ id: ids[i], data: r.result as readonly [bigint, `0x${string}`, `0x${string}`, `0x${string}`, number, number, bigint, bigint, bigint, bigint, bigint] | undefined }))
    .filter(x => x.data && x.data[6] > 0n) // liquidity > 0

  const anyPositions = vammHeld.length > 0 || clHeld.length > 0

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Migrate</h1>
        <p className="text-sm text-text-muted mt-1">
          Move AEON v1 → v2, and see every existing pool position tied to this wallet.
        </p>
      </div>

      {/* ── AEON v1 -> v2 swap ────────────────────────────────────────────── */}
      <div className="bg-bg-card border border-bg-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">AEON v1 → v2 (1:1)</h2>
          <span className="text-2xs text-text-muted font-mono">{capacityFmt.toFixed(2)} v2 remaining in reserve</span>
        </div>
        <p className="text-xs text-text-muted">
          v1&apos;s mint permission was permanently dead-ended — see <Link href="/docs" className="text-aeon-400 hover:underline">docs</Link> for why.
          v2 AEON is the token governance/emissions now run on. v1 stays valid inside existing pools;
          migrating here just swaps your personal balance, it does not touch any pool.
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-bg-raised rounded-xl p-3">
            <div className="text-2xs text-text-muted mb-1">Your AEON v1</div>
            <div className="font-mono text-text-primary">{v1BalFmt.toFixed(4)}</div>
          </div>
          <div className="bg-bg-raised rounded-xl p-3">
            <div className="text-2xs text-text-muted mb-1">Your AEON v2</div>
            <div className="font-mono text-aeon-400">{v2BalFmt.toFixed(4)}</div>
          </div>
        </div>

        <div className="bg-bg-raised rounded-xl p-3">
          <div className="flex justify-between mb-1">
            <span className="text-2xs text-text-muted">Amount to migrate</span>
            <button className="text-2xs text-text-muted hover:text-aeon-400" onClick={() => setAmount(v1BalFmt.toString())}>Max</button>
          </div>
          <input
            type="number" value={amount} onChange={e => { setAmount(e.target.value); setStep('idle') }}
            placeholder="0.0" className="w-full bg-transparent text-lg font-mono text-text-primary placeholder-text-muted focus:outline-none"
          />
        </div>

        {!isConnected ? (
          <button onClick={openConnectModal} className="w-full py-3 rounded-xl font-semibold bg-aeon-400 text-bg-base hover:bg-aeon-300 transition-all">
            Connect Wallet
          </button>
        ) : step === 'done' ? (
          <div className="flex items-center justify-center gap-2 py-3 text-emerald-400 text-sm font-medium">
            <CheckCircle2 size={16} /> Migrated
          </div>
        ) : (
          <button
            disabled={amountWei === 0n || amountWei > (v1Bal as bigint ?? 0n) || step === 'approve_wait' || step === 'migrate_wait'}
            onClick={needApprove ? doApprove : doMigrate}
            className="w-full py-3 rounded-xl font-semibold bg-aeon-400 text-bg-base hover:bg-aeon-300 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {(step === 'approve_wait' || step === 'migrate_wait') && <Loader2 size={16} className="animate-spin" />}
            {needApprove ? 'Approve AEON v1' : 'Migrate'}
          </button>
        )}
        {writeErr && <div className="text-2xs text-red-400">{writeErr.message.slice(0, 140)}</div>}
      </div>

      {/* ── Legacy burn visibility ───────────────────────────────────────── */}
      {hasLegacyBurn && legacyBurnedFmt > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Flame size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-text-primary">Legacy Furnace burn found</h2>
          </div>
          <p className="text-xs text-text-muted">
            This wallet permanently burned <span className="font-mono text-orange-400">{legacyBurnedFmt.toFixed(4)} AEON v1</span> in
            the old Furnace. Those tokens are gone forever — burning was always irreversible by design, unrelated to
            today&apos;s deploy. But that burn&apos;s voting power isn&apos;t recognized by the new Voter, since it runs
            on a fresh Furnace. To restore equivalent voting power, burn the same amount of v2 AEON (after migrating above)
            on the <Link href="/lock" className="text-aeon-400 hover:underline">Lock page</Link>.
          </p>
        </div>
      )}

      {/* ── Legacy staked LP (real, orphaned gauges) ────────────────────── */}
      {isConnected && legacyFetchError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5 space-y-2">
          <h2 className="text-sm font-semibold text-red-400">Couldn&apos;t check legacy staked LP</h2>
          <p className="text-xs text-text-muted font-mono">{legacyFetchError}</p>
          <button onClick={refetchLegacyStaked} className="text-xs text-aeon-400 hover:underline">Retry</button>
        </div>
      )}
      {isConnected && !legacyFetchError && legacyStakedAll === null && (
        <div className="bg-bg-card border border-bg-border rounded-2xl p-5 text-xs text-text-muted flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Checking legacy gauges for staked LP…
        </div>
      )}
      {isConnected && legacyStaked.length > 0 && (
        <div className="bg-bg-card border border-bg-border rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text-primary">Legacy staked LP found</h2>
          <p className="text-xs text-text-muted">
            These are real gauge contracts from before the v2 deploy — never registered on any current Voter,
            so they don&apos;t show up on the Earn page, but the LP tokens you staked into them are genuinely
            still sitting there. Unstake below to get them back into your wallet.
          </p>
          <div className="space-y-2">
            {legacyStaked.map(g => {
              const state = unstakeStep[g.gauge] ?? 'idle'
              return (
                <div key={g.gauge} className="bg-bg-raised rounded-lg p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-text-primary">{poolLabel(g.pool)}</div>
                    <span className="text-2xs text-text-muted font-mono">{g.gauge.slice(0, 6)}…{g.gauge.slice(-4)}</span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-2xs text-text-muted">
                    <span>Staked: <span className="text-text-primary">{parseFloat(formatUnits(g.staked, 18)).toFixed(6)} LP</span></span>
                    {g.earned > 0n && <span>Unclaimed: <span className="text-aeon-400">{parseFloat(formatUnits(g.earned, 18)).toFixed(6)} AEON v1</span></span>}
                  </div>
                  {state === 'done' ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-2xs font-medium"><CheckCircle2 size={12} /> Done</div>
                  ) : (
                    <div className="flex gap-2">
                      {g.staked > 0n && (
                        <button
                          disabled={state === 'pending'}
                          onClick={() => withdrawAndClaim(g.gauge, g.staked)}
                          className="flex-1 py-1.5 rounded-lg bg-aeon-400 text-bg-base font-semibold hover:bg-aeon-300 transition-all disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          {state === 'pending' && <Loader2 size={12} className="animate-spin" />}
                          Unstake all
                        </button>
                      )}
                      {g.earned > 0n && (
                        <button
                          disabled={state === 'pending'}
                          onClick={() => claimOnly(g.gauge)}
                          className="flex-1 py-1.5 rounded-lg border border-bg-border text-text-secondary font-semibold hover:border-aeon-400/40 transition-all disabled:opacity-40"
                        >
                          Claim rewards only
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Existing pool positions ─────────────────────────────────────── */}
      <div className="bg-bg-card border border-bg-border rounded-2xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">Your existing pool positions</h2>
        <p className="text-xs text-text-muted">
          Nothing about your pool liquidity changed today — this just lists what this wallet currently holds
          across every pool type so you can remove it from the <Link href="/liquidity" className="text-aeon-400 hover:underline">Liquidity page</Link> if you want to.
        </p>

        {!isConnected ? (
          <div className="text-xs text-text-muted">Connect a wallet to check.</div>
        ) : !anyPositions ? (
          <div className="text-xs text-text-muted">No vAMM LP tokens or CL positions found for this wallet.</div>
        ) : (
          <div className="space-y-2">
            {vammHeld.map(({ pool, bal }) => (
              <div key={pool.address} className="flex items-center justify-between bg-bg-raised rounded-lg p-3 text-xs">
                <div>
                  <div className="font-medium text-text-primary">{pool.name} <span className="text-2xs text-text-muted">vAMM · {pool.fee}</span></div>
                  <div className="font-mono text-text-muted mt-0.5">{parseFloat(formatUnits(bal, 18)).toFixed(6)} LP</div>
                </div>
                <Link href="/liquidity" className="flex items-center gap-1 text-aeon-400 hover:underline">Remove <ArrowRight size={12} /></Link>
              </div>
            ))}
            {clHeld.map(({ id, data }) => data && (
              <div key={id.toString()} className="flex items-center justify-between bg-bg-raised rounded-lg p-3 text-xs">
                <div>
                  <div className="font-medium text-text-primary">CL Position #{id.toString()}</div>
                  <div className="font-mono text-text-muted mt-0.5">liquidity: {data[6].toString()}</div>
                </div>
                <Link href="/liquidity" className="flex items-center gap-1 text-aeon-400 hover:underline">Remove <ArrowRight size={12} /></Link>
              </div>
            ))}
          </div>
        )}

        {dlmmPools.length > 0 && (
          <div className="pt-2 border-t border-bg-border text-2xs text-text-muted flex items-center gap-1">
            DLMM (Trader Joe LB) positions aren&apos;t bin-enumerable from here — check per-pool on the
            <Link href="/liquidity" className="text-aeon-400 hover:underline inline-flex items-center gap-0.5">Liquidity page <ExternalLink size={10} /></Link>
            if you added liquidity to a DLMM pool.
          </div>
        )}
      </div>
    </div>
  )
}
