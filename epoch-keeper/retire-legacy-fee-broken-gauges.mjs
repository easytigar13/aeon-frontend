#!/usr/bin/env node

import fs from 'node:fs'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const CHAIN_ID = 4663
const VOTER = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const ADMIN = '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc'
const gauges = [
  '0x9f1B49f62eDBc13888e3A5A4fa8a4770abAF8cd5', '0xB223BAeCf7a062243CAd6DD528dAA50731715733',
  '0xcEAE6EfD7a61035f7DDE822771E191eFFefaA8e9', '0x31FE14B441C508aE371df5175ca29D8111aBd70D',
  '0x272503c41d899FEAb7b18f7c0CED14767B3b56e0', '0xc491303915D79eA7f5070c9C09abB44f4DC6747c',
  '0x50446754B5932C3C9734128CeE05405283981996', '0xCcfc25B3Cdb21AAe75A0BddC014f9D26C7D566E8',
  '0x7cddd1f0287bba4647F66DA3da29332bbd7958Cd', '0xb0Be89A7260569B2aa998B439C851685F63CdE0e',
  '0xb991a3bc37f3f216afd7A19765F67144e7656aE1', '0xB7D66729bb110Ba629021Ebd25628F87f4CFbf9d',
  '0x8f932bcf0E7728cA2C7Daecf3F77929976C8567f',
]
const chain = { id: CHAIN_ID, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const abi = parseAbi([
  'function emergencyCouncil() view returns(address)',
  'function isAlive(address) view returns(bool)',
  'function poolForGauge(address) view returns(address)',
  'function claimable(address) view returns(uint256)',
  'function killGauge(address)',
])
const client = createPublicClient({ chain, transport: http(RPC) })

function key() {
  if (!process.env.DEPLOYER_PK) process.loadEnvFile('epoch-keeper/.env')
  const raw = process.env.DEPLOYER_PK
  if (!raw) throw new Error('DEPLOYER_PK missing')
  const value = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('DEPLOYER_PK invalid')
  return value
}

console.log('AEON LEGACY GAUGE RETIREMENT')
console.log('Marks 13 pre-fee-accounting gauges inactive in AeonVoterV3.')
console.log('This prevents new votes/emissions and makes the keeper skip them.')
console.log('It does NOT transfer, burn, or lock any LP; users can still withdraw and claim existing gauge rewards.\n')
const rl = readline.createInterface({ input, output })
const answer = (await rl.question('Type YES to retire the 13 fee-broken gauges: ')).trim().toUpperCase()
rl.close()
if (answer !== 'YES') throw new Error('Authorization cancelled')

const account = privateKeyToAccount(key())
if (account.address.toLowerCase() !== ADMIN.toLowerCase()) throw new Error('Configured signer is not admin')
if (await client.getChainId() !== CHAIN_ID) throw new Error('Wrong chain')
const council = await client.readContract({ address: VOTER, abi, functionName: 'emergencyCouncil' })
if (council.toLowerCase() !== account.address.toLowerCase()) throw new Error('Configured signer is not emergency council')
const wallet = createWalletClient({ account, chain, transport: http(RPC) })
const results = []

for (const gauge of gauges) {
  const [alive, pool, claimable] = await Promise.all([
    client.readContract({ address: VOTER, abi, functionName: 'isAlive', args: [gauge] }),
    client.readContract({ address: VOTER, abi, functionName: 'poolForGauge', args: [gauge] }),
    client.readContract({ address: VOTER, abi, functionName: 'claimable', args: [gauge] }),
  ])
  if (!alive) {
    results.push({ gauge, pool, status: 'already inactive', returnedClaimableAeon: '0' })
    continue
  }
  const simulation = await client.simulateContract({ account, address: VOTER, abi, functionName: 'killGauge', args: [gauge] })
  const hash = await wallet.writeContract(simulation.request)
  console.log(`killGauge ${gauge} submitted: ${hash}`)
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`killGauge reverted: ${hash}`)
  const nowAlive = await client.readContract({ address: VOTER, abi, functionName: 'isAlive', args: [gauge] })
  if (nowAlive) throw new Error(`Gauge remained alive: ${gauge}`)
  console.log(`confirmed block ${receipt.blockNumber}`)
  results.push({ gauge, pool, status: 'inactive', returnedClaimableAeon: formatUnits(claimable, 18), hash, blockNumber: receipt.blockNumber.toString() })
}

const result = { completedAt: new Date().toISOString(), voter: VOTER, results }
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
fs.writeFileSync(new URL('../data/legacy-gauge-retirement.json', import.meta.url), JSON.stringify(result, null, 2))
console.log('\nSUCCESS: all 13 fee-broken gauges are inactive.')
console.log(JSON.stringify(result, null, 2))
