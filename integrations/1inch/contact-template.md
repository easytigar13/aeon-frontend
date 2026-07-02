# 1inch Integration Request — AEON Protocol

**Send to:** 1inch team via Discord (#partnerships) or https://1inch.io → Partners

---

## Subject: DEX Integration Request — AEON Protocol on Robinhood Chain

Hi 1inch team,

We'd like to request integration of **AEON Protocol** into 1inch's routing engine on Robinhood Chain (chainId 4663).

### What is AEON?

AEON is a ve(3,3) DEX on Robinhood Chain with a fee-anchored emissions model: weekly AEON emissions are algorithmically capped at 1/10th of protocol fees. This prevents token inflation without real usage.

### Protocol Contracts

| Contract        | Address |
|-----------------|---------|
| Factory         | `0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6` |
| Router          | `0x4d188106175De919a971B0cB6F8A0e3E885a3410` |
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
| AEON/ETH      | 1%    | `0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3` |
| AEON/USDG     | 1%    | `0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434` |
| ETH/USDG      | 0.3%  | `0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2` |

### Chain
Robinhood Chain, chainId 4663 (Arbitrum Orbit L2, native gas token ETH)
RPC: https://rpc.mainnet.chain.robinhood.com

### Docs
https://aeonprotocol.net/docs

### Contact
- Email: easytigar1@gmail.com
- Twitter: @AeonProtocol

We're happy to assist with any technical details needed for the integration.

Thanks!
