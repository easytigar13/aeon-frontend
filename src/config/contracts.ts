// src/config/contracts.ts
// Replace REPLACE_AFTER_DEPLOY with real addresses after mainnet deploy

export const CONTRACTS = {
  AeonRouter:       '0xD847Ea61394ADa3bb23B373349b58C90f9126A9F' as `0x${string}`,
  // AEON v1 — still the token actually held/traded by all existing AMM pools below.
  // Kept as TOKENS.AEON. Do not repoint pool trading logic to v2.
  AeonToken:        '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`,
  AeonFactory:      '0x3ECf287990A2365d48C6681620393aC1cdF3D268' as `0x${string}`,
  AeonOracle:       '0x0b18B0f483f1caAaBB7505bCD8D1C3C43197Add9' as `0x${string}`,
  LiquidityHelper:     '0xFe307aA9b7514949Ee1a0F8a64E951d9277B62CA' as `0x${string}`,
  PairRegistry:        '0xcfcb643d8f51d640e0b81257340c1ca344238f48' as `0x${string}`,
  // AEON v2 stack — deployed 2026-07-02. v1's mint role was permanently
  // dead-ended (EmissionsEngine had no path to reassign AeonToken.emissionsEngine,
  // and v1's AeonVoter.createGauge() only ever produced fake, codeless gauge
  // addresses — see AeonVoterV2.sol / EmissionsEngineV2.sol audit notes).
  // Governance/emissions now run on v2; existing pools still trade v1 AEON.
  AeonTokenV2:         '0x4173e412b85164Bb592668ce674627752934868B' as `0x${string}`,
  AeonSwap:            '0x2A85a6634c2EFaA33e441d3C28B6aaDc72A70376' as `0x${string}`, // 1:1 v1→v2 migration
  AeonVotingEscrow:    '0xd2252ce511DdC0D44A5Aa333e6b729bE8192C040' as `0x${string}`,
  TheFurnace:          '0x7863970e4888D1cFC7C3fB5A7E6C9e301cc5085C' as `0x${string}`,
  AeonVoter:           '0x001Af1382370c42c730BF9eed0beD450B07db89a' as `0x${string}`,
  BuybackEngine:       '0x8538C90eE4008FB11376714d75C5517CB529E536' as `0x${string}`,
  FeeDistributor:      '0x5F0DCd63a350b4347A13195B95FB5556b7557122' as `0x${string}`,
  AeonGaugeFactory:    '0x84fF0cCBc41cfA1Bdd8384A958aF272cC9EA74Bb' as `0x${string}`,
  EmissionsEngine:     '0xE42c5602f0E38524E94c765639E65aB9a2f10FB3' as `0x${string}`,
  // Trader Joe LB v2.2 — deployed 2026-06-30 to Avalanche C-Chain
  LBFactory:           '0xDa37277dE28547BfCE9431281560B60Cea00B1Af' as `0x${string}`,
  LBRouter:            '0x93B1754B48Fdb8C0519975B01cD5c35957066Ab9' as `0x${string}`,
  LBQuoter:            '0x1dfe97A9555d09F08ae72c96a18702a232221e8C' as `0x${string}`,
  // Algebra Integral — CL position manager deployed to Avalanche C-Chain
  AlgebraPositionManager: '0xe35ff3f8F55Af4E79FbFc19250fFf405c95Da910' as `0x${string}`,
} as const

// Orphaned v1 governance contracts — read-only, kept only so users can see
// legacy state (old burns, old votes) that isn't recognized by the v2 stack.
// Burned tokens are permanently gone regardless (sent to 0xdead) — this is
// just for visibility, not recovery.
export const LEGACY_V1 = {
  TheFurnace: '0x2f4cad5f25AcC8E8d18a77ACEc5E2832B6cFF104' as `0x${string}`,
  AeonVoter:  '0x05b04a4344520bb08201bd9460ec9d37ad5f7918' as `0x${string}`,
} as const

