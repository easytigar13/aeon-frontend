# [Avalanche] Add AEON Protocol vAMM

## What is AEON Protocol?

AEON is a ve(3,3) DEX on Avalanche C-Chain (chainId 43114) with a unique **fee-anchored emissions model**: weekly AEON token emissions are algorithmically capped at 1/10th of protocol fees. This prevents token inflation without corresponding real usage — the first DEX of its kind on Avalanche.

- Website: https://app.aeonprotocol.xyz
- Docs: https://app.aeonprotocol.xyz/docs
- Chain: Avalanche C-Chain (43114)
- Twitter: @AeonProtocolX

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
| Factory      | `0x3ECf287990A2365d48C6681620393aC1cdF3D268` |
| Router       | `0xD847Ea61394ADa3bb23B373349b58C90f9126A9F` |
| AEON Token   | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

## Key Pools (Avalanche)

| Pair        | Fee   | Address |
|-------------|-------|---------|
| AEON/WAVAX  | 1%    | `0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489` |
| AEON/USDC   | 1%    | `0xFD029a446632618f218189d4a0B572896CD29B58` |
| WAVAX/USDC  | 0.3%  | `0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086` |

## Files Added

```
src/dex/aeon-vamm/
  aeon-vamm.ts   — extends UniswapV2 with AEON factory config
  config.ts      — DexConfigMap for Avalanche
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
Twitter: @AeonProtocolX | easytigar1@gmail.com
