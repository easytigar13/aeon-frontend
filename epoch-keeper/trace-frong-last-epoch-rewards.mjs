#!/usr/bin/env node

import { createPublicClient, formatUnits, http, parseAbi, parseAbiItem } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const A = {
  gauge: '0x8f932bcf0E7728cA2C7Daecf3F77929976C8567f',
  aeon: '0xd4c93eD1843606f92CccA078941f3d52A585982f',
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  staker: '0x6D93ab5743AD9fad6Ff3c33e3ae60755b8913a08',
}
const client = createPublicClient({ transport: http(RPC) })
const gaugeAbi = parseAbi([
  'function balanceOf(address) view returns(uint256)',
  'function totalSupply() view returns(uint256)',
  'function earned(address) view returns(uint256)',
  'function rewards(address) view returns(uint256)',
  'function rewardRate() view returns(uint256)',
  'function periodFinish() view returns(uint256)',
  'function lastUpdateTime() view returns(uint256)',
  'function left() view returns(uint256)',
])
const erc20Abi = parseAbi(['function balanceOf(address) view returns(uint256)'])
const oracleAbi = parseAbi(['function getTokenPrice(address) view returns(uint256)'])

const [block, stake, totalSupply, earned, storedReward, rewardRate, periodFinish, lastUpdateTime, left, gaugeAeon, aeonUsd] = await Promise.all([
  client.getBlock(),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'balanceOf', args: [A.staker] }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'totalSupply' }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'earned', args: [A.staker] }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'rewards', args: [A.staker] }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'rewardRate' }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'periodFinish' }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'lastUpdateTime' }),
  client.readContract({ address: A.gauge, abi: gaugeAbi, functionName: 'left' }),
  client.readContract({ address: A.aeon, abi: erc20Abi, functionName: 'balanceOf', args: [A.gauge] }),
  client.readContract({ address: A.oracle, abi: oracleAbi, functionName: 'getTokenPrice', args: [A.aeon] }),
])

const logs = []
const from = block.number > 500_000n ? block.number - 500_000n : 0n
for (let cursor = from; cursor <= block.number; cursor += 50_000n) {
  const toBlock = cursor + 49_999n > block.number ? block.number : cursor + 49_999n
  logs.push(...await client.getLogs({
    address: A.gauge,
    event: parseAbiItem('event RewardAdded(uint256 reward)'),
    fromBlock: cursor,
    toBlock,
  }))
}

const usd = value => formatUnits((value * aeonUsd) / 10n ** 18n, 18)
console.log(JSON.stringify({
  block: block.number.toString(),
  timestamp: Number(block.timestamp),
  staker: A.staker,
  stakeLp: formatUnits(stake, 18),
  totalStakedLp: formatUnits(totalSupply, 18),
  claimableEarnedAeon: formatUnits(earned, 18),
  claimableEarnedUsd: usd(earned),
  storedRewardAeon: formatUnits(storedReward, 18),
  remainingStreamAeon: formatUnits(left, 18),
  remainingStreamUsd: usd(left),
  gaugeAeonBalance: formatUnits(gaugeAeon, 18),
  gaugeAeonBalanceUsd: usd(gaugeAeon),
  rewardRateAeonPerSecond: formatUnits(rewardRate, 18),
  periodFinish: Number(periodFinish),
  lastUpdateTime: Number(lastUpdateTime),
  aeonUsd: formatUnits(aeonUsd, 18),
  rewardAddedEvents: logs.map(log => ({
    rewardAeon: formatUnits(log.args.reward, 18),
    rewardUsdAtCurrentPrice: usd(log.args.reward),
    blockNumber: log.blockNumber.toString(),
    transactionHash: log.transactionHash,
  })),
}, null, 2))
