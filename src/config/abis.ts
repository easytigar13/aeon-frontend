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

// EmissionsEngineRH.sol
export const EMISSIONS_ENGINE_ABI = [
  {
    name: 'lastMintAmount',
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
    name: 'genesisDone',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'updatePeriod',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'period', type: 'uint256' }],
  },
] as const

// FeeDistributorV3.sol
export const FEE_DISTRIBUTOR_ABI = [
  {
    name: 'lastEpochFeesUSD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
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

