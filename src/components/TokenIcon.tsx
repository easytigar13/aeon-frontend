'use client'
import { useState } from 'react'

const TRUSTWALLET_LOGOS: Record<string, string> = {
  ETH:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  WETH: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
}

// TradingView's public per-company symbol-logo CDN -- real company logos for
// Robinhood's tokenized stocks (AAPL, TSLA, etc. are real, recognizable
// public companies, unlike the small independently-deployed tokens above,
// so a plain letter avatar undersells them). Every slug below verified to
// return 200 before wiring in (TradingView's URL scheme isn't just
// ticker-based, so a few needed the company's actual slug, not a guess from
// the ticker).
const STOCK_LOGOS: Record<string, string> = {
  AAPL:  'https://s3-symbol-logo.tradingview.com/apple--big.svg',
  AMD:   'https://s3-symbol-logo.tradingview.com/advanced-micro-devices--big.svg',
  AMZN:  'https://s3-symbol-logo.tradingview.com/amazon--big.svg',
  BABA:  'https://s3-symbol-logo.tradingview.com/alibaba--big.svg',
  BE:    'https://s3-symbol-logo.tradingview.com/bloom-energy--big.svg',
  COIN:  'https://s3-symbol-logo.tradingview.com/coinbase--big.svg',
  CRCL:  'https://s3-symbol-logo.tradingview.com/circle--big.svg',
  CRWV:  'https://s3-symbol-logo.tradingview.com/coreweave--big.svg',
  GOOGL: 'https://s3-symbol-logo.tradingview.com/alphabet--big.svg',
  INTC:  'https://s3-symbol-logo.tradingview.com/intel--big.svg',
  META:  'https://s3-symbol-logo.tradingview.com/meta-platforms--big.svg',
  MSFT:  'https://s3-symbol-logo.tradingview.com/microsoft--big.svg',
  MU:    'https://s3-symbol-logo.tradingview.com/micron-technology--big.svg',
  NVDA:  'https://s3-symbol-logo.tradingview.com/nvidia--big.svg',
  ORCL:  'https://s3-symbol-logo.tradingview.com/oracle--big.svg',
  PLTR:  'https://s3-symbol-logo.tradingview.com/palantir--big.svg',
  SNDK:  'https://s3-symbol-logo.tradingview.com/sandisk--big.svg',
  SPCX:  'https://s3-symbol-logo.tradingview.com/spacex--big.svg',
  TSLA:  'https://s3-symbol-logo.tradingview.com/tesla--big.svg',
  USAR:  'https://s3-symbol-logo.tradingview.com/usa-rare-earth--big.svg',
}

// DexScreener-hosted logos for the independently-deployed Robinhood-chain
// tokens (memecoins, protocol tokens) that have no curated stock/trustwallet
// logo and whose GeckoTerminal imageUrl comes back empty. Pulled from the
// DexScreener token API (chainId "robinhood"); these are the same icons shown
// on dexscreener.com. Tokens with no DexScreener image (USDG, SLEEP, SHERWOOD)
// intentionally fall through to the colored letter avatar below.
const DEXSCREENER_LOGOS: Record<string, string> = {
  VIRTUAL:    'https://cdn.dexscreener.com/cms/images/bkl7Ue-EfiCazhHg?width=800&height=800&quality=95&format=auto',
  ROBINFUN:   'https://cdn.dexscreener.com/cms/images/bFyRNIIQPL8g8Snc?width=800&height=800&quality=95&format=auto',
  CASHCAT:    'https://cdn.dexscreener.com/cms/images/Lq7a3pS9Wn8EuGp0?width=800&height=800&quality=95&format=auto',
  INDEX:      'https://cdn.dexscreener.com/cms/images/LTfdhAlnWijozhDa?width=800&height=800&quality=95&format=auto',
  PONS:       'https://cdn.dexscreener.com/cms/images/dkmXs8KYMyMXjuU1?width=800&height=800&quality=95&format=auto',
  AI:         'https://cdn.dexscreener.com/cms/images/U6RIzs8Fm7Jar6GE?width=800&height=800&quality=95&format=auto',
  FRONG:      'https://cdn.dexscreener.com/cms/images/sb8NxFYZy_lfgbXO?width=800&height=800&quality=95&format=auto',
  TENDIES:    'https://cdn.dexscreener.com/cms/images/j8K5uOi-9TVXuWFJ?width=800&height=800&quality=95&format=auto',
  MARIAN:     'https://cdn.dexscreener.com/cms/images/lWKxBmLc4OdlQb2E?width=800&height=800&quality=95&format=auto',
  VEX:        'https://cdn.dexscreener.com/cms/images/dbR0nWyawKyvw7sI?width=800&height=800&quality=95&format=auto',
  JUGGERNAUT: 'https://cdn.dexscreener.com/cms/images/usHPD9u49cr88jb0?width=800&height=800&quality=95&format=auto',
  VAULTS:     'https://cdn.dexscreener.com/cms/images/ElM6guhw17ehP5FZ?width=800&height=800&quality=95&format=auto',
  HOODIE:     'https://cdn.dexscreener.com/cms/images/lPw_YhoFA-ThjIWZ?width=800&height=800&quality=95&format=auto',
  NASDAQ:     'https://cdn.dexscreener.com/cms/images/apY4EJ8dg5snBOY8?width=800&height=800&quality=95&format=auto',
}

