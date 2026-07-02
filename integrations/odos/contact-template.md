# Odos Integration Request — AEON Protocol

**Send via:** https://www.odos.xyz → Partners / Contact form

---

## Protocol Overview

**Name:** AEON Protocol
**Chain:** Robinhood Chain (chainId 4663)
**Website:** https://aeonprotocol.net
**Docs:** https://aeonprotocol.net/docs
**Twitter:** @AeonProtocol

AEON is a ve(3,3) DEX on Robinhood Chain. Emissions are algorithmically capped at 1/10th of protocol fees — a fee-anchored DEX from genesis, with zero team allocation.

## Contracts

| Contract   | Address |
|------------|---------|
| Factory    | `0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6` |
| Router     | `0x4d188106175De919a971B0cB6F8A0e3E885a3410` |
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
| AEON/ETH   | 1%    | `0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3` |
| AEON/USDG  | 1%    | `0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434` |
| ETH/USDG   | 0.3%  | `0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2` |

## Contact
- Email: easytigar1@gmail.com
- Twitter: @AeonProtocol
