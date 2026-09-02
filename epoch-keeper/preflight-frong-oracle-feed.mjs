#!/usr/bin/env node

import fs from 'node:fs'
import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const chain = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const A = {
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  pool: '0x2c07F05D5111da590D8749A091974285FcacDf0D',
}
const oracleAbi = parseAbi([
  'function admin() view returns(address)',
  'function wavax() view returns(address)',
  'function chainlinkFeed(address) view returns(address)',
  'function twapPool(address) view returns(address)',
  'function getTokenPrice(address) view returns(uint256)',
])
const poolAbi = parseAbi(['function getTwap(address,uint32) view returns(uint256)'])
const client = createPublicClient({ chain, transport: http(RPC) })
const artifactPath = new URL('../../../aeon-protocol-v5/out/TwapQuoteUsdFeed.sol/TwapQuoteUsdFeed.json', import.meta.url)
if (!fs.existsSync(artifactPath)) throw new Error(`Compiled adapter artifact missing: ${artifactPath.pathname}`)

const [admin, base, currentFeed, currentPool, frongReported, wethUsd, frongInWeth] = await Promise.all([
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'admin' }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'wavax' }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'chainlinkFeed', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'twapPool', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.weth] }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'getTwap', args: [A.frong, 1800] }),
])
if (base.toLowerCase() !== A.weth.toLowerCase()) throw new Error(`Oracle base ${base} is not WETH`)
if (currentPool.toLowerCase() !== A.pool.toLowerCase()) throw new Error(`Unexpected FRONG TWAP pool ${currentPool}`)
const expectedUsd = (frongInWeth * wethUsd) / 10n ** 18n
if (expectedUsd === 0n) throw new Error('Expected FRONG USD price is zero')

console.log(JSON.stringify({
  status: 'PREFLIGHT PASS',
  admin,
  base,
  currentFeed,
  currentPool,
  currentReportedUsd: formatUnits(frongReported, 18),
  frongInWeth: formatUnits(frongInWeth, 18),
  wethUsd: formatUnits(wethUsd, 18),
  correctedFrongUsd: formatUnits(expectedUsd, 18),
  underpricingFactor: Number(expectedUsd) / Number(frongReported),
  repair: 'Deploy TwapQuoteUsdFeed, set it as FRONG direct USD feed, clear unsafe native FRONG TWAP fallback',
}, null, 2))
