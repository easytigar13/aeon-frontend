// ABI fragments — only what the frontend needs

// Algebra Integral NonfungiblePositionManager — mint a concentrated-liquidity position
// Matches the REAL deployed INonfungiblePositionManager.MintParams (note the
// `deployer` field for custom-pool deployers — address(0) for standard pools —
// which sits between token1 and tickLower; earlier drafts of this ABI omitted
// it and would have silently mis-encoded every mint() call).
export const ALGEBRA_POSITION_MANAGER_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'token0',          type: 'address' },
        { name: 'token1',          type: 'address' },
        { name: 'deployer',        type: 'address' },
        { name: 'tickLower',       type: 'int24'   },
        { name: 'tickUpper',       type: 'int24'   },
        { name: 'amount0Desired',  type: 'uint256' },
        { name: 'amount1Desired',  type: 'uint256' },
        { name: 'amount0Min',      type: 'uint256' },
        { name: 'amount1Min',      type: 'uint256' },
        { name: 'recipient',       type: 'address' },
        { name: 'deadline',        type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'tokenId',   type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0',   type: 'uint256' },
      { name: 'amount1',   type: 'uint256' },
    ],
  },
  {
    name: 'decreaseLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'tokenId',      type: 'uint256' },
        { name: 'liquidity',    type: 'uint128' },
        { name: 'amount0Min',   type: 'uint256' },
        { name: 'amount1Min',   type: 'uint256' },
        { name: 'deadline',     type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'collect',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params', type: 'tuple',
      components: [
        { name: 'tokenId',     type: 'uint256' },
        { name: 'recipient',   type: 'address' },
        { name: 'amount0Max',  type: 'uint128' },
        { name: 'amount1Max',  type: 'uint128' },
      ],
    }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'burn',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
  },
] as const

// Algebra Integral NonfungiblePositionManager — enumerate a wallet's CL positions
export const ALGEBRA_PM_ENUMERABLE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'tokenOfOwnerByIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce',                  type: 'uint88'  },
      { name: 'operator',               type: 'address' },
      { name: 'token0',                 type: 'address' },
      { name: 'token1',                 type: 'address' },
      { name: 'deployer',               type: 'address' },
      { name: 'tickLower',              type: 'int24'   },
      { name: 'tickUpper',              type: 'int24'   },
      { name: 'liquidity',              type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0',            type: 'uint128' },
      { name: 'tokensOwed1',            type: 'uint128' },
    ],
  },
] as const

// AeonSwap — 1:1 AEON v1 -> v2 migration
export const AEON_SWAP_ABI = [
  {
    name: 'migrate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'remainingCapacity',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalMigrated',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Algebra Integral pool — tick spacing and global state (sqrtPrice, current tick)
export const ALGEBRA_POOL_ABI = [
  {
    name: 'tickSpacing',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
  },
  {
    name: 'globalState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'price',        type: 'uint160' },
      { name: 'tick',         type: 'int24'   },
      { name: 'lastFee',      type: 'uint16'  },
      { name: 'pluginConfig', type: 'uint8'   },
      { name: 'communityFee', type: 'uint16'  },
      { name: 'unlocked',     type: 'bool'    },
    ],
  },
  {
    name: 'liquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint128' }],
  },
] as const

