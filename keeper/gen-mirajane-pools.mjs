// Generates keeper/mirajane-pools.json from the curated Mirajane pool list by
// reading every pool's real parameters on-chain -- no hand-transcription.
// Re-run this whenever the pool set changes:  node gen-mirajane-pools.mjs
//
// Classifies each address (our vAMM / our Algebra CL / external Uni V3),
// resolves every V4 poolId's full key from PoolManager Initialize events,
// skips hooked or zero-liquidity V4 pools, and writes the exact PoolConfig +
// V4 ref shapes the keeper expects. Output is loaded when MIRAJANE_MODE=true.

import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { CL_GAUGES, POOLS } from '../src/config/contracts.ts'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({ transport: http(RPC) })
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const ZERO = '0x0000000000000000000000000000000000000000'

// address(lowercased) -> { symbol, decimals }
const TOK = {
  '0xd4c93ed1843606f92ccca078941f3d52a585982f': 'AEON',
  '0x0bd7d308f8e1639fab988df18a8011f41eacad73': 'WETH',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG',
  '0xc6911796042b15d7fa4f6cde69e245ddcd3d9c31': 'VIRTUAL',
  '0x56a98db16cf501b686c14ba00a5dec02e87083fa': 'ROBINFUN',
  '0x020bfc650a365f8bb26819deaabf3e21291018b4': 'CASHCAT',
  '0xb3b78ca800c5327a21f03f0636d9a08a103787fd': 'SHERWOOD',
  '0x2e897abb6bf1d77c61eb3fa6c093ae71de0efd2d': 'NASDAQ',
}
const sym = a => TOK[(a || '').toLowerCase()]

// Every address the user provided (our pools + external Uniswap V3). The
// generator auto-classifies each; unknown/non-pool addresses are skipped.
const ADDRESSES = [
  // first batch
  '0xD215650cb628113A64D938164Ee5CD72293F9ea6','0xB4692A778E33fBA0B97Feaa863377C6322c83AA4',
  '0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288','0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6',
  // second batch (our pools + external)
  '0x22d76bf4e8d2c1DfCca7de6c9dC46Ec2a8Ed7Eb7','0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e',
  '0xeB638e1FA253E5526C2be76626dE26F02E4bdaba','0x77fee4F698d2925d8437D678ab804886D0695d11',
  '0x280b2eb06B105944BB2f1378c861D604eb82Aa3d','0x67B2da1742187Aa09b427082b06ACDC5bBCA2D99',
  '0xbf5FCFF8e5604b3ba404a4Cb5Be49EF230e0dA76','0xA70fc67C9F69da90B63a0e4C05D229954574E313',
  '0xd42A491087a15E5afd51FEb3606066Cc152d2b09','0x4E8649Be40aE67EBbcff99C291B92eE03015917b',
  '0x0579fA41416101b66e202F66bF3B0de5101F5b9F','0x4B0c312fFbB068F6a0bEa128759E35d94B94D0E1',
  '0x13F501cbFd47a07cceE7E9ef4134bb0E770D138F','0x5dA1Aa1ad4a357C9D1Ed4f78F8b0503C5b9d02E8',
  '0x1e4238E85B8C76c3a81d8E65544367ebb9A61b78','0x9b950a37FeC9D64E9Ed95a169E64cd7B98677690',
]
const V4_POOL_IDS = [
  '0x68d8ea65260d4dd8266536f8e2d039ef84b0e2acc72241d0290c527a21ee02fb','0x524ac58d769cf6cca091ec78adac38f1b3fe5677879ace1754b6ed5310547f3a',
  '0xa92a3df27a00a276183ff7265fd8affa11df1fe8bb23ddfaf13f6c879a3f818b','0xfb4f9cf463af813633e533f7e81cfb95cea80422495d02ac3552d92ed2786e88',
  '0xee0d95c4644e0847eca78d5f5333abe1ab798b159fdd01712327258a755d4423','0x7dfc6415af7b5b5fda7939c37696ea69d6c56989bc1d2f49ab66cda1f97ad7e1',
  '0xf7dc0af99fce7169eb76854c0b39beb9915526894d42229946e5cb469cab50b1','0x9ef65557448721482d554f24875113238919551fd92944627f3ac0f3cc3b07fe',
  '0x121d3e1946de183d49b1fb9d5d3f0ca37b1f7f4ae611977eb85c97f520b95c81','0xcf59973103ba5b7023b607cf9708496d86e07b0c16b77f98935ab6c3419293d2',
  '0x74739c7ee5dda3695d01575c32371eff16e7b831e37517d1a99b568749143e7a','0x06a136ff9199da1a43b5a5d163a00de4c760fd8e5d333b491d7fd9d6ac489773',
  '0x414582fb651d8629238ca87b85e93509d27a1e3610ff65c050ada959f4459fe9','0x5501f1e70a9a3c56f57880c18d095a63f4e1b50e9def646e7f3c6633d49db550',
  '0x76d4df1e097e3ed9e73a6a14ea5c574a96297b63e375dc8bb6877b6ff447bf43','0xc37120cc36a2c63af25448d5503fe4b8ff8bd5d7a91a99912aafa1c6a90fa6f9',
  '0x23a983bb3d0711aae0a5614dd37e9dc9086a44e838c9a331fb9e787bca18dace','0x2e76dfba67e8e04c2d9deae3bbd59ecd1059509d954da523df13c923d9c62ea9',
]

