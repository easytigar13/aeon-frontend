#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbiItem } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const gauge = '0x8f932bcf0E7728cA2C7Daecf3F77929976C8567f'
const client = createPublicClient({ transport: http(RPC) })
const latest = await client.getBlockNumber()

let low = 0n
let high = latest
while (low < high) {
  const mid = (low + high) / 2n
  const code = await client.getCode({ address: gauge, blockNumber: mid })
  if (code && code !== '0x') high = mid
  else low = mid + 1n
}
const deployedAt = low
const event = parseAbiItem('event Deposit(address indexed lp,uint256 amount)')
let logs = []
try {
  logs = await client.getLogs({ address: gauge, event, fromBlock: deployedAt, toBlock: latest })
} catch {
  const chunk = 100_000n
  for (let from = deployedAt; from <= latest; from += chunk) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n
    const part = await client.getLogs({ address: gauge, event, fromBlock: from, toBlock: to })
    logs.push(...part)
  }
}
console.log(JSON.stringify({
  deployedAt: deployedAt.toString(),
  latest: latest.toString(),
  deposits: logs.map(log => ({
    lp: log.args.lp,
    amount: formatUnits(log.args.amount, 18),
    blockNumber: log.blockNumber.toString(),
    transactionHash: log.transactionHash,
  })),
}, null, 2))
