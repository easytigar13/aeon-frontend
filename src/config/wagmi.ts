'use client'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { http } from 'viem'
import { robinhoodChain } from './chain'

export { robinhoodChain }

// In the browser, route on-chain reads through the same-origin /api/rpc proxy:
// the public RPC sends no CORS headers, so a direct fetch from the site origin
// is blocked by the browser (which blanked the whole dashboard). Server-side
// (SSR) there is no CORS, so hit the node directly. `batch` collapses the
// dashboard's many reads into few JSON-RPC requests.
const RPC_TARGET =
  typeof window !== 'undefined' ? '/api/rpc' : 'https://rpc.mainnet.chain.robinhood.com'

export const wagmiConfig = getDefaultConfig({
  appName: 'AEON Protocol',
  projectId: 'aeon-protocol-dex',
  chains: [robinhoodChain],
  ssr: true,
  transports: {
    [robinhoodChain.id]: http(RPC_TARGET, { batch: true }),
  },
})
