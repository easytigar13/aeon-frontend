'use client'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { avalanche } from 'wagmi/chains'

export const wagmiConfig = getDefaultConfig({
  appName: 'AEON Protocol',
  projectId: 'aeon-protocol-dex',
  chains: [avalanche],
  ssr: true,
})
