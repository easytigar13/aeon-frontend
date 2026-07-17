// src/config/contracts.ts
// AEON Protocol on Robinhood Chain (chain id 4663) — deployed 2026-07-02.
// vAMM pools at genesis, plus a forked Algebra Integral (algebra.finance)
// concentrated-liquidity deployment for the same 3 pairs, added 2026-07-03.

export const CHAIN_ID = 4663

// Cut over 2026-07-16: the AeonVoterV3 furnace-double-count-vote fix (see
// aeon-protocol-v5/MIGRATION_V3_CHECKLIST.md) is now the LIVE voter --
// AeonVotingEscrow.voter and MinterProxy both point at the new stack
// (CONTRACTS.AeonVoter/EmissionsEngine/FeeDistributor/BuybackEngine below).
// LEGACY_AEON_VOTER is the pre-cutover voter, kept only so the Earn page's
// Old/New gauge toggle can still show LPs who haven't moved yet where their
// stake is -- unstake from LEGACY_AEON_VOTER's gauges, restake into the
// (now live, now emitting) new ones under CONTRACTS.AeonVoter.
export const LEGACY_AEON_VOTER = '0x2f4cad5f25AcC8E8d18a77ACEc5E2832B6cFF104' as `0x${string}`

// Cutover happened MID-epoch (2026-07-16, epoch boundary 2026-07-16 00:00
// UTC, closes ~2026-07-23) -- the real fees collected during that epoch
// (~700 AEON as of cutover) are sitting in the OLD FeeDistributor, tagged to
// an epoch whose vote weights live entirely on LEGACY_AEON_VOTER. That
// contract doesn't depend on the voter/engine cutover at all (pure
// wall-clock epoch math, immutable reference to the old voter's still-intact
// storage) -- the money becomes claimable normally once the epoch closes,
// just through the OLD FeeDistributor, not the new one. Needed so the vote
// page can still show/claim it instead of it going unclaimed forever.
export const LEGACY_FEE_DISTRIBUTOR = '0x772C2Ba92278D47B3A76b3f97b26A5c74d7F7975' as `0x${string}`

