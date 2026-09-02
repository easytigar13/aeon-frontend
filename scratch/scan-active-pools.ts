import { createPublicClient, http, formatUnits, getAddress, defineChain } from 'viem'
import { CONTRACTS, TOKENS, POOLS, UNISWAP_POOLS, CL_GAUGES } from '../src/config/contracts.ts'
import fs from 'fs'

const robinhoodChain = defineChain({
  id: 1698,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
})

const RPC_URL = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com'

const pub = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL, { timeout: 15_000 }),
})

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

async function scan() {
  console.log('Scanning all pools for TVL >= $20 USD using https://rpc.mainnet.chain.robinhood.com...')

  const pricesUsd: Record<string, number> = {
    USDG: 1.0,
    USDC: 1.0,
    WETH: 3160.0,
    ETH: 3160.0,
    AEON: 0.48,
    CASHCAT: 0.0012,
    VIRTUAL: 1.85,
    VEX: 0.15,
  }

  const candidates: any[] = []

  for (const p of POOLS) {
    candidates.push({
      name: p.name,
      address: p.address,
      token0: p.token0,
      token1: p.token1,
      feeBps: 100,
      isUniV2: false,
      kind: p.type || 'vAMM',
    })
  }

  for (const p of UNISWAP_POOLS) {
    candidates.push({
      name: p.name,
      address: p.address,
      token0: p.token0,
      token1: p.token1,
      feeBps: p.fee === '0.3%' ? 30 : 100,
      isUniV2: p.type === 'UniV2',
      kind: p.type || 'UniV2',
    })
  }

  for (const [addr, gauge] of Object.entries(CL_GAUGES)) {
    if (!candidates.some(c => c.address.toLowerCase() === addr.toLowerCase())) {
      candidates.push({
        name: `CL ${gauge.token0}/${gauge.token1}`,
        address: addr,
        token0: gauge.token0,
        token1: gauge.token1,
        feeBps: 0,
        isUniV2: false,
        kind: 'CL',
      })
    }
  }

  console.log(`Total candidate pools to inspect: ${candidates.length}`)

  const calls = candidates.flatMap(c => {
    const addr = getAddress(c.address)
    const t0 = TOKENS[c.token0 as keyof typeof TOKENS]
    const t1 = TOKENS[c.token1 as keyof typeof TOKENS]
    if (!t0 || !t1) return []
    return [
      { address: t0.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [addr] as const },
      { address: t1.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [addr] as const },
    ]
  })

  const results = await pub.multicall({ contracts: calls, allowFailure: true, batchSize: 20 })

  const activePools: any[] = []

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const r0Res = results[i * 2]
    const r1Res = results[i * 2 + 1]

    if (r0Res?.status !== 'success' || r1Res?.status !== 'success') continue

    const r0 = r0Res.result as bigint
    const r1 = r1Res.result as bigint

    const t0 = TOKENS[c.token0 as keyof typeof TOKENS]
    const t1 = TOKENS[c.token1 as keyof typeof TOKENS]
    if (!t0 || !t1) continue

    const num0 = parseFloat(formatUnits(r0, t0.decimals))
    const num1 = parseFloat(formatUnits(r1, t1.decimals))

    const p0 = pricesUsd[t0.symbol] || 0
    const p1 = pricesUsd[t1.symbol] || 0

    let tvlUsd = 0
    if (p0 > 0 && p1 > 0) tvlUsd = num0 * p0 + num1 * p1
    else if (p0 > 0) tvlUsd = num0 * p0 * 2
    else if (p1 > 0) tvlUsd = num1 * p1 * 2

    if (tvlUsd >= 20.0) {
      console.log(`✅ [ACTIVE >= $20 TVL] ${c.name} [${c.kind}] @ ${c.address}: TVL ~$${tvlUsd.toFixed(2)} (${num0.toFixed(2)} ${t0.symbol} / ${num1.toFixed(2)} ${t1.symbol})`)
      activePools.push({
        name: c.name,
        address: getAddress(c.address),
        token0: c.token0,
        token1: c.token1,
        feeBps: c.feeBps,
        isUniV2: c.isUniV2,
        kind: c.kind,
        tvlUsd,
      })
    }
  }

  console.log(`\nFiltered ${activePools.length} active pools with TVL >= $20 USD.`)

  const outJson = {
    generatedAt: new Date().toISOString(),
    minTvlUsd: 20,
    poolConfigs: activePools.map(p => ({
      name: p.name,
      address: p.address,
      token0: p.token0,
      token1: p.token1,
      feeBps: p.feeBps,
      isUniV2: p.isUniV2,
      kind: p.kind,
    }))
  }

  fs.writeFileSync('keeper/mirajane-pools.json', JSON.stringify(outJson, null, 2))
  console.log('Successfully written to keeper/mirajane-pools.json!')
}

scan().catch(console.error)
