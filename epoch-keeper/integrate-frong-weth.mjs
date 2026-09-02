#!/usr/bin/env node

import { createPublicClient, createWalletClient, formatUnits, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const CHAIN_ID = 4663
const APPROVAL = 'FRONG-WETH-INTEGRATION-SINGLE-USE'
const ZERO = '0x0000000000000000000000000000000000000000'
const A = {
  admin: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
  pool: '0x2c07F05D5111da590D8749A091974285FcacDf0D',
  frongAeonPool: '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  aeon: '0xd4c93eD1843606f92CccA078941f3d52A585982f',
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  buyback: '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4',
}

const chain = {
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const voterAbi = parseAbi([
  'function governor() view returns(address)',
  'function registerPool(address pool)',
  'function createGauge(address pool) returns(address gauge)',
  'function gauges(address pool) view returns(address)',
  'function isPool(address pool) view returns(bool)',
  'function isGauge(address gauge) view returns(bool)',
  'function isAlive(address gauge) view returns(bool)',
  'function poolForGauge(address gauge) view returns(address)',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function sync()',
  'function observationCount() view returns(uint16)',
  'function observations(uint256) view returns(uint32 timestamp,uint256 price0Cumulative,uint256 price1Cumulative)',
  'function getTwap(address token,uint32 period) view returns(uint256)',
])
const oracleAbi = parseAbi([
  'function admin() view returns(address)',
  'function wavax() view returns(address)',
  'function chainlinkFeed(address token) view returns(address)',
  'function twapPool(address token) view returns(address)',
  'function getTokenPrice(address token) view returns(uint256)',
])
const buybackAbi = parseAbi([
  'function governor() view returns(address)',
  'function poolForToken(address token) view returns(address)',
  'function setPoolForToken(address token,address pool)',
])

const publicClient = createPublicClient({ chain, transport: http(RPC) })
const DRY_RUN = process.argv.includes('--dry-run')

function same(a, b) { return a.toLowerCase() === b.toLowerCase() }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function privateKey(value) {
  if (!value) throw new Error('DEPLOYER_PK is missing from epoch-keeper/.env')
  const key = value.startsWith('0x') ? value : `0x${value}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEPLOYER_PK format is invalid')
  return key
}

async function send(wallet, account, address, abi, functionName, args, label) {
  const simulation = await publicClient.simulateContract({ account, address, abi, functionName, args })
  const hash = await wallet.writeContract(simulation.request)
  console.log(`${label} submitted: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`)
  console.log(`${label} confirmed in block ${receipt.blockNumber}`)
  return { hash, receipt }
}

async function oldestObservationTimestamp() {
  const count = Number(await publicClient.readContract({ address: A.pool, abi: poolAbi, functionName: 'observationCount' }))
  if (count === 0) return 0
  const observations = await Promise.all(Array.from({ length: count }, (_, i) =>
    publicClient.readContract({ address: A.pool, abi: poolAbi, functionName: 'observations', args: [BigInt(i)] })
  ))
  return Math.min(...observations.map(o => Number(o[0])).filter(Boolean))
}

async function verifyPairs() {
  for (const [pool, expected] of [[A.pool, [A.weth, A.frong]], [A.frongAeonPool, [A.frong, A.aeon]]]) {
    const [token0, token1, reserves] = await Promise.all([
      publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'token0' }),
      publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'token1' }),
      publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getReserves' }),
    ])
    const valid = expected.every(t => same(t, token0) || same(t, token1))
    if (!valid || reserves[0] === 0n || reserves[1] === 0n) throw new Error(`Invalid or empty required pool: ${pool}`)
  }
}

async function main() {
  if (DRY_RUN) {
    await verifyPairs()
    for (const [address, abi, functionName, args] of [
      [A.voter, voterAbi, 'registerPool', [A.pool]],
      [A.voter, voterAbi, 'createGauge', [A.pool]],
      [A.pool, poolAbi, 'sync', []],
      [A.buyback, buybackAbi, 'setPoolForToken', [A.frong, A.frongAeonPool]],
      [A.oracle, oracleAbi, 'setTwapPool', [A.frong, A.pool]],
    ]) {
      await publicClient.simulateContract({ account: A.admin, address, abi, functionName, args })
      console.log(`${functionName} eth_call simulation: PASS`)
    }
    console.log('DRY RUN ONLY: no transactions broadcast.')
    return
  }
  if (process.env.AEON_FRONG_INTEGRATION_APPROVED !== APPROVAL) throw new Error('Missing single-use human authorization')
  if (!process.env.DEPLOYER_PK) process.loadEnvFile('epoch-keeper/.env')
  const account = privateKeyToAccount(privateKey(process.env.DEPLOYER_PK))
  if (!same(account.address, A.admin)) throw new Error(`Configured signer ${account.address} is not admin ${A.admin}`)
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('RPC is on the wrong chain')

  const wallet = createWalletClient({ account, chain, transport: http(RPC) })
  const [voterGov, oracleAdmin, oracleWeth, buybackGov] = await Promise.all([
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'governor' }),
    publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'admin' }),
    publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'wavax' }),
    publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'governor' }),
  ])
  for (const [name, value] of [['voter governor', voterGov], ['oracle admin', oracleAdmin], ['buyback governor', buybackGov]]) {
    if (!same(value, account.address)) throw new Error(`${name} is ${value}, not the configured admin`)
  }
  if (!same(oracleWeth, A.weth)) throw new Error(`Oracle base asset is ${oracleWeth}, expected WETH`)
  await verifyPairs()

  console.log('=== FRONG/WETH protocol integration ===')
  console.log(`Pool:   ${A.pool}`)
  console.log(`Signer: ${account.address}`)

  let isPool = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isPool', args: [A.pool] })
  if (!isPool) {
    await send(wallet, account, A.voter, voterAbi, 'registerPool', [A.pool], 'registerPool')
    isPool = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isPool', args: [A.pool] })
    if (!isPool) throw new Error('Voter did not register the pool')
  }

  let gauge = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [A.pool] })
  if (same(gauge, ZERO)) {
    await send(wallet, account, A.voter, voterAbi, 'createGauge', [A.pool], 'createGauge')
    gauge = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [A.pool] })
  }
  if (same(gauge, ZERO)) throw new Error('Gauge creation did not produce an address')
  const [isGauge, isAlive, gaugePool] = await Promise.all([
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isGauge', args: [gauge] }),
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isAlive', args: [gauge] }),
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'poolForGauge', args: [gauge] }),
  ])
  if (!isGauge || !isAlive || !same(gaugePool, A.pool)) throw new Error('Gauge/voter postcondition failed')
  console.log(`Gauge live: ${gauge}`)

  let buybackPool = await publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'poolForToken', args: [A.frong] })
  if (same(buybackPool, ZERO)) {
    await send(wallet, account, A.buyback, buybackAbi, 'setPoolForToken', [A.frong, A.frongAeonPool], 'set FRONG buyback route')
    buybackPool = await publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'poolForToken', args: [A.frong] })
  }
  if (!same(buybackPool, A.frongAeonPool)) throw new Error(`Unexpected FRONG buyback route: ${buybackPool}`)

  let oldest = await oldestObservationTimestamp()
  if (oldest === 0) {
    await send(wallet, account, A.pool, poolAbi, 'sync', [], 'start TWAP checkpoint')
    oldest = await oldestObservationTimestamp()
  }
  if (oldest === 0) throw new Error('Pool did not create a TWAP observation')

  while (true) {
    const block = await publicClient.getBlock()
    const remaining = oldest + 1800 - Number(block.timestamp)
    if (remaining <= 0) break
    console.log(`TWAP maturation: ${Math.ceil(remaining / 60)} minute(s) remaining; keep this window open.`)
    await sleep(Math.min(60, remaining) * 1000)
  }

  const [twapWethPerFrong, wethUsd, reserves, token0] = await Promise.all([
    publicClient.readContract({ address: A.pool, abi: poolAbi, functionName: 'getTwap', args: [A.frong, 1800] }),
    publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.weth] }),
    publicClient.readContract({ address: A.pool, abi: poolAbi, functionName: 'getReserves' }),
    publicClient.readContract({ address: A.pool, abi: poolAbi, functionName: 'token0' }),
  ])
  if (twapWethPerFrong === 0n || wethUsd === 0n) throw new Error('TWAP or WETH/USD price is zero after maturation')
  const reserveWeth = same(token0, A.weth) ? reserves[0] : reserves[1]
  const reserveFrong = same(token0, A.weth) ? reserves[1] : reserves[0]
  const spotWethPerFrong = (reserveWeth * 10n ** 18n) / reserveFrong
  const larger = twapWethPerFrong > spotWethPerFrong ? twapWethPerFrong : spotWethPerFrong
  const diff = twapWethPerFrong > spotWethPerFrong ? twapWethPerFrong - spotWethPerFrong : spotWethPerFrong - twapWethPerFrong
  if ((diff * 10_000n) / larger > 500n) throw new Error('TWAP differs from current reserve price by more than 5%')
  const expectedUsd = (twapWethPerFrong * wethUsd) / 10n ** 18n
  console.log(`Validated FRONG TWAP price: $${formatUnits(expectedUsd, 18)}`)

  const [oracleFeed, oraclePool] = await Promise.all([
    publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'chainlinkFeed', args: [A.frong] }),
    publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'twapPool', args: [A.frong] }),
  ])
  // AeonOracle's native TWAP fallback assumes the pool's quote token is USDG
  // because its immutable multiplier is the constant $1 feed. FRONG/WETH must
  // therefore be priced by a direct USD adapter; wiring this pool directly
  // reports WETH-per-FRONG while incorrectly labelling it USD.
  if (same(oracleFeed, ZERO)) {
    throw new Error('FRONG direct USD feed is not configured; never wire FRONG/WETH as AeonOracle native TWAP fallback')
  }
  if (!same(oraclePool, ZERO)) throw new Error(`Unsafe FRONG native TWAP fallback remains configured: ${oraclePool}`)
  const oracleUsd = await publicClient.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.frong] })
  if (oracleUsd === 0n) throw new Error('FRONG oracle price remains zero after wiring')
  const oracleDiff = oracleUsd > expectedUsd ? oracleUsd - expectedUsd : expectedUsd - oracleUsd
  if ((oracleDiff * 10_000n) / expectedUsd > 100n) throw new Error('Oracle price differs from validated TWAP by more than 1%')

  console.log('\nSUCCESS')
  console.log(`Pool:          ${A.pool}`)
  console.log(`Gauge:         ${gauge}`)
  console.log(`Oracle FRONG:  $${formatUnits(oracleUsd, 18)}`)
  console.log(`Buyback route: ${buybackPool}`)
}

main().catch(error => {
  console.error(`\nABORTED: ${error.shortMessage ?? error.message}`)
  process.exitCode = 1
})
