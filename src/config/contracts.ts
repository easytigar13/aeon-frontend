// src/config/contracts.ts
// AEON Protocol on Robinhood Chain (chain id 4663) — deployed 2026-07-02.
// vAMM pools at genesis, plus a forked Algebra Integral (algebra.finance)
// concentrated-liquidity deployment for the same 3 pairs, added 2026-07-03.

export const CHAIN_ID = 4663

export const CONTRACTS = {
  AeonToken:           '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`,
  MinterProxy:         '0x05b04A4344520Bb08201Bd9460ec9d37aD5f7918' as `0x${string}`,
  AeonVotingEscrow:    '0x0b18B0f483f1caAaBB7505bCD8D1C3C43197Add9' as `0x${string}`,
  TheFurnace:          '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A' as `0x${string}`,
  AeonVoter:           '0x2f4cad5f25AcC8E8d18a77ACEc5E2832B6cFF104' as `0x${string}`,
  AeonGaugeFactory:    '0x044f2A04Ca5D521293E6687D9a2953cf2B27a3C1' as `0x${string}`,
  BuybackEngine:       '0xe159282352fbD7aF64C22d581cf6338C382b7c5A' as `0x${string}`,
  FeeDistributor:      '0x772C2Ba92278D47B3A76b3f97b26A5c74d7F7975' as `0x${string}`,
  EmissionsEngine:     '0xf34feaA8a05b81D8FC0c66cA8F0621475e88C8b6' as `0x${string}`,
  AeonOracle:          '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD' as `0x${string}`,
  ConstantUsdFeed:     '0x182e8039659F8110D47a87BEad1FAAaEf981781d' as `0x${string}`,
  AeonFactory:         '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6' as `0x${string}`,
  AeonRouter:          '0x4d188106175De919a971B0cB6F8A0e3E885a3410' as `0x${string}`,
  // Redeployed 2026-07-03: the original LiquidityHelperRH gated addLiquidity()
  // behind a 100 AEON whitelist payment. Removed entirely per product decision
  // (there should be no paywall to add liquidity to the protocol) — this is a
  // fresh contract with no whitelist check at all.
  LiquidityHelper:     '0xbCE7C45dDB6387BCeF217B923E4E1a76ad5B9037' as `0x${string}`,
  // Deployed 2026-07-04: replaces LiquidityHelper for all ongoing add/remove
  // calls. The old helper took the caller's amounts (or the pool's burn()
  // output) on faith — no slippage bound, no live-reserve ratio correction —
  // so a reserve shift between quoting and confirming could silently donate
  // value on add, or hand back less than quoted on remove, with zero floor.
  // This version computes the optimal matching amount from live reserves
  // (Uniswap V2 Router pattern) and reverts if either side misses the
  // caller's min bound. EmissionsEngine's stored liquidityHelper reference
  // only fired once, inside the already-executed genesis epoch, so pointing
  // the frontend here doesn't touch anything already on-chain.
  LiquidityHelperV2:   '0xF5eDf6C1932e2E558ee560041c7B647a41673e78' as `0x${string}`,
  Whitelist:           '0x0337333fdCf79D08f4ac10321796A91f300b5a80' as `0x${string}`,
  // Deployed 2026-07-05: bundles "swap into WETH via AeonRouter, then unwrap
  // to native ETH" into one transaction/one wallet prompt. Without it, the
  // unwrap step is a separate raw WETH.withdraw() call that wallets label
  // "Withdraw" — accurate (that's WETH's own real function name) but reads
  // as unrelated to a swap. Verified end-to-end against a fork simulation
  // before deploying: real 2-hop swap, real unwrap, zero leftover funds in
  // the helper. Wraps AeonRouter unchanged — doesn't touch it, so it can't
  // change behavior for anything already using that router directly.
  SwapUnwrapHelper:    '0x86b6760D84EFfF5FD1894473101bD67744eF9FC2' as `0x${string}`,
  // Deployed 2026-07-04: safety-guaranteed arbitrage executor (reverts unless
  // the cycle nets at least the caller's own required profit — never
  // executes a losing trade). Mixes our own pools with external venues
  // (e.g. Uniswap's real WETH/USDG pair, also live on Robinhood Chain) via a
  // generic raw pair-swap hop abstraction. Not run automatically by anything —
  // see keeper/arb-bot.js in aeon-protocol-v5 for the analysis/execution script.
  ArbKeeper:           '0xdce1773a806cdf172f76f94d8828971d580cd472' as `0x${string}`,
  // Deployed 2026-07-05: AeonRouterRH only ever implements vAMM's swap
  // interface (hardcoded poolType 0) — it has no code path for Algebra's
  // exactInputSingle (CL) or Trader Joe's LB swapExactTokensForTokens
  // (DLMM), so a route could never cross pool types before this. One
  // transaction can now chain hops across vAMM, CL, and DLMM in any order.
  // Verified via fork simulation covering all three orderings (vAMM->CL,
  // CL-as-intermediate->vAMM, DLMM-as-intermediate->vAMM) before deploying —
  // exact-matching reported vs. actual balance deltas on all of them.
  // Redeployed 2026-07-05 to add poolType 3 (external Uniswap-V2-style
  // pairs). Real Uniswap pairs take a 4-param swap(amount0Out, amount1Out,
  // to, data) for flash-swap callbacks -- a different function selector
  // than our own simplified pools' 3-param swap(), confirmed by a direct
  // revert against the real USDG/VIRTUAL pair before the fix. Verified fixed
  // via fork simulation (exact-matching reported vs actual balance delta)
  // before this redeploy.
  // Redeployed again 2026-07-05 to add swapSplitExactTokensForTokens: splits
  // one trade's input across independent legs (e.g. "fill from our own pool
  // up to the caller's slippage tolerance, route the remainder through
  // whichever venue is best") and sums their outputs. Product decision: a
  // pure best-price router would send most ETH/USDG volume straight to
  // Uniswap's real pair (our own vAMM+CL+DLMM pools there total ~$54 vs
  // Uniswap's ~$6,600) -- this lets the swap page prioritize our own pools
  // for as much of a trade as the user's own slippage setting tolerates,
  // instead of losing that volume outright. Fork-verified (exact-matching
  // reported vs actual balance delta) splitting a real USDG->WETH trade
  // across AEON's own vAMM ETH/USDG pool and Uniswap's WETH/USDG pair.
  UniversalRouter:     '0xd948c4ea449e36d899bdC8f62585DC04B5e26942' as `0x${string}`,
  // Deployed 2026-07-05: backs the Tower Defense mini-game. 50 AEON entry fee
  // per session feeds a self-funded prize pool; claimReward() only pays out
  // with a signature from trustedSigner (a dedicated key held by
  // /api/games/tower-defense/claim, holding no funds itself) attesting to a
  // specific reward amount for a specific session -- the game runs client-side
  // so a client's own "I won" claim can never be trusted directly. Hard caps
  // (maxRewardPerClaim, maxClaimsPerDay) bound worst-case payout even if that
  // signer key were ever compromised. Fork-verified (happy path + double-claim
  // + wrong-signer + over-cap all behave correctly) before deploying.
  TowerDefenseArena:   '0xCFcb643D8f51D640e0B81257340C1cA344238F48' as `0x${string}`,
} as const

// Deployed 2026-07-05: parallel staking + AEON-rewards contracts for CL and
// DLMM pools, keyed by pool address. NOT wired into AeonVoterV2's automatic
// vote-weighted emissions — that voter's gaugeFactory can only ever be set
// once (already is, permanently, to a factory that only deploys plain
// ERC20-LP-token gauges), and CL positions are NFTs / DLMM positions are
// per-bin share tokens, neither of which fit that shape. These gauges take
// a governor-funded discretionary AEON budget via notifyRewardAmount()
// instead of the automatic stream vAMM gauges get.
// Redeployed 2026-07-05 (v2) to add per-user staked-position enumeration
// (getStakedTokenIds / getStakedBinIds) — needed for the frontend to show
// "your staked positions" at all, since staking transfers custody away from
// the user. The v1 addresses were replaced before anything was ever staked
// in them (confirmed totalSupply()==0 on all 8 first).
export const CL_GAUGES: Record<string, `0x${string}`> = {
  '0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e': '0xd4f0a5b1905537ad8be89a04591171c25cb916ef', // CL AEON/ETH
  '0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6': '0x5f6c7ffca91223fc1187ac3e29abb5d66d455367', // CL AEON/USDG
  '0x96B5de75c08971f41DE6bde917fB0a8d0EB450F3': '0xb3ed0456a2637a71711c415e9e5c5982284fa432', // CL ETH/USDG
  '0x280b2eb06B105944BB2f1378c861D604eb82Aa3d': '0xafff2c5d9bb53bc3553b2e9086225aa6e293a2cc', // CL VIRTUAL/AEON
}
export const DLMM_GAUGES: Record<string, `0x${string}`> = {
  '0x736d8E418673253b2CDE1ef3Df6205Fc9780816b': '0xe3c3457d17f7a63b6f1af36274be141af97e3ac2', // DLMM AEON/ETH
  '0x8bCCec714f42eeb73954172C253F84f649599E3B': '0x71f4b4d6ef39bf0f666cd8c37636502800edda52', // DLMM AEON/USDG
  '0x6E3772afbef845Ef4a3aD23a6eEEf65776375bC6': '0x0ccf1f26e820f8045424877821e2e6412f4f4abc', // DLMM ETH/USDG
  '0xcC62C85794F652ee257cf00c87530fF860755892': '0xf5b1f8c09de36fb508dc8f3669a76eed4be4db87', // DLMM VIRTUAL/AEON
}

// Native ETH sentinel — convention used across the app for "the chain's
// native gas token" wherever an ERC20 address is expected.
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`

export const TOKENS = {
  AEON:    { address: CONTRACTS.AeonToken,                                       symbol: 'AEON',    decimals: 18, name: 'Aeon' },
  ETH:     { address: NATIVE_SENTINEL,                                           symbol: 'ETH',     decimals: 18, name: 'Ether (Native)' },
  WETH:    { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as `0x${string}`, symbol: 'WETH',    decimals: 18, name: 'Wrapped Ether' },
  USDG:    { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as `0x${string}`, symbol: 'USDG',    decimals: 6,  name: 'USDG' },
  // real, independently-deployed Virtuals Protocol token on Robinhood Chain (not
  // ours) — verified via Blockscout (582 holders) and cross-checked against its
  // own live WETH/VIRTUAL and USDG/VIRTUAL pools before wiring in a CL pool for it
  VIRTUAL: { address: '0xc6911796042b15d7Fa4F6CDe69e245DdCd3d9c31' as `0x${string}`, symbol: 'VIRTUAL', decimals: 18, name: 'Virtuals Protocol' },
  // real, independently-deployed token, already trading on a separate DEX on
  // this same chain (DexScreener: ~$21k liquidity, real volume) — added
  // 2026-07-05 at the user's request, with an AEON vAMM pool
  ROBINFUN: { address: '0x56A98Db16Cf501b686c14BA00a5DeC02E87083FA' as `0x${string}`, symbol: 'ROBINFUN', decimals: 18, name: 'Robinfun' },
  // real, independently-deployed token, already trading elsewhere on this
  // chain (verified via Blockscout: 8,333 holders, ~$88M/24h volume,
  // ~$0.106 price at the time these pools were created 2026-07-06) — added
  // at the user's request, with AEON/WETH/USDG vAMM pools
  CASHCAT: { address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4' as `0x${string}`, symbol: 'CASHCAT', decimals: 18, name: 'Cash Cat' },
} as const

// Migrated 2026-07-03: the genesis vAMM pools had no way to ever claim swap
// fees (AeonPoolRH.claimFees() didn't exist in that bytecode, so 100% of
// every swap fee sat compounding into LP value forever instead of flowing to
// voters). Replaced with 3 fresh pools whose fee accounting is a direct port
// of Aerodrome's real Pool.sol — same seed liquidity, same fee tiers, same
// token pairs, new addresses.
export const POOLS = [
  { name: 'AEON/ETH',     token0: 'AEON',    token1: 'WETH', type: 'vAMM', fee: '1%',   address: '0xD215650cb628113A64D938164Ee5CD72293F9ea6' as `0x${string}` },
  { name: 'AEON/USDG',    token0: 'AEON',    token1: 'USDG', type: 'vAMM', fee: '1%',   address: '0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288' as `0x${string}` },
  { name: 'ETH/USDG',     token0: 'WETH',    token1: 'USDG', type: 'vAMM', fee: '0.3%', address: '0x2732E1312e5Bba5729534E9d94D44c090b200F14' as `0x${string}` },
  // Added 2026-07-05 for parity with VIRTUAL's existing CL and DLMM pools —
  // deployed via the real AeonFactoryRH.createPool() (no PoolExists conflict,
  // unlike the fee-fix migration's pools, so its own on-chain registry stays
  // in sync for this one).
  { name: 'VIRTUAL/AEON', token0: 'VIRTUAL', token1: 'AEON', type: 'vAMM', fee: '1%',   address: '0x50bCeFB28502C8628Bc2564A0BFEB6D5D33EFA25' as `0x${string}` },
  // Added 2026-07-05 — small/dust-sized on purpose (deployer's AEON balance
  // was the binding constraint): 6.5 AEON against a price-matched ~1991
  // ROBINFUN, pegged to ROBINFUN's real price on its other DEX listing.
  { name: 'ROBINFUN/AEON', token0: 'ROBINFUN', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x6EE853608078a207A30836Eec6310974D4506c14' as `0x${string}` },
  // Added 2026-07-06 via AeonFactoryRH.createPool() at the user's request.
  // Deployed EMPTY on purpose -- deployer wallet held zero CASHCAT and only
  // dust WETH at deploy time, so there was nothing real to seed with yet.
  // These show 0 TVL/unswappable until liquidity is actually added.
  { name: 'CASHCAT/AEON', token0: 'CASHCAT', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x8323E657009aBBF1567A15294766203150908b10' as `0x${string}` },
  { name: 'CASHCAT/ETH',  token0: 'CASHCAT', token1: 'WETH', type: 'vAMM', fee: '1%', address: '0xAbC3DA2cc75387Caf867B07bC272DF19d3Cff02C' as `0x${string}` },
  { name: 'CASHCAT/USDG', token0: 'CASHCAT', token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xb55dadbFb20912466F2961cF466f331Fe98706F1' as `0x${string}` },
  // Added 2026-07-08 for parity with ROBINFUN/AEON. ROBINFUN/USDG seeded for
  // real (deployer's full remaining 303.11 ROBINFUN + 0.012669 USDG, pegged
  // to ROBINFUN/AEON's own real price). ROBINFUN/ETH deployed EMPTY --
  // deployer WETH balance was dust (~$0.0016), nothing meaningful to seed yet.
  { name: 'ROBINFUN/ETH',  token0: 'ROBINFUN', token1: 'WETH', type: 'vAMM', fee: '1%', address: '0x0B499B8c6BA886090ADd7C21f8e1810BDDD8277D' as `0x${string}` },
  { name: 'ROBINFUN/USDG', token0: 'ROBINFUN', token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xd4F8574d3bC25FE20195Ce58a47d61D79bA7504b' as `0x${string}` },
]

// Algebra Integral (algebra.finance) concentrated-liquidity pools — same 3
// genesis pairs as the vAMM pools above, deployed 2026-07-03 by forking the
// official cryptoalgebra/Algebra core+periphery+farming contracts.
export const ALGEBRA_CONTRACTS = {
  factory:                    '0x28A57A4000049cCb5a2F272DCb5483Bc692f304E' as `0x${string}`,
  poolDeployer:                '0x7B041a9133bce876434908b1438F2F1f187c215b' as `0x${string}`,
  nonfungiblePositionManager: '0x7eB725C9EA96dAB6bf0E734e8D7A54474eb713BB' as `0x${string}`,
  swapRouter:                  '0x2B440b6759d37CA4F5a21f190d2BfdBE4eb9B533' as `0x${string}`,
  quoterV2:                    '0x0fC2Ac0217FC9dF2577Be3519be07e6612775Eab' as `0x${string}`,
} as const

export const CL_POOLS = [
  { name: 'AEON/ETH',     token0: 'AEON', token1: 'WETH',    type: 'CL', fee: '0.25%', address: '0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e' as `0x${string}` },
  { name: 'AEON/USDG',    token0: 'AEON', token1: 'USDG',    type: 'CL', fee: '0.25%', address: '0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6' as `0x${string}` },
  { name: 'ETH/USDG',     token0: 'WETH', token1: 'USDG',    type: 'CL', fee: '0.25%', address: '0x96B5de75c08971f41DE6bde917fB0a8d0EB450F3' as `0x${string}` },
  { name: 'VIRTUAL/AEON', token0: 'VIRTUAL', token1: 'AEON', type: 'CL', fee: '0.25%', address: '0x280b2eb06B105944BB2f1378c861D604eb82Aa3d' as `0x${string}` },
]

export const CL_RANGE_PRESETS = [
  { key: 'narrow', label: 'Narrow',     desc: '±2.5%',   pctLow: -2.5,   pctHigh: 2.5    },
  { key: 'normal', label: 'Normal',     desc: '±5%',     pctLow: -5.0,   pctHigh: 5.0    },
  { key: 'wide',   label: 'Wide',       desc: '±10%',    pctLow: -10.0,  pctHigh: 10.0   },
  { key: 'full',   label: 'Full Range', desc: '0 → ∞',   pctLow: -99.9,  pctHigh: 99999  },
]

// Trader Joe / LFJ Liquidity Book (joe-v2, MIT-licensed — the same open-source
// engine Pharaoh Exchange's own DLMM on Avalanche is built on) — deployed to
// Robinhood Chain 2026-07-04 for the same 4 genesis-era pairs. token0/token1
// below match on-chain tokenX/tokenY exactly (LB doesn't sort by address).
export const DLMM_CONTRACTS = {
  factory: '0xd60Cf7876a1E7B8fcf963722A05039849fde5387' as `0x${string}`,
  router:  '0xFDdF3bb9e0f90881f9931104D97844f66b7E3873' as `0x${string}`,
  quoter:  '0x7757e07Ff0D82f03E65a7DD4da0150378Bd12806' as `0x${string}`,
} as const

// fee = real on-chain base fee (getStaticFeeParameters().baseFactor * binStep *
// 1e10, in 18-decimal fraction terms) — all 4 pools share baseFactor=5000, so
// fee = 5000 * binStep / 1e8. Verified directly against each pool on-chain
// (all read baseFactor=5000) rather than assumed.
export const DLMM_POOLS = [
  { name: 'AEON/ETH',     token0: 'AEON',    token1: 'WETH', type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x736d8E418673253b2CDE1ef3Df6205Fc9780816b' as `0x${string}` },
  { name: 'AEON/USDG',    token0: 'AEON',    token1: 'USDG', type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x8bCCec714f42eeb73954172C253F84f649599E3B' as `0x${string}` },
  { name: 'ETH/USDG',     token0: 'WETH',    token1: 'USDG', type: 'DLMM', binStep: 10, fee: '0.05%',  address: '0x6E3772afbef845Ef4a3aD23a6eEEf65776375bC6' as `0x${string}` },
  { name: 'VIRTUAL/AEON', token0: 'VIRTUAL', token1: 'AEON', type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xcC62C85794F652ee257cf00c87530fF860755892' as `0x${string}` },
]

// Real, independently-deployed Uniswap V2 pairs already live on Robinhood
// Chain (factory 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f, 898 total pairs
// chain-wide) -- not ours, but AeonUniversalRouter can route through them
// (poolType 3) alongside our own pools when they offer a better price.
// Added 2026-07-05: these 4 are deeper than AEON's own corresponding pools
// for the same tokens, confirmed via getReserves() before wiring in.
// Standard Uniswap V2 fee (0.3%, i.e. the fixed 997/1000 factor baked into
// every real UniV2-style pair).
export const UNISWAP_POOLS = [
  { name: 'WETH/USDG',     token0: 'WETH', token1: 'USDG',    type: 'UniV2', fee: '0.3%', address: '0x8803c117ccae7B5146297876c2A25DF135141C4d' as `0x${string}` },
  { name: 'WETH/VIRTUAL',  token0: 'WETH', token1: 'VIRTUAL', type: 'UniV2', fee: '0.3%', address: '0xd95e8e2Cd04c207625C6F23c974d365a5F3A91D3' as `0x${string}` },
  { name: 'USDG/VIRTUAL',  token0: 'USDG', token1: 'VIRTUAL', type: 'UniV2', fee: '0.3%', address: '0xee8D21C0E5AAA31269867Db4E3C66a90C3D5951D' as `0x${string}` },
  { name: 'WETH/ROBINFUN', token0: 'WETH', token1: 'ROBINFUN', type: 'UniV2', fee: '0.3%', address: '0xE53377eB912D08e1B0160E5Ea0c626CF162870fF' as `0x${string}` },
]

// Genesis + ongoing tokenomics — mirrors EmissionsEngineRH.sol / FeeDistributorV3.sol / BuybackEngineV3.sol
export const EPOCH_CONFIG = {
  epochLength:            604800,
  emissionRatio:           10,     // tokensToMint = feesUSD / emissionRatio / aeonPrice
  emissionVoterSplit:      95,     // of each mint: 95% to voters
  emissionFurnaceSplit:     5,     // of each mint: 5% to Furnace bonus
  feeVoterSplit:           80,     // of raw collected fees: 80% straight to voters
  feeBuybackSplit:         20,     // of raw collected fees: 20% to BuybackEngine
  buybackBurnSplit:        50,     // of that 20%: 50% swapped to AEON and burned
  buybackRedistributeSplit:50,     // of that 20%: 50% swapped to AEON and redistributed to Furnace burners
  genesisTotal:            '90000000000000000000000',  // 90,000 AEON
  genesisLpEach:           '20000000000000000000000',  // 20,000 AEON -> each of AEON/ETH, AEON/USDG
  genesisBurn:             '50000000000000000000000',  // 50,000 AEON -> burned, voted 25k/25k
  whitelistCostAEON:       '100000000000000000000',    // 100 AEON to unlock adding liquidity
}