const t0Abi = [{ name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }]
const t1Abi = [{ name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }]
const feeAbi = [{ name: 'fee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] }]
const resAbi = [{ name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] }]
const svAbi = [{ name: 'getLiquidity', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint128' }] }]
const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
const clSet = new Set(Object.keys(CL_GAUGES).map(a => a.toLowerCase()))
// Our own vAMM pools (poolType 0). Anything else with getReserves is an
// EXTERNAL constant-product pool (Uniswap V2 style) needing poolType 3, which
// we haven't verified for these specific pools -- excluded for safety.
const ourVammFee = new Map(POOLS.filter(p => p.type === 'vAMM').map(p => [p.address.toLowerCase(), Number(String(p.fee).replace('%', '')) * 100]))

const poolConfigs = []
const v4Refs = []
const skipped = []

for (const addr of ADDRESSES) {
  let t0, t1
  try { t0 = await client.readContract({ address: addr, abi: t0Abi, functionName: 'token0' }) }
  catch { skipped.push(`${addr} (not a pool / no token0)`); continue }
  try { t1 = await client.readContract({ address: addr, abi: t1Abi, functionName: 'token1' }) } catch {}
  const s0 = sym(t0), s1 = sym(t1)
  if (!s0 || !s1) { skipped.push(`${addr} (unknown token ${!s0 ? t0 : t1})`); continue }

  let hasReserves = false
  try { await client.readContract({ address: addr, abi: resAbi, functionName: 'getReserves' }); hasReserves = true } catch {}
  const lc = addr.toLowerCase()

  // Order matters: OUR config membership before any generic heuristic --
  // Algebra CL pools also expose fee(), and external constant-product pools
  // also expose getReserves(), so the raw getters can't disambiguate.
  if (ourVammFee.has(lc)) {
    poolConfigs.push({ name: `${s0}/${s1}`, address: getAddress(addr), token0: s0, token1: s1, feeBps: ourVammFee.get(lc), isUniV2: false, kind: 'vAMM' })
    continue
  }
  if (clSet.has(lc)) {
    poolConfigs.push({ name: `CL ${s0}/${s1}`, address: getAddress(addr), token0: s0, token1: s1, feeBps: 0, isUniV2: false, kind: 'CL' })
    continue
  }
  if (hasReserves) {
    skipped.push(`${addr} (${s0}/${s1} -- external constant-product pool, needs poolType 3 verification; excluded)`)
    continue
  }
  let v3Fee
  try { v3Fee = Number(await client.readContract({ address: addr, abi: feeAbi, functionName: 'fee' })) } catch {}
  if (v3Fee !== undefined) {
    poolConfigs.push({ name: `UniV3 ${s0}/${s1}`, address: getAddress(addr), token0: s0, token1: s1, feeBps: 0, isUniV2: false, kind: 'uniV3', v3Fee })
    continue
  }
  skipped.push(`${addr} (${s0}/${s1} -- not our vAMM/CL, not Uni V3; unknown AMM, excluded for safety)`)
}

// V4 keys via Initialize events, filtered by the exact ids
const ev = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)')
const latest = await client.getBlockNumber()
const logs = await client.getLogs({ address: POOL_MANAGER, event: ev, args: { id: V4_POOL_IDS }, fromBlock: 0n, toBlock: latest })
const byId = new Map(logs.map(l => [l.args.id.toLowerCase(), l.args]))

for (const id of V4_POOL_IDS) {
  const a = byId.get(id.toLowerCase())
  if (!a) { skipped.push(`${id} (V4 key not found)`); continue }
  if (a.hooks.toLowerCase() !== ZERO) { skipped.push(`${id} (V4 hooked pool ${a.hooks} -- excluded)`); continue }
  const liq = await client.readContract({ address: STATE_VIEW, abi: svAbi, functionName: 'getLiquidity', args: [id] })
  if (liq === 0n) { skipped.push(`${id} (V4 zero liquidity)`); continue }
  const native = a.currency0.toLowerCase() === ZERO
  const c0 = a.currency0, c1 = a.currency1
  const tok0Addr = native ? '0x0bd7d308f8e1639fab988df18a8011f41eacad73' : c0 // WETH stand-in for native
  const s0 = sym(tok0Addr), s1 = sym(c1)
  if (!s0 || !s1) { skipped.push(`${id} (unknown V4 token)`); continue }
  poolConfigs.push({
    name: `UniV4 ${s0}/${s1}`, address: getAddress(POOL_MANAGER), token0: s0, token1: s1,
    feeBps: 0, isUniV2: false, kind: 'uniV4',
    v4PoolId: id, v4Fee: Number(a.fee), v4TickSpacing: Number(a.tickSpacing), v4Hooks: getAddress(a.hooks), v4Native: native,
  })
  v4Refs.push({
    id, token0: getAddress(tok0Addr), token1: getAddress(c1),
    currency0: getAddress(c0), currency1: getAddress(c1),
    fee: Number(a.fee), tickSpacing: Number(a.tickSpacing), hooks: getAddress(a.hooks), native, volume24: 0,
  })
}

const out = { generatedAt: 'on-chain', poolConfigs, v4Refs }
const path = fileURLToPath(new URL('mirajane-pools.json', import.meta.url))
writeFileSync(path, JSON.stringify(out, null, 2))
const counts = poolConfigs.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {})
console.log(`Wrote ${poolConfigs.length} pools:`, counts)
console.log(`V4 refs: ${v4Refs.length}`)
console.log(`Skipped ${skipped.length}:`)
for (const s of skipped) console.log('  -', s)