// Real AeonGauge contracts deployed by the old (v1) AeonGaugeFactory
// (0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6). These were never registered
// on any Voter's gauges mapping — orphaned, but fully functional: LP tokens
// staked into them via deposit() are real ERC20 transfers and are still
// sitting there right now. withdraw()/getReward() both still work.
// pool: the underlying trading pool this gauge tracks (for labeling only).
export const LEGACY_GAUGES = [
  { gauge: '0xd1E04ab9CE0A6854914Cd9c929B401bdf0700bE3' as `0x${string}`, pool: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489' as `0x${string}` },
  { gauge: '0x69072b04Cf3eEE09b474D9ab9F80aA17506EE434' as `0x${string}`, pool: '0xd1C58E8B2E3d54FbFf443F34c67952c033aC77a6' as `0x${string}` },
  { gauge: '0x955bEEee93D334437c1FE284c40Ab28eaCbE1cA2' as `0x${string}`, pool: '0xFD029a446632618f218189d4a0B572896CD29B58' as `0x${string}` },
  { gauge: '0x50bCefB28502C8628bc2564A0bFEb6d5D33eFa25' as `0x${string}`, pool: '0x29c818b0929F9D247157f7b17a49B89664C9efcE' as `0x${string}` },
  { gauge: '0x6ee853608078A207A30836Eec6310974D4506c14' as `0x${string}`, pool: '0x6658A37c6F1544129CfBA898F827c64680db00b6' as `0x${string}` },
  { gauge: '0x8323e657009aBbf1567A15294766203150908B10' as `0x${string}`, pool: '0xEF43D5718ec0e22e105e21b9292bE33a7daC5061' as `0x${string}` },
  { gauge: '0xAbc3Da2cC75387cAf867B07bC272Df19D3cff02c' as `0x${string}`, pool: '0xabce7E6160dF0B1e7A300FfA55Ac26843a59710B' as `0x${string}` },
  { gauge: '0xB55daDbFB20912466f2961cF466f331fE98706f1' as `0x${string}`, pool: '0x98F41ef967fC9105d83E5a1B44512C25ae15E53E' as `0x${string}` },
  { gauge: '0x0b499B8c6BA886090aDD7c21F8e1810BDdd8277d' as `0x${string}`, pool: '0x1C95905E0C7D290A46E1d970BeCD315BE10b3421' as `0x${string}` },
  { gauge: '0xd4F8574d3bC25fE20195Ce58a47D61D79Ba7504b' as `0x${string}`, pool: '0x69174eFdFAE19af3BfbC45e2dbdccfC1A44FdE9b' as `0x${string}` },
  { gauge: '0x35bd4B5D17192649098aeC846C790178A84a982B' as `0x${string}`, pool: '0xEcb2EBb887cbBC810Ba519906594185D8F1fc704' as `0x${string}` },
  { gauge: '0xdF769bF01ee70e2F86adC0417e0717d32C4586Be' as `0x${string}`, pool: '0x954068b2289e2Edfa878F17c27b4Ab1B015B77a7' as `0x${string}` },
  { gauge: '0x2F8cBa007598CBb15FFAbe7A826A9Cc8576eD6bE' as `0x${string}`, pool: '0x966FDDeBc8311bB5A22C625129257213d54A6938' as `0x${string}` },
  { gauge: '0x90D97BC8991E6d32a5CF3C6e5684644194699A70' as `0x${string}`, pool: '0x45c0d4FfFBE60FBc454f8Db0Eb2643aA139cB706' as `0x${string}` },
  { gauge: '0x9ccB02D4d9994993f1D7b95298A93230e042B7e5' as `0x${string}`, pool: '0x978968E5F40f1B183959cA8852718E22a6f3fCE7' as `0x${string}` },
  { gauge: '0x312541E5eF7017f9Ad27C10ea695eDc9529bA3D4' as `0x${string}`, pool: '0x1d891fC5954D777abbb95FaDac8D7de880B9F49a' as `0x${string}` },
  { gauge: '0x932f5AC813465D6573b4649528DA593f213Aea81' as `0x${string}`, pool: '0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086' as `0x${string}` },
  { gauge: '0x021033c66B9De3D11a3D7C5807C4B4A4fE05958b' as `0x${string}`, pool: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b' as `0x${string}` },
  { gauge: '0x12C2C9dc225cDCadd17B8bA9a3cFfB0183fA05dB' as `0x${string}`, pool: '0x4fAA1a9B62Be8465f33fB3c3ac767F6bc4e510DB' as `0x${string}` },
  { gauge: '0xBb5e8a475fCF427aA5aB2627ace5AC58943D8bB6' as `0x${string}`, pool: '0xE82347882508179DDED4e74BD4645fad0895e0E7' as `0x${string}` },
  { gauge: '0xfbCF062cF9C6683Da16dE58f6646965B7520647F' as `0x${string}`, pool: '0x29dFab19335Bcc8E05811d5F9d047372A391DB9C' as `0x${string}` },
  { gauge: '0x7eBA4a5cF347Cc14436c4FbE7635018a4E8c5E05' as `0x${string}`, pool: '0x1EdEE242F3F1Af2B9B330557816459988a75378b' as `0x${string}` },
  { gauge: '0x20da4403CF7294B78F1b60f9E23174BdcFe693cE' as `0x${string}`, pool: '0x2b97cEC6A8B1D90732E2c5Fe17433E647cDe62Cc' as `0x${string}` },
  { gauge: '0x887fAA05836C92FBD0081Ae7F249a893FDbC33aD' as `0x${string}`, pool: '0x836AeEd458857e5FD4134c7DaF7B36ee20B73dbC' as `0x${string}` },
  { gauge: '0x3f3e49dA26a8534c58b0D63d71511bC0EAD5A16d' as `0x${string}`, pool: '0x1e173e4d5811f27E72300A214DEeF4EFcB3B6be8' as `0x${string}` },
  { gauge: '0xF6D8Bbf7299253a67a729Ad245Dcad32a6125Bdd' as `0x${string}`, pool: '0x27e4D2467584B7a370856BceDb1B7f460ef2462c' as `0x${string}` },
  { gauge: '0xc79A7CE8Eb6ddc52E651D5877d4659A88732De6f' as `0x${string}`, pool: '0xDdBcc56993A6d44b24bD9Af0a27000419b0d9b4f' as `0x${string}` },
  { gauge: '0x0Ce5229Db7ef9DA94Da95359E0fDf828bf16142c' as `0x${string}`, pool: '0xAa35B2eA1DEb790585f9fd11d1878dc0606091a3' as `0x${string}` },
  { gauge: '0xA95d34E3f0a3a768fDf5199e9505496B11E855D0' as `0x${string}`, pool: '0xC84D3fb669b3b0369978E253dC2F1B7329F6D7eF' as `0x${string}` },
  { gauge: '0x204Ed15c9Eb0Cc4a1BF80FbeFc8D43c01327E070' as `0x${string}`, pool: '0xD9ae01537e4099eCad113B52856A86148A0E6548' as `0x${string}` },
  { gauge: '0x433627F321A4596E50c4B0Edb29568438fea2Be9' as `0x${string}`, pool: '0x306B89922bccea64545e701795Ffbf20FB5a0f70' as `0x${string}` },
  { gauge: '0xEB97d2414269e9952544cb1DdCc7EB488a8746D2' as `0x${string}`, pool: '0xb39e555f18DEfC9d97FBfd08fB4f88D784A44944' as `0x${string}` },
  { gauge: '0xb24B32A0A16adEf2E857C0a30cc1D3608880869d' as `0x${string}`, pool: '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd' as `0x${string}` },
  { gauge: '0x016DA438386b7e114A9A086B5F67049c08cbfD1a' as `0x${string}`, pool: '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77' as `0x${string}` },
  { gauge: '0xbB9c311313d61A687B4744f42cD8C31b0C0f9128' as `0x${string}`, pool: '0x19aE273606588fb17D99572321eAD9b0B060DF00' as `0x${string}` },
  { gauge: '0xD5704702dbf6C92F8b1a4B8D8F7Db1aE3415503f' as `0x${string}`, pool: '0xFb0b8D088691057Fe08040F4364494C23b60C66c' as `0x${string}` },
  { gauge: '0x5f85Ec0bc2943C2402d1EEa76982796F958ecAcD' as `0x${string}`, pool: '0xB1a5295A8133097E389221df70Ee1dd021B088F0' as `0x${string}` },
  { gauge: '0x78c11CF0a088e26b0013b5c780b22E90A21171fB' as `0x${string}`, pool: '0xeDDBA3c2A4491D77E8D4b69502f7C862c538DC76' as `0x${string}` },
  { gauge: '0x48871611388C136Eeb5C777d58470eE837cCb43A' as `0x${string}`, pool: '0x04de9ee7b6355ec643db415b2212734390fcb2f8' as `0x${string}` },
  { gauge: '0x8f66195845A9fff978e85F024C3220507D9e6094' as `0x${string}`, pool: '0xeb55b531c1881751d6c83ce343ee3870a3ed6cb3' as `0x${string}` },
  { gauge: '0x0b20720D1A0C27E31ADf368E5B8Eba1aFf541107' as `0x${string}`, pool: '0x56889e4e8c9c1eaf7a91f436c32a1a9fdfcacb0e' as `0x${string}` },
  { gauge: '0xae513E42584c4Bce4c3a9D0d14b8E819FE7462BA' as `0x${string}`, pool: '0x0D94e9bD42cBDdEeF6804B9813Da82A42617cC01' as `0x${string}` },
  { gauge: '0x898115c029fCaE28b1B0963A8936F0e000aF05c3' as `0x${string}`, pool: '0x10235223CBa1939Eb5DeE67a08CF1c065BC17A6e' as `0x${string}` },
  { gauge: '0xADcc48e44Da5B50E550A44D4c0965AbD68eB9123' as `0x${string}`, pool: '0xeaC2c4B5b9a1169C7e46a44ED6A5E4836bA3bB95' as `0x${string}` },
] as const

// Static fallback for the "Legacy staked LP" section on /migrate — the live
// multicall-based fetch proved unreliable for at least one real user despite
// repeated fixes (chunking, error surfacing), so known positions found via
// direct on-chain audit (eth_call against each gauge) are hardcoded here as
// a guaranteed-to-render source. Amounts are a snapshot as of the audit date
// noted per wallet — if some/all have already been unstaked since, the
// withdraw() call simply reverts (safe, no funds at risk either way).
export const KNOWN_LEGACY_POSITIONS: Record<string, { gauge: `0x${string}`; pool: `0x${string}`; amount: bigint; asOf: string }[]> = {
  '0x6d93ab5743ad9fad6ff3c33e3ae60755b8913a08': [
    { gauge: '0xd1E04ab9CE0A6854914Cd9c929B401bdf0700bE3', pool: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489', amount: 4077415133827889083n, asOf: '2026-07-02' }, // AEON/WAVAX vAMM
    { gauge: '0x69072b04Cf3eEE09b474D9ab9F80aA17506EE434', pool: '0xd1C58E8B2E3d54FbFf443F34c67952c033aC77a6', amount: 8086804645743487n,    asOf: '2026-07-02' }, // AEON/WAVAX legacy CL
    { gauge: '0x955bEEee93D334437c1FE284c40Ab28eaCbE1cA2', pool: '0xFD029a446632618f218189d4a0B572896CD29B58', amount: 45558778797002n,       asOf: '2026-07-02' }, // AEON/USDC vAMM
    { gauge: '0x021033c66B9De3D11a3D7C5807C4B4A4fE05958b', pool: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b', amount: 259939609296n,          asOf: '2026-07-02' }, // WAVAX/USDC legacy CL
    { gauge: '0xfbCF062cF9C6683Da16dE58f6646965B7520647F', pool: '0x29dFab19335Bcc8E05811d5F9d047372A391DB9C', amount: 9643046043652388405n, asOf: '2026-07-02' }, // WAVAX/GUNZ legacy CL
    { gauge: '0xb24B32A0A16adEf2E857C0a30cc1D3608880869d', pool: '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd', amount: 236672820576268n,       asOf: '2026-07-02' }, // GUNZ/USDC legacy CL
    { gauge: '0x0b20720D1A0C27E31ADf368E5B8Eba1aFf541107', pool: '0x56889e4e8c9c1eaf7a91f436c32a1a9fdfcacb0e', amount: 34985711369071801825n, asOf: '2026-07-02' }, // AEON/SPX6900 legacy CL
  ],
}

export const TOKENS = {
  AEON:  { address: '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`, symbol: 'AEON',   decimals: 18, name: 'Aeon' },
  AVAX:  { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`, symbol: 'AVAX',  decimals: 18, name: 'Avalanche (Native)' },
  WAVAX: { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' as `0x${string}`, symbol: 'WAVAX',  decimals: 18, name: 'Wrapped AVAX' },
  USDC:  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as `0x${string}`, symbol: 'USDC',   decimals: 6,  name: 'USD Coin' },
  WUSDT: { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7' as `0x${string}`, symbol: 'WUSDT',  decimals: 6,  name: 'Tether USD' },
  WBTCE: { address: '0x50b7545627a5162F82A992c33b87aDc75187B218' as `0x${string}`, symbol: 'WBTC.e', decimals: 8,  name: 'Wrapped Bitcoin' },
  WBTCB: { address: '0x152b9d0fdc40c096757f570a51e494bd4b943e50' as `0x${string}`, symbol: 'WBTC.b', decimals: 8,  name: 'Bitcoin (Native)' },
  WETHE: { address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB' as `0x${string}`, symbol: 'WETH.e', decimals: 18, name: 'Wrapped Ether' },
  SPX:   { address: '0x6F911b6B39Bcc665A463129c94B5380A4387b7eb' as `0x${string}`, symbol: 'SPX6900', decimals: 18, name: 'SPX6900' },
  GUNZ:  { address: '0x26deBD39D5eD069770406FCa10A0E4f8d2c743eB' as `0x${string}`, symbol: 'GUNZ',   decimals: 18, name: 'GUNZ' },
  ARENA: { address: '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C' as `0x${string}`, symbol: 'ARENA',  decimals: 18, name: 'Arena' },
  COQ:   { address: '0x420FcA0121DC28039145009570975747295f2329' as `0x${string}`, symbol: 'COQ',    decimals: 18, name: 'Coq Inu' },
} as const

export const POOLS = [
  // vAMM — token0/token1 verified on-chain
  { name: 'AEON/WAVAX', token0: 'WAVAX', token1: 'AEON', type: 'vAMM', fee: '1%',    address: '0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'USDC',  token1: 'AEON', type: 'vAMM', fee: '1%',    address: '0xFD029a446632618f218189d4a0B572896CD29B58' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX', token1: 'USDC', type: 'vAMM', fee: '0.3%',  address: '0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086' as `0x${string}` },
  // Previously untracked vAMM pool — found via legacy gauge audit (governor held 474 LP staked here)
  { name: 'ARENA/AEON', token0: 'ARENA', token1: 'AEON', type: 'vAMM', fee: '1%',    address: '0x978968e5F40f1B183959cA8852718E22a6f3fCE7' as `0x${string}` },
  // CL — Algebra Integral pools deployed 2026-07-01, token0/token1 is actual on-chain ordering
  { name: 'AEON/WAVAX',  token0: 'AEON',  token1: 'WAVAX', type: 'CL', fee: '0.25%', address: '0x141ebD42bdFB433d6038f109C9ec3215B50DECA0' as `0x${string}` },
  { name: 'AEON/USDC',   token0: 'AEON',  token1: 'USDC',  type: 'CL', fee: '0.25%', address: '0x4919Fa49f2678AfFDB8E6F6d79B37F00eEdaBB9E' as `0x${string}` },
  { name: 'AEON/WBTCE',  token0: 'AEON',  token1: 'WBTCE', type: 'CL', fee: '0.25%', address: '0x793d52b1aA39B99780498D0DfC3a4c16E866Cf1F' as `0x${string}` },
  { name: 'AEON/WETHE',  token0: 'AEON',  token1: 'WETHE', type: 'CL', fee: '0.25%', address: '0xfB91EeC408fe053e0bc21D40C0481dd948ac8176' as `0x${string}` },
  { name: 'AEON/GUNZ',   token0: 'AEON',  token1: 'GUNZ',  type: 'CL', fee: '0.25%', address: '0xE7F3F20a930076CC9593263CE7395821490394A9' as `0x${string}` },
  { name: 'AEON/ARENA',  token0: 'AEON',  token1: 'ARENA', type: 'CL', fee: '0.25%', address: '0x4A969d19ba450847256a9C46fD2107fA9c30251f' as `0x${string}` },
  { name: 'AEON/COQ',    token0: 'AEON',  token1: 'COQ',   type: 'CL', fee: '0.25%', address: '0x0bfB3cAb947b042ebB67e2F908f25dfe0903B9FA' as `0x${string}` },
  { name: 'AEON/WBTCB',  token0: 'AEON',  token1: 'WBTCB', type: 'CL', fee: '0.25%', address: '0xd5d166fF75c0040b22d10F3C7552ef3BDf1b4b72' as `0x${string}` },
  { name: 'AEON/SPX6900',token0: 'AEON',  token1: 'SPX',   type: 'CL', fee: '0.25%', address: '0x5c8C45B87Ed8cE4eA9efF3df5f9Be461daEf9711' as `0x${string}` },
  { name: 'WAVAX/USDC',  token0: 'USDC',  token1: 'WAVAX', type: 'CL', fee: '0.25%', address: '0xdA9Ec34217a7FbA3099f1a0D6471089D9C969C5C' as `0x${string}` },
  { name: 'WAVAX/WETHE', token0: 'WAVAX', token1: 'WETHE', type: 'CL', fee: '0.25%', address: '0x70EB6bc48bEdd1780C617A53a2473D954D658120' as `0x${string}` },
  { name: 'WAVAX/WBTCE', token0: 'WAVAX', token1: 'WBTCE', type: 'CL', fee: '0.25%', address: '0x3a2dC7DAc3f46B6C70A76D48c391187B32d32970' as `0x${string}` },
  { name: 'WAVAX/GUNZ',  token0: 'GUNZ',  token1: 'WAVAX', type: 'CL', fee: '0.25%', address: '0x605bF42f228Ca4A8277D6C487ff2e145104Fe357' as `0x${string}` },
  { name: 'WAVAX/ARENA', token0: 'ARENA', token1: 'WAVAX', type: 'CL', fee: '0.25%', address: '0x6bC9FF1569F073b05422abeee18dAd4559a4FBDe' as `0x${string}` },
  { name: 'WAVAX/COQ',   token0: 'COQ',   token1: 'WAVAX', type: 'CL', fee: '0.25%', address: '0x59397b073dc2AF3293E86aa09450B4B3820587C4' as `0x${string}` },
  { name: 'WAVAX/WBTCB', token0: 'WAVAX', token1: 'WBTCB', type: 'CL', fee: '0.25%', address: '0x22AB413D078ec54E6491b4ec71Bb786CF57663C9' as `0x${string}` },
  { name: 'WBTCE/USDC',  token0: 'USDC',  token1: 'WBTCE', type: 'CL', fee: '0.25%', address: '0x3EffEA68D7F585241D0c51B9736a12F01a68e5D0' as `0x${string}` },
  { name: 'WETHE/USDC',  token0: 'USDC',  token1: 'WETHE', type: 'CL', fee: '0.25%', address: '0x5dbbB7f9E977475935Cbf47f618d0Eb52938C340' as `0x${string}` },
  { name: 'GUNZ/USDC',   token0: 'GUNZ',  token1: 'USDC',  type: 'CL', fee: '0.25%', address: '0xb660a29575CFF72b1Cf90B7Ce23ed47cBB7be1f3' as `0x${string}` },
  { name: 'ARENA/USDC',  token0: 'ARENA', token1: 'USDC',  type: 'CL', fee: '0.25%', address: '0x9AA84ca69AAa1c4F04aa119aeee322faC9080b49' as `0x${string}` },
  { name: 'COQ/USDC',    token0: 'COQ',   token1: 'USDC',  type: 'CL', fee: '0.25%', address: '0x5C1745446F342Cec648e4D884074FB91b3F7f803' as `0x${string}` },
  { name: 'USDC/WUSDT',  token0: 'USDC',  token1: 'WUSDT', type: 'CL', fee: '0.25%', address: '0xc96c5B6A11A2e6707d36c5f889FaA99627f46853' as `0x${string}` },
  { name: 'WBTCB/WBTCE', token0: 'WBTCB', token1: 'WBTCE', type: 'CL', fee: '0.25%', address: '0x939831edAC3C89584Ea07Bf145a91265aaE5F5AC' as `0x${string}` },
  // Full Range CL pools — original Algebra vAMM-style full-range pools, kept alongside the concentrated ones so LPs can still unstake/withdraw or provide full-range liquidity.
  { name: 'AEON/WAVAX (Full Range)', token0: 'WAVAX', token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0xd1C58E8B2E3d54FbFf443F34c67952c033aC77a6' as `0x${string}` },
  { name: 'AEON/USDC (Full Range)',  token0: 'USDC',  token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x29c818b0929F9D247157f7b17a49B89664C9efcE' as `0x${string}` },
  { name: 'AEON/WBTCE (Full Range)', token0: 'WBTCE', token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x6658A37c6F1544129CfBA898F827c64680db00b6' as `0x${string}` },
  { name: 'AEON/WETHE (Full Range)', token0: 'WETHE', token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0xEF43D5718ec0e22e105e21b9292bE33a7daC5061' as `0x${string}` },
  { name: 'AEON/GUNZ (Full Range)',  token0: 'GUNZ',  token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x98F41ef967fC9105d83E5a1B44512C25ae15E53E' as `0x${string}` },
  { name: 'AEON/ARENA (Full Range)', token0: 'ARENA', token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x1C95905E0C7D290A46E1d970BeCD315BE10b3421' as `0x${string}` },
  { name: 'AEON/COQ (Full Range)',   token0: 'COQ',   token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x69174eFdFAE19af3BfbC45e2dbdccfC1A44FdE9b' as `0x${string}` },
  { name: 'WAVAX/USDC (Full Range)', token0: 'WAVAX', token1: 'USDC', type: 'CL',   fee: '0.05%', address: '0x5205f2D5BF9957335eF847E59F799Bc0a801B01b' as `0x${string}` },
  { name: 'WAVAX/WETHE (Full Range)',token0: 'WETHE', token1: 'WAVAX',type: 'CL',   fee: '0.3%',  address: '0x4fAA1a9B62Be8465f33fB3c3ac767F6bc4e510DB' as `0x${string}` },
  { name: 'WAVAX/WBTCE (Full Range)',token0: 'WBTCE', token1: 'WAVAX',type: 'CL',   fee: '0.3%',  address: '0xE82347882508179DDED4e74BD4645fad0895e0E7' as `0x${string}` },
  { name: 'WAVAX/GUNZ (Full Range)', token0: 'GUNZ',  token1: 'WAVAX',type: 'CL',   fee: '0.3%',  address: '0x29dFab19335Bcc8E05811d5F9d047372A391DB9C' as `0x${string}` },
  { name: 'WAVAX/ARENA (Full Range)',token0: 'WAVAX', token1: 'ARENA',type: 'CL',   fee: '0.3%',  address: '0x1EdEE242F3F1Af2B9B330557816459988a75378b' as `0x${string}` },
  { name: 'WAVAX/COQ (Full Range)',  token0: 'COQ',   token1: 'WAVAX',type: 'CL',   fee: '0.3%',  address: '0x2b97cEC6A8B1D90732E2c5Fe17433E647cDe62Cc' as `0x${string}` },
  { name: 'WBTCE/USDC (Full Range)', token0: 'WBTCE', token1: 'USDC', type: 'CL',   fee: '0.3%',  address: '0xC84D3fb669b3b0369978E253dC2F1B7329F6D7eF' as `0x${string}` },
  { name: 'WETHE/USDC (Full Range)', token0: 'WETHE', token1: 'USDC', type: 'CL',   fee: '0.05%', address: '0x306B89922bccea64545e701795Ffbf20FB5a0f70' as `0x${string}` },
  { name: 'GUNZ/USDC (Full Range)',  token0: 'GUNZ',  token1: 'USDC', type: 'CL',   fee: '0.3%',  address: '0x1cf8d65A13D7cA3a793a8E6bb28aA5Ae90ea14Dd' as `0x${string}` },
  { name: 'ARENA/USDC (Full Range)', token0: 'ARENA', token1: 'USDC', type: 'CL',   fee: '0.3%',  address: '0xBf9F67B3dA5F27035DCEff232b0b31F08CfB2a77' as `0x${string}` },
  { name: 'COQ/USDC (Full Range)',   token0: 'COQ',   token1: 'USDC', type: 'CL',   fee: '0.3%',  address: '0x19aE273606588fb17D99572321eAD9b0B060DF00' as `0x${string}` },
  { name: 'USDC/WUSDT (Full Range)', token0: 'WUSDT', token1: 'USDC', type: 'CL',   fee: '0.01%', address: '0xB1a5295A8133097E389221df70Ee1dd021B088F0' as `0x${string}` },
  { name: 'AEON/WBTCB (Full Range)',  token0: 'WBTCB', token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x04de9ee7b6355ec643db415b2212734390fcb2f8' as `0x${string}` },
  { name: 'WAVAX/WBTCB (Full Range)', token0: 'WBTCB', token1: 'WAVAX',type: 'CL',   fee: '0.3%',  address: '0xeb55b531c1881751d6c83ce343ee3870a3ed6cb3' as `0x${string}` },
  { name: 'AEON/SPX6900 (Full Range)', token0: 'SPX',  token1: 'AEON', type: 'CL',   fee: '0.3%',  address: '0x56889e4e8c9c1eaf7a91f436c32a1a9fdfcacb0e' as `0x${string}` },
  // DLMM — real Trader Joe LB v2.2 pairs deployed 2026-06-30
  // tokenX is the "priced" asset, tokenY is the quote (LB ordering)
  // binStep is actual LB binStep (basis points per bin)
  { name: 'AEON/WAVAX', token0: 'AEON',  token1: 'WAVAX', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xbA292A7bB1F27A9F37aF0d29a633A574249a0Ceb' as `0x${string}` },
  { name: 'AEON/USDC',  token0: 'AEON',  token1: 'USDC',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xdCc749323Ebc82fa73BC40d76598D8cEbb42ff28' as `0x${string}` },
  { name: 'AEON/WBTCE', token0: 'AEON',  token1: 'WBTCE', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x39b6f6AE9345938CCAe6B7627e6e8DCc97272C49' as `0x${string}` },
  { name: 'AEON/WETHE', token0: 'AEON',  token1: 'WETHE', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xc304E547991502a13a93f95431bF81d68738F9b2' as `0x${string}` },
  { name: 'AEON/GUNZ',  token0: 'AEON',  token1: 'GUNZ',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xD3CFAAe7CfA5B909Ef4572B6f50aBb2a8affC7a1' as `0x${string}` },
  { name: 'AEON/ARENA', token0: 'AEON',  token1: 'ARENA', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x9f992b3C9F1108956DAF7Fef26740A99647a52cb' as `0x${string}` },
  { name: 'AEON/COQ',   token0: 'AEON',  token1: 'COQ',   type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x75d2Cb746c484451a913bF1D7Afb25528aB095c6' as `0x${string}` },
  { name: 'AEON/WBTCB', token0: 'AEON',  token1: 'WBTCB', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x8426379EdB14b7be2395AdB3eFc6662A70e7dBC0' as `0x${string}` },
  { name: 'AEON/SPX6900',token0: 'AEON', token1: 'SPX',   type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x55099A2307FE072cdbE5050d725133BfB3f86b93' as `0x${string}` },
  { name: 'WAVAX/USDC', token0: 'WAVAX', token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0xdf9C7DAA6278c4026865dFf438261c92dfE82dF4' as `0x${string}` },
  { name: 'WAVAX/WETHE',token0: 'WAVAX', token1: 'WETHE', type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x8074bfC5758A93cAC70b8ED9Be242c152D6Da3f5' as `0x${string}` },
  { name: 'WAVAX/WBTCE',token0: 'WAVAX', token1: 'WBTCE', type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x84a1C69D376CD4861DBD6201b0145DaD1D9A85F1' as `0x${string}` },
  { name: 'WAVAX/GUNZ', token0: 'WAVAX', token1: 'GUNZ',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x35970292c5bd867C717E3185554738609BDED102' as `0x${string}` },
  { name: 'WAVAX/ARENA',token0: 'WAVAX', token1: 'ARENA', type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x4B4dC6A027189FfC1D9bF976D146bcB5697EeC37' as `0x${string}` },
  { name: 'WAVAX/COQ',  token0: 'WAVAX', token1: 'COQ',   type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x3D5FAeaCFEC59d031DDd3Ae9b6DB25Bdade7eb7E' as `0x${string}` },
  { name: 'WAVAX/WBTCB',token0: 'WAVAX', token1: 'WBTCB', type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x4FC4895D801a7Cae8403686b5AC2E5D17d70279c' as `0x${string}` },
  { name: 'WBTCE/USDC', token0: 'WBTCE', token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0x3BdAa6d818dA6B55D1496E918b24CF43623f298A' as `0x${string}` },
  { name: 'WETHE/USDC', token0: 'WETHE', token1: 'USDC',  type: 'DLMM', fee: '0.1%',  binStep: 10,  address: '0xd384f78f376C4927b91946E9D9Ef009eaCfA0dce' as `0x${string}` },
  { name: 'GUNZ/USDC',  token0: 'GUNZ',  token1: 'USDC',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xAd6F3ee4A6D05f3EB5BD958467DA9f5665FB0C01' as `0x${string}` },
  { name: 'ARENA/USDC', token0: 'ARENA', token1: 'USDC',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0x3859f8487231d955F7f1498f186FB3086a674AE4' as `0x${string}` },
  { name: 'COQ/USDC',   token0: 'COQ',   token1: 'USDC',  type: 'DLMM', fee: '0.25%', binStep: 25,  address: '0xbCbAb0aB380C1c222D63b12E1f7bF17e7B881fCC' as `0x${string}` },
  { name: 'USDC/WUSDT', token0: 'WUSDT', token1: 'USDC',  type: 'DLMM', fee: '0.05%', binStep: 5,   address: '0x54DF1C2B3487f7738Dbc448Dd7838497d93Bc4dd' as `0x${string}` },
  { name: 'WBTCB/WBTCE',token0: 'WBTCB', token1: 'WBTCE', type: 'DLMM', fee: '0.05%', binStep: 5,   address: '0x62E1208D1FF4333Af4621Fd93101696DC23bB685' as `0x${string}` },
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