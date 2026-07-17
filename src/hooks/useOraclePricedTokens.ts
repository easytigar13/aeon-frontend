'use client'
import { useReadContracts } from 'wagmi'
import { TOKENS, CONTRACTS } from '@/config/contracts'
import { ORACLE_ABI } from '@/config/abis'

// Which token symbols does the on-chain AeonOracle actually price (getTokenPrice
// > 0)? This is the exact set the protocol counts toward lastEpochFeesUSD, and
// therefore toward the emission mint. Querying the oracle live (instead of a
// hardcoded list) keeps the frontend's emission math in lockstep with whatever
// feeds/TWAP pools the governor has registered — no silent drift when a new
// token gets priced (e.g. AEON itself, wired in 2026-07-17).
const TOKEN_ENTRIES = Object.entries(TOKENS) as [string, { address: `0x${string}` }][]

const PRICE_CONTRACTS = TOKEN_ENTRIES.map(([, t]) => ({
  address: CONTRACTS.AeonOracle,
  abi: ORACLE_ABI,
  functionName: 'getTokenPrice',
  args: [t.address],
} as const))

export function useOraclePricedTokens(): Set<string> {
  const { data } = useReadContracts({
    contracts: PRICE_CONTRACTS,
    query: { refetchInterval: 300_000 },
  })
  const priced = new Set<string>()
  TOKEN_ENTRIES.forEach(([symbol], i) => {
    const r = data?.[i]
    if (r?.status === 'success' && (r.result as bigint) > 0n) priced.add(symbol)
  })
  return priced
}
