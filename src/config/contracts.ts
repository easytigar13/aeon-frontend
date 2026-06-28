// src/config/contracts.ts
// Replace REPLACE_AFTER_DEPLOY with real addresses after mainnet deploy

export const CONTRACTS = {
  AeonRouter:       '0xD847Ea61394ADa3bb23B373349b58C90f9126A9F' as `0x${string}`,
  AeonToken:        '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`,
  AeonVotingEscrow: '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A' as `0x${string}`,
  AeonVoter:        '0x05b04A4344520Bb08201Bd9460ec9d37aD5f7918' as `0x${string}`,
  TheFurnace:       '0x2f4cad5f25AcC8E8d18a77ACEc5E2832B6cFF104' as `0x${string}`,
  EmissionsEngine:  '0x4d188106175De919a971B0cB6F8A0e3E885a3410' as `0x${string}`,
  FeeDistributor:   '0x8e33182d3271e2902Ed36aCA77A79e28c8F22d4e' as `0x${string}`,
  BuybackEngine:    '0x0337333fdCf79D08f4ac10321796A91f300b5a80' as `0x${string}`,
  AeonFactory:      '0x3ECf287990A2365d48C6681620393aC1cdF3D268' as `0x${string}`,
  AeonOracle:       '0x0b18B0f483f1caAaBB7505bCD8D1C3C43197Add9' as `0x${string}`,
  AeonGaugeFactory:    '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6' as `0x${string}`,
  LiquidityHelper:     '0xFe307aA9b7514949Ee1a0F8a64E951d9277B62CA' as `0x${string}`,
} as const

