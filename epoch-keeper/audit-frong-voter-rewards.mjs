#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const WEEK = 604800n
const A = {
  pool: '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  aeon: '0xd4c93eD1843606f92CccA078941f3d52A585982f',
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  distributor: '0x40524d597e9e241b5B7C76D1b2e570A77933D412',
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  factoryV1: '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6',
  factoryV2: '0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC',
  admin: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
}
const client = createPublicClient({ transport: http(RPC) })
const voterAbi = parseAbi([
  'function gauges(address) view returns(address)',
  'function isGauge(address) view returns(bool)',
  'function isAlive(address) view returns(bool)',
  'function poolTotalWeight(address,uint256) view returns(uint256)',
])
const gaugeAbi = parseAbi([
  'function pool() view returns(address)',
  'function feeDistributor() view returns(address)',
  'function totalSupply() view returns(uint256)',
  'function rewardRate() view returns(uint256)',
  'function periodFinish() view returns(uint256)',
  'function collectFees()',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function factory() view returns(address)',
  'function poolFees() view returns(address)',
  'function totalSupply() view returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function index0() view returns(uint256)',
  'function index1() view returns(uint256)',
  'function supplyIndex0(address) view returns(uint256)',
  'function supplyIndex1(address) view returns(uint256)',
  'function claimable0(address) view returns(uint256)',
  'function claimable1(address) view returns(uint256)',
])
const distributorAbi = parseAbi([
  'function poolTokenEpochFees(address,address,uint256) view returns(uint256)',
  'function lastEpochFeesUSD() view returns(uint256)',
  'function lastSnapshotPeriod() view returns(uint256)',
])
const oracleAbi = parseAbi(['function getTokenPrice(address) view returns(uint256)'])
const erc20Abi = parseAbi(['function balanceOf(address) view returns(uint256)'])
const factoryAbi = parseAbi(['function getPoolFor(address,address,uint24) view returns(address)'])

const block = await client.getBlock()
const currentEpoch = (block.timestamp / WEEK) * WEEK
const gauge = await client.readContract({ address: A.voter, abi: voterAbi, functionName: 'gauges', args: [A.pool] })
const [
  isGauge, isAlive, gaugePool, gaugeDistributor, gaugeStakedLp, rewardRate, periodFinish,
  token0, token1, poolFactory, poolFees, lpSupply, gaugeLpBalance, adminStakedLp,
  index0, index1, supplyIndex0, supplyIndex1, storedClaimable0, storedClaimable1,
  frongPrice, aeonPrice, lastEpochFeesUsd, lastSnapshotPeriod,
] = await Promise.all([
  client.readContract({ address: A.voter, abi: voterAbi, functionName: 'isGauge', args: [gauge] }),
  client.readContract({ address: A.voter, abi: voterAbi, functionName: 'isAlive', args: [gauge] }),
  client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'pool' }),
  client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'feeDistributor' }),
  client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'totalSupply' }),
  client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'rewardRate' }),
  client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'periodFinish' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'token0' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'token1' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'factory' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'poolFees' }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'totalSupply' }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'balanceOf', args: [gauge] }),
  client.readContract({ address: gauge, abi: parseAbi(['function balanceOf(address) view returns(uint256)']), functionName: 'balanceOf', args: [A.admin] }),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'index0' }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'index1' }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'supplyIndex0', args: [gauge] }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'supplyIndex1', args: [gauge] }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'claimable0', args: [gauge] }).catch(() => null),
  client.readContract({ address: A.pool, abi: poolAbi, functionName: 'claimable1', args: [gauge] }).catch(() => null),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.frong] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.aeon] }),
  client.readContract({ address: A.distributor, abi: distributorAbi, functionName: 'lastEpochFeesUSD' }),
  client.readContract({ address: A.distributor, abi: distributorAbi, functionName: 'lastSnapshotPeriod' }),
])
const [poolFeesToken0, poolFeesToken1, distributorFrong, distributorAeon] = await Promise.all([
  poolFees ? client.readContract({ address: token0, abi: erc20Abi, functionName: 'balanceOf', args: [poolFees] }) : 0n,
  poolFees ? client.readContract({ address: token1, abi: erc20Abi, functionName: 'balanceOf', args: [poolFees] }) : 0n,
  client.readContract({ address: A.frong, abi: erc20Abi, functionName: 'balanceOf', args: [A.distributor] }),
  client.readContract({ address: A.aeon, abi: erc20Abi, functionName: 'balanceOf', args: [A.distributor] }),
])
const supportsFeeAccounting = [poolFees, index0, index1, supplyIndex0, supplyIndex1, storedClaimable0, storedClaimable1].every(value => value !== null)
const pending0 = supportsFeeAccounting ? storedClaimable0 + (gaugeLpBalance * (index0 - supplyIndex0)) / 10n ** 18n : 0n
const pending1 = supportsFeeAccounting ? storedClaimable1 + (gaugeLpBalance * (index1 - supplyIndex1)) / 10n ** 18n : 0n
let collectFeesSimulation = 'PASS'
try {
  await client.simulateContract({ address: gauge, abi: gaugeAbi, functionName: 'collectFees' })
} catch (error) {
  collectFeesSimulation = error.shortMessage ?? error.message
}
const [factoryV1Pool, factoryV2Pool] = await Promise.all([
  client.readContract({ address: A.factoryV1, abi: factoryAbi, functionName: 'getPoolFor', args: [A.frong, A.aeon, 100] }).catch(() => null),
  client.readContract({ address: A.factoryV2, abi: factoryAbi, functionName: 'getPoolFor', args: [A.frong, A.aeon, 100] }).catch(() => null),
])

