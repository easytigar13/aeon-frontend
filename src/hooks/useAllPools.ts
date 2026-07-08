'use client'
import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { CONTRACTS, POOLS, TOKENS } from '@/config/contracts'
import { AEON_FACTORY_ABI, PAIR_ABI, ERC20_ABI } from '@/config/abis'

// AeonFactoryRH.createPool() is permissionless -- anyone can deploy a vAMM
// pool for any pair/fee tier directly from the Create Pool page. Before this
// hook, the only pools that ever showed up anywhere on the site (Liquidity
// list, Swap routing) were the ones hardcoded into POOLS in contracts.ts --
// a pool created by any other user just sat on-chain, tradeable only by
// someone who already knew its address. This reads the factory's own
// allPools() registry directly, so any real pool a user creates shows up
// for everyone automatically, with no manual config edit required.

export interface DiscoveredPool {
  type: 'vAMM'
  name: string
  token0: string          // symbol if known, else a shortened address as a display fallback
  token1: string
  token0Address: `0x${string}`  // always the real address -- token0/token1 above may not be a valid TOKENS key
  token1Address: `0x${string}`
  address: `0x${string}`
  fee: string              // e.g. "1%" -- same string shape POOLS already uses
  feeBps: number
}

const ADDR_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(TOKENS).map(([symbol, t]) => [t.address.toLowerCase(), symbol]),
)

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

function feeLabel(feeBps: number): string {
  const pct = feeBps / 100
  return `${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%`
}

function pairFeeKey(a: string, b: string, feeBps: number): string {
  const [x, y] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]
  return `${x.toLowerCase()}-${y.toLowerCase()}-${feeBps}`
}

// AeonFactoryRH.allPools() still lists the ORIGINAL genesis pools for AEON/ETH,
// AEON/USDG, and ETH/USDG (created via factory.createPool() at launch) --
// the 2026-07-03 fee-fix migration replaced them with fresh pools deployed
// directly (bypassing the factory, so the new ones were never registered,
// and the old drained ones were never de-registered either). Both the old
// dead pool and the new real one exist on-chain at the SAME pair+fee; only
// the address in POOLS is the one anyone should use. Dedup by (pair, fee)
// against POOLS, not just by exact address, or these dead pools resurface
// as apparent "duplicates" alongside the real ones.
const STATIC_PAIR_FEE_KEYS = new Set(
  POOLS
    .map(p => {
      const a0 = TOKENS[p.token0 as keyof typeof TOKENS]?.address
      const a1 = TOKENS[p.token1 as keyof typeof TOKENS]?.address
      if (!a0 || !a1) return null
      return pairFeeKey(a0, a1, Math.round(parseFloat(p.fee) * 100))
    })
    .filter((k): k is string => !!k),
)

/// Every real vAMM pool from AeonFactoryRH.allPools() that ISN'T already one
/// of the hardcoded POOLS entries. Merge with POOLS yourself at the call site
/// (`[...POOLS, ...discovered]`) -- kept separate here so existing static
/// pool ordering/identity isn't disturbed for anything already relying on it.
export function useAllPools(): { discovered: DiscoveredPool[]; isLoading: boolean } {
  const { data: len } = useReadContract({
    address: CONTRACTS.AeonFactory,
    abi: AEON_FACTORY_ABI,
    functionName: 'allPoolsLength',
  })

  const count = len !== undefined ? Number(len) : 0

  const idxContracts = useMemo(
    () => Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.AeonFactory, abi: AEON_FACTORY_ABI, functionName: 'allPools' as const, args: [BigInt(i)] as const,
    })),
    [count],
  )
  const { data: addrResults } = useReadContracts({ contracts: idxContracts, query: { enabled: count > 0 } })

  const poolAddrs = useMemo(
    () => (addrResults ?? [])
      .map(r => (r.status === 'success' ? (r.result as `0x${string}`) : undefined))
      .filter((a): a is `0x${string}` => !!a),
    [addrResults],
  )

  const staticAddrs = useMemo(() => new Set(POOLS.map(p => p.address.toLowerCase())), [])
  const newAddrs = useMemo(() => poolAddrs.filter(a => !staticAddrs.has(a.toLowerCase())), [poolAddrs, staticAddrs])

  const metaContracts = useMemo(
    () => newAddrs.flatMap(addr => [
      { address: addr, abi: PAIR_ABI, functionName: 'token0' as const },
      { address: addr, abi: PAIR_ABI, functionName: 'token1' as const },
      { address: addr, abi: PAIR_ABI, functionName: 'feeBps' as const },
    ]),
    [newAddrs],
  )
  const { data: metaResults } = useReadContracts({ contracts: metaContracts, query: { enabled: newAddrs.length > 0 } })

  const unknownTokenAddrs = useMemo(() => {
    const set = new Set<string>()
    newAddrs.forEach((_, i) => {
      const t0 = metaResults?.[i * 3]?.result as string | undefined
      const t1 = metaResults?.[i * 3 + 1]?.result as string | undefined
      ;[t0, t1].forEach(t => { if (t && !ADDR_TO_SYMBOL[t.toLowerCase()]) set.add(t.toLowerCase()) })
    })
    return [...set]
  }, [newAddrs, metaResults])

  const symbolContracts = useMemo(
    () => unknownTokenAddrs.map(addr => ({ address: addr as `0x${string}`, abi: ERC20_ABI, functionName: 'symbol' as const })),
    [unknownTokenAddrs],
  )
  const { data: symbolResults } = useReadContracts({ contracts: symbolContracts, query: { enabled: unknownTokenAddrs.length > 0 } })

  const discovered = useMemo(() => {
    const unknownSymbolMap: Record<string, string> = {}
    unknownTokenAddrs.forEach((addr, i) => {
      const r = symbolResults?.[i]
      unknownSymbolMap[addr] = r?.status === 'success' ? (r.result as string) : short(addr)
    })
    const symbolFor = (addr: string) => ADDR_TO_SYMBOL[addr.toLowerCase()] ?? unknownSymbolMap[addr.toLowerCase()] ?? short(addr)

    const out: DiscoveredPool[] = []
    newAddrs.forEach((addr, i) => {
      const t0 = metaResults?.[i * 3]?.result as string | undefined
      const t1 = metaResults?.[i * 3 + 1]?.result as string | undefined
      const feeBpsRaw = metaResults?.[i * 3 + 2]?.result as number | undefined
      if (!t0 || !t1 || feeBpsRaw === undefined) return
      if (STATIC_PAIR_FEE_KEYS.has(pairFeeKey(t0, t1, feeBpsRaw))) return
      const s0 = symbolFor(t0)
      const s1 = symbolFor(t1)
      out.push({
        type: 'vAMM', name: `${s0}/${s1}`, token0: s0, token1: s1,
        token0Address: t0 as `0x${string}`, token1Address: t1 as `0x${string}`,
        address: addr, fee: feeLabel(feeBpsRaw), feeBps: feeBpsRaw,
      })
    })
    return out
  }, [newAddrs, metaResults, unknownTokenAddrs, symbolResults])

  const isLoading = count > 0 && (!addrResults || (newAddrs.length > 0 && !metaResults))

  return { discovered, isLoading }
}
