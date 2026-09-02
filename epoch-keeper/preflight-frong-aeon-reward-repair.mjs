#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const A = {
  admin: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
  frong: '0x6245e67affA44a23077f0Ea7f981a8DC743a0c47',
  aeon: '0xd4c93eD1843606f92CccA078941f3d52A585982f',
  oldPool: '0x2f8CBA007598cBb15FfABE7a826a9cC8576ed6be',
  factoryV2: '0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC',
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  buyback: '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4',
}
const client = createPublicClient({ transport: http(RPC) })
const factoryAbi = parseAbi([
  'function getPoolFor(address,address,uint24) view returns(address)',
  'function createPool(address,address,uint24) returns(address)',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
])
const erc20Abi = parseAbi(['function balanceOf(address) view returns(uint256)'])
const govAbi = parseAbi(['function governor() view returns(address)'])
const seedFrong = 350n * 10n ** 18n
const [chainId, existing, oldToken0, reserves, frongBalance, aeonBalance, gasBalance, voterGov, buybackGov] = await Promise.all([
  client.getChainId(),
  client.readContract({ address: A.factoryV2, abi: factoryAbi, functionName: 'getPoolFor', args: [A.frong, A.aeon, 100] }),
  client.readContract({ address: A.oldPool, abi: poolAbi, functionName: 'token0' }),
  client.readContract({ address: A.oldPool, abi: poolAbi, functionName: 'getReserves' }),
  client.readContract({ address: A.frong, abi: erc20Abi, functionName: 'balanceOf', args: [A.admin] }),
  client.readContract({ address: A.aeon, abi: erc20Abi, functionName: 'balanceOf', args: [A.admin] }),
  client.getBalance({ address: A.admin }),
  client.readContract({ address: A.voter, abi: govAbi, functionName: 'governor' }),
  client.readContract({ address: A.buyback, abi: govAbi, functionName: 'governor' }),
])
const frongFirst = oldToken0.toLowerCase() === A.frong.toLowerCase()
const oldFrong = frongFirst ? reserves[0] : reserves[1]
const oldAeon = frongFirst ? reserves[1] : reserves[0]
const seedAeon = seedFrong * oldAeon / oldFrong
let createSimulation = 'SKIPPED: pool already exists'
if (/^0x0{40}$/i.test(existing)) {
  await client.simulateContract({ account: A.admin, address: A.factoryV2, abi: factoryAbi, functionName: 'createPool', args: [A.frong, A.aeon, 100] })
  createSimulation = 'PASS'
}
const checks = {
  chain: chainId === 4663,
  voterGovernor: voterGov.toLowerCase() === A.admin.toLowerCase(),
  buybackGovernor: buybackGov.toLowerCase() === A.admin.toLowerCase(),
  frongBalance: frongBalance >= seedFrong,
  aeonBalance: aeonBalance >= seedAeon,
  gasReserve: gasBalance >= 10n ** 16n,
  seedAeonCap: seedAeon > 0n && seedAeon <= 6n * 10n ** 18n,
}
if (Object.values(checks).some(value => !value)) throw new Error(`Preflight failed: ${JSON.stringify(checks)}`)
console.log(JSON.stringify({
  checks,
  existingV2Pool: existing,
  createPoolSimulation: createSimulation,
  oldReserveFrong: formatUnits(oldFrong, 18),
  oldReserveAeon: formatUnits(oldAeon, 18),
  seedFrong: formatUnits(seedFrong, 18),
  seedAeon: formatUnits(seedAeon, 18),
  adminFrong: formatUnits(frongBalance, 18),
  adminAeon: formatUnits(aeonBalance, 18),
  adminGasEth: formatUnits(gasBalance, 18),
}, null, 2))
