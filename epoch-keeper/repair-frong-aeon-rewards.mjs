#!/usr/bin/env node

import fs from 'node:fs'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const CHAIN_ID = 4663
const ZERO = '0x0000000000000000000000000000000000000000'
const FEE_BPS = 100
const SEED_FRONG = 350n * 10n ** 18n
const MAX_SEED_AEON = 6n * 10n ** 18n
const MIN_NATIVE_GAS = 10n ** 16n
const A = {
  admin: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  aeon: '0xd4c93eD1843606f92CccA078941f3d52A585982f',
  oldPool: '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be',
  factoryV2: '0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC',
  helperV2: '0xF5eDf6C1932e2E558ee560041c7B647a41673e78',
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  distributor: '0x40524d597e9e241b5B7C76D1b2e570A77933D412',
  buyback: '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4',
}
const chain = {
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const factoryAbi = parseAbi([
  'function getPoolFor(address,address,uint24) view returns(address)',
  'function createPool(address,address,uint24) returns(address)',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function factory() view returns(address)',
  'function poolFees() view returns(address)',
  'function feeBps() view returns(uint24)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function balanceOf(address) view returns(uint256)',
])
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
  'function approve(address,uint256) returns(bool)',
])
const helperAbi = parseAbi([
  'function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,address,uint256) returns(uint256,uint256,uint256)',
])
const voterAbi = parseAbi([
  'function governor() view returns(address)',
  'function registerPool(address)',
  'function createGauge(address) returns(address)',
  'function gauges(address) view returns(address)',
  'function isPool(address) view returns(bool)',
  'function isGauge(address) view returns(bool)',
  'function isAlive(address) view returns(bool)',
  'function poolForGauge(address) view returns(address)',
])
const gaugeAbi = parseAbi([
  'function deposit(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function totalSupply() view returns(uint256)',
  'function pool() view returns(address)',
  'function feeDistributor() view returns(address)',
  'function collectFees()',
])
const buybackAbi = parseAbi([
  'function governor() view returns(address)',
  'function poolForToken(address) view returns(address)',
  'function setPoolForToken(address,address)',
])

const publicClient = createPublicClient({ chain, transport: http(RPC) })
const same = (a, b) => a.toLowerCase() === b.toLowerCase()
const resultPath = new URL('../data/frong-aeon-v2-repair.json', import.meta.url)

