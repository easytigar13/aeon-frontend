'use client'
import { useState } from 'react'

// Maps our token symbols to their TrustWallet asset-repo logo path (Avalanche C-Chain).
// Tokens without a known public logo fall back to a generated letter avatar.
const TRUSTWALLET_LOGOS: Record<string, string> = {
  WAVAX: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/info/logo.png',
  USDC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E/logo.png',
  WUSDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7/logo.png',
  WBTCE: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0x50b7545627a5162F82A992c33b87aDc75187B218/logo.png',
  WBTCB: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0x152b9d0fdc40c096757f570a51e494bd4b943e50/logo.png',
  WETHE: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanchec/assets/0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB/logo.png',
}

// Distinct AEON-palette colors per symbol for the generated letter-avatar fallback
const AVATAR_COLORS: Record<string, string> = {
  AEON:  '#FFB800', // aeon-400 gold
  AVAX:  '#E84142', // avalanche red
  WAVAX: '#E84142',
  USDC:  '#2775CA',
  WUSDT: '#26A17B',
  WBTCE: '#F7931A',
  WBTCB: '#F7931A',
  WETHE: '#627EEA',
  SPX:   '#8B5CF6', // violet-500
  GUNZ:  '#10B981', // emerald-500
  ARENA: '#FFCB45', // aeon-300
  COQ:   '#E6A500', // aeon-500
}

export function TokenIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  const logoUrl = TRUSTWALLET_LOGOS[symbol]
  const color = AVATAR_COLORS[symbol] ?? '#FFB800'
  const letter = symbol.startsWith('WBTC') ? '₿' : symbol.replace(/^W/, '')[0]

  if (logoUrl && !imgFailed) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => setImgFailed(true)}
        className="rounded-full bg-bg-raised border border-bg-border object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className="rounded-full flex items-center justify-center font-display font-bold shrink-0 border border-bg-border"
      style={{
        width: size, height: size,
        fontSize: size * 0.42,
        color: '#0A0A0F',
        background: `linear-gradient(135deg, ${color}, ${color}CC)`,
      }}
    >
      {letter}
    </div>
  )
}

// Small Avalanche network badge — every AEON DEX token lives on Avalanche C-Chain
export function ChainBadge({ size = 14 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center border-2 border-bg-base shrink-0"
      style={{ width: size, height: size, background: '#E84142' }}
      title="Avalanche C-Chain"
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="#fff">
        <path d="M16.5 12.8 13.4 7.1a1.5 1.5 0 0 0-2.7 0L4.7 18.5a1.5 1.5 0 0 0 1.3 2.2h4.9a1.5 1.5 0 0 0 1.4-.9l1-2.2 1.7 3.1h4.4l-3-7.9Zm-6.4 4.4H7.5l4.6-9 2.3 4.5-2.7 4.5h-1.6Z"/>
      </svg>
    </div>
  )
}
