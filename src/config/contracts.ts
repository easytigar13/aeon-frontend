// src/config/contracts.ts
// AEON Protocol on Robinhood Chain (chain id 4663) — deployed 2026-07-02.
// Fresh deployment: no v1/v2 legacy state, no CL/DLMM pools yet (vAMM only
// at genesis; Algebra CL pools for the same pairs are planned as a follow-up).

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
  AEON:  { address: CONTRACTS.AeonToken,                                       symbol: 'AEON', decimals: 18, name: 'Aeon' },
  ETH:   { address: NATIVE_SENTINEL,                                           symbol: 'ETH',  decimals: 18, name: 'Ether (Native)' },
  WETH:  { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as `0x${string}`, symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
  USDG:  { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as `0x${string}`, symbol: 'USDG', decimals: 6,  name: 'USDG' },
} as const

// vAMM only at genesis. CL pools for the same pairs are planned as a
// follow-up once Algebra Integral is deployed to Robinhood Chain.
export const POOLS = [
  { name: 'AEON/ETH',  token0: 'AEON', token1: 'WETH', type: 'vAMM', fee: '1%',   address: '0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3' as `0x${string}` },
  { name: 'AEON/USDG', token0: 'AEON', token1: 'USDG', type: 'vAMM', fee: '1%',   address: '0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434' as `0x${string}` },
  { name: 'ETH/USDG',  token0: 'WETH', token1: 'USDG', type: 'vAMM', fee: '0.3%', address: '0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2' as `0x${string}` },
]

export const CL_RANGE_PRESETS = [
  { key: 'narrow', label: 'Narrow',     desc: '±2.5%',   pctLow: -2.5,   pctHigh: 2.5    },
  { key: 'normal', label: 'Normal',     desc: '±5%',     pctLow: -5.0,   pctHigh: 5.0    },
  { key: 'wide',   label: 'Wide',       desc: '±10%',    pctLow: -10.0,  pctHigh: 10.0   },
  { key: 'full',   label: 'Full Range', desc: '0 → ∞',   pctLow: -99.9,  pctHigh: 99999  },
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
