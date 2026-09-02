#!/usr/bin/env node

import fs from 'node:fs'
import { createPublicClient, formatUnits, http, parseAbi } from 'viem'

const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const WEEK = 604800n
const ZERO = '0x0000000000000000000000000000000000000000'
const A = {
  voter: '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb',
  distributor: '0x40524d597e9e241b5B7C76D1b2e570A77933D412',
  oracle: '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD',
  factoryV1: '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6',
  factoryV2: '0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC',
  account: '0x92aAc9aeD3b93e3F6252982A716Aa683A7F650bc',
}
const client = createPublicClient({ transport: http(RPC) })
const voterAbi = parseAbi([
  'function length() view returns(uint256)',
  'function pools(uint256) view returns(address)',
  'function gauges(address) view returns(address)',
  'function isPool(address) view returns(bool)',
  'function isGauge(address) view returns(bool)',
  'function isAlive(address) view returns(bool)',
  'function poolForGauge(address) view returns(address)',
  'function poolTotalWeight(address,uint256) view returns(uint256)',
])
const poolAbi = parseAbi([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function factory() view returns(address)',
  'function poolFees() view returns(address)',
  'function getReserves() view returns(uint112,uint112,uint32)',
  'function totalSupply() view returns(uint256)',
])
const gaugeAbi = parseAbi([
  'function pool() view returns(address)',
  'function feeDistributor() view returns(address)',
  'function totalSupply() view returns(uint256)',
  'function rewardRate() view returns(uint256)',
  'function periodFinish() view returns(uint256)',
  'function collectFees()',
])
const erc20Abi = parseAbi([
  'function symbol() view returns(string)',
  'function decimals() view returns(uint8)',
  'function balanceOf(address) view returns(uint256)',
])
const distributorAbi = parseAbi(['function poolTokenEpochFees(address,address,uint256) view returns(uint256)'])
const oracleAbi = parseAbi(['function getTokenPrice(address) view returns(uint256)'])
const rd = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args }).catch(() => null)
const tokenCache = new Map()

async function tokenInfo(address) {
  const key = address.toLowerCase()
  if (tokenCache.has(key)) return tokenCache.get(key)
  const [symbol, decimals, price] = await Promise.all([
    rd(address, erc20Abi, 'symbol'),
    rd(address, erc20Abi, 'decimals'),
    rd(A.oracle, oracleAbi, 'getTokenPrice', [address]),
  ])
  const info = { symbol: symbol ?? address.slice(0, 8), decimals: Number(decimals ?? 18), priceUsd: price === null ? null : formatUnits(price, 18) }
  tokenCache.set(key, info)
  return info
}