const AVATAR_COLORS: Record<string, string> = {
  AEON:     '#FFB800',
  ETH:      '#627EEA',
  WETH:     '#627EEA',
  USDG:     '#00C805',
  VIRTUAL:  '#8B5CF6',
  ROBINFUN: '#EC4899',
  CASHCAT:  '#22D3EE',
  FRONG:    '#10B981',
  LEGS:     '#F43F5E',
  SLEEP:    '#6366F1',
  SHERWOOD: '#10B981',
  // Real (approximate) brand colors -- only ever shown if the TradingView
  // logo above fails to load, but picked to still look intentional rather
  // than falling back to the generic gold used for everything else.
  AAPL:  '#A2AAAD',
  AMD:   '#ED1C24',
  AMZN:  '#FF9900',
  BABA:  '#FF6A00',
  BE:    '#0A8A5F',
  COIN:  '#0052FF',
  CRCL:  '#7B61FF',
  CRWV:  '#4C6EF5',
  GOOGL: '#4285F4',
  INTC:  '#0071C5',
  META:  '#0866FF',
  MSFT:  '#00A4EF',
  MU:    '#7A1FA2',
  NVDA:  '#76B900',
  ORCL:  '#F80000',
  PLTR:  '#4C566A',
  SNDK:  '#E4002B',
  SPCX:  '#005288',
  TSLA:  '#CC0000',
  USAR:  '#B8860B',
}

// Curated logos (STOCK_LOGOS/TRUSTWALLET_LOGOS/the local AEON asset) go
// FIRST, ahead of the dynamic `imageUrl` from GeckoTerminal/CoinGecko --
// GeckoTerminal auto-generates a generic placeholder image for any token it
// discovers without a submitted logo (tell: filename is just the contract
// address, e.g. "0xaf3d76f....png"), and for Robinhood's tokenized stocks
// that generic icon was silently winning over the real company logo already
// sitting in STOCK_LOGOS below. imageUrl only serves as the final fallback,
// for tokens (CASHCAT, ROBINFUN, VIRTUAL, ...) that have no curated entry.
export function TokenIcon({
  symbol,
  size = 32,
  imageUrl,
}: {
  symbol: string
  size?: number
  imageUrl?: string | null
}) {
  const candidates = [STOCK_LOGOS[symbol], TRUSTWALLET_LOGOS[symbol], symbol === 'AEON' ? '/logo.jpg' : null, DEXSCREENER_LOGOS[symbol], imageUrl].filter(
    (u): u is string => !!u
  )
  const [failedCount, setFailedCount] = useState(0)
  const activeUrl = candidates[failedCount] ?? null

  const color = AVATAR_COLORS[symbol] ?? '#FFB800'
  const letter = symbol.replace(/^W/, '')[0]

  if (activeUrl) {
    return (
      <img
        src={activeUrl}
        alt={symbol}
        width={size}
        height={size}
        onError={() => setFailedCount(n => n + 1)}
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