function loadKey() {
  if (!process.env.DEPLOYER_PK) process.loadEnvFile('epoch-keeper/.env')
  const value = process.env.DEPLOYER_PK
  if (!value) throw new Error('DEPLOYER_PK is missing')
  const key = value.startsWith('0x') ? value : `0x${value}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEPLOYER_PK has an invalid format')
  return key
}

async function send(wallet, account, address, abi, functionName, args, label) {
  const simulation = await publicClient.simulateContract({ account, address, abi, functionName, args })
  const hash = await wallet.writeContract(simulation.request)
  console.log(`${label} submitted: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${hash}`)
  console.log(`${label} confirmed in block ${receipt.blockNumber}`)
  return { hash, blockNumber: receipt.blockNumber.toString() }
}

async function approveExact(wallet, account, token, spender, amount, label, receipts) {
  const allowance = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, spender] })
  if (allowance !== 0n && allowance !== amount) receipts.push(await send(wallet, account, token, erc20Abi, 'approve', [spender, 0n], `${label} reset`))
  const current = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account.address, spender] })
  if (current !== amount) receipts.push(await send(wallet, account, token, erc20Abi, 'approve', [spender, amount], label))
}

async function main() {
  console.log('AEON FRONG/AEON VOTER-REWARD REPAIR')
  console.log('Creates a fee-enabled FactoryV2 pool and V3 gauge at the existing live FRONG/AEON price.')
  console.log('Uses at most 350 FRONG and 6 AEON from the configured admin wallet, stakes the new LP,')
  console.log('and repoints the FRONG buyback route. The old user-owned pool and LP are not withdrawn or destroyed.')
  console.log('Every write is simulated first and every receipt is verified.\n')
  const rl = readline.createInterface({ input, output })
  const answer = (await rl.question('Type YES to authorize this one repair: ')).trim().toUpperCase()
  rl.close()
  if (answer !== 'YES') throw new Error('Authorization cancelled')

  const account = privateKeyToAccount(loadKey())
  if (!same(account.address, A.admin)) throw new Error(`Configured signer ${account.address} is not admin ${A.admin}`)
  if (await publicClient.getChainId() !== CHAIN_ID) throw new Error('RPC is on the wrong chain')
  const wallet = createWalletClient({ account, chain, transport: http(RPC) })
  const receipts = []

  const [voterGovernor, buybackGovernor, gasBalance] = await Promise.all([
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'governor' }),
    publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'governor' }),
    publicClient.getBalance({ address: account.address }),
  ])
  if (!same(voterGovernor, account.address) || !same(buybackGovernor, account.address)) throw new Error('Configured admin does not control Voter and Buyback')
  if (gasBalance < MIN_NATIVE_GAS) throw new Error(`Gas reserve too low: ${formatUnits(gasBalance, 18)} ETH`)

  let pool = await publicClient.readContract({ address: A.factoryV2, abi: factoryAbi, functionName: 'getPoolFor', args: [A.frong, A.aeon, FEE_BPS] })
  if (same(pool, ZERO)) {
    receipts.push(await send(wallet, account, A.factoryV2, factoryAbi, 'createPool', [A.frong, A.aeon, FEE_BPS], 'create fee-enabled FRONG/AEON pool'))
    pool = await publicClient.readContract({ address: A.factoryV2, abi: factoryAbi, functionName: 'getPoolFor', args: [A.frong, A.aeon, FEE_BPS] })
  }
  if (same(pool, ZERO)) throw new Error('FactoryV2 did not register the new pool')

  const [token0, token1, factory, poolFees, feeBps, oldToken0, oldReserves] = await Promise.all([
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'token0' }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'token1' }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'factory' }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'poolFees' }),
    publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'feeBps' }),
    publicClient.readContract({ address: A.oldPool, abi: poolAbi, functionName: 'token0' }),
    publicClient.readContract({ address: A.oldPool, abi: poolAbi, functionName: 'getReserves' }),
  ])
  if (!same(factory, A.factoryV2) || same(poolFees, ZERO) || Number(feeBps) !== FEE_BPS) throw new Error('New pool failed fee-accounting provenance checks')
  if (![token0, token1].some(t => same(t, A.frong)) || ![token0, token1].some(t => same(t, A.aeon))) throw new Error('New pool token pair is incorrect')

  let reserves = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getReserves' })
  if (reserves[0] === 0n && reserves[1] === 0n) {
    const oldFrong = same(oldToken0, A.frong) ? oldReserves[0] : oldReserves[1]
    const oldAeon = same(oldToken0, A.aeon) ? oldReserves[0] : oldReserves[1]
    if (oldFrong === 0n || oldAeon === 0n) throw new Error('Old reference pool has empty reserves')
    const seedAeon = (SEED_FRONG * oldAeon) / oldFrong
    if (seedAeon === 0n || seedAeon > MAX_SEED_AEON) throw new Error(`Derived AEON seed is unsafe: ${formatUnits(seedAeon, 18)}`)
    const [frongBalance, aeonBalance] = await Promise.all([
      publicClient.readContract({ address: A.frong, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
      publicClient.readContract({ address: A.aeon, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    ])
    if (frongBalance < SEED_FRONG || aeonBalance < seedAeon) throw new Error('Admin token balance is below the bounded seed requirement')
    const amount0 = same(token0, A.frong) ? SEED_FRONG : seedAeon
    const amount1 = same(token1, A.aeon) ? seedAeon : SEED_FRONG
    await approveExact(wallet, account, token0, A.helperV2, amount0, 'approve exact token0 seed', receipts)
    await approveExact(wallet, account, token1, A.helperV2, amount1, 'approve exact token1 seed', receipts)
    const deadline = (await publicClient.getBlock()).timestamp + 600n
    receipts.push(await send(wallet, account, A.helperV2, helperAbi, 'addLiquidity', [pool, token0, amount0, amount1, amount0, amount1, token1, account.address, deadline], 'seed fee-enabled FRONG/AEON pool'))
    reserves = await publicClient.readContract({ address: pool, abi: poolAbi, functionName: 'getReserves' })
  }
  if (reserves[0] === 0n || reserves[1] === 0n) throw new Error('New pool remains empty')

  let isPool = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isPool', args: [pool] })
  if (!isPool) {
    receipts.push(await send(wallet, account, A.voter, voterAbi, 'registerPool', [pool], 'register V2 FRONG/AEON pool'))
    isPool = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isPool', args: [pool] })
  }
  let gauge = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [pool] })
  if (same(gauge, ZERO)) {
    receipts.push(await send(wallet, account, A.voter, voterAbi, 'createGauge', [pool], 'create V2 FRONG/AEON gauge'))
    gauge = await publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [pool] })
  }
  if (!isPool || same(gauge, ZERO)) throw new Error('Voter did not wire the new pool and gauge')
  const [isGauge, isAlive, gaugePool, gaugeDistributor] = await Promise.all([
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isGauge', args: [gauge] }),
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'isAlive', args: [gauge] }),
    publicClient.readContract({ address: A.voter, abi: voterAbi, functionName: 'poolForGauge', args: [gauge] }),
    publicClient.readContract({ address: gauge, abi: gaugeAbi, functionName: 'feeDistributor' }),
  ])
  if (!isGauge || !isAlive || !same(gaugePool, pool) || !same(gaugeDistributor, A.distributor)) throw new Error('New gauge postcondition failed')

  const unstakedLp = await publicClient.readContract({ address: pool, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  if (unstakedLp > 0n) {
    await approveExact(wallet, account, pool, gauge, unstakedLp, 'approve exact new LP stake', receipts)
    receipts.push(await send(wallet, account, gauge, gaugeAbi, 'deposit', [unstakedLp], 'stake new FRONG/AEON LP'))
  }
  const stakedLp = await publicClient.readContract({ address: gauge, abi: gaugeAbi, functionName: 'balanceOf', args: [account.address] })
  if (stakedLp === 0n) throw new Error('New gauge has no staked admin LP')
  await publicClient.simulateContract({ account, address: gauge, abi: gaugeAbi, functionName: 'collectFees' })

  let buybackPool = await publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'poolForToken', args: [A.frong] })
  if (!same(buybackPool, pool)) {
    receipts.push(await send(wallet, account, A.buyback, buybackAbi, 'setPoolForToken', [A.frong, pool], 'repoint FRONG buyback to fee-enabled pool'))
    buybackPool = await publicClient.readContract({ address: A.buyback, abi: buybackAbi, functionName: 'poolForToken', args: [A.frong] })
  }
  if (!same(buybackPool, pool)) throw new Error('Buyback route postcondition failed')

  const result = {
    completedAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    oldPool: A.oldPool,
    pool,
    poolFees,
    gauge,
    stakedLp: formatUnits(stakedLp, 18),
    reserve0: formatUnits(reserves[0], 18),
    reserve1: formatUnits(reserves[1], 18),
    buybackPool,
    collectFeesSimulation: 'PASS',
    receipts,
  }
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2))
  console.log('\nSUCCESS: FRONG/AEON future voter-fee collection is live.')
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(`\nABORTED: ${error.shortMessage ?? error.message}`)
  process.exitCode = 1
})