export const CONTRACTS = {
  AeonToken:           '0xd4c93eD1843606f92CccA078941f3d52A585982f' as `0x${string}`,
  MinterProxy:         '0x05b04A4344520Bb08201Bd9460ec9d37aD5f7918' as `0x${string}`,
  AeonVotingEscrow:    '0x0b18B0f483f1caAaBB7505bCD8D1C3C43197Add9' as `0x${string}`,
  TheFurnace:          '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A' as `0x${string}`,
  // AeonVoterV3 -- fixes the furnace multi-veNFT double-count exploit
  // (furnacePowerUsed[epoch][owner] tracking). Live since 2026-07-16 cutover.
  AeonVoter:           '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb' as `0x${string}`,
  AeonGaugeFactory:    '0x985c715e810C17a68C4E9C8f4a097772E394E2BF' as `0x${string}`,
  // BuybackEngineV3 (redeployed) -- routes the Furnace-holder redistribute
  // share through ProtocolBurnRewardDistributorV2, which redirects the
  // genesis-burn account's (permanently unclaimable) share to the dev
  // wallet instead of letting it accumulate forever with no claimant.
  BuybackEngine:       '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4' as `0x${string}`,
  ProtocolBurnRewardDistributor: '0xE14119e92c991e242AFfB80f0c0cf12F4a67AA29' as `0x${string}`,
  // FeeDistributorV4 -- claimFees()/claimAllFees() now take an explicit
  // tokenId (checked against real ownership) instead of silently resolving
  // to whichever veNFT a wallet most recently voted with, which made every
  // other owned veNFT's fee share permanently unclaimable for multi-NFT
  // wallets.
  FeeDistributor:      '0x40524d597e9e241b5B7C76D1b2e570A77933D412' as `0x${string}`,
  // Multi-gauge engine/controller activated 2026-07-13. Existing vAMM
  // gauges remain on AeonVoter; the controller directly funds the existing
  // CL/DLMM gauges without migrating pools, NFTs, bins, or staked positions.
  // Superseded 2026-07-13 by VoteDirectedLpEmissionsEngineRH (see below) --
  // kept only as a comment for history, not read anywhere in the frontend.
  // Old: '0xbF021C27F317b7e8B23d47B9063c5551D8527986'
  // Then: '0xf999ac0Cc5D7FeA6aDB28f905A6b1e71066f2241' (confirmed live via
  // MinterProxy.logic() before the 2026-07-16 cutover).
  //
  // VoteDirectedLpEmissionsEngineRH (current instance) -- each completed
  // epoch mints AEON worth exactly 25% of that epoch's finalized USD fees
  // (feeDistributor.lastEpochFeesUSD()) -- no rolling average, no previous-
  // mint growth cap, and no Furnace mint at all (TO_FURNACE_BPS=0;
  // updatePeriod() never calls the Furnace notifier). 100% of every mint
  // goes to vote-directed LP gauges. Furnace burners still earn ongoing
  // rewards through BuybackEngineV3's redistribute share (10% of raw
  // trading fees, unrelated to this emissions-engine swap) -- see
  // EPOCH_CONFIG.buybackRedistributeSplit below.
  EmissionsEngine:     '0xd3163F5390F1A5326671DeD6EC38D8b8E2eA96e6' as `0x${string}`,
  MultiGaugeController:'0x63f61916cDAABa76556723A75EE3690deCA9bd9A' as `0x${string}`,
  AeonOracle:          '0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD' as `0x${string}`,
  ConstantUsdFeed:     '0x182e8039659F8110D47a87BEad1FAAaEf981781d' as `0x${string}`,
  // Old factory (2026-07-02 genesis deploy) has an AeonPoolRH baked into its
  // createPool() bytecode from before fee accounting (poolFees/claimFees)
  // existed -- confirmed via those calls reverting with no matching
  // selector on all 9 pools it's ever created. Real third-party LP is
  // staked in at least 2 of those pools' gauges, so migrating them isn't
  // something to do without those users' own action -- left fully
  // functional (swap/add/remove all still work), just kept for READS
  // (existing-pool lookups, useAllPools discovery of its already-created
  // pools) rather than new pool creation.
  AeonFactory:         '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6' as `0x${string}`,
  // Deployed 2026-07-09: fresh factory using the current AeonPoolRH (real
  // fee accounting from pool #1) -- verified via fork test before
  // deploying (poolFees() resolves to a real, nonzero companion contract).
  // Create Pool now targets THIS factory exclusively, so every
  // permissionlessly-created pool going forward has working fee routing
  // to voters, without touching any existing pool or its LPs.
  AeonFactoryV2:       '0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC' as `0x${string}`,
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
  // Redeployed 2026-07-08: real users hit "UniswapV2: K" reverts routing
  // through ROBINFUN -- ROBINFUN taxes 1% on transfers touching its own
  // official Uniswap pair, so the router's off-chain-quoted amountOut
  // (computed from the full pre-tax amountIn) asked that pair for more
  // than it actually received, tripping the pair's own K-check. Separately,
  // a real (non-dust) split route -- AEON/USDG (78%) + AEON->VIRTUAL->USDG
  // (22%) -- failed the same way pre-sign, so the fix is general: every
  // intermediate hop now re-measures this router's actual received balance
  // instead of trusting the previous hop's theoretical reported amountOut,
  // covering tax tokens and any other quote/settlement mismatch, not just
  // the one already-observed case.
  UniversalRouter:     '0x63af965c901230667d3ff8e0a9dc0959563f5aa2' as `0x${string}`,
  // Wraps native ETH and executes UniversalRouter routes atomically. Cycles
  // unwrap back to ETH; cross-settlement routes deliver AEON/USDG directly.
  NativeArbExecutor:   '0x871fa5908dcd02df2993056666b324cd6078e6b1' as `0x${string}`,
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
  // Deployed 2026-07-11: token launchpad V1, at the user's request. Anyone
  // could create a new ERC-20 + seed an Aeon vAMM pool for it in one tx, then
  // route the LP to themselves, burn it, or lock it in AeonLPLocker until a
  // chosen date. Superseded by V2 below the same day, after the user asked
  // for every launch's LP to be permanently staked in a real gauge instead --
  // left here (not deleted) since one real launch went through it and its
  // pool/token are still live and swappable. AeonLPLocker is V1-only; V2 has
  // no lock/burn/creator choice at all, so it's never used going forward.
  AeonLPLocker:        '0xE42c5602f0E38524E94c765639E65aB9a2f10FB3' as `0x${string}`,
  AeonTokenLaunchpad:  '0xf456538039755c855068AC2e2f3DB48a974DA33e' as `0x${string}`,
  // V2 -- every launch is an AeonLaunchTaxToken (see
  // aeon-protocol-v5/src/launchpad/AeonLaunchpadSuiteV2.sol): a fixed,
  // non-optional 0.025% transfer tax that auto-swaps to AEON and burns on
  // every transfer, no toggle. LP always ends up permanently staked in a
  // real AeonVoterV2 gauge -- no creator/burn/lock choice anymore, no
  // withdraw function anywhere in the contract. Quote asset is ETH/WETH or
  // AEON, creator's choice. Launch fee is a % of quote liquidity,
  // owner-adjustable, hard-capped on-chain at 5%, currently 0, paid to the
  // dev wallet.
  //
  // Gauge creation can't happen atomically in the launch transaction --
  // AeonVoterV2.createGauge() requires a direct governor-signed call for any
  // brand-new pool, confirmed by reading its verified source (no bypass for
  // a calling contract, by design -- a real security boundary on the core
  // voting contract, not something to route around). Instead:
  // keeper/launchpad-keeper.js in aeon-protocol-v5 watches for new launches
  // and does that governor step (registerPool + createGauge) automatically
  // shortly after each one, then calls the permissionless stakeLaunch() to
  // finish. Until that runs for a given launch, its pool exists and is
  // swappable, but shows no gauge/stake yet.
  //
  // Fork-tested before deploying (10 tests): the full keeper flow end to
  // end (launch -> governor creates gauge -> permissionless stake -> LP
  // balance confirmed in the real gauge), stakeLaunch rejecting a
  // not-yet-created gauge and rejecting a second call, the harvest-and-burn
  // sweep (real AEON burned to DEAD, nothing left sitting in the
  // contract), permissionless harvest callable by a random address, exact
  // 5%-fee-to-dev-wallet routing, and zero-supply rejection.
  AeonTokenLaunchpadV2: '0x06825A8969593b83cCcC793f82463e892Fb7641e' as `0x${string}`,
} as const

