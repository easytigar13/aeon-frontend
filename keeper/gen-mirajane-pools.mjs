// Generates keeper/mirajane-pools.json from the curated Mirajane pool list by
// reading every pool's real parameters on-chain -- no hand-transcription.
// Re-run this whenever the pool set changes:  node gen-mirajane-pools.mjs
//
// Classifies each address (our vAMM / our Algebra CL / external Uni V3),
// resolves every V4 poolId's full key from PoolManager Initialize events,
// skips unapproved hooked or zero-liquidity V4 pools, and writes the exact PoolConfig +
// V4 ref shapes the keeper expects. Output is loaded when MIRAJANE_MODE=true.

import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { CL_GAUGES, POOLS } from '../src/config/contracts.ts'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const client = createPublicClient({ transport: http(RPC) })
const POOL_MANAGER = '0x8366a39cc670b4001a1121b8f6a443a643e40951'
const UNISWAP_V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'
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
  '0x56910d4409f3a0c78c64dd8d0545ff0705389870': 'INDEX',
  '0x45242320dbb855eea8fd36804c6487e10e97fcf9': 'TENDIES',
  '0x01637b14b7378b99de75a64d50656d98488d9a4d': 'MARIAN',
  '0x8ff92566f2e81bdd68edfaa8cde73942a723796b': 'VEX',
  '0xd7321801caae694090694ff55a9323139f043b88': 'JUGGERNAUT',
  '0x768a8b3421742d5e17bd901b63898674fc097777': 'VAULTS',
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
  // canonical Uniswap V3 INDEX/WETH, fee 1%
  '0xD29893fFac8b29eC4Db2cfE0CDB3FE1377c028Ff',
  // canonical Uniswap V3 NASDAQ/WETH, fee 1%
  '0x434DE0f0800D9653D26F96bEcD9702d8d740EE3c',
  // verified V2-compatible external pairs
  '0x8803c117ccae7B5146297876c2A25DF135141C4d','0xd95e8e2Cd04c207625C6F23c974d365a5F3A91D3',
  '0xD65870Dc303b9CA01e07528B220C76d5fE917126','0xee8D21C0E5AAA31269867Db4E3C66a90C3D5951D',
  '0x817f16F5D8da83d1B089B082c0172af3923618dA',
  // canonical Uniswap V3 pools for the finalized external token set
  '0x9cc8c4F6118419A27f113723F1DeA646685Be55F','0x7a11bC7f32AEA2f81E83DA399C70315d9662869C',
  '0x1Fb312C6eabfeCe638009A64d7688b6b44A382c0','0x237609918F330ADD285b8bC5f8f2922283D1C4C5',
  '0xFE331fD29b54bCE09D52988FA691e3B18B0A4081','0x4fA27693a052863bb5e9D3E63bA02857442A1Ecf',
  '0x588b0785f50063260003B7790C42f1eF74902746',
  // VAULTS: canonical liquid WETH V2 and canonical active USDG V3 (1%).
  // Zero-liquidity V3/V4 pools are intentionally excluded.
  '0x1988b801dBb178D77956B67Fa9B6B61Ae59E3a0a','0xdf949e67A21761a52AE043982E640360f7986B25',
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
  // liquid, unhooked INDEX/USDG pools (0.95% and 3%)
  '0x51d1a40389e7fe42bd4f3d4c3c901ec8846d8d6e051d7375b65782f340898d58',
  '0x0d0bcef5e77bc4dddca11964f58481f6d810b7ab4be1035b31de30eb41c4abc8',
  // INDEX/ETH: the large hook pool plus liquid unhooked alternatives
  '0x00dd2df2f17d431cf3a0938f06c9cf9abc5e9643b6cc466ca3f71f3af246edf3',
  '0xdb33247bd4d779b737b56a8d57c2b96dde053d7fa66562d5d4d8d83e63d2fa19',
  '0xdfa47c9208015216e8694cc7b75cc20c16c3e8441006247e926525c47fb64f5e',
  '0xfaae12e9bfeabb41560ecbbc344b9e68dd541a626be599e5fc8b8664a4cbf032',
  // VIRTUAL, TENDIES, MARIAN, VEX and JUGGERNAUT V4 markets
  '0xa95732060867f07aa9b8ae9a4b7b8d737bc3374f1dfbb952759c5ed676e8737c',
  '0xfee96a0e7cf4a544f2b42a163eee51be5cb0920f04099ab41662f6d33419a6ab',
  '0x43a562fe46f3240a9d61ac1c72a27763ad2da69a0f867fadc4ec6a2b83a5ce0e',
  '0xb88dfb184602b74bee9c325a2b2dabdd6886ec6a995ac2fe8ec351804df00604',
  '0x847661839a596aa6a175f3c055d109bf8a0a2a8c06c750691d1f5285e56d545d',
  '0x0681e99719bda118a9dd72e3afa4d3e36d073ef79025d7409f57e8d38e48cd3e',
  '0xbf0b53d7f6551902c467e686994b2e19e0d55119590c4bec3228604e521e9090',
  '0x97ab3c0d4b7ed8244dae434fb039160116d2f5721ce2d0b693a6d05aed823eac',
  '0x68518a0a7081c15381b2d34b70fbf10210c5c7d1706b6fcb65ac953041cbffc1',
  '0x91a1a4f988adb34a38ca87d2557e8029a50152b51d812190a8b72765e256a492',
]

