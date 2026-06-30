// ABI fragments — only what the frontend needs

// Algebra Integral NonfungiblePositionManager — mint a concentrated-liquidity position
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
  {
    name: 'swapExactAVAXForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'routes', type: 'tuple[]', components: [
        { name: 'tokenIn',  type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'pool',     type: 'address' },
        { name: 'poolType', type: 'uint8'   },
        { name: 'feeBps',   type: 'uint24'  },
      ]},
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'to',           type: 'address' },
      { name: 'deadline',     type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'swapExactTokensForAVAX',
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

export const EMISSIONS_ENGINE_ABI = [
  {
    name: 'weeklyEmissions',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'epochFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'lastEpochFees',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export const VOTER_ABI_WHITELIST = [
  {
    name: 'whitelist',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_token', type: 'address' }],
    outputs: [],
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