// Deployed 2026-07-05: CL/DLMM staking gauges, keyed by pool address.
// Upgraded in place on 2026-07-13: their governor roles now point to the
// MultiGaugeController above, which supplies automatic vote-weighted AEON
// emissions. Pools, CL NFTs, DLMM bins, and existing stakes were not moved.
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
  // Added 2026-07-09 -- one Algebra CL pool per remaining vAMM pair. The
  // factory's createPool(address,address) selector doesn't exist on this
  // deployment -- the real signature is createPool(address,address,bytes),
  // found by grepping the factory bytecode for candidate selectors after
  // POOLS_ADMINISTRATOR_ROLE (also required, granted via grantRole) still
  // didn't fix the original empty-revert. Each pool then needed a separate
  // initialize(uint160 sqrtPriceX96) call -- createPool alone leaves it
  // unlocked=false. sqrtPriceX96 computed from each pair's live vAMM price.
  '0xC4A0B77a4a09eE7ECff12CC6504BFA9BB8c62C3B': '0xf4b4dd6caf39a73425a2db017a368936c3f44904', // CL ROBINFUN/AEON
  '0xbCD1Bf0d9F25503DDfEd0b663827811637B27B80': '0x93ba36bff83b08f2da9e3b44a6d0d074d9901630', // CL CASHCAT/AEON
  '0x9ebd1C556967d8e3f6f1C043D57eb7762047D60D': '0x7c9dcac9aebd8bc7144f0bcc4d3dcbb5570cbc8d', // CL CASHCAT/USDG
  '0x09e729D9e077EB1Ad10aDccDE4D18C143035fe04': '0x269b01b00dc427a8b118ae768cd17e72b105ed4d', // CL CASHCAT/ETH
  '0x14E266508d68107509487DE6Ead5ded5764C5F20': '0x87e27373bee17f043553b60b9321518d0b50a083', // CL CASHCAT/ROBINFUN
  '0xC6b5b34133E290e5c28B19844970cee783DD9b40': '0x424cfb459b83ed272e0df87e95c8fbcd19af263f', // CL ROBINFUN/ETH
  '0xBb6aA9914f53afb8e7C89Bf05D4DD2525aF4E4ce': '0x05581a779096183bc15387f81a784ab22d40abfe', // CL ROBINFUN/USDG
}
export const DLMM_GAUGES: Record<string, `0x${string}`> = {
  '0x736d8E418673253b2CDE1ef3Df6205Fc9780816b': '0xe3c3457d17f7a63b6f1af36274be141af97e3ac2', // DLMM AEON/ETH
  '0x8bCCec714f42eeb73954172C253F84f649599E3B': '0x71f4b4d6ef39bf0f666cd8c37636502800edda52', // DLMM AEON/USDG
  '0x6E3772afbef845Ef4a3aD23a6eEEf65776375bC6': '0x0ccf1f26e820f8045424877821e2e6412f4f4abc', // DLMM ETH/USDG
  '0xcC62C85794F652ee257cf00c87530fF860755892': '0xf5b1f8c09de36fb508dc8f3669a76eed4be4db87', // DLMM VIRTUAL/AEON
  // Added 2026-07-09 -- one DLMM pool per remaining vAMM pair, matching
  // binStep=25 (same tier as 3 of the 4 original DLMM pools). ROBINFUN had
  // to be added to the LBFactory's quote-asset whitelist first (addQuoteAsset)
  // since it wasn't whitelisted -- CASHCAT/ROBINFUN and ROBINFUN/ETH both
  // use ROBINFUN as the Y (quote) token and reverted with a custom error
  // until that was done.
  '0xfD32dBb36B7873cCd9a1547AFf8341240Ebd1904': '0xdb429b7d0b2a7ba559516ecfd5f2fa0c929f3f3f', // DLMM ROBINFUN/AEON
  '0x754EDCcEdd8F27A6ba7874052760f42e801be172': '0x300a922965096a0e68d37e1b43e847f6f2513c89', // DLMM CASHCAT/AEON
  '0xBEe641E8d7EAe49Cae27832dBf33dFd9F4AACb17': '0x1091edc081d1bb24d21605187192ecf9a20dcfd6', // DLMM CASHCAT/USDG
  '0xaF6cd582516C69BD2FDE8803f277b64D6d0A1247': '0x75d5847299af61637845400cf5d45ea5230552b1', // DLMM CASHCAT/ETH
  '0x513768a47297f8ab6e843c853f60d0dd360ec4c1': '0xd950fbe6ef8d258cd9d6492d8764e34c56d88296', // DLMM CASHCAT/ROBINFUN
  '0x6a035f314de5ac12383a9698b000dbd7ee7c71db': '0x7544808e18dafc0195e3619eecab5030666a7f87', // DLMM ROBINFUN/ETH
  '0xA41bf62FbD1EeDa210C65F7fE2B82B4f71bF819F': '0x60f1e81ddb461754eca6a89afeed230a792c321d', // DLMM ROBINFUN/USDG
}

// Native ETH sentinel — convention used across the app for "the chain's
// native gas token" wherever an ERC20 address is expected.
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as `0x${string}`