const t0Abi = [{ name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }]
const t1Abi = [{ name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }]
const feeAbi = [{ name: 'fee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] }]
const v3FactoryAbi = [{
  name: 'getPool', type: 'function', stateMutability: 'view',
  inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }],
}]
const resAbi = [{ name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] }]
const svAbi = [{ name: 'getLiquidity', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint128' }] }]
const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
const clSet = new Set(Object.keys(CL_GAUGES).map(a => a.toLowerCase()))
// Our own vAMM pools (poolType 0). Verified external constant-product pools
// use poolType 3 with their measured fee; all other getReserves pools remain
// excluded rather than guessed.
const ourVammFee = new Map(POOLS.filter(p => p.type === 'vAMM').map(p => [p.address.toLowerCase(), Number(String(p.fee).replace('%', '')) * 100]))
const verifiedExternalV2Fee = new Map([
  ['0x8803c117ccae7b5146297876c2a25df135141c4d', 30],
  ['0xd95e8e2cd04c207625c6f23c974d365a5f3a91d3', 30],
  ['0xd65870dc303b9ca01e07528b220c76d5fe917126', 25],
  ['0xee8d21c0e5aaa31269867db4e3c66a90c3d5951d', 30],
  ['0x817f16f5d8da83d1b089b082c0172af3923618da', 30],
  ['0x1988b801dbb178d77956b67fa9b6b61ae59e3a0a', 30],
])
const certifiedHookedV4 = new Set([
  '0x00dd2df2f17d431cf3a0938f06c9cf9abc5e9643b6cc466ca3f71f3af246edf3',
])

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
    const feeBps = verifiedExternalV2Fee.get(lc)
    if (feeBps === undefined) {
      skipped.push(`${addr} (${s0}/${s1} -- unverified external constant-product pool; excluded)`)
      continue
    }
    poolConfigs.push({ name: `UniV2 ${s0}/${s1}`, address: getAddress(addr), token0: s0, token1: s1, feeBps, isUniV2: true, kind: 'uniV2' })
    continue
  }
  let v3Fee
  try { v3Fee = Number(await client.readContract({ address: addr, abi: feeAbi, functionName: 'fee' })) } catch {}
  if (v3Fee !== undefined) {
    const canonical = await client.readContract({
      address: UNISWAP_V3_FACTORY, abi: v3FactoryAbi, functionName: 'getPool', args: [t0, t1, v3Fee],
    })
    if (canonical.toLowerCase() !== addr.toLowerCase()) {
      skipped.push(`${addr} (${s0}/${s1} -- not canonical Uniswap V3; excluded)`)
      continue
    }
    poolConfigs.push({ name: `UniV3 ${s0}/${s1}`, address: getAddress(addr), token0: s0, token1: s1, feeBps: Math.ceil(v3Fee / 100), isUniV2: false, kind: 'uniV3', v3Fee })
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
  if (a.hooks.toLowerCase() !== ZERO && !certifiedHookedV4.has(id.toLowerCase())) {
    skipped.push(`${id} (V4 hooked pool ${a.hooks} -- not certified; excluded)`)
    continue
  }
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