export const TOKENS = {
  AEON:  { address: '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`, symbol: 'AEON',   decimals: 18, name: 'Aeon' },
  AVAX:  { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`, symbol: 'AVAX',  decimals: 18, name: 'Avalanche (Native)' },
  WAVAX: { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' as `0x${string}`, symbol: 'WAVAX',  decimals: 18, name: 'Wrapped AVAX' },
  USDC:  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as `0x${string}`, symbol: 'USDC',   decimals: 6,  name: 'USD Coin' },
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
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'vAMM', fee: '1%',    address: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'vAMM', fee: '1%',    address: '0xFD029a446632618f218189d4a0B572896CD29B58' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'vAMM', fee: '0.3%',  address: '0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086' as `0x${string}` },
  // CL
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'CL',   fee: '0.3%',  address: '0xd1C58E8B2E3d54FbFf443F34c67952c033aC77a6' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x29c818b0929F9D247157f7b17a49B89664C9efcE' as `0x${string}` },
  { name: 'AEON/WBTCE', token0: 'AEON', token1: 'WBTCE', type: 'CL',   fee: '0.3%',  address: '0x6658A37c6F1544129CfBA898F827c64680db00b6' as `0x${string}` },
  { name: 'AEON/WETHE', token0: 'AEON', token1: 'WETHE', type: 'CL',   fee: '0.3%',  address: '0xEF43D5718ec0e22e105e21b9292bE33a7daC5061' as `0x${string}` },
  { name: 'AEON/SPX',   token0: 'AEON', token1: 'SPX',   type: 'CL',   fee: '0.3%',  address: '0xabCE7E6160dF0B1E7a300FfA55AC26843A59710b' as `0x${string}` },
  { name: 'AEON/GUNZ',  token0: 'AEON', token1: 'GUNZ',  type: 'CL',   fee: '0.3%',  address: '0x98F41ef967fC9105d83E5a1B44512C25ae15E53E' as `0x${string}` },
  { name: 'AEON/ARENA', token0: 'AEON', token1: 'ARENA', type: 'CL',   fee: '0.3%',  address: '0x1C95905E0C7D290A46E1d970BeCD315BE10b3421' as `0x${string}` },
  { name: 'AEON/COQ',   token0: 'AEON', token1: 'COQ',   type: 'CL',   fee: '0.3%',  address: '0x69174eFdFAE19af3BfbC45e2dbdccfC1A44FdE9b' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'CL',   fee: '0.05%', address: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b' as `0x${string}` },
  { name: 'WAVAX/WETHE',token0: 'WAVAX',token1: 'WETHE', type: 'CL',   fee: '0.3%',  address: '0x4fAA1a9B62Be8465f33fB3c3ac767F6bc4e510DB' as `0x${string}` },
  { name: 'WAVAX/WBTCE',token0: 'WAVAX',token1: 'WBTCE', type: 'CL',   fee: '0.3%',  address: '0xE82347882508179DDED4e74BD4645fad0895e0E7' as `0x${string}` },
  { name: 'WAVAX/GUNZ', token0: 'WAVAX',token1: 'GUNZ',  type: 'CL',   fee: '0.3%',  address: '0x29dFab19335Bcc8E05811d5F9d047372A391DB9C' as `0x${string}` },
  { name: 'WAVAX/ARENA',token0: 'WAVAX',token1: 'ARENA', type: 'CL',   fee: '0.3%',  address: '0x1EdEE242F3F1Af2B9B330557816459988a75378b' as `0x${string}` },
  { name: 'WAVAX/COQ',  token0: 'WAVAX',token1: 'COQ',   type: 'CL',   fee: '0.3%',  address: '0x2b97cEC6A8B1D90732E2c5Fe17433E647cDe62Cc' as `0x${string}` },
  { name: 'WAVAX/SPX',  token0: 'WAVAX',token1: 'SPX',   type: 'CL',   fee: '0.3%',  address: '0x836Aeed458857E5Fd4134c7dAF7B36EE20B73DBc' as `0x${string}` },
  { name: 'WBTCE/USDC', token0: 'WBTCE',token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0xC84D3fb669b3b0369978E253dC2F1B7329F6D7eF' as `0x${string}` },
  { name: 'WETHE/USDC', token0: 'WETHE',token1: 'USDC',  type: 'CL',   fee: '0.05%', address: '0x306B89922bccea64545e701795Ffbf20FB5a0f70' as `0x${string}` },
  { name: 'GUNZ/USDC',  token0: 'GUNZ', token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd' as `0x${string}` },
  { name: 'ARENA/USDC', token0: 'ARENA',token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77' as `0x${string}` },
  { name: 'COQ/USDC',   token0: 'COQ',  token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0x19aE273606588fb17D99572321eAD9b0B060DF00' as `0x${string}` },
  { name: 'SPX/USDC',   token0: 'SPX',  token1: 'USDC',  type: 'CL',   fee: '0.3%',  address: '0xFb0b8D088691057fE08040f4364494c23B60c66C' as `0x${string}` },
  { name: 'USDC/WUSDT', token0: 'USDC', token1: 'WUSDT', type: 'CL',   fee: '0.01%', address: '0xB1a5295A8133097E389221df70Ee1dd021B088F0' as `0x${string}` },
  // DLMM
  { name: 'AEON/WAVAX', token0: 'AEON', token1: 'WAVAX', type: 'DLMM', fee: '1%',    binStep: 100, address: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON', token1: 'USDC',  type: 'DLMM', fee: '1%',    binStep: 100, address: '0xFD029a446632618f218189d4a0B572896CD29B58' as `0x${string}` },
  { name: 'AEON/WBTCE', token0: 'AEON', token1: 'WBTCE', type: 'DLMM', fee: '1%',    binStep: 100, address: '0xecB2EbB887cbbC810BA519906594185d8f1fc704' as `0x${string}` },
  { name: 'AEON/WETHE', token0: 'AEON', token1: 'WETHE', type: 'DLMM', fee: '1%',    binStep: 100, address: '0x954068b2289E2EdFA878f17C27b4ab1B015b77a7' as `0x${string}` },
  { name: 'AEON/SPX',   token0: 'AEON', token1: 'SPX',   type: 'DLMM', fee: '1%',    binStep: 100, address: '0x966fdDEBC8311Bb5a22c625129257213D54a6938' as `0x${string}` },
  { name: 'AEON/GUNZ',  token0: 'AEON', token1: 'GUNZ',  type: 'DLMM', fee: '1%',    binStep: 100, address: '0x45C0D4fffbe60fBC454F8dB0Eb2643aa139cb706' as `0x${string}` },
  { name: 'AEON/ARENA', token0: 'AEON', token1: 'ARENA', type: 'DLMM', fee: '1%',    binStep: 100, address: '0x978968E5f40f1b183959Ca8852718e22A6f3fcE7' as `0x${string}` },
  { name: 'AEON/COQ',   token0: 'AEON', token1: 'COQ',   type: 'DLMM', fee: '1%',    binStep: 100, address: '0x1d891FC5954D777ABbb95fadAC8D7dE880b9F49a' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX',token1: 'USDC',  type: 'DLMM', fee: '0.05%', binStep: 10,  address: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b' as `0x${string}` },
  { name: 'WAVAX/WETHE',token0: 'WAVAX',token1: 'WETHE', type: 'DLMM', fee: '0.3%',  binStep: 10,  address: '0x4fAA1a9B62Be8465f33fB3c3ac767F6bc4e510DB' as `0x${string}` },
  { name: 'WAVAX/WBTCE',token0: 'WAVAX',token1: 'WBTCE', type: 'DLMM', fee: '0.3%',  binStep: 10,  address: '0xE82347882508179DDED4e74BD4645fad0895e0E7' as `0x${string}` },
  { name: 'WAVAX/GUNZ', token0: 'WAVAX',token1: 'GUNZ',  type: 'DLMM', fee: '1%',    binStep: 100, address: '0x1E173e4d5811F27E72300a214DeeF4eFCB3B6be8' as `0x${string}` },
  { name: 'WAVAX/ARENA',token0: 'WAVAX',token1: 'ARENA', type: 'DLMM', fee: '1%',    binStep: 100, address: '0x27e4d2467584b7A370856BCedb1b7F460EF2462C' as `0x${string}` },
  { name: 'WAVAX/COQ',  token0: 'WAVAX',token1: 'COQ',   type: 'DLMM', fee: '1%',    binStep: 100, address: '0xddbcC56993a6D44b24Bd9AF0A27000419B0d9B4F' as `0x${string}` },
  { name: 'WAVAX/SPX',  token0: 'WAVAX',token1: 'SPX',   type: 'DLMM', fee: '1%',    binStep: 100, address: '0xaA35b2EA1deB790585f9fd11d1878Dc0606091a3' as `0x${string}` },
  { name: 'WBTCE/USDC', token0: 'WBTCE',token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0xd9AE01537e4099ECAD113B52856a86148A0E6548' as `0x${string}` },
  { name: 'WETHE/USDC', token0: 'WETHE',token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0xB39e555F18DEfc9D97fbFd08Fb4F88d784a44944' as `0x${string}` },
  { name: 'GUNZ/USDC',  token0: 'GUNZ', token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd' as `0x${string}` },
  { name: 'ARENA/USDC', token0: 'ARENA',token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77' as `0x${string}` },
  { name: 'COQ/USDC',   token0: 'COQ',  token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x19aE273606588fb17D99572321eAD9b0B060DF00' as `0x${string}` },
  { name: 'SPX/USDC',   token0: 'SPX',  token1: 'USDC',  type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0xFb0b8D088691057fE08040f4364494c23B60c66C' as `0x${string}` },
  { name: 'SPX/WAVAX',  token0: 'SPX',  token1: 'WAVAX', type: 'DLMM', fee: '0.3%',  binStep: 100, address: '0x836Aeed458857E5Fd4134c7dAF7B36EE20B73DBc' as `0x${string}` },
  { name: 'USDC/WUSDT', token0: 'USDC', token1: 'WUSDT', type: 'DLMM', fee: '0.01%', binStep: 1,   address: '0xB1a5295A8133097E389221df70Ee1dd021B088F0' as `0x${string}` },
  { name: 'WBTCB/WBTCE',token0: 'WBTCB',token1: 'WBTCE', type: 'DLMM', fee: '0.05%', binStep: 5,   address: '0xeDdBA3C2A4491D77e8d4b69502f7c862C538DC76' as `0x${string}` },
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