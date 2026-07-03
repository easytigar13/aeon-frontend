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
  LiquidityHelper:     '0x8e33182d3271e2902Ed36aCA77A79e28c8F22d4e' as `0x${string}`,
  Whitelist:           '0x0337333fdCf79D08f4ac10321796A91f300b5a80' as `0x${string}`,
} as const

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
} as const

// Migrated 2026-07-03: the genesis vAMM pools had no way to ever claim swap
// fees (AeonPoolRH.claimFees() didn't exist in that bytecode, so 100% of
// every swap fee sat compounding into LP value forever instead of flowing to
// voters). Replaced with 3 fresh pools whose fee accounting is a direct port
// of Aerodrome's real Pool.sol — same seed liquidity, same fee tiers, same
// token pairs, new addresses.
export const POOLS = [
  { name: 'AEON/ETH',  token0: 'AEON', token1: 'WETH', type: 'vAMM', fee: '1%',   address: '0xD215650cb628113A64D938164Ee5CD72293F9ea6' as `0x${string}` },
  { name: 'AEON/USDG', token0: 'AEON', token1: 'USDG', type: 'vAMM', fee: '1%',   address: '0x38be0a822326D51fdF37a9b44Cb6dcA49A59E288' as `0x${string}` },
  { name: 'ETH/USDG',  token0: 'WETH', token1: 'USDG', type: 'vAMM', fee: '0.3%', address: '0x2732E1312e5Bba5729534E9d94D44c090b200F14' as `0x${string}` },
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
