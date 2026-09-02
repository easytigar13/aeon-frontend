#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbiItem } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const GAUGE = '0x8f932bcf0E7728cA2C7Daecf3F77929976C8567f'
const client = createPublicClient({ transport: http(RPC) })
const depositEvent = parseAbiItem('event Deposit(address indexed lp, uint256 amount)')
const withdrawEvent = parseAbiItem('event Withdraw(address indexed lp, uint256 amount)')
const latest = await client.getBlockNumber()
const from = latest > 5_000_000n ? latest - 5_000_000n : 0n
const chunk = 50_000n
const events = []

for (let start = from; start <= latest; start += chunk) {
  const end = start + chunk - 1n > latest ? latest : start + chunk - 1n
  for (const [kind, event] of [['Deposit', depositEvent], ['Withdraw', withdrawEvent]]) {
    const logs = await client.getLogs({ address: GAUGE, event, fromBlock: start, toBlock: end })
    for (const log of logs) {
      events.push({
        kind,
        blockNumber: log.blockNumber.toString(),
        transactionHash: log.transactionHash,
        lp: log.args.lp,
        amount: formatUnits(log.args.amount, 18),
      })
    }
  }
}

events.sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)))
console.log(JSON.stringify({ gauge: GAUGE, fromBlock: from.toString(), latestBlock: latest.toString(), events }, null, 2))