export const AEON_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'routes', type: 'tuple[]', components: [
        { name: 'tokenIn',  type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'pool',     type: 'address' },
        { name: 'poolType', type: 'uint8'   },
        { name: 'feeBps',   type: 'uint24'  },
      ]},
      { name: 'amountIn',     type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to',           type: 'address' },
      { name: 'deadline',     type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

// AeonUniversalRouter — chains hops across vAMM, CL, and DLMM in one
// transaction (AEON_ROUTER_ABI above only ever supports poolType 0). Hop.pool
// is only meaningful for vAMM (poolType 0); CL/DLMM hops pass address(0) —
// Algebra derives its pool from tokenIn/tokenOut/deployer, DLMM's router
// derives its pair from tokenPath/binStep, neither needs an explicit pool arg.
export const AEON_UNIVERSAL_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'hops', type: 'tuple[]', components: [
        { name: 'poolType', type: 'uint8'   }, // 0 = vAMM, 1 = CL, 2 = DLMM, 3 = UniV2, 4 = UniV3, 5 = UniV4
        { name: 'pool',     type: 'address' },
        { name: 'tokenIn',  type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'feeBps',   type: 'uint24'  }, // vAMM/UniV2 only
        { name: 'binStep',  type: 'uint16'  }, // DLMM only
        { name: 'tickSpacing', type: 'int24' }, // UniV4 only
        { name: 'v4Native', type: 'bool' },     // UniV4 native-ETH PoolKey
      ]},
      { name: 'amountIn',     type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to',           type: 'address' },
      { name: 'deadline',     type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  // Splits the SAME input token across independent legs (e.g. "as much as
  // fits our own pool within tolerance, the rest via the best remaining
  // route") and sums their outputs -- only the blended total is checked
  // against amountOutMin, same pattern as the single-route function above.
  {
    name: 'swapSplitExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'legs', type: 'tuple[]', components: [
        { name: 'hops', type: 'tuple[]', components: [
          { name: 'poolType', type: 'uint8'   },
          { name: 'pool',     type: 'address' },
          { name: 'tokenIn',  type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'feeBps',   type: 'uint24'  },
          { name: 'binStep',  type: 'uint16'  },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'v4Native', type: 'bool' },
        ]},
        { name: 'amountIn', type: 'uint256' },
      ]},
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to',           type: 'address' },
      { name: 'deadline',     type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

// Native-ETH wrapper for WETH-settled arbitrage cycles. It performs
// ETH -> WETH -> UniversalRouter hops -> WETH -> ETH atomically.
export const AEON_NATIVE_ARB_EXECUTOR_ABI = [
  {
    name: 'executeNativeCycle', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'hops', type: 'tuple[]', components: [
        { name: 'poolType', type: 'uint8' }, { name: 'pool', type: 'address' },
        { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
        { name: 'feeBps', type: 'uint24' }, { name: 'binStep', type: 'uint16' },
        { name: 'tickSpacing', type: 'int24' }, { name: 'v4Native', type: 'bool' },
      ]},
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'executeNativeSettlement', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'hops', type: 'tuple[]', components: [
        { name: 'poolType', type: 'uint8' }, { name: 'pool', type: 'address' },
        { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
        { name: 'feeBps', type: 'uint24' }, { name: 'binStep', type: 'uint16' },
        { name: 'tickSpacing', type: 'int24' }, { name: 'v4Native', type: 'bool' },
      ]},
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

// Bundles "swap into WETH via AeonRouter, then unwrap to native ETH" into one
// call -- same Route[]/amountIn/amountOutMin/deadline shape as AEON_ROUTER_ABI,
// `to` just receives native ETH instead of WETH. Verified end-to-end against
// a fork simulation before deploying (real 2-hop swap + real unwrap + zero
// leftover funds in the helper).
export const AEON_SWAP_UNWRAP_HELPER_ABI = [
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'routes', type: 'tuple[]', components: [
        { name: 'tokenIn',  type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'pool',     type: 'address' },
        { name: 'poolType', type: 'uint8'   },
        { name: 'feeBps',   type: 'uint24'  },
      ]},
      { name: 'amountIn',     type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to',           type: 'address' },
      { name: 'deadline',     type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

// WETH9-style wrap/unwrap — used for the native ETH <-> WETH pair directly
export const WETH_ABI = [
  { name: 'deposit',  type: 'function', stateMutability: 'payable',    inputs: [],                                  outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
] as const

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner',   type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

export const VOTING_ESCROW_ABI = [
  {
    name: 'createLock',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_value',        type: 'uint256' },
      { name: '_lockDuration', type: 'uint256' },
    ],
    outputs: [{ name: '_tokenId', type: 'uint256' }],
  },
  {
    name: 'increaseAmount',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_tokenId', type: 'uint256' },
      { name: '_value',   type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'increaseUnlockTime',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_tokenId',      type: 'uint256' },
      { name: '_lockDuration', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOfNFT',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lockedAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lockedEnd',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'tokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'voted',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'merge',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_from', type: 'uint256' },
      { name: '_to',   type: 'uint256' },
    ],
    outputs: [],
  },
] as const

// VoteDirectedLpEmissionsEngineRH.sol -- activated 2026-07-13, replaces the
// old rolling-average/circuit-breaker EmissionsEngineRH. Each completed
// epoch mints AEON worth exactly EMISSION_BPS (25%) of that epoch's
// finalized USD fees (feeDistributor.lastEpochFeesUSD()) -- no rolling
// average, no previous-mint growth cap, no Furnace mint (TO_FURNACE_BPS=0).
// 100% of the mint goes to vote-directed LP gauges, split between the
// legacy vAMM voter and the MultiGaugeController by multiGaugeBps (only
// when both have live vote weight this epoch).
export const EMISSIONS_ENGINE_ABI = [
  {
    name: 'lastMintAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastFeesUSD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'activePeriod',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'multiGaugeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'EMISSION_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'TO_VOTER_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'TO_FURNACE_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'previewMint',
    type: 'function',
    stateMutability: 'pure',
    inputs: [
      { name: 'feesUSD', type: 'uint256' },
      { name: 'aeonPriceUSD', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'updatePeriod',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'period', type: 'uint256' }],
  },
] as const

// AeonOracle.sol -- getTokenPrice(token) returns the token's USD price (1e18)
// or 0 if the oracle can't price it. This is the SAME valuation the protocol
// uses in FeeDistributorV4.notifyFees: a fee token only contributes to
// lastEpochFeesUSD (which sizes the emission mint) if getTokenPrice > 0.
// Unpriced tokens (most memecoins) count as $0 toward emissions even though
// their fees ARE still collected and paid to voters/LPs in-kind.
export const ORACLE_ABI = [
  {
    name: 'getTokenPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// FeeDistributorV3.sol -- pre-cutover, still holds real unsnapshotted fees
// for the transitional epoch (see LEGACY_FEE_DISTRIBUTOR in contracts.ts).
// V3's claimAllFees has no tokenId arg -- resolves via
// voter.lastVotedTokenId(msg.sender) against LEGACY_AEON_VOTER, which is
// fine for this one legacy epoch since it's a single already-cast vote per
// wallet from before cutover, not an ongoing multi-vote pattern.
export const LEGACY_FEE_DISTRIBUTOR_ABI = [
  {
    name: 'lastEpochFeesUSD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastSnapshotPeriod',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'snapshotEpoch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimAllFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

// FeeDistributorV4.sol -- live since the 2026-07-16 cutover.
export const FEE_DISTRIBUTOR_ABI = [
  {
    name: 'lastEpochFeesUSD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Claims the given tokenId's voter-share of every fee token collected for
  // `pool` during `epoch` (epoch must already be closed -- epoch <
  // currentEpoch()). tokenId is checked against real ownership/approval on
  // the voting escrow -- V3 instead silently resolved to whichever veNFT
  // the wallet most recently voted with, making every other owned veNFT's
  // share permanently unclaimable for multi-NFT wallets.
  {
    name: 'claimAllFees',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'poolEpochTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'poolTokenEpochFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'claimed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'pool', type: 'address' },
      { name: 'epoch', type: 'uint256' },
      { name: 'token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// WhitelistRH.sol — pay 100 AEON to the protocol treasury to permanently
// unlock the ability to add liquidity via LiquidityHelperRH.
export const WHITELIST_ABI = [
  {
    name: 'joinWhitelist',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'isWhitelisted',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'WHITELIST_COST',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'treasury',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const FURNACE_ABI = [
  {
    name: 'burn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'earned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'addressToTokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'burnedByToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalBurned',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'votingPowerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const GAUGE_FACTORY_ABI = [
  {
    name: 'gaugeForPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const GAUGE_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [],
  },
  {
    name: 'earned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'rewardRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'periodFinish',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// Minimal ERC721 approve — used to approve a single CL position NFT to a
// gauge before staking it (positionManager already exposes this; not a new deploy).
export const ERC721_APPROVE_ABI = [
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  { name: 'getApproved', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
] as const

// AeonClGauge — parallel staking gauge for CL position NFTs. Not the same
// contract as GAUGE_ABI (deposit/withdraw take a tokenId, not an amount;
// staked weight is the position's own liquidity).
export const CL_GAUGE_ABI = [
  { name: 'stake',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
  { name: 'getReward', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'earned',   type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'rewardRate', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'periodFinish', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getStakedTokenIds', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] },
  { name: 'stakedLiquidity', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint128' }] },
] as const

// AeonDlmmGauge — parallel staking gauge for LB (DLMM) bin-share tokens.
export const DLMM_GAUGE_ABI = [
  { name: 'stake',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'ids', type: 'uint256[]' }, { name: 'amounts', type: 'uint256[]' }], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'ids', type: 'uint256[]' }, { name: 'amounts', type: 'uint256[]' }], outputs: [] },
  { name: 'getReward', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { name: 'earned',   type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'rewardRate', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'periodFinish', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'getStakedBinIds', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] },
  { name: 'stakedBins', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }, { name: '', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

export const BRIBE_ABI = [
  {
    name: 'earned',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'token',   type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'tokens',  type: 'address[]' },
    ],
    outputs: [],
  },
] as const

export const PAIR_ABI = [
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0',            type: 'uint112' },
      { name: 'reserve1',            type: 'uint112' },
      { name: 'blockTimestampLast',  type: 'uint32'  },
    ],
  },
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'feeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
  },
] as const

export const AEON_FACTORY_ABI = [
  {
    name: 'createPool',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA',  type: 'address' },
      { name: 'tokenB',  type: 'address' },
      { name: 'feeBps',  type: 'uint24'  },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
  {
    name: 'getPoolFor',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'feeBps', type: 'uint24'  },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'allPools',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'allPoolsLength',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const LIQUIDITY_HELPER_ABI = [
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool',    type: 'address' },
      { name: 'token0',  type: 'address' },
      { name: 'amount0', type: 'uint256' },
      { name: 'token1',  type: 'address' },
      { name: 'amount1', type: 'uint256' },
      { name: 'to',      type: 'address' },
    ],
    outputs: [{ name: 'liquidity', type: 'uint256' }],
  },
  {
    name: 'removeLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool',     type: 'address' },
      { name: 'lpAmount', type: 'uint256' },
      { name: 'to',       type: 'address' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const

// Slippage-protected replacement for LIQUIDITY_HELPER_ABI — computes the
// optimal matching amount from live pool reserves and reverts if either
// side misses the caller's min bound (add), or if either received amount
// undercuts the caller's min bound (remove).
export const LIQUIDITY_HELPER_V2_ABI = [
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool',            type: 'address' },
      { name: 'token0',          type: 'address' },
      { name: 'amount0Desired',  type: 'uint256' },
      { name: 'amount1Desired',  type: 'uint256' },
      { name: 'amount0Min',      type: 'uint256' },
      { name: 'amount1Min',      type: 'uint256' },
      { name: 'token1',          type: 'address' },
      { name: 'to',              type: 'address' },
      { name: 'deadline',        type: 'uint256' },
    ],
    outputs: [
      { name: 'amount0',   type: 'uint256' },
      { name: 'amount1',   type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    name: 'removeLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pool',        type: 'address' },
      { name: 'lpAmount',    type: 'uint256' },
      { name: 'amount0Min',  type: 'uint256' },
      { name: 'amount1Min',  type: 'uint256' },
      { name: 'to',          type: 'address' },
      { name: 'deadline',    type: 'uint256' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
] as const

export const VOTER_ABI = [
  {
    name: 'vote',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_tokenId', type: 'uint256' },
      { name: '_poolVote', type: 'address[]' },
      { name: '_weights',  type: 'uint256[]' },
    ],
    outputs: [],
  },
  // AeonVoterV3 only -- true once `owner` has already been credited the
  // Furnace bonus for `epoch` (via any of their veNFTs). Prevents the old
  // multi-veNFT double-count exploit; the frontend uses this to show
  // whether the Furnace Bonus preview is still real or already spent.
  {
    name: 'furnacePowerUsed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'reset',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'poke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'gauges',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'weights',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // Epoch-scoped vote weight -- distinct from the all-time cumulative
  // `weights`/`totalWeight` above (what AEON emissions distribute against).
  // This is what FeeDistributorV3._claimFees() actually divides by to split
  // the 80%-of-raw-fees voter share for one specific epoch, per pool.
  {
    name: 'poolTotalWeight',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'pool', type: 'address' },
      { name: 'epoch', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalWeight',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastVotedTokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'voter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastVoted',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getVotes',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'pool',    type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'usedWeights',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'internalBribes',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'gauge', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

export const MULTI_GAUGE_CONTROLLER_ABI = [
  {
    name: 'vote', type: 'function', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'poolVote', type: 'address[]' },
      { name: 'allocation', type: 'uint256[]' },
    ],
  },
  { name: 'currentEpoch', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'hasVoted', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'epoch', type: 'uint256' }, { name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'votes', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'epoch', type: 'uint256' }, { name: 'tokenId', type: 'uint256' }, { name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'weights', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'epoch', type: 'uint256' }, { name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  { name: 'totalWeight', type: 'function', stateMutability: 'view', inputs: [{ name: 'epoch', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'claimable', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }, { name: 'epoch', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'distributeBatch', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'poolList', type: 'address[]' }, { name: 'epoch', type: 'uint256' }],
    outputs: [{ name: 'total', type: 'uint256' }],
  },
] as const

// Trader Joe LB v2.2 ABIs
export const LB_PAIR_ABI = [
  { name: 'getActiveId',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'activeId', type: 'uint24' }] },
  { name: 'getBinStep',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'binStep', type: 'uint16' }] },
  { name: 'getTokenX',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'tokenX', type: 'address' }] },
  { name: 'getTokenY',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'tokenY', type: 'address' }] },
  { name: 'getReserves',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: 'reserveX', type: 'uint128' }, { name: 'reserveY', type: 'uint128' }] },
  { name: 'getBin', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint24' }],
    outputs: [{ name: 'binReserveX', type: 'uint128' }, { name: 'binReserveY', type: 'uint128' }] },
  { name: 'totalSupply', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approveForAll', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'approved', type: 'bool' }],
    outputs: [] },
  { name: 'isApprovedForAll', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }] },
] as const

export const LB_ROUTER_ABI = [
  { name: 'addLiquidity', type: 'function', stateMutability: 'nonpayable',
    inputs: [{
      name: 'liquidityParameters', type: 'tuple', components: [
        { name: 'tokenX',         type: 'address' },
        { name: 'tokenY',         type: 'address' },
        { name: 'binStep',        type: 'uint256' },
        { name: 'amountX',        type: 'uint256' },
        { name: 'amountY',        type: 'uint256' },
        { name: 'amountXMin',     type: 'uint256' },
        { name: 'amountYMin',     type: 'uint256' },
        { name: 'activeIdDesired',type: 'uint256' },
        { name: 'idSlippage',     type: 'uint256' },
        { name: 'deltaIds',       type: 'int256[]' },
        { name: 'distributionX', type: 'uint256[]' },
        { name: 'distributionY', type: 'uint256[]' },
        { name: 'to',             type: 'address' },
        { name: 'refundTo',       type: 'address' },
        { name: 'deadline',       type: 'uint256' },
      ]
    }],
    outputs: [
      { name: 'amountXAdded',   type: 'uint256' },
      { name: 'amountYAdded',   type: 'uint256' },
      { name: 'amountXLeft',    type: 'uint256' },
      { name: 'amountYLeft',    type: 'uint256' },
      { name: 'depositIds',     type: 'uint256[]' },
      { name: 'liquidityMinted',type: 'uint256[]' },
    ],
  },
  { name: 'addLiquidityNATIVE', type: 'function', stateMutability: 'payable',
    inputs: [{
      name: 'liquidityParameters', type: 'tuple', components: [
        { name: 'tokenX',         type: 'address' },
        { name: 'tokenY',         type: 'address' },
        { name: 'binStep',        type: 'uint256' },
        { name: 'amountX',        type: 'uint256' },
        { name: 'amountY',        type: 'uint256' },
        { name: 'amountXMin',     type: 'uint256' },
        { name: 'amountYMin',     type: 'uint256' },
        { name: 'activeIdDesired',type: 'uint256' },
        { name: 'idSlippage',     type: 'uint256' },
        { name: 'deltaIds',       type: 'int256[]' },
        { name: 'distributionX', type: 'uint256[]' },
        { name: 'distributionY', type: 'uint256[]' },
        { name: 'to',             type: 'address' },
        { name: 'refundTo',       type: 'address' },
        { name: 'deadline',       type: 'uint256' },
      ]
    }],
    outputs: [
      { name: 'amountXAdded',   type: 'uint256' },
      { name: 'amountYAdded',   type: 'uint256' },
      { name: 'amountXLeft',    type: 'uint256' },
      { name: 'amountYLeft',    type: 'uint256' },
      { name: 'depositIds',     type: 'uint256[]' },
      { name: 'liquidityMinted',type: 'uint256[]' },
    ],
  },
  { name: 'removeLiquidity', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenX',    type: 'address' },
      { name: 'tokenY',    type: 'address' },
      { name: 'binStep',   type: 'uint16' },
      { name: 'amountXMin',type: 'uint256' },
      { name: 'amountYMin',type: 'uint256' },
      { name: 'ids',       type: 'uint256[]' },
      { name: 'amounts',   type: 'uint256[]' },
      { name: 'to',        type: 'address' },
      { name: 'deadline',  type: 'uint256' },
    ],
    outputs: [{ name: 'amountX', type: 'uint256' }, { name: 'amountY', type: 'uint256' }],
  },
  { name: 'removeLiquidityNATIVE', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token',     type: 'address' },
      { name: 'binStep',   type: 'uint16' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountNATIVEMin',type: 'uint256' },
      { name: 'ids',       type: 'uint256[]' },
      { name: 'amounts',   type: 'uint256[]' },
      { name: 'to',        type: 'address' },
      { name: 'deadline',  type: 'uint256' },
    ],
    outputs: [{ name: 'amountToken', type: 'uint256' }, { name: 'amountNATIVE', type: 'uint256' }],
  },
  // Version enum: V1=0, V2=1, V2_1=2, V2_2=3 -- our deployed router only has
  // its V2_2 factory slot populated (verified on-chain: getFactory() ==
  // _factory2_2 == our real DLMM_CONTRACTS.factory; the V1/V2/V2_1 slots all
  // resolve to the zero address), so every swap path must use version 3 —
  // any other value makes the router look up a pair via an unset factory and
  // revert on a call to address(0). Confirmed via a traced fork simulation.
  { name: 'swapExactTokensForTokens', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn',    type: 'uint256' },
      { name: 'amountOutMin',type: 'uint256' },
      { name: 'path', type: 'tuple', components: [
        { name: 'pairBinSteps', type: 'uint256[]' },
        { name: 'versions',     type: 'uint8[]' },
        { name: 'tokenPath',    type: 'address[]' },
      ]},
      { name: 'to',       type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  // Quote helper lives on the router itself (takes the pair address
  // directly, no Path/version needed) — real view function, verified on-chain.
  { name: 'getSwapOut', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'lbPair',    type: 'address' },
      { name: 'amountIn',  type: 'uint128' },
      { name: 'swapForY',  type: 'bool' },
    ],
    outputs: [
      { name: 'amountInLeft', type: 'uint128' },
      { name: 'amountOut',    type: 'uint128' },
      { name: 'fee',          type: 'uint128' },
    ],
  },
] as const

// Algebra Integral (cryptoalgebra/Algebra) periphery — real ISwapRouter/
// IQuoterV2 interfaces, verified against a traced fork simulation (the
// quoter's function isn't `view` on-chain since it reverts internally to
// compute its result, but it's annotated view here so wagmi's read hooks
// will call it — the actual eth_call behaves identically either way).
export const ALGEBRA_SWAP_ROUTER_ABI = [
  { name: 'exactInputSingle', type: 'function', stateMutability: 'payable',
    inputs: [{
      name: 'params', type: 'tuple', components: [
        { name: 'tokenIn',          type: 'address' },
        { name: 'tokenOut',         type: 'address' },
        { name: 'deployer',        type: 'address' },
        { name: 'recipient',        type: 'address' },
        { name: 'deadline',         type: 'uint256' },
        { name: 'amountIn',         type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'limitSqrtPrice',   type: 'uint160' },
      ]
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

export const ALGEBRA_QUOTER_ABI = [
  { name: 'quoteExactInputSingle', type: 'function', stateMutability: 'view',
    inputs: [{
      name: 'params', type: 'tuple', components: [
        { name: 'tokenIn',        type: 'address' },
        { name: 'tokenOut',       type: 'address' },
        { name: 'deployer',      type: 'address' },
        { name: 'amountIn',       type: 'uint256' },
        { name: 'limitSqrtPrice', type: 'uint160' },
      ]
    }],
    outputs: [
      { name: 'amountOut',              type: 'uint256' },
      { name: 'amountIn',               type: 'uint256' },
      { name: 'sqrtPriceX96After',      type: 'uint160' },
      { name: 'initializedTicksCrossed',type: 'uint32'  },
      { name: 'gasEstimate',            type: 'uint256' },
      { name: 'fee',                    type: 'uint16'  },
    ],
  },
] as const

export const LB_FACTORY_ABI = [
  { name: 'getLBPairInformation', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'tokenX',  type: 'address' },
      { name: 'tokenY',  type: 'address' },
      { name: 'binStep', type: 'uint256' },
    ],
    outputs: [{
      name: 'lbPairInformation', type: 'tuple', components: [
        { name: 'binStep',           type: 'uint16' },
        { name: 'LBPair',            type: 'address' },
        { name: 'createdByOwner',    type: 'bool' },
        { name: 'ignoredForRouting', type: 'bool' },
      ]
    }],
  },
  { name: 'getAllLBPairs', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'tokenX', type: 'address' }, { name: 'tokenY', type: 'address' }],
    outputs: [{
      name: 'lbPairsAvailable', type: 'tuple[]', components: [
        { name: 'binStep',           type: 'uint16' },
        { name: 'LBPair',            type: 'address' },
        { name: 'createdByOwner',    type: 'bool' },
        { name: 'ignoredForRouting', type: 'bool' },
      ]
    }],
  },
] as const


// AeonTowerDefenseArena — entry fee + self-funded prize pool for the Tower
// Defense mini-game. startSession() pulls the fee and records the session on
// chain; claimReward() only pays out with a valid signature from the
// contract's trustedSigner (a dedicated off-chain key that re-checks the
// session and applies anti-cheat rules before signing -- see /api/games/tower-defense/claim).
export const TOWER_DEFENSE_ARENA_ABI = [
  { name: 'startSession', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'difficulty', type: 'uint8' }], outputs: [{ name: 'sessionId', type: 'uint256' }] },
  { name: 'claimReward', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'rewardAmount', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ], outputs: [] },
  { name: 'entryFee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'maxRewardPerClaim', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'sessions', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'player', type: 'address' },
      { name: 'startedAt', type: 'uint40' },
      { name: 'difficulty', type: 'uint8' },
      { name: 'claimed', type: 'bool' },
    ] },
  { name: 'SessionStarted', type: 'event', inputs: [
    { name: 'sessionId', type: 'uint256', indexed: true },
    { name: 'player', type: 'address', indexed: true },
    { name: 'difficulty', type: 'uint8', indexed: false },
    { name: 'fee', type: 'uint256', indexed: false },
  ] },
  { name: 'RewardClaimed', type: 'event', inputs: [
    { name: 'sessionId', type: 'uint256', indexed: true },
    { name: 'player', type: 'address', indexed: true },
    { name: 'reward', type: 'uint256', indexed: false },
  ] },
] as const

// Token Launchpad -- deployed 2026-07-11 (AeonLPLocker 0xE42c5602..., then
// AeonTokenLaunchpad 0xf4565380... wired to it). Every launched token is an
// AeonLaunchTaxToken: fixed non-optional 0.025% transfer tax, auto-swapped to
// AEON and burned on every transfer (see the contract's own header comment in
// aeon-protocol-v5/src/launchpad/AeonLaunchpadSuite.sol for the full
// reentrancy/MEV-tradeoff reasoning). Launch fee is a % of the quote
// liquidity (owner-adjustable, hard-capped on-chain at 5%), currently 0.
export const AEON_TOKEN_LAUNCHPAD_ABI = [
  { name: 'launchFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'MAX_LAUNCH_FEE_BPS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'feeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'launchCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'launches',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'quoteToken', type: 'address' },
      { name: 'pool', type: 'address' },
      { name: 'feeBps', type: 'uint24' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'tokenLiquidity', type: 'uint256' },
      { name: 'quoteLiquidity', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'lpDestination', type: 'uint8' },
      { name: 'lockId', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
    ],
  },
  {
    name: 'launchTokenWithNativeLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'metadataURI', type: 'string' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'tokenLiquidityAmount', type: 'uint256' },
        { name: 'minTokenAmount', type: 'uint256' },
        { name: 'minNativeAmount', type: 'uint256' },
        { name: 'feeBps', type: 'uint24' },
        { name: 'deadline', type: 'uint256' },
        { name: 'lpDestination', type: 'uint8' },
        { name: 'lpUnlockTime', type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
      { name: 'liquidityOrLockId', type: 'uint256' },
    ],
  },
  {
    name: 'launchTokenWithTokenLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'metadataURI', type: 'string' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'tokenLiquidityAmount', type: 'uint256' },
        { name: 'quoteToken', type: 'address' },
        { name: 'quoteLiquidityAmount', type: 'uint256' },
        { name: 'minTokenAmount', type: 'uint256' },
        { name: 'minQuoteAmount', type: 'uint256' },
        { name: 'feeBps', type: 'uint24' },
        { name: 'deadline', type: 'uint256' },
        { name: 'lpDestination', type: 'uint8' },
        { name: 'lpUnlockTime', type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
      { name: 'liquidityOrLockId', type: 'uint256' },
    ],
  },
  {
    name: 'TokenLaunched',
    type: 'event',
    inputs: [
      { name: 'launchId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'quoteToken', type: 'address', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'lpDestination', type: 'uint8', indexed: false },
      { name: 'lockId', type: 'uint256', indexed: false },
      { name: 'metadataURI', type: 'string', indexed: false },
    ],
  },
  {
    name: 'LaunchFeePaid',
    type: 'event',
    inputs: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'quoteToken', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'feeRecipient', type: 'address', indexed: false },
    ],
  },
] as const

export const AEON_LP_LOCKER_ABI = [
  { name: 'lockCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'locksOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256[]' }] },
  {
    name: 'locks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'lpToken', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'unlockTime', type: 'uint256' },
      { name: 'withdrawn', type: 'bool' },
    ],
  },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'lockId', type: 'uint256' }], outputs: [] },
  {
    name: 'LPLocked', type: 'event', inputs: [
      { name: 'lockId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'lpToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'unlockTime', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LPWithdrawn', type: 'event', inputs: [
      { name: 'lockId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'lpToken', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

// Token Launchpad V2 -- deployed 2026-07-11, supersedes AEON_TOKEN_LAUNCHPAD_ABI
// above (0xf4565380...) same day. No creator/burn/lock choice anymore -- every
// launch's LP always ends up permanently staked in a real gauge, via a
// two-step flow (see the contracts.ts comment on AeonTokenLaunchpadV2 for why
// gauge creation can't be atomic): launch first (LP held by the contract,
// unstaked), then keeper/launchpad-keeper.js in aeon-protocol-v5 creates the
// gauge and calls stakeLaunch() shortly after.
export const AEON_TOKEN_LAUNCHPAD_V2_ABI = [
  { name: 'launchFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'MAX_LAUNCH_FEE_BPS', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'feeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'launchCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    name: 'launches',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'quoteToken', type: 'address' },
      { name: 'pool', type: 'address' },
      { name: 'gauge', type: 'address' },
      { name: 'feeBps', type: 'uint24' },
      { name: 'totalSupply', type: 'uint256' },
      { name: 'tokenLiquidity', type: 'uint256' },
      { name: 'quoteLiquidity', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
    ],
  },
  {
    name: 'launchTokenWithNativeLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'metadataURI', type: 'string' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'tokenLiquidityAmount', type: 'uint256' },
        { name: 'minTokenAmount', type: 'uint256' },
        { name: 'minNativeAmount', type: 'uint256' },
        { name: 'feeBps', type: 'uint24' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
    ],
  },
  {
    name: 'launchTokenWithTokenLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'request',
      type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'symbol', type: 'string' },
        { name: 'metadataURI', type: 'string' },
        { name: 'totalSupply', type: 'uint256' },
        { name: 'tokenLiquidityAmount', type: 'uint256' },
        { name: 'quoteToken', type: 'address' },
        { name: 'quoteLiquidityAmount', type: 'uint256' },
        { name: 'minTokenAmount', type: 'uint256' },
        { name: 'minQuoteAmount', type: 'uint256' },
        { name: 'feeBps', type: 'uint24' },
        { name: 'deadline', type: 'uint256' },
      ],
    }],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'pool', type: 'address' },
    ],
  },
  { name: 'stakeLaunch', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'launchId', type: 'uint256' }], outputs: [] },
  { name: 'harvestLaunchRewards', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'launchId', type: 'uint256' }], outputs: [] },
  {
    name: 'TokenLaunched',
    type: 'event',
    inputs: [
      { name: 'launchId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'quoteToken', type: 'address', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
      { name: 'metadataURI', type: 'string', indexed: false },
    ],
  },
  {
    name: 'LaunchStaked',
    type: 'event',
    inputs: [
      { name: 'launchId', type: 'uint256', indexed: true },
      { name: 'gauge', type: 'address', indexed: true },
      { name: 'liquidity', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'LaunchFeePaid',
    type: 'event',
    inputs: [
      { name: 'creator', type: 'address', indexed: true },
      { name: 'quoteToken', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'feeRecipient', type: 'address', indexed: false },
    ],
  },
  {
    name: 'LaunchRewardsHarvested',
    type: 'event',
    inputs: [
      { name: 'launchId', type: 'uint256', indexed: true },
      { name: 'aeonBurned', type: 'uint256', indexed: false },
    ],
  },
] as const
