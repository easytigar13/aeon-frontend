# 1inch Integration Request — AEON Protocol

**Send to:** 1inch team via Discord (#partnerships) or https://1inch.io → Partners

---

## Subject: DEX Integration Request — AEON Protocol on Avalanche

Hi 1inch team,

We'd like to request integration of **AEON Protocol** into 1inch's routing engine on Avalanche C-Chain (chainId 43114).

### What is AEON?

AEON is a ve(3,3) DEX on Avalanche with a fee-anchored emissions model: weekly AEON emissions are algorithmically capped at 1/10th of protocol fees. This prevents token inflation without real usage.

### Protocol Contracts

| Contract        | Address |
|-----------------|---------|
| Factory         | `0x3ECf287990A2365d48C6681620393aC1cdF3D268` |
| Router          | `0xD847Ea61394ADa3bb23B373349b58C90f9126A9F` |
| AEON Token      | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

### Pool Type

**vAMM** — UniswapV2-compatible constant product (x*y=k). Fully compatible with existing UniswapV2 adapters.

- `getReserves()` → `(uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)`
- `token0()` → `address`
- `token1()` → `address`
- `swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)`
- Fee range: 1–100 bps

### Key Pools

| Pool          | Fee   | Address |
|---------------|-------|---------|
| AEON/WAVAX    | 1%    | `0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489` |
| AEON/USDC     | 1%    | `0xFD029a446632618f218189d4a0B572896CD29B58` |
| WAVAX/USDC    | 0.3%  | `0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086` |

### Chain
Avalanche C-Chain, chainId 43114

### Docs
https://app.aeonprotocol.xyz/docs

### Contact
- Email: easytigar1@gmail.com
- Twitter: @AeonProtocolX

We're happy to assist with any technical details needed for the integration.

Thanks!
