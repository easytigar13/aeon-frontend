#!/usr/bin/env node

import fs from 'node:fs'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createPublicClient, createWalletClient, encodeDeployData, formatUnits, http, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const chain = { id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const A = {
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  pool: '0x2c07F05D5111da590D8749A091974285FcacDf0D',
  admin: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
}
const oracleAbi = parseAbi([
  'function admin() view returns(address)',
  'function chainlinkFeed(address) view returns(address)',
  'function twapPool(address) view returns(address)',
  'function getTokenPrice(address) view returns(uint256)',
  'function setChainlinkFeed(address,address)',
  'function setTwapPool(address,address)',
])
const poolAbi = parseAbi(['function getTwap(address,uint32) view returns(uint256)'])
const feedAbi = parseAbi(['function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)'])
const client = createPublicClient({ chain, transport: http(RPC) })

function privateKey() {
  if (!process.env.DEPLOYER_PK) process.loadEnvFile('epoch-keeper/.env')
  const raw = process.env.DEPLOYER_PK
  if (!raw) throw new Error('DEPLOYER_PK missing')
  const value = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('DEPLOYER_PK invalid')
  return value
}

console.log('AEON FRONG ORACLE USD REPAIR')
console.log('Fixes FRONG being valued in WETH units while labeled as USD.')
console.log('Deploys a narrowly scoped TWAP x WETH/USD adapter, points FRONG to it,')
console.log('and clears the unsafe direct FRONG/WETH fallback. No liquidity or user funds move.\n')
const rl = readline.createInterface({ input, output })
const answer = (await rl.question('Type YES to authorize this one oracle repair: ')).trim().toUpperCase()
rl.close()
if (answer !== 'YES') throw new Error('Authorization cancelled')

const account = privateKeyToAccount(privateKey())
if (account.address.toLowerCase() !== A.admin.toLowerCase()) throw new Error('Configured signer is not admin')
if (await client.getChainId() !== chain.id) throw new Error('Wrong chain')
const admin = await client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'admin' })
if (admin.toLowerCase() !== account.address.toLowerCase()) throw new Error('Configured signer is not oracle admin')

const artifact = JSON.parse(fs.readFileSync(new URL('../../../aeon-protocol-v5/out/TwapQuoteUsdFeed.sol/TwapQuoteUsdFeed.json', import.meta.url), 'utf8'))
const wallet = createWalletClient({ account, chain, transport: http(RPC) })
const deployData = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [A.frong, A.weth, A.pool, A.oracle, 1800],
})
const deployGas = await client.estimateGas({ account, data: deployData })
const deployHash = await wallet.sendTransaction({ account, data: deployData, gas: deployGas })
console.log(`adapter deployment submitted: ${deployHash}`)
const deployReceipt = await client.waitForTransactionReceipt({ hash: deployHash, confirmations: 1 })
if (deployReceipt.status !== 'success' || !deployReceipt.contractAddress) throw new Error(`Adapter deployment failed: ${deployHash}`)
const adapter = deployReceipt.contractAddress
console.log(`adapter confirmed at ${adapter} in block ${deployReceipt.blockNumber}`)

const [round, frongInWeth, wethUsd] = await Promise.all([
  client.readContract({ address: adapter, abi: feedAbi, functionName: 'latestRoundData' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'getTwap', args: [A.frong, 1800] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.weth] }),
])
const expectedUsd = (frongInWeth * wethUsd) / 10n ** 18n
const adapterUsd18 = BigInt(round[1]) * 10n ** 10n
const diff = expectedUsd > adapterUsd18 ? expectedUsd - adapterUsd18 : adapterUsd18 - expectedUsd
if (BigInt(round[1]) <= 0n || (diff * 10_000n) / expectedUsd > 1n) throw new Error('Adapter price failed pre-activation validation')

const feedSimulation = await client.simulateContract({ account, address: A.oracle, abi: oracleAbi, functionName: 'setChainlinkFeed', args: [A.frong, adapter] })
const feedHash = await wallet.writeContract(feedSimulation.request)
console.log(`set FRONG USD feed submitted: ${feedHash}`)
const feedReceipt = await client.waitForTransactionReceipt({ hash: feedHash, confirmations: 1 })
if (feedReceipt.status !== 'success') throw new Error(`setChainlinkFeed reverted: ${feedHash}`)

const clearSimulation = await client.simulateContract({ account, address: A.oracle, abi: oracleAbi, functionName: 'setTwapPool', args: [A.frong, zeroAddress] })
const clearHash = await wallet.writeContract(clearSimulation.request)
console.log(`clear unsafe FRONG fallback submitted: ${clearHash}`)
const clearReceipt = await client.waitForTransactionReceipt({ hash: clearHash, confirmations: 1 })
if (clearReceipt.status !== 'success') throw new Error(`setTwapPool reverted: ${clearHash}`)

const [liveFeed, livePool, liveUsd] = await Promise.all([
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'chainlinkFeed', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'twapPool', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.frong] }),
])
if (liveFeed.toLowerCase() !== adapter.toLowerCase() || livePool !== zeroAddress) throw new Error('Oracle wiring verification failed')
const liveDiff = expectedUsd > liveUsd ? expectedUsd - liveUsd : liveUsd - expectedUsd
if (liveUsd === 0n || (liveDiff * 10_000n) / expectedUsd > 1n) throw new Error('Live FRONG USD price verification failed')

const result = {
  completedAt: new Date().toISOString(),
  adapter,
  frongUsd: formatUnits(liveUsd, 18),
  wethUsd: formatUnits(wethUsd, 18),
  frongInWeth: formatUnits(frongInWeth, 18),
  receipts: [
    { action: 'deploy adapter', hash: deployHash, blockNumber: deployReceipt.blockNumber.toString() },
    { action: 'set FRONG feed', hash: feedHash, blockNumber: feedReceipt.blockNumber.toString() },
    { action: 'clear unsafe fallback', hash: clearHash, blockNumber: clearReceipt.blockNumber.toString() },
  ],
}
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
fs.writeFileSync(new URL('../data/frong-oracle-feed-repair.json', import.meta.url), JSON.stringify(result, null, 2))
console.log('\nSUCCESS: FRONG now reports a correctly converted USD price.')
console.log(JSON.stringify(result, null, 2))