async function inspect(pool, currentEpoch, previousEpoch) {
  const gauge = await rd(A.voter, voterAbi, 'gauges', [pool])
  const [isPool, token0, token1, factory, poolFees, reserves, lpSupply] = await Promise.all([
    rd(A.voter, voterAbi, 'isPool', [pool]),
    rd(pool, poolAbi, 'token0'),
    rd(pool, poolAbi, 'token1'),
    rd(pool, poolAbi, 'factory'),
    rd(pool, poolAbi, 'poolFees'),
    rd(pool, poolAbi, 'getReserves'),
    rd(pool, poolAbi, 'totalSupply'),
  ])
  if (!token0 || !token1) return { pool, gauge, severity: 'critical', defects: ['pool metadata unreadable'] }
  const [t0, t1] = await Promise.all([tokenInfo(token0), tokenInfo(token1)])
  const feeAccounting = !!poolFees && poolFees.toLowerCase() !== ZERO
  const [vault0, vault1, feesNow0, feesNow1, feesPrev0, feesPrev1, weightNow, weightPrev] = await Promise.all([
    feeAccounting ? rd(token0, erc20Abi, 'balanceOf', [poolFees]) : 0n,
    feeAccounting ? rd(token1, erc20Abi, 'balanceOf', [poolFees]) : 0n,
    rd(A.distributor, distributorAbi, 'poolTokenEpochFees', [pool, token0, currentEpoch]),
    rd(A.distributor, distributorAbi, 'poolTokenEpochFees', [pool, token1, currentEpoch]),
    rd(A.distributor, distributorAbi, 'poolTokenEpochFees', [pool, token0, previousEpoch]),
    rd(A.distributor, distributorAbi, 'poolTokenEpochFees', [pool, token1, previousEpoch]),
    rd(A.voter, voterAbi, 'poolTotalWeight', [pool, currentEpoch]),
    rd(A.voter, voterAbi, 'poolTotalWeight', [pool, previousEpoch]),
  ])
  let isGauge = false, isAlive = false, gaugePool = null, gaugeDistributor = null, gaugeSupply = null, rewardRate = null, periodFinish = null
  let collectSimulation = 'NO_GAUGE'
  if (gauge && gauge.toLowerCase() !== ZERO) {
    ;[isGauge, isAlive, gaugePool, gaugeDistributor, gaugeSupply, rewardRate, periodFinish] = await Promise.all([
      rd(A.voter, voterAbi, 'isGauge', [gauge]),
      rd(A.voter, voterAbi, 'isAlive', [gauge]),
      rd(gauge, gaugeAbi, 'pool'),
      rd(gauge, gaugeAbi, 'feeDistributor'),
      rd(gauge, gaugeAbi, 'totalSupply'),
      rd(gauge, gaugeAbi, 'rewardRate'),
      rd(gauge, gaugeAbi, 'periodFinish'),
    ])
    if (isAlive) {
      try {
        await client.simulateContract({ account: A.account, address: gauge, abi: gaugeAbi, functionName: 'collectFees' })
        collectSimulation = 'PASS'
      } catch (error) {
        collectSimulation = error.shortMessage ?? error.message
      }
    } else {
      collectSimulation = 'SKIPPED_INACTIVE'
    }
  }
  const retired = !!gauge && gauge.toLowerCase() !== ZERO && isGauge === true && isAlive === false
  const defects = []
  if (!isPool) defects.push('not registered as voter pool')
  if (!gauge || gauge.toLowerCase() === ZERO) defects.push('missing gauge')
  if (gauge && gauge.toLowerCase() !== ZERO && !isGauge) defects.push('voter does not recognize gauge')
  if (gaugePool && gaugePool.toLowerCase() !== pool.toLowerCase()) defects.push('gauge pool mismatch')
  if (gaugeDistributor && gaugeDistributor.toLowerCase() !== A.distributor.toLowerCase()) defects.push('wrong fee distributor')
  if (!retired && !feeAccounting) defects.push('pool has no fee accounting')
  if (!retired && collectSimulation !== 'PASS') defects.push('collectFees simulation reverts')
  const hasLiquidity = !!reserves && (reserves[0] > 0n || reserves[1] > 0n) && !!lpSupply && lpSupply > 1000n
  const actionable = defects.length > 0 && (hasLiquidity || (weightNow ?? 0n) > 0n || (weightPrev ?? 0n) > 0n)
  return {
    pool,
    name: `${t0.symbol}/${t1.symbol}`,
    gauge,
    factory,
    factoryClass: factory?.toLowerCase() === A.factoryV1.toLowerCase() ? 'legacy' : factory?.toLowerCase() === A.factoryV2.toLowerCase() ? 'v2' : 'direct/other',
    poolFees,
    feeAccounting,
    collectSimulation,
    isPool,
    isGauge,
    isAlive,
    retired,
    gaugePool,
    gaugeDistributor,
    hasLiquidity,
    reserves: reserves ? [formatUnits(reserves[0], t0.decimals), formatUnits(reserves[1], t1.decimals)] : null,
    lpSupply: lpSupply === null ? null : formatUnits(lpSupply, 18),
    gaugeSupply: gaugeSupply === null ? null : formatUnits(gaugeSupply, 18),
    feeVault: [formatUnits(vault0 ?? 0n, t0.decimals), formatUnits(vault1 ?? 0n, t1.decimals)],
    recordedCurrent: [formatUnits(feesNow0 ?? 0n, t0.decimals), formatUnits(feesNow1 ?? 0n, t1.decimals)],
    recordedPrevious: [formatUnits(feesPrev0 ?? 0n, t0.decimals), formatUnits(feesPrev1 ?? 0n, t1.decimals)],
    tokenPricesUsd: [t0.priceUsd, t1.priceUsd],
    weights: [formatUnits(weightNow ?? 0n, 18), formatUnits(weightPrev ?? 0n, 18)],
    rewardRate: rewardRate === null ? null : formatUnits(rewardRate, 18),
    periodFinish: periodFinish?.toString() ?? null,
    defects,
    severity: retired ? 'retired' : actionable ? 'critical' : defects.length ? 'dormant' : 'ok',
  }
}

const block = await client.getBlock()
const currentEpoch = block.timestamp / WEEK * WEEK
const previousEpoch = currentEpoch - WEEK
const length = await client.readContract({ address: A.voter, abi: voterAbi, functionName: 'length' })
const pools = []
for (let i = 0n; i < length; i++) pools.push(await client.readContract({ address: A.voter, abi: voterAbi, functionName: 'pools', args: [i] }))
const rows = []
for (let i = 0; i < pools.length; i += 5) rows.push(...await Promise.all(pools.slice(i, i + 5).map(pool => inspect(pool, currentEpoch, previousEpoch))))
const summary = {
  total: rows.length,
  ok: rows.filter(r => r.severity === 'ok').length,
  critical: rows.filter(r => r.severity === 'critical').length,
  dormant: rows.filter(r => r.severity === 'dormant').length,
  retired: rows.filter(r => r.severity === 'retired').length,
  collectPass: rows.filter(r => r.collectSimulation === 'PASS').length,
  collectFail: rows.filter(r => r.isAlive && r.collectSimulation !== 'PASS').length,
  feeAccountingMissingActive: rows.filter(r => r.isAlive && r.feeAccounting === false).length,
  missingGauge: rows.filter(r => !r.gauge || r.gauge.toLowerCase() === ZERO).length,
}
const result = { auditedAt: new Date().toISOString(), block: block.number.toString(), currentEpoch: currentEpoch.toString(), previousEpoch: previousEpoch.toString(), summary, critical: rows.filter(r => r.severity === 'critical'), dormant: rows.filter(r => r.severity === 'dormant'), retired: rows.filter(r => r.severity === 'retired'), rows }
const out = new URL('../data/vamm-gauge-fee-audit.json', import.meta.url)
fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true })
fs.writeFileSync(out, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ...summary, critical: result.critical.map(r => ({ name: r.name, pool: r.pool, gauge: r.gauge, factoryClass: r.factoryClass, defects: r.defects })) }, null, 2))