const epochs = []
for (let offset = 0n; offset < 5n; offset++) {
  const epoch = currentEpoch - WEEK * offset
  const [frongFees, aeonFees, totalWeight] = await Promise.all([
    client.readContract({ address: A.distributor, abi: distributorAbi, functionName: 'poolTokenEpochFees', args: [A.pool, A.frong, epoch] }),
    client.readContract({ address: A.distributor, abi: distributorAbi, functionName: 'poolTokenEpochFees', args: [A.pool, A.aeon, epoch] }),
    client.readContract({ address: A.voter, abi: voterAbi, functionName: 'poolTotalWeight', args: [A.pool, epoch] }),
  ])
  epochs.push({
    epoch: epoch.toString(),
    frongFees: formatUnits(frongFees, 18),
    aeonFees: formatUnits(aeonFees, 18),
    voterPoolFrong: formatUnits(frongFees * 8000n / 10000n, 18),
    voterPoolAeon: formatUnits(aeonFees * 8000n / 10000n, 18),
    totalWeight: formatUnits(totalWeight, 18),
  })
}
const stakerCandidates = {}
for (const candidate of [
  A.admin,
  '0x6D93ab5743AD9fad6Ff3c33e3ae60755b8913a08',
  '0x6d93abf1e85698be8d42a45c334a081b15913a08',
  '0x6d93ab63068f9b9f71c4c1144f0bcc4d3dcbb557',
  '0x32a3fc106f77300524dc2dc4d5e672ef08615391',
]) {
  const balance = await client.readContract({ address: gauge, abi: parseAbi(['function balanceOf(address) view returns(uint256)']), functionName: 'balanceOf', args: [candidate] })
  stakerCandidates[candidate] = formatUnits(balance, 18)
}

console.log(JSON.stringify({
  block: block.number.toString(),
  blockTimestamp: Number(block.timestamp),
  currentEpoch: currentEpoch.toString(),
  gauge,
  isGauge,
  isAlive,
  gaugePool,
  gaugeDistributor,
  token0,
  token1,
  poolFactory,
  factoryV1Pool,
  factoryV2Pool,
  poolFees,
  supportsFeeAccounting,
  collectFeesSimulation,
  poolLpSupply: formatUnits(lpSupply, 18),
  gaugeLpBalance: formatUnits(gaugeLpBalance, 18),
  gaugeStakedLp: formatUnits(gaugeStakedLp, 18),
  adminStakedLp: formatUnits(adminStakedLp, 18),
  stakerCandidates,
  gaugeLpSharePct: lpSupply === 0n ? '0' : Number(gaugeLpBalance * 1_000_000n / lpSupply) / 10_000,
  pendingToken0ForGauge: formatUnits(pending0, 18),
  pendingToken1ForGauge: formatUnits(pending1, 18),
  poolFeesToken0Balance: formatUnits(poolFeesToken0, 18),
  poolFeesToken1Balance: formatUnits(poolFeesToken1, 18),
  distributorFrongBalance: formatUnits(distributorFrong, 18),
  distributorAeonBalance: formatUnits(distributorAeon, 18),
  frongPriceUsd: formatUnits(frongPrice, 18),
  aeonPriceUsd: formatUnits(aeonPrice, 18),
  lastEpochFeesUsd: formatUnits(lastEpochFeesUsd, 18),
  lastSnapshotPeriod: lastSnapshotPeriod.toString(),
  rewardRateAeonPerSecond: formatUnits(rewardRate, 18),
  periodFinish: periodFinish.toString(),
  epochs,
}, null, 2))
