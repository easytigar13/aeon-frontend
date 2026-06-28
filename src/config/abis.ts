// ABI fragments — only what the frontend needs

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
] as const
