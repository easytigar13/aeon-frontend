# [Avalanche] Add AEON Protocol vAMM liquidity source

## Protocol

**AEON Protocol** is a ve(3,3) DEX on Avalanche C-Chain (chainId 43114) with a fee-anchored emissions model.
Weekly AEON token emissions are algorithmically capped at 1/10th of protocol fees — no inflation without real usage.

- Website: https://app.aeonprotocol.xyz
- Docs: https://app.aeonprotocol.xyz/docs
- Chain: Avalanche C-Chain (43114)

## Pricing Logic

**Pool type:** vAMM — constant product (x*y=k), UniswapV2-compatible interface.

**Swap formula:**
```
amountOut = (amountIn * (10000 - feeBps) * reserveOut)
          / (reserveIn * 10000 + amountIn * (10000 - feeBps))
```

Fee range: 1–100 bps (0.01%–1%), encoded per pool.

## Contracts

| Contract        | Address |
|-----------------|---------|
| Factory         | `0x3ECf287990A2365d48C6681620393aC1cdF3D268` |
| Router          | `0xD847Ea61394ADa3bb23B373349b58C90f9126A9F` |
| AEON Token      | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

## Key Pools

| Pair          | Fee   | Address |
|---------------|-------|---------|
| AEON/WAVAX    | 1%    | `0xF03A55f9578c35Ec442e2F5dA040C20fF3A59489` |
| AEON/USDC     | 1%    | `0xFD029a446632618f218189d4a0B572896CD29B58` |
| WAVAX/USDC    | 0.3%  | `0x3feb54fE68d7C6B2105EB0b06eD8c92cf0182086` |

## Files Added

```
pkg/liquidity-source/aeon-vamm/
  config.go            — factory address, chain config
  types.go             — Extra (reserves + fee), PoolMeta
  pool_list_updater.go — fetches all pairs from factory in batches
  pool_simulator.go    — CalcAmountOut + UpdateBalance (x*y=k)
```

## Contact

Twitter: @AeonProtocolX
