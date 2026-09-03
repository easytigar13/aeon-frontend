'use client'
import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, Copy, Check, ExternalLink, PlusCircle, AlertTriangle, Sparkles } from 'lucide-react'
import { TOKENS, NATIVE_SENTINEL } from '@/config/contracts'
import { useAccount, usePublicClient } from 'wagmi'
import { isAddress, erc20Abi } from 'viem'
import { clsx } from 'clsx'

export interface TokenItem {
  symbol: string
  name: string
  address: `0x${string}`
  decimals: number
  isCustom?: boolean
}

interface EnhancedTokenSelectModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectToken: (token: TokenItem) => void
  selectedTokenAddress?: string
}

export function EnhancedTokenSelectModal({
  isOpen,
  onClose,
  onSelectToken,
  selectedTokenAddress,
}: EnhancedTokenSelectModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const [customTokens, setCustomTokens] = useState<TokenItem[]>([])
  const [isSearchingContract, setIsSearchingContract] = useState(false)
  const [discoveredToken, setDiscoveredToken] = useState<TokenItem | null>(null)
  const [customTokenError, setCustomTokenError] = useState<string | null>(null)

  const publicClient = usePublicClient()
  const { address: userAddress } = useAccount()

  // Load custom tokens from local storage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('aeon_custom_tokens')
      if (stored) {
        setCustomTokens(JSON.parse(stored))
      }
    } catch {}
  }, [isOpen])

  // Combine default protocol tokens + custom user imported tokens
  const allTokensList = useMemo(() => {
    const list: TokenItem[] = Object.values(TOKENS).map(t => ({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      decimals: t.decimals,
      isCustom: false,
    }))

    // Add unique custom tokens
    customTokens.forEach(ct => {
      if (!list.some(t => t.address.toLowerCase() === ct.address.toLowerCase())) {
        list.push(ct)
      }
    })

    return list
  }, [customTokens])

  // Filter list
  const filteredTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return allTokensList

    return allTokensList.filter(
      t =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase() === q
    )
  }, [allTokensList, searchQuery])

  // If search query is a 0x address not in the list, attempt on-chain resolution
  useEffect(() => {
    const q = searchQuery.trim()
    setDiscoveredToken(null)
    setCustomTokenError(null)

    if (isAddress(q)) {
      const exists = allTokensList.some(t => t.address.toLowerCase() === q.toLowerCase())
      if (!exists && publicClient) {
        setIsSearchingContract(true)
        Promise.all([
          publicClient.readContract({ address: q as `0x${string}`, abi: erc20Abi, functionName: 'name' }).catch(() => 'Unknown Token'),
          publicClient.readContract({ address: q as `0x${string}`, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'UNKNOWN'),
          publicClient.readContract({ address: q as `0x${string}`, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
        ])
          .then(([name, symbol, decimals]) => {
            setDiscoveredToken({
              address: q as `0x${string}`,
              name: String(name),
              symbol: String(symbol),
              decimals: Number(decimals),
              isCustom: true,
            })
          })
          .catch(() => {
            setCustomTokenError('Could not fetch token details from Robinhood Chain.')
          })
          .finally(() => {
            setIsSearchingContract(false)
          })
      }
    }
  }, [searchQuery, allTokensList, publicClient])

  const handleImportToken = (token: TokenItem) => {
    const updated = [...customTokens, token]
    setCustomTokens(updated)
    try {
      localStorage.setItem('aeon_custom_tokens', JSON.stringify(updated))
    } catch {}
    onSelectToken(token)
    onClose()
  }

  const handleCopy = (address: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    setTimeout(() => setCopiedAddress(null), 2000)
  }

  if (!isOpen) return null

  const quickSelectSymbols = ['AEON', 'ETH', 'USDG', 'WETH', 'VIRTUAL']

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative bg-[#0E1424] border border-[#1E2C48] rounded-2xl p-5 w-full max-w-md shadow-2xl text-white z-10 space-y-4 max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1A253C] pb-3 shrink-0">
            <h3 className="font-display font-bold text-base text-white">Select a Token</h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative shrink-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              placeholder="Search by name, symbol, or paste address..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#12192C] border border-[#202E4B] rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400 font-sans"
              autoFocus
            />
          </div>

          {/* Quick Select Tokens */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {quickSelectSymbols.map(sym => {
              const token = allTokensList.find(t => t.symbol === sym)
              if (!token) return null
              return (
                <button
                  key={sym}
                  onClick={() => {
                    onSelectToken(token)
                    onClose()
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#141B2D] border border-[#223150] text-xs font-mono font-medium hover:border-emerald-400/50 hover:bg-[#182238] transition-all flex items-center gap-1.5 text-slate-300"
                >
                  <span className="font-bold text-white">{sym}</span>
                </button>
              )
            })}
          </div>

          {/* Discovered Token from Address */}
          {isSearchingContract && (
            <div className="p-3 rounded-xl bg-[#141C30] border border-sky-500/30 text-xs text-sky-300 flex items-center gap-2 animate-pulse shrink-0">
              <Sparkles className="w-4 h-4 text-sky-400 animate-spin" />
              <span>Scanning Robinhood Chain contract metadata...</span>
            </div>
          )}

          {discoveredToken && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2 shrink-0">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-white text-sm">{discoveredToken.symbol}</span>
                  <span className="text-slate-400 block text-xs">{discoveredToken.name}</span>
                </div>
                <button
                  onClick={() => handleImportToken(discoveredToken)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs flex items-center gap-1 transition-all"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Import Token
                </button>
              </div>
              <div className="text-[11px] text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Custom token found on Robinhood Chain. Trade with care.</span>
              </div>
            </div>
          )}

          {/* Token List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar min-h-[200px]">
            {filteredTokens.length === 0 && !discoveredToken && !isSearchingContract && (
              <div className="text-center py-8 text-slate-500 text-sm">
                No tokens found matching "{searchQuery}"
              </div>
            )}

            {filteredTokens.map(token => {
              const isSelected = selectedTokenAddress?.toLowerCase() === token.address.toLowerCase()
              const isNative = token.address === NATIVE_SENTINEL

              return (
                <div
                  key={token.address}
                  onClick={() => {
                    onSelectToken(token)
                    onClose()
                  }}
                  className={clsx(
                    'w-full p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition-all border',
                    isSelected
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-white'
                      : 'bg-[#101626]/80 border-transparent hover:bg-[#151E33] hover:border-[#223150]'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {/* Token avatar icon */}
                    <div className="w-8 h-8 rounded-full bg-black/60 border border-slate-700 flex items-center justify-center font-mono font-bold text-xs text-emerald-400">
                      {token.symbol.slice(0, 3)}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-sm text-white">{token.symbol}</span>
                        {token.isCustom && (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Custom
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 line-clamp-1">{token.name}</span>
                    </div>
                  </div>

                  {/* Address actions */}
                  {!isNative && (
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={e => handleCopy(token.address, e)}
                        title="Copy Contract Address"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1A2640] transition-colors"
                      >
                        {copiedAddress === token.address ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <a
                        href={`https://explorer.robinhood.com/token/${token.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Robinhood Blockscout"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-[#1A2640] transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
