# Odos Integration Request — AEON Protocol

**Send via:** https://www.odos.xyz → Partners / Contact form

---

## Protocol Overview

**Name:** AEON Protocol  
**Chain:** Avalanche C-Chain (chainId 43114)  
**Website:** https://app.aeonprotocol.xyz  
**Docs:** https://app.aeonprotocol.xyz/docs  
**Twitter:** @AeonProtocolX  

AEON is a ve(3,3) DEX on Avalanche. Emissions are algorithmically capped at 1/10th of protocol fees — the first truly fee-anchored DEX on Avalanche.

## Contracts

| Contract   | Address |
|------------|---------|
| Factory    | `0x3ECf287990A2365d48C6681620393aC1cdF3D268` |
| Router     | `0xD847Ea61394ADa3bb23B373349b58C90f9126A9F` |
| AEON Token | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

## Pool Interface (UniswapV2-compatible)

```solidity
function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
function token0() external view returns (address);
function token1() external view returns (address);
function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
```

## Swap Math

```
amountOut = (amountIn * (10000 - feeBps) * reserveOut)
          / (reserveIn * 10000 + amountIn * (10000 - feeBps))
```

Fee range: 1–100 bps (0.01%–1%)

## Active Pools

| Pair       | Fee   | Address |
|------------|-------|---------|
| AEON/WAVAX | 1%    | `0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489` |
| AEON/USDC  | 1%    | `0xFD029a446632618f218189d4a0B572896CD29B58` |
| WAVAX/USDC | 0.3%  | `0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086` |

## Contact
- Email: easytigar1@gmail.com
- Twitter: @AeonProtocolX
