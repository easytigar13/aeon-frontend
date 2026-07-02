# [Robinhood Chain] Add AEON Protocol vAMM liquidity source

## Protocol

**AEON Protocol** is a ve(3,3) DEX on Robinhood Chain (chainId 4663) with a fee-anchored emissions model.
Weekly AEON token emissions are algorithmically capped at 1/10th of protocol fees — no inflation without real usage.

- Website: https://aeonprotocol.net
- Docs: https://aeonprotocol.net/docs
- Chain: Robinhood Chain (4663), an Arbitrum Orbit L2 with native gas token ETH

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
| Factory         | `0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6` |
| Router          | `0x4d188106175De919a971B0cB6F8A0e3E885a3410` |
| AEON Token      | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |

## Key Pools

| Pair          | Fee   | Address |
|---------------|-------|---------|
| AEON/ETH      | 1%    | `0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3` |
| AEON/USDG     | 1%    | `0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434` |
| ETH/USDG      | 0.3%  | `0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2` |

## Files Added

```
pkg/liquidity-source/aeon-vamm/
  config.go            — factory address, chain config
  types.go             — Extra (reserves + fee), PoolMeta
  pool_list_updater.go — fetches all pairs from factory in batches
  pool_simulator.go    — CalcAmountOut + UpdateBalance (x*y=k)
```

## Contact

Twitter: @AeonProtocol
