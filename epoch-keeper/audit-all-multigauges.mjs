#!/usr/bin/env node

import fs from 'node:fs'
import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const CTRL = '0x4D49C36197bF806dc5f65267a847b3A7a4ab1335'
const AEON = '0xd4c93eD1843606f92CccA078941f3d52A585982f'
const ACCOUNT = '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc'
const client = createPublicClient({ transport: http(RPC) })
const controllerAbi = parseAbi([
  'function currentEpoch() view returns(uint256)',
  'function votingEpoch() view returns(uint256)',
  'function getPools() view returns(address[])',
  'function gaugeInfo(address) view returns(address gauge,uint8 kind,bool active)',
  'function poolForGauge(address) view returns(address)',
  'function weights(uint256,address) view returns(uint256)',
  'function totalWeight(uint256) view returns(uint256)',
  'function epochReward(uint256) view returns(uint256)',
  'function distributed(uint256,address) view returns(uint256)',
  'function claimable(address,uint256) view returns(uint256)',
  'function distribute(address,uint256) returns(uint256)',
])
const gaugeAbi = parseAbi([
  'function pool() view returns(address)',
  'function rewardToken() view returns(address)',
  'function governor() view returns(address)',
  'function totalSupply() view returns(uint256)',
  'function rewardRate() view returns(uint256)',
  'function periodFinish() view returns(uint256)',
])
const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)'])
const currentEpoch = await client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'currentEpoch' })
const previousEpoch = currentEpoch - 604800n
const [pools, currentTotalWeight, previousTotalWeight, currentReward, previousReward] = await Promise.all([
  client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'getPools' }),
  client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'totalWeight', args: [currentEpoch] }),
  client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'totalWeight', args: [previousEpoch] }),
  client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'epochReward', args: [currentEpoch] }),
  client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'epochReward', args: [previousEpoch] }),
])
const rows = []
for (let i = 0; i < pools.length; i += 8) {
  const chunk = await Promise.all(pools.slice(i, i + 8).map(async pool => {
    const info = await client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'gaugeInfo', args: [pool] })
    const [gauge, kind, active] = info
    const [reversePool, gaugePool, rewardToken, governor, totalSupply, rewardRate, periodFinish, gaugeAeon, weightNow, weightPrev, claimNow, claimPrev, distributedNow, distributedPrev] = await Promise.all([
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'poolForGauge', args: [gauge] }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'pool' }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'rewardToken' }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'governor' }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'totalSupply' }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'rewardRate' }).catch(() => null),
      client.readContract({ address: gauge, abi: gaugeAbi, functionName: 'periodFinish' }).catch(() => null),
      client.readContract({ address: AEON, abi: tokenAbi, functionName: 'balanceOf', args: [gauge] }).catch(() => null),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'weights', args: [currentEpoch, pool] }),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'weights', args: [previousEpoch, pool] }),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'claimable', args: [pool, currentEpoch] }),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'claimable', args: [pool, previousEpoch] }),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'distributed', args: [currentEpoch, pool] }),
      client.readContract({ address: CTRL, abi: controllerAbi, functionName: 'distributed', args: [previousEpoch, pool] }),
    ])
    let distributeSimulation = 'PASS'
    try { await client.simulateContract({ account: ACCOUNT, address: CTRL, abi: controllerAbi, functionName: 'distribute', args: [pool, currentEpoch] }) }
    catch (error) { distributeSimulation = error.shortMessage ?? error.message }
    const defects = []
    if (!gauge || /^0x0{40}$/i.test(gauge)) defects.push('missing gauge')
    if (![1, 2].includes(Number(kind))) defects.push('invalid gauge kind')
    if (!active) defects.push('controller gauge inactive')
    if (reversePool?.toLowerCase() !== pool.toLowerCase()) defects.push('controller reverse mapping mismatch')
    if (gaugePool?.toLowerCase() !== pool.toLowerCase()) defects.push('gauge pool mismatch')
    if (rewardToken?.toLowerCase() !== AEON.toLowerCase()) defects.push('wrong reward token')
    if (governor?.toLowerCase() !== CTRL.toLowerCase()) defects.push('controller is not gauge governor')
    if (distributeSimulation !== 'PASS') defects.push('distribution simulation reverts')
    return {
      pool, gauge, kind: Number(kind) === 1 ? 'CL' : Number(kind) === 2 ? 'DLMM' : Number(kind), active,
      reversePool, gaugePool, rewardToken, governor,
      totalSupply: totalSupply === null ? null : totalSupply.toString(),
      rewardRate: rewardRate === null ? null : formatUnits(rewardRate, 18),
      periodFinish: periodFinish?.toString() ?? null,
      gaugeAeonBalance: gaugeAeon === null ? null : formatUnits(gaugeAeon, 18),
      weights: [formatUnits(weightNow, 18), formatUnits(weightPrev, 18)],
      claimable: [formatUnits(claimNow, 18), formatUnits(claimPrev, 18)],
      distributed: [formatUnits(distributedNow, 18), formatUnits(distributedPrev, 18)],
      distributeSimulation, defects,
    }
  }))
  rows.push(...chunk)
}
const summary = {
  total: rows.length,
  healthy: rows.filter(r => r.defects.length === 0).length,
  defective: rows.filter(r => r.defects.length > 0).length,
  cl: rows.filter(r => r.kind === 'CL').length,
  dlmm: rows.filter(r => r.kind === 'DLMM').length,
  active: rows.filter(r => r.active).length,
  staked: rows.filter(r => BigInt(r.totalSupply ?? '0') > 0n).length,
  distributionPass: rows.filter(r => r.distributeSimulation === 'PASS').length,
  currentEpoch: currentEpoch.toString(),
  previousEpoch: previousEpoch.toString(),
  currentTotalWeight: formatUnits(currentTotalWeight, 18),
  previousTotalWeight: formatUnits(previousTotalWeight, 18),
  currentEpochReward: formatUnits(currentReward, 18),
  previousEpochReward: formatUnits(previousReward, 18),
}
const result = { auditedAt: new Date().toISOString(), controller: CTRL, summary, defective: rows.filter(r => r.defects.length), rows }
fs.writeFileSync(new URL('../data/multigauge-audit.json', import.meta.url), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ summary, defective: result.defective }, null, 2))
