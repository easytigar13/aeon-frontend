#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const A = {
  pool: '0x2c07F05D5111da590D8749A091974285FcacDf0D',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  buyback: '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4',
}
const chain = {
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const voterAbi = parseAbi([
  'function gauges(address) view returns(address)',
  'function isPool(address) view returns(bool)',
  'function isGauge(address) view returns(bool)',
  'function isAlive(address) view returns(bool)',
  'function poolForGauge(address) view returns(address)',
])
const poolAbi = parseAbi([
  'function observationCount() view returns(uint16)',
  'function observations(uint256) view returns(uint32,uint256,uint256)',
  'function getTwap(address,uint32) view returns(uint256)',
])
const oracleAbi = parseAbi([
  'function chainlinkFeed(address) view returns(address)',
  'function twapPool(address) view returns(address)',
  'function getTokenPrice(address) view returns(uint256)',
])
const buybackAbi = parseAbi(['function poolForToken(address) view returns(address)'])
const client = createPublicClient({ chain, transport: http(RPC) })
const zero = '0x0000000000000000000000000000000000000000'

const [block, isPool, gauge, observationCount, oracleFeed, oraclePool, oraclePrice, buybackPool] = await Promise.all([
  client.getBlock(),
  client.readContract({ address: A.voter, abi: voterAbi, functionName: 'isPool', args: [A.pool] }),
  client.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [A.pool] }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'observationCount' }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'chainlinkFeed', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'twapPool', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.frong] }),
  client.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'poolForToken', args: [A.frong] }),
])
let gaugeState = { isGauge: false, isAlive: false, poolForGauge: zero }
if (gauge.toLowerCase() !== zero) {
  const [isGauge, isAlive, poolForGauge] = await Promise.all([
    client.readContract({ address: A.voter, abi: voterAbi, functionName: 'isGauge', args: [gauge] }),
    client.readContract({ address: A.voter, abi: voterAbi, functionName: 'isAlive', args: [gauge] }),
    client.readContract({ address: A.voter, abi: voterAbi, functionName: 'poolForGauge', args: [gauge] }),
  ])
  gaugeState = { isGauge, isAlive, poolForGauge }
}
let oldestObservation = 0
if (Number(observationCount) > 0) {
  const observations = await Promise.all(Array.from({ length: Number(observationCount) }, (_, index) =>
    client.readContract({ address: A.pool, abi: poolAbi, functionName: 'observations', args: [BigInt(index)] })
  ))
  oldestObservation = Math.min(...observations.map(value => Number(value[0])).filter(Boolean))
}
let twap = 0n
try {
  twap = await client.readContract({ address: A.pool, abi: poolAbi, functionName: 'getTwap', args: [A.frong, 1800] })
} catch {}

console.log(JSON.stringify({
  block: block.number.toString(),
  blockTimestamp: Number(block.timestamp),
  isPool,
  gauge,
  ...gaugeState,
  observationCount: Number(observationCount),
  oldestObservation,
  twapWethPerFrong: formatUnits(twap, 18),
  oracleFeed,
  oraclePool,
  oraclePriceUsd: formatUnits(oraclePrice, 18),
  buybackPool,
}, null, 2))
