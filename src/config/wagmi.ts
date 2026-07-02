'use client'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { robinhoodChain } from './chain'

export { robinhoodChain }

export const wagmiConfig = getDefaultConfig({
  appName: 'AEON Protocol',
  projectId: 'aeon-protocol-dex',
  chains: [robinhoodChain],
  ssr: true,
})
