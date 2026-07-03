'use client'
import { useState } from 'react'
import { Wallet, Check } from 'lucide-react'
import { useAccount, useWatchAsset } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { TOKENS, NATIVE_SENTINEL } from '@/config/contracts'

// Known off-chain logo URLs for tokens whose icon isn't served from this site
// (wallet_watchAsset's `image` param needs a publicly reachable URL).
const KNOWN_LOGOS: Record<string, string> = {
  WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
}

// EIP-747 wallet_watchAsset — prompts the connected wallet (Rabby, MetaMask,
// etc.) to import this token directly, no manual contract-address copy/paste.
// ERC20-only by spec, so native ETH has nothing to watch and renders nothing.
export function AddToWalletButton({ tokenKey, className }: { tokenKey: keyof typeof TOKENS; className?: string }) {
  const token = TOKENS[tokenKey]
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { watchAsset, isPending } = useWatchAsset()
  const [added, setAdded] = useState(false)

  if (token.address === NATIVE_SENTINEL) return null

  function handleClick() {
    if (!isConnected) { openConnectModal?.(); return }
    const image = tokenKey === 'AEON'
      ? `${window.location.origin}/logo.svg`
      : KNOWN_LOGOS[tokenKey]
    watchAsset(
      { type: 'ERC20', options: { address: token.address, symbol: token.symbol, decimals: token.decimals, image } },
      { onSuccess: () => setAdded(true) },
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title={`Add ${token.symbol} to your wallet`}
      className={className ?? 'flex items-center gap-1 text-2xs font-mono text-text-muted hover:text-aeon-400 transition-colors disabled:opacity-50'}
    >
      {added ? <Check size={11} className="text-emerald-400" /> : <Wallet size={11} />}
      {added ? 'Added' : isPending ? 'Adding…' : 'Add to Wallet'}
    </button>
  )
}
