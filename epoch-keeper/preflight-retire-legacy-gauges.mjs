#!/usr/bin/env node

import { createPublicClient, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const VOTER = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const ADMIN = '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc'
const gauges = [
  '0x9f1B49f62eDBc13888e3A5A4fa8a4770abAF8cd5',
  '0xB223BAeCf7a062243CAd6DD528dAA50731715733',
  '0xcEAE6EfD7a61035f7DDE822771E191eFFefaA8e9',
  '0x31FE14B441C508aE371df5175ca29D8111aBd70D',
  '0x272503c41d899FEAb7b18f7c0CED14767B3b56e0',
  '0xc491303915D79eA7f5070c9C09abB44f4DC6747c',
  '0x50446754B5932C3C9734128CeE05405283981996',
  '0xCcfc25B3Cdb21AAe75A0BddC014f9D26C7D566E8',
  '0x7cddd1f0287bba4647F66DA3da29332bbd7958Cd',
  '0xb0Be89A7260569B2aa998B439C851685F63CdE0e',
  '0xb991a3bc37f3f216afd7A19765F67144e7656aE1',
  '0xB7D66729bb110Ba629021Ebd25628F87f4CFbf9d',
  '0x8f932bcf0E7728cA2C7Daecf3F77929976C8567f',
]
const abi = parseAbi([
  'function emergencyCouncil() view returns(address)',
  'function isAlive(address) view returns(bool)',
  'function poolForGauge(address) view returns(address)',
  'function killGauge(address)',
])
const client = createPublicClient({ transport: http(RPC) })
const council = await client.readContract({ address: VOTER, abi, functionName: 'emergencyCouncil' })
if (council.toLowerCase() !== ADMIN.toLowerCase()) throw new Error(`Emergency council is ${council}, not configured admin`)
const rows = []
for (const gauge of gauges) {
  const [alive, pool] = await Promise.all([
    client.readContract({ address: VOTER, abi, functionName: 'isAlive', args: [gauge] }),
    client.readContract({ address: VOTER, abi, functionName: 'poolForGauge', args: [gauge] }),
  ])
  if (alive) await client.simulateContract({ account: ADMIN, address: VOTER, abi, functionName: 'killGauge', args: [gauge] })
  rows.push({ gauge, pool, alive, killSimulation: alive ? 'PASS' : 'ALREADY_DEAD' })
}
console.log(JSON.stringify({ emergencyCouncil: council, gauges: rows }, null, 2))
