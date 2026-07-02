# [Robinhood Chain] Add AEON Protocol vAMM

## What is AEON Protocol?

AEON is a ve(3,3) DEX on Robinhood Chain (chainId 4663) with a unique **fee-anchored emissions model**: weekly AEON token emissions are algorithmically capped at 1/10th of protocol fees. This prevents token inflation without corresponding real usage — a fee-anchored DEX from genesis, with zero team allocation.

- Website: https://aeonprotocol.net
- Docs: https://aeonprotocol.net/docs
- Chain: Robinhood Chain (4663), an Arbitrum Orbit L2 with native gas token ETH
- Twitter: @AeonProtocol

## Pricing Logic

**Pool type:** vAMM — constant product (x*y=k), UniswapV2-compatible interface.

Standard AMM formula:
```
amountOut = (amountIn * (10000 - feeBps) * reserveOut)
          / (reserveIn * 10000 + amountIn * (10000 - feeBps))
```

Fee range: 1–100 bps (0.01%–1%), variable per pool.

## Important Contracts

| Contract     | Address |
|--------------|---------|
| Factory      | `0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6` |
| Router       | `0x4d188106175De919a971B0cB6F8A0e3E885a3410` |
| AEON Token   | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

## Key Pools (Robinhood Chain)

| Pair        | Fee   | Address |
|-------------|-------|---------|
| AEON/ETH    | 1%    | `0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3` |
| AEON/USDG   | 1%    | `0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434` |
| ETH/USDG    | 0.3%  | `0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2` |

## Files Added

```
src/dex/aeon-vamm/
  aeon-vamm.ts   — extends UniswapV2 with AEON factory config
  config.ts      — DexConfigMap for Robinhood Chain
  types.ts       — re-exports UniswapV2Data (identical structure)
  index.ts       — barrel export
```

Add to `src/dex/index.ts`:
```ts
import { AeonVAMM } from './aeon-vamm';
// ... in the Dexes map:
AeonVAMM,
```

## Pool Interface

Fully UniswapV2-compatible:
```solidity
getReserves() → (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
token0()      → address
token1()      → address
swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data)
```

## Contact
Twitter: @AeonProtocol | easytigar1@gmail.com
