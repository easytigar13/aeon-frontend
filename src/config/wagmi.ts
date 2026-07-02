'use client'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
})

export const wagmiConfig = getDefaultConfig({
  appName: 'AEON Protocol',
  projectId: 'aeon-protocol-dex',
  chains: [robinhoodChain],
  ssr: true,
})
