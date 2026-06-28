// src/config/contracts.ts
// Replace REPLACE_AFTER_DEPLOY with real addresses after mainnet deploy

export const CONTRACTS = {
  AeonToken:        '0x0000000000000000000000000000000000000001' as `0x${string}`,
  AeonVotingEscrow: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  AeonVoter:        '0x0000000000000000000000000000000000000003' as `0x${string}`,
  TheFurnace:       '0x0000000000000000000000000000000000000004' as `0x${string}`,
  EmissionsEngine:  '0x0000000000000000000000000000000000000005' as `0x${string}`,
  FeeDistributor:   '0x0000000000000000000000000000000000000006' as `0x${string}`,
  BuybackEngine:    '0x0000000000000000000000000000000000000007' as `0x${string}`,
  AeonFactory:      '0x0000000000000000000000000000000000000008' as `0x${string}`,
  AeonOracle:       '0x0000000000000000000000000000000000000009' as `0x${string}`,
  AeonGaugeFactory: '0x000000000000000000000000000000000000000a' as `0x${string}`,
} as const

export const TOKENS = {
  AEON:  { address: '0x0000000000000000000000000000000000000001' as `0x${string}`, symbol: 'AEON',   decimals: 18, name: 'Aeon' },
  AVAX:  { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`, symbol: 'AVAX',  decimals: 18, name: 'Avalanche (Native)' },
  WAVAX: { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' as `0x${string}`, symbol: 'WAVAX',  decimals: 18, name: 'Wrapped AVAX' },
  USDC:  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6' as `0x${string}`, symbol: 'USDC',   decimals: 6,  name: 'USD Coin' },
  WUSDT: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' as `0x${string}`, symbol: 'WUSDT',  decimals: 6,  name: 'Tether USD' },
  WBTCE: { address: '0x50b7545627a5162F82A992c33b87aDc75187B218' as `0x${string}`, symbol: 'WBTC.e', decimals: 8,  name: 'Wrapped Bitcoin' },
  WBTCB: { address: '0x152b9d0fdc40c096757f570a51e494bd4b943e50' as `0x${string}`, symbol: 'WBTC.b', decimals: 8,  name: 'Bitcoin (Native)' },
  WETHE: { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB' as `0x${string}`, symbol: 'WETH.e', decimals: 18, name: 'Wrapped Ether' },
  SPX:   { address: '0x3bB4445D30AC020a84c1b5A8A2C6248ebC9779D0' as `0x${string}`, symbol: 'SPX',    decimals: 8,  name: 'SPX6900' },
  GUNZ:  { address: '0x26deBD39D5eD069770406FCa10A0E4f8d2c743eB' as `0x${string}`, symbol: 'GUNZ',   decimals: 18, name: 'GUNZ' },
  ARENA: { address: '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C' as `0x${string}`, symbol: 'ARENA',  decimals: 18, name: 'Arena' },
  COQ:   { address: '0x420FcA0121DC28039145009570975747295f2329' as `0x${string}`, symbol: 'COQ',    decimals: 18, name: 'Coq Inu' },
} as const

export const POOLS = [
  // vAMM
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'vAMM', fee: '1%',    address: '0x0000000000000000000000000000000000001001' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'vAMM', fee: '1%',    address: '0x0000000000000000000000000000000000001002' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'vAMM', fee: '0.3%',  address: '0x0000000000000000000000000000000000001003' as `0x${string}` },
  // CL
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002001' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002002' as `0x${string}` },
  { name: 'AEON/WBTCE', token0: 'AEON', token1: 'WBTCE', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002003' as `0x${string}` },
  { name: 'AEON/WETHE', token0: 'AEON', token1: 'WETHE', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002004' as `0x${string}` },
  { name: 'AEON/SPX',   token0: 'AEON', token1: 'SPX',   type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002005' as `0x${string}` },
  { name: 'AEON/GUNZ',  token0: 'AEON', token1: 'GUNZ',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002006' as `0x${string}` },
  { name: 'AEON/ARENA', token0: 'AEON', token1: 'ARENA', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002007' as `0x${string}` },
  { name: 'AEON/COQ',   token0: 'AEON', token1: 'COQ',   type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002008' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'CL',   fee: '0.05%', address: '0x0000000000000000000000000000000000002009' as `0x${string}` },
  { name: 'WAVAX/WETHE',token0: 'WAVAX',token1: 'WETHE', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002010' as `0x${string}` },
  { name: 'WAVAX/WBTCE',token0: 'WAVAX',token1: 'WBTCE', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002011' as `0x${string}` },
  { name: 'WAVAX/GUNZ', token0: 'WAVAX',token1: 'GUNZ',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002012' as `0x${string}` },
  { name: 'WAVAX/ARENA',token0: 'WAVAX',token1: 'ARENA', type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002013' as `0x${string}` },
  { name: 'WAVAX/COQ',  token0: 'WAVAX',token1: 'COQ',   type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002014' as `0x${string}` },
  { name: 'WBTCE/USDC', token0: 'WBTCE',token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002015' as `0x${string}` },
  { name: 'WETHE/USDC', token0: 'WETHE',token1: 'USDC',  type: 'CL',   fee: '0.05%', address: '0x0000000000000000000000000000000000002016' as `0x${string}` },
  { name: 'GUNZ/USDC',  token0: 'GUNZ', token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002017' as `0x${string}` },
  { name: 'ARENA/USDC', token0: 'ARENA',token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002018' as `0x${string}` },
  { name: 'COQ/USDC',   token0: 'COQ',  token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x0000000000000000000000000000000000002019' as `0x${string}` },
  { name: 'USDC/WUSDT', token0: 'USDC', token1: 'WUSDT', type: 'CL',   fee: '0.01%', address: '0x0000000000000000000000000000000000002020' as `0x${string}` },
  { name: 'AVAX/WAVAX', token0: 'AVAX', token1: 'WAVAX', type: 'CL',   fee: '0.05%', address: '0x0000000000000000000000000000000000002021' as `0x${string}` },
  // DLMM
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'DLMM', fee: '1%',    binStep: 100, address: '0x0000000000000000000000000000000000003001' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'DLMM', fee: '1%',    binStep: 100, address: '0x0000000000000000000000000000000000003002' as `0x${string}` },
  { name: 'AEON/WBTCE', token0: 'AEON', token1: 'WBTCE', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003003' as `0x${string}` },
  { name: 'AEON/WETHE', token0: 'AEON', token1: 'WETHE', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003004' as `0x${string}` },
  { name: 'AEON/SPX',   token0: 'AEON', token1: 'SPX',   type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003005' as `0x${string}` },
  { name: 'AEON/GUNZ',  token0: 'AEON', token1: 'GUNZ',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003006' as `0x${string}` },
  { name: 'AEON/ARENA', token0: 'AEON', token1: 'ARENA', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003007' as `0x${string}` },
  { name: 'AEON/COQ',   token0: 'AEON', token1: 'COQ',   type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003008' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'DLMM', fee: '0.05%', binStep: 10,  address: '0x0000000000000000000000000000000000003009' as `0x${string}` },
  { name: 'WAVAX/WETHE',token0: 'WAVAX',token1: 'WETHE', type: 'DLMM', fee: '0.3%',  binStep: 10,  address: '0x0000000000000000000000000000000000003010' as `0x${string}` },
  { name: 'WAVAX/WBTCE',token0: 'WAVAX',token1: 'WBTCE', type: 'DLMM', fee: '0.3%',  binStep: 10,  address: '0x0000000000000000000000000000000000003011' as `0x${string}` },
  { name: 'WAVAX/GUNZ', token0: 'WAVAX',token1: 'GUNZ',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003012' as `0x${string}` },
  { name: 'WAVAX/ARENA',token0: 'WAVAX',token1: 'ARENA', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003013' as `0x${string}` },
  { name: 'WAVAX/COQ',  token0: 'WAVAX',token1: 'COQ',   type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003014' as `0x${string}` },
  { name: 'WBTCE/USDC', token0: 'WBTCE',token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x0000000000000000000000000000000000003015' as `0x${string}` },
  { name: 'WETHE/USDC', token0: 'WETHE',token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x0000000000000000000000000000000000003016' as `0x${string}` },
  { name: 'GUNZ/USDC',  token0: 'GUNZ', token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003017' as `0x${string}` },
  { name: 'ARENA/USDC', token0: 'ARENA',token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003018' as `0x${string}` },
  { name: 'COQ/USDC',   token0: 'COQ',  token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003019' as `0x${string}` },
  { name: 'USDC/WUSDT', token0: 'USDC', token1: 'WUSDT', type: 'DLMM', fee: '0.01%', binStep: 1,   address: '0x0000000000000000000000000000000000003020' as `0x${string}` },
  { name: 'WBTCB/WBTCE',token0: 'WBTCB',token1: 'WBTCE', type: 'DLMM', fee: '0.05%', binStep: 5,   address: '0x0000000000000000000000000000000000003021' as `0x${string}` },
  { name: 'SPX/USDC',   token0: 'SPX',  token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003022' as `0x${string}` },
  { name: 'SPX/WAVAX',  token0: 'SPX',  token1: 'WAVAX', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x0000000000000000000000000000000000003023' as `0x${string}` },
  { name: 'AVAX/WAVAX', token0: 'AVAX', token1: 'WAVAX', type: 'DLMM', fee: '0.05%', binStep: 1,   address: '0x0000000000000000000000000000000000003024' as `0x${string}` },
]

export const CL_RANGE_PRESETS = [
  { key: 'narrow', label: 'Narrow',     desc: '±2.5%',   pctLow: -2.5,   pctHigh: 2.5    },
  { key: 'normal', label: 'Normal',     desc: '±5%',     pctLow: -5.0,   pctHigh: 5.0    },
  { key: 'wide',   label: 'Wide',       desc: '±10%',    pctLow: -10.0,  pctHigh: 10.0   },
  { key: 'full',   label: 'Full Range', desc: '0 → ∞',   pctLow: -99.9,  pctHigh: 99999  },
]

export const EPOCH_CONFIG = {
  epochLength:         604800,
  bootstrapEpochs:     2,
  bootstrapAmount:     '250000000000000000000',
  emissionRatio:       10,
  feeVoterSplit:       95,
  feeBuybackSplit:     5,
  emissionVoterSplit:  95,
  emissionFurnaceSplit:5,
  minStakeUSD:         '5000000000000000000',
  poolCreationFeeUSD:  '500000000000000000000',
}

export const CHAIN_ID = 43114