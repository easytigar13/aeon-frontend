'use client'
import { useState } from 'react'

const TRUSTWALLET_LOGOS: Record<string, string> = {
  ETH:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
}

const AVATAR_COLORS: Record<string, string> = {
  AEON:    '#FFB800',
  ETH:     '#627EEA',
  WETH:    '#627EEA',
  USDG:    '#00C805',
  VIRTUAL: '#8B5CF6',
}

// Optional imageUrl from an external source (e.g. GeckoTerminal) takes priority
export function TokenIcon({
  symbol,
  size = 32,
  imageUrl,
}: {
  symbol: string
  size?: number
  imageUrl?: string | null
}) {
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)

  const primaryUrl = imageUrl && !primaryFailed ? imageUrl : null
  const twUrl = TRUSTWALLET_LOGOS[symbol] && !fallbackFailed ? TRUSTWALLET_LOGOS[symbol] : null
  const aeonUrl = symbol === 'AEON' && !fallbackFailed ? '/logo.svg' : null
  const activeUrl = primaryUrl ?? twUrl ?? aeonUrl

  const color = AVATAR_COLORS[symbol] ?? '#FFB800'
  const letter = symbol.replace(/^W/, '')[0]

  if (activeUrl) {
    return (
      <img
        src={activeUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => {
          if (primaryUrl) setPrimaryFailed(true)
          else setFallbackFailed(true)
        }}
        className="rounded-full bg-bg-raised border border-bg-border object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <div
      className="rounded-full flex items-center justify-center font-display font-bold shrink-0 border border-bg-border"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color: '#0A0A0F',
        background: `linear-gradient(135deg, ${color}, ${color}CC)`,
      }}
    >
      {letter}
    </div>
  )
}

export function ChainBadge({ size = 14 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center border-2 border-bg-base shrink-0"
      style={{ width: size, height: size, background: '#00C805' }}
      title="Robinhood Chain"
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="8" cy="16" r="4" />
        <circle cx="16" cy="8" r="4" />
      </svg>
    </div>
  )
}