export const TOKENS = {
  AEON:    { address: CONTRACTS.AeonToken,                                       symbol: 'AEON',    decimals: 18, name: 'Aeon' },
  ETH:     { address: NATIVE_SENTINEL,                                           symbol: 'ETH',     decimals: 18, name: 'Ether (Native)' },
  // name fields below match each token's real on-chain name() exactly
  // (verified via cast 2026-07-08) -- WETH's real name is "WETH" itself,
  // not the generic "Wrapped Ether"; USDG's real name is "Global Dollar".
  WETH:    { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as `0x${string}`, symbol: 'WETH',    decimals: 18, name: 'WETH' },
  USDG:    { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as `0x${string}`, symbol: 'USDG',    decimals: 6,  name: 'Global Dollar' },
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
  // Active Robinhood Chain token, verified on-chain: name "The Index",
  // symbol "Index", 18 decimals. Routed through canonical Uniswap V3 and
  // executor-certified Uniswap V4 pools; it is never used as a settlement asset.
  INDEX: { address: '0x56910D4409F3a0C78C64DD8D0545FF0705389870' as `0x${string}`, symbol: 'INDEX', decimals: 18, name: 'The Index' },
  // Curated external routing tokens. These are intermediate assets only:
  // profitable cycles must still settle back into AEON, USDG, or WETH.
  TENDIES: { address: '0x45242320DBB855EeA8Fd36804C6487E10E97FCF9' as `0x${string}`, symbol: 'TENDIES', decimals: 18, name: 'TENDIES' },
  MARIAN: { address: '0x01637b14B7378B99dE75A64d50656d98488D9a4d' as `0x${string}`, symbol: 'MARIAN', decimals: 18, name: 'Lady Marian' },
  VEX: { address: '0x8Ff92566f2e81BDd68EDfAa8cde73942A723796b' as `0x${string}`, symbol: 'VEX', decimals: 18, name: 'ProjectVex' },
  JUGGERNAUT: { address: '0xD7321801CAae694090694Ff55A9323139F043B88' as `0x${string}`, symbol: 'JUGGERNAUT', decimals: 18, name: 'The Juggernaut' },
  // real, independently-deployed token (verified via Blockscout: 93 holders,
  // no price/volume data yet elsewhere on this chain) — added 2026-07-08 at
  // the user's request, with an AEON vAMM pool
  SLEEP: { address: '0x84864dbA3e1dFffcaf3d39c44f12833897Cf5B06' as `0x${string}`, symbol: 'SLEEP', decimals: 18, name: "Don't Sleep" },
  // real, independently-deployed token (verified via Blockscout: 106 holders;
  // DexScreener: real Uniswap V3 SHERWOOD/WETH pair on this chain, ~$13K
  // liquidity, ~$75K/24h volume) — added 2026-07-10 at the user's request,
  // with an AEON vAMM pool
  SHERWOOD: { address: '0xB3b78ca800C5327a21F03f0636d9A08A103787fD' as `0x${string}`, symbol: 'SHERWOOD', decimals: 18, name: 'Sherwood Online' },
  // real, independently-deployed token (verified on-chain directly:
  // name()/symbol()/decimals() resolve to "HOODIE"/"HOODIE"/18, totalSupply
  // 100,000,000,000) — added 2026-07-11 at the user's request, AEON-only
  // (no USDG pair, unlike the Robinhood stock tokens)
  HOODIE: { address: '0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3' as `0x${string}`, symbol: 'HOODIE', decimals: 18, name: 'HOODIE' },
  // real, independently-deployed token -- verified on-chain directly: real
  // name() is "RobinhoodTrumpGMEShrekNokia4663Doge" (18 decimals, 1B supply),
  // symbol() is "NASDAQ" -- clearly a meme/joke token riding on the NASDAQ
  // name, not an official listing. Added 2026-07-11 at the user's explicit
  // request after flagging this, AEON-only.
  NASDAQ: { address: '0x2E897ABb6BF1d77c61eB3fa6c093ae71DE0Efd2D' as `0x${string}`, symbol: 'NASDAQ', decimals: 18, name: 'RobinhoodTrumpGMEShrekNokia4663Doge' },
  // Robinhood's own official tokenized stocks, per
  // https://docs.robinhood.com/chain/contracts -- all 20 addresses verified
  // directly on-chain (name()/symbol()/decimals() all resolve, matching the
  // docs page exactly) before wiring in, added 2026-07-10 at the user's
  // request, each with AEON and USDG vAMM pools.
  AAPL:  { address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' as `0x${string}`, symbol: 'AAPL',  decimals: 18, name: 'Apple — Robinhood Token' },
  AMD:   { address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC' as `0x${string}`, symbol: 'AMD',   decimals: 18, name: 'AMD — Robinhood Token' },
  AMZN:  { address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54' as `0x${string}`, symbol: 'AMZN',  decimals: 18, name: 'Amazon — Robinhood Token' },
  BABA:  { address: '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4' as `0x${string}`, symbol: 'BABA',  decimals: 18, name: 'Alibaba — Robinhood Token' },
  BE:    { address: '0x822CC93fFD030293E9842c30BBD678F530701867' as `0x${string}`, symbol: 'BE',    decimals: 18, name: 'Bloom Energy — Robinhood Token' },
  COIN:  { address: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b' as `0x${string}`, symbol: 'COIN',  decimals: 18, name: 'Coinbase — Robinhood Token' },
  CRCL:  { address: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5' as `0x${string}`, symbol: 'CRCL',  decimals: 18, name: 'Circle Internet Group — Robinhood Token' },
  CRWV:  { address: '0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3' as `0x${string}`, symbol: 'CRWV',  decimals: 18, name: 'CoreWeave — Robinhood Token' },
  GOOGL: { address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3' as `0x${string}`, symbol: 'GOOGL', decimals: 18, name: 'Alphabet Class A — Robinhood Token' },
  INTC:  { address: '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681' as `0x${string}`, symbol: 'INTC',  decimals: 18, name: 'Intel — Robinhood Token' },
  META:  { address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35' as `0x${string}`, symbol: 'META',  decimals: 18, name: 'Meta Platforms — Robinhood Token' },
  MSFT:  { address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74' as `0x${string}`, symbol: 'MSFT',  decimals: 18, name: 'Microsoft — Robinhood Token' },
  MU:    { address: '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD' as `0x${string}`, symbol: 'MU',    decimals: 18, name: 'Micron Technology — Robinhood Token' },
  NVDA:  { address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC' as `0x${string}`, symbol: 'NVDA',  decimals: 18, name: 'NVIDIA — Robinhood Token' },
  ORCL:  { address: '0xb0992820E760d836549ba69BC7598b4af75dEE03' as `0x${string}`, symbol: 'ORCL',  decimals: 18, name: 'Oracle — Robinhood Token' },
  PLTR:  { address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A' as `0x${string}`, symbol: 'PLTR',  decimals: 18, name: 'Palantir Technologies — Robinhood Token' },
  SNDK:  { address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400' as `0x${string}`, symbol: 'SNDK',  decimals: 18, name: 'Sandisk Corporation — Robinhood Token' },
  SPCX:  { address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa' as `0x${string}`, symbol: 'SPCX',  decimals: 18, name: 'Space Exploration Technologies (SpaceX) — Robinhood Token' },
  TSLA:  { address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d' as `0x${string}`, symbol: 'TSLA',  decimals: 18, name: 'Tesla — Robinhood Token' },
  USAR:  { address: '0xd917B029C761D264c6A312BBbcDA868658eF86a6' as `0x${string}`, symbol: 'USAR',  decimals: 18, name: 'USA Rare Earth — Robinhood Token' },
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
  // ── The 8 (Old) pools that used to live here (created via the OLD
  // AeonFactoryRH, 0xD8495E39..., which has an AeonPoolRH baked into its
  // createPool() bytecode from before fee accounting existed) have all been
  // fully drained on-chain as of 2026-07-09 -- every wallet holding real LP
  // migrated out (unstaked + removed liquidity), confirmed via totalSupply()
  // sitting at the 1000-wei locked-minimum floor for all of them. Removed
  // from this list rather than kept as empty dead entries.

  // ── Fresh replacements, deployed 2026-07-09 via AeonFactoryV2
  // (0xE27EA15d...) -- real fee accounting verified via poolFees() before
  // deploying. Real gauges created for all 9. Empty until LP migrates over
  // from the corresponding (Old) pool above.
  { name: 'VIRTUAL/AEON', token0: 'VIRTUAL', token1: 'AEON', type: 'vAMM', fee: '1%',   address: '0x67B2da1742187Aa09b427082b06ACDC5bBCA2D99' as `0x${string}` },
  { name: 'ROBINFUN/AEON', token0: 'ROBINFUN', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xeB638e1FA253E5526C2be76626dE26F02E4bdaba' as `0x${string}` },
  { name: 'CASHCAT/AEON', token0: 'CASHCAT', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x22d76bf4e8d2c1DfCca7de6c9dC46Ec2a8Ed7Eb7' as `0x${string}` },
  { name: 'CASHCAT/ETH',  token0: 'CASHCAT', token1: 'WETH', type: 'vAMM', fee: '1%', address: '0x3DC6b6c354fB1e9CFdaA8A36ff845728f7176f4e' as `0x${string}` },
  { name: 'CASHCAT/USDG', token0: 'CASHCAT', token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x82203a764428Fbf826DCd1CE48Fdd57655b604f2' as `0x${string}` },
  { name: 'ROBINFUN/ETH',  token0: 'ROBINFUN', token1: 'WETH', type: 'vAMM', fee: '1%', address: '0x625fcD4CA1cA34Eb8ac74883748419De037d78DF' as `0x${string}` },
  { name: 'ROBINFUN/USDG', token0: 'ROBINFUN', token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xB60d3Dea956204c6731cA22622bE2b8bEFac4029' as `0x${string}` },
  { name: 'CASHCAT/ROBINFUN', token0: 'CASHCAT', token1: 'ROBINFUN', type: 'vAMM', fee: '1%', address: '0x8Ca7acDe0218B5A905dC29CC9d650fadC706Fd9E' as `0x${string}` },
  // Deployed 2026-07-10 via AeonFactoryV2 at the user's request (real gauge
  // created too -- verified voter.gauges(pool) resolves to it on-chain).
  // Empty until someone adds liquidity -- deployer wallet holds ~0.24 AEON
  // and 0 SHERWOOD, not enough to seed it.
  { name: 'SHERWOOD/AEON', token0: 'SHERWOOD', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xB4692A778E33fBA0B97Feaa863377C6322c83AA4' as `0x${string}` },
  // Deployed 2026-07-11 via AeonFactoryV2 at the user's request (real gauge
  // created too -- verified voter.gauges(pool) resolves to it on-chain).
  // Empty until someone adds liquidity -- deployer wallet holds ~0.24 AEON
  // and 0 HOODIE, not enough to seed it.
  { name: 'HOODIE/AEON', token0: 'HOODIE', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x3C643F22F0b24795710638CdEf2296eA12896317' as `0x${string}` },
  // Deployed 2026-07-11 via AeonFactoryV2 at the user's request (real gauge
  // created too -- verified voter.gauges(pool) resolves to it on-chain).
  // Empty until someone adds liquidity -- deployer wallet holds ~0.24 AEON
  // and 0 of this token, not enough to seed it.
  { name: 'NASDAQ/AEON', token0: 'NASDAQ', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xbf5FCFF8e5604b3ba404a4Cb5Be49EF230e0dA76' as `0x${string}` },
  // Deployed 2026-07-10 via AeonFactoryV2, all 40 pools + real gauges (real
  // 80-tx batch, ~0.0068 ETH total gas) -- one AEON pair + one USDG pair for
  // each of Robinhood's 20 official tokenized stocks. Every pool verified
  // on-chain (getPoolFor resolves it, voter.gauges(pool) resolves a real
  // gauge) after deploying. All empty until someone adds liquidity.
  { name: 'AAPL/AEON',  token0: 'AAPL',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x6dCA20911C85f8f9F0382f7355CB944C4CeE45A8' as `0x${string}` },
  { name: 'AAPL/USDG',  token0: 'AAPL',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x2b6809F19dEA50782bE6eFFD59D09b5256d9fe2c' as `0x${string}` },
  { name: 'AMD/AEON',   token0: 'AMD',   token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x44CA8d2896d58A6896DcA5e4AC5d139A596A82e3' as `0x${string}` },
  { name: 'AMD/USDG',   token0: 'AMD',   token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x249f4F9a89A7C270eFc90F2e58Aac2E73b1Bc9F3' as `0x${string}` },
  { name: 'AMZN/AEON',  token0: 'AMZN',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x430B3c1BeA4Bd105AC9dFD88F7B9117eECF3637a' as `0x${string}` },
  { name: 'AMZN/USDG',  token0: 'AMZN',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x6c8D348F3D16629935e0Fd77FfB96EC4816dA435' as `0x${string}` },
  { name: 'BABA/AEON',  token0: 'BABA',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x5e161a8840d6375753731d20dA603A6aB4aC2748' as `0x${string}` },
  { name: 'BABA/USDG',  token0: 'BABA',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x86B60A1C025b159B1aA891061beDEAAD2A62b52e' as `0x${string}` },
  { name: 'BE/AEON',    token0: 'BE',    token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x90f6056da5E516f2a4CF7971A40D40D9525FD3C7' as `0x${string}` },
  { name: 'BE/USDG',    token0: 'BE',    token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xB3e467F7F3930d1FAC1b1dBD5a377fEc38763048' as `0x${string}` },
  { name: 'COIN/AEON',  token0: 'COIN',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x68BAA1cD558417A71f99B13B4E3255DF017D5951' as `0x${string}` },
  { name: 'COIN/USDG',  token0: 'COIN',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x6012917b57ADd4400D5Dc2C3090fd01905BDC1AD' as `0x${string}` },
  { name: 'CRCL/AEON',  token0: 'CRCL',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x5651Dbe9F3F730B05e904cd302449045d650d27f' as `0x${string}` },
  { name: 'CRCL/USDG',  token0: 'CRCL',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xD107B9Ff4BCa85473d5F1C90858A266702F4Bb2B' as `0x${string}` },
  { name: 'CRWV/AEON',  token0: 'CRWV',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x774e1DbBb1F7aa76EB83052C1E205799BBC90b60' as `0x${string}` },
  { name: 'CRWV/USDG',  token0: 'CRWV',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xd0D5C6b8b715511f38798c7fb9a5CF2b7F4eCD79' as `0x${string}` },
  { name: 'GOOGL/AEON', token0: 'GOOGL', token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xEC63E87D41C088837aE825Fc0ffFd5d54e22e9ad' as `0x${string}` },
  { name: 'GOOGL/USDG', token0: 'GOOGL', token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xBfE163398FEB32e6cFE9cB9bBa0f3a791F0E2AEE' as `0x${string}` },
  { name: 'INTC/AEON',  token0: 'INTC',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xaaB08fF301dD07108cc92abdAAb26eF33b3128b3' as `0x${string}` },
  { name: 'INTC/USDG',  token0: 'INTC',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x3B2C6c865144aFacD19E0A94664fD069217B9080' as `0x${string}` },
  { name: 'META/AEON',  token0: 'META',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x5Df191615Bf75Fac0a7EAa6Ca9004540B986bEc3' as `0x${string}` },
  { name: 'META/USDG',  token0: 'META',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x35D17334D60e2d66Fc7Bd8134FcD04de6327E478' as `0x${string}` },
  { name: 'MSFT/AEON',  token0: 'MSFT',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x7fd17741539566d9952fA0E1c15577354ba84599' as `0x${string}` },
  { name: 'MSFT/USDG',  token0: 'MSFT',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x2f6A06d63AE74adB9D7B93e7A5BE570921Ac0576' as `0x${string}` },
  { name: 'MU/AEON',    token0: 'MU',    token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xAdeC4dcFe2FcB21e30327368Ac71f0232A2CD5f9' as `0x${string}` },
  { name: 'MU/USDG',    token0: 'MU',    token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x13Fc57D534F6385A5a8298A863f9841D6448a281' as `0x${string}` },
  { name: 'NVDA/AEON',  token0: 'NVDA',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xD3698bD92C892F21638eaCa8070d2A05865586A8' as `0x${string}` },
  { name: 'NVDA/USDG',  token0: 'NVDA',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x5B7C1440aD8C1e10E6c36C8851F6b6F787C39d2B' as `0x${string}` },
  { name: 'ORCL/AEON',  token0: 'ORCL',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x0D43C803bA52490a171faF76A58C8f4Df3450c47' as `0x${string}` },
  { name: 'ORCL/USDG',  token0: 'ORCL',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x8Ea29453b524a8C1325C82FD24e38956a65A7042' as `0x${string}` },
  { name: 'PLTR/AEON',  token0: 'PLTR',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x1142b85486e6D5D7f04DDd08DD40FEAaC1Bc41ff' as `0x${string}` },
  { name: 'PLTR/USDG',  token0: 'PLTR',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xae54382e114BC6965942Ce8A3DbE8E3aF904779C' as `0x${string}` },
  { name: 'SNDK/AEON',  token0: 'SNDK',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x1424A2e6634707B8b15c98E9F7B00611366dcFbe' as `0x${string}` },
  { name: 'SNDK/USDG',  token0: 'SNDK',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0xE39f94A16743BA530bCF97d9f2D6324be4C451Fa' as `0x${string}` },
  { name: 'SPCX/AEON',  token0: 'SPCX',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x603D32172a7A47676Caed0c37b8D8c368f519479' as `0x${string}` },
  { name: 'SPCX/USDG',  token0: 'SPCX',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x0DeDE83443efFeE1CCF69276beC826502C6d70Ba' as `0x${string}` },
  { name: 'TSLA/AEON',  token0: 'TSLA',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0xa1B57937edA1F8ed3a151F3F676bAc3eC19959ef' as `0x${string}` },
  { name: 'TSLA/USDG',  token0: 'TSLA',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x079C008EAADaFD62AeE351D61660AF64b5b022DC' as `0x${string}` },
  { name: 'USAR/AEON',  token0: 'USAR',  token1: 'AEON', type: 'vAMM', fee: '1%', address: '0x329860B303B5816239594D3D367ea5B8f2314eB2' as `0x${string}` },
  { name: 'USAR/USDG',  token0: 'USAR',  token1: 'USDG', type: 'vAMM', fee: '1%', address: '0x8B016c5Ed32296D68068F3176Fa2CF2a32F2d406' as `0x${string}` },
]

// Real, working pools deliberately excluded from the Liquidity page's
// dynamic discovery (useAllPools.ts). Unlike the (Old) pools above, these
// have no surviving same-pair entry in POOLS to dedupe against, so without
// this list useAllPools would resurface them via the factory's allPools()
// registry. SLEEP/AEON: user explicitly asked to hide it 2026-07-09 despite
// it being a real, fee-accounting-correct pool -- on-chain pool/gauge still
// exist, just not discoverable via the UI.
export const HIDDEN_POOLS: `0x${string}`[] = [
  '0x77FE92Da859e6d9cfdD948CF8900A3AF147b8cE4', // SLEEP/AEON (new factory)
  '0xDF769bF01Ee70e2F86adC0417E0717D32c4586be', // SLEEP/AEON (Old, empty, never had liquidity)
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

// Removed from the frontend entirely 2026-07-10, then partially restored 2026-07-12,
// per explicit user request -- only the CASHCAT/AEON/ETH/USDG subset (the
// VIRTUAL and ROBINFUN pairs stay hidden/commented below). All 6 addresses re-verified on-chain (real
// bytecode) before restoring. On-chain pools/gauges were never touched by
// the original removal -- 3 of these 6 pairs (AEON/ETH, AEON/USDG, ETH/USDG)
// have real staked positions; CASHCAT/AEON, CASHCAT/USDG, CASHCAT/ETH are
// empty until someone adds liquidity.
export const CL_POOLS: {
  name: string; token0: string; token1: string; type: 'CL'; fee: string; address: `0x${string}`
}[] = [
  { name: 'AEON/ETH',     token0: 'AEON',    token1: 'WETH',    type: 'CL', fee: '0.25%', address: '0x3c8090c3Cb3A45A677A6492acb5ad5253F9A686e' as `0x${string}` },
  { name: 'AEON/USDG',    token0: 'AEON',    token1: 'USDG',    type: 'CL', fee: '0.25%', address: '0xE2503a27a33DacdBEEc821557fe8747800Cf6ff6' as `0x${string}` },
  { name: 'ETH/USDG',     token0: 'WETH',    token1: 'USDG',    type: 'CL', fee: '0.25%', address: '0x96B5de75c08971f41DE6bde917fB0a8d0EB450F3' as `0x${string}` },
  { name: 'CASHCAT/AEON', token0: 'CASHCAT', token1: 'AEON',    type: 'CL', fee: '0.25%', address: '0xbCD1Bf0d9F25503DDfEd0b663827811637B27B80' as `0x${string}` },
  { name: 'CASHCAT/USDG', token0: 'CASHCAT', token1: 'USDG',    type: 'CL', fee: '0.25%', address: '0x9ebd1C556967d8e3f6f1C043D57eb7762047D60D' as `0x${string}` },
  { name: 'CASHCAT/ETH',  token0: 'CASHCAT', token1: 'WETH',    type: 'CL', fee: '0.25%', address: '0x09e729D9e077EB1Ad10aDccDE4D18C143035fe04' as `0x${string}` },
]
// Still hidden -- VIRTUAL/ROBINFUN pairs, not part of the restored subset.
// // { name: 'VIRTUAL/AEON',     token0: 'VIRTUAL',  token1: 'AEON',     type: 'CL', fee: '0.25%', address: '0x280b2eb06B105944BB2f1378c861D604eb82Aa3d' as `0x${string}` },
// // { name: 'ROBINFUN/AEON',    token0: 'ROBINFUN', token1: 'AEON',     type: 'CL', fee: '0.25%', address: '0xC4A0B77a4a09eE7ECff12CC6504BFA9BB8c62C3B' as `0x${string}` },
// // { name: 'CASHCAT/ROBINFUN', token0: 'CASHCAT',  token1: 'ROBINFUN', type: 'CL', fee: '0.25%', address: '0x14E266508d68107509487DE6Ead5ded5764C5F20' as `0x${string}` },
// // { name: 'ROBINFUN/ETH',     token0: 'WETH',     token1: 'ROBINFUN', type: 'CL', fee: '0.25%', address: '0xC6b5b34133E290e5c28B19844970cee783DD9b40' as `0x${string}` },
// // { name: 'ROBINFUN/USDG',    token0: 'ROBINFUN', token1: 'USDG',     type: 'CL', fee: '0.25%', address: '0xBb6aA9914f53afb8e7C89Bf05D4DD2525aF4E4ce' as `0x${string}` },

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
// Removed from the frontend entirely 2026-07-10, same reasoning as CL_POOLS
// above -- DLMM rewards are also governor-funded-discretionary, not
// automatic vote-weighted emissions. Partially restored 2026-07-12, same as
// CL_POOLS -- only the CASHCAT/AEON/ETH/USDG subset (VIRTUAL/ROBINFUN pairs
// stay hidden below). All 6 addresses re-verified on-chain (real bytecode)
// before restoring. 3 of these 6 pairs (AEON/ETH, AEON/USDG, ETH/USDG) have
// real staked positions; CASHCAT/AEON, CASHCAT/USDG, CASHCAT/ETH are empty
// until someone adds liquidity.
export const DLMM_POOLS: {
  name: string; token0: string; token1: string; type: 'DLMM'; binStep: number; fee: string; address: `0x${string}`
}[] = [
  { name: 'AEON/ETH',     token0: 'AEON',    token1: 'WETH',    type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x736d8E418673253b2CDE1ef3Df6205Fc9780816b' as `0x${string}` },
  { name: 'AEON/USDG',    token0: 'AEON',    token1: 'USDG',    type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x8bCCec714f42eeb73954172C253F84f649599E3B' as `0x${string}` },
  { name: 'ETH/USDG',     token0: 'WETH',    token1: 'USDG',    type: 'DLMM', binStep: 10, fee: '0.05%',  address: '0x6E3772afbef845Ef4a3aD23a6eEEf65776375bC6' as `0x${string}` },
  { name: 'CASHCAT/AEON', token0: 'CASHCAT', token1: 'AEON',    type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x754EDCcEdd8F27A6ba7874052760f42e801be172' as `0x${string}` },
  { name: 'CASHCAT/USDG', token0: 'CASHCAT', token1: 'USDG',    type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xBEe641E8d7EAe49Cae27832dBf33dFd9F4AACb17' as `0x${string}` },
  { name: 'CASHCAT/ETH',  token0: 'CASHCAT', token1: 'WETH',    type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xaF6cd582516C69BD2FDE8803f277b64D6d0A1247' as `0x${string}` },
]
// Still hidden -- VIRTUAL/ROBINFUN pairs, not part of the restored subset.
// // { name: 'VIRTUAL/AEON',     token0: 'VIRTUAL',  token1: 'AEON',     type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xcC62C85794F652ee257cf00c87530fF860755892' as `0x${string}` },
// // { name: 'ROBINFUN/AEON',    token0: 'ROBINFUN', token1: 'AEON',     type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xfD32dBb36B7873cCd9a1547AFf8341240Ebd1904' as `0x${string}` },
// // { name: 'CASHCAT/ROBINFUN', token0: 'CASHCAT',  token1: 'ROBINFUN', type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x513768a47297f8ab6e843c853f60d0dd360ec4c1' as `0x${string}` },
// // { name: 'ROBINFUN/ETH',     token0: 'WETH',     token1: 'ROBINFUN', type: 'DLMM', binStep: 25, fee: '0.125%', address: '0x6a035f314de5ac12383a9698b000dbd7ee7c71db' as `0x${string}` },
// // { name: 'ROBINFUN/USDG',    token0: 'ROBINFUN', token1: 'USDG',     type: 'DLMM', binStep: 25, fee: '0.125%', address: '0xA41bf62FbD1EeDa210C65F7fE2B82B4f71bF819F' as `0x${string}` },

// Independently deployed V2-compatible pairs on Robinhood Chain. These are
// not ours, but AeonUniversalRouter can route through them (poolType 3)
// alongside our pools. Fees are explicit per pair; the VIRTUAL/WETH pool at
// 0xD658... was verified against its live getAmountOut() quoter (25 bps).
export const UNISWAP_POOLS = [
  { name: 'WETH/USDG',     token0: 'WETH', token1: 'USDG',    type: 'UniV2', fee: '0.3%', address: '0x8803c117ccae7B5146297876c2A25DF135141C4d' as `0x${string}` },
  { name: 'WETH/VIRTUAL',  token0: 'WETH', token1: 'VIRTUAL', type: 'UniV2', fee: '0.3%', address: '0xd95e8e2Cd04c207625C6F23c974d365a5F3A91D3' as `0x${string}` },
  { name: 'WETH/VIRTUAL',  token0: 'WETH', token1: 'VIRTUAL', type: 'UniV2', fee: '0.25%', address: '0xD65870Dc303b9CA01e07528B220C76d5fE917126' as `0x${string}` },
  { name: 'USDG/VIRTUAL',  token0: 'USDG', token1: 'VIRTUAL', type: 'UniV2', fee: '0.3%', address: '0xee8D21C0E5AAA31269867Db4E3C66a90C3D5951D' as `0x${string}` },
  { name: 'VEX/VIRTUAL',   token0: 'VEX', token1: 'VIRTUAL', type: 'UniV2', fee: '0.3%', address: '0x817f16F5D8da83d1B089B082c0172af3923618dA' as `0x${string}` },
  { name: 'WETH/ROBINFUN', token0: 'WETH', token1: 'ROBINFUN', type: 'UniV2', fee: '0.3%', address: '0xE53377eB912D08e1B0160E5Ea0c626CF162870fF' as `0x${string}` },
]

// Genesis + ongoing tokenomics — mirrors VoteDirectedLpEmissionsEngineRH.sol / FeeDistributorV3.sol / BuybackEngineV3.sol
export const EPOCH_CONFIG = {
  epochLength:            604800,
  emissionPct:             25,     // tokensToMint = (feesUSD * emissionPct / 100) / aeonPrice -- no rolling average, no growth cap
  emissionVoterSplit:      100,    // of each mint: 100% to vote-directed LP gauges
  emissionFurnaceSplit:     0,     // Furnace receives 0% of the mint now; burn rewards are funded separately by ProtocolBurnRewardDistributor
  feeVoterSplit:           80,     // of raw collected fees: 80% straight to voters
  feeBuybackSplit:         20,     // of raw collected fees: 20% to BuybackEngine
  buybackBurnSplit:        50,     // of that 20%: 50% swapped to AEON and burned
  buybackRedistributeSplit:50,     // of that 20%: 50% swapped to AEON and redistributed to Furnace burners
  genesisTotal:            '90000000000000000000000',  // 90,000 AEON
  genesisLpEach:           '20000000000000000000000',  // 20,000 AEON -> each of AEON/ETH, AEON/USDG
  genesisBurn:             '50000000000000000000000',  // 50,000 AEON -> burned, voted 25k/25k
  whitelistCostAEON:       '100000000000000000000',    // 100 AEON to unlock adding liquidity
}
