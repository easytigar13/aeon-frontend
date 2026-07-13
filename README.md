# AEON Protocol

A ve(3,3) DEX on **Robinhood Chain** (chainId 4663) where emissions are anchored to real trading fees:

```
Weekly AEON Emissions = Last Epoch Fees ÷ 10
```

No inflation without demand. Zero team allocation at genesis.

- **Website:** https://aeonprotocol.net
- **Docs:** https://aeonprotocol.net/docs
- **Twitter:** [@AeonProtocol](https://twitter.com/AeonProtocol)

## What's in this repo

This is the Next.js frontend for AEON Protocol, plus supporting infrastructure:

```
src/            — Next.js 14 app (swap, liquidity, earn, vote, lock, dashboard, docs)
contracts/      — standalone helper contracts (e.g. pair discovery registry)
integrations/   — DEX aggregator integration requests and PR drafts (1inch, Odos,
                   KyberSwap, ParaSwap, OpenOcean)
keeper/         — price-equalization arbitrage bot across AEON pools
```

The protocol's core smart contracts (token, voting escrow, furnace, voter, emissions
engine, factory, router, liquidity helper, whitelist) live in a separate Foundry repo
and are deployed at the addresses listed below.

## Tokenomics

- **Genesis:** 90,000 AEON minted once. 20,000 seeded into AEON/ETH liquidity, 20,000
  into AEON/USDG liquidity, 50,000 burned via the Furnace and voted 25,000/25,000
  across both AEON pools — guaranteeing gauge weight from day one.
- **Fee split, forever after:** 80% of every fee goes straight to veNFT voters of that
  pool. The remaining 20% routes to the Buyback Engine, split 50/50: half swapped to
  AEON and burned forever, half swapped to AEON and redistributed to Furnace burners
  (liquid AEON, no unstaking required).
- **Whitelist:** a one-time 100 AEON payment to the protocol treasury permanently
  unlocks the ability to add liquidity for that wallet.

Full breakdown at [aeonprotocol.net/docs](https://aeonprotocol.net/docs).

## Deployed contracts (Robinhood Chain, chainId 4663)

| Contract | Address |
|---|---|
| AEON Token | `0xd4c93eD1843606f92CccA078941f3d52A585982f` |
| Minter Proxy | `0x05b04A4344520Bb08201Bd9460ec9d37aD5f7918` |
| VotingEscrow (veNFT) | `0x0b18B0f483f1caAaBB7505bCD8D1C3C43197Add9` |
| The Furnace | `0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A` |
| Voter | `0x2f4cad5f25AcC8E8d18a77ACEc5E2832B6cFF104` |
| Gauge Factory | `0x044f2A04Ca5D521293E6687D9a2953cf2B27a3C1` |
| Buyback Engine | `0xe159282352fbD7aF64C22d581cf6338C382b7c5A` |
| Fee Distributor | `0x772C2Ba92278D47B3A76b3f97b26A5c74d7F7975` |
| Emissions Engine | `0xbF021C27F317b7e8B23d47B9063c5551D8527986` |
| Protocol Burn Reward Distributor | `0xA258263aA1eE6870344336A17a1D94E18b7Af568` |
| Oracle | `0x5A1E28EE00C4e83De000C7ffa5b59B22B45BD9BD` |
| Factory | `0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6` |
| Router | `0x4d188106175De919a971B0cB6F8A0e3E885a3410` |
| Liquidity Helper | `0x8e33182d3271e2902Ed36aCA77A79e28c8F22d4e` |
| Whitelist | `0x0337333fdCf79D08f4ac10321796A91f300b5a80` |

**Pools (vAMM at genesis; concentrated liquidity pools land next):**

| Pair | Fee | Address |
|---|---|---|
| AEON/ETH | 1% | `0xD1E04Ab9CE0a6854914cd9C929B401BDf0700Be3` |
| AEON/USDG | 1% | `0x69072b04Cf3eEE09b474d9aB9f80Aa17506ee434` |
| ETH/USDG | 0.3% | `0x955bEeee93D334437c1Fe284C40ab28EACbe1ca2` |

## Running the frontend locally

```bash
npm install
npm run dev
```

Requires no environment variables for read-only browsing — wallet connection uses
RainbowKit and works against Robinhood Chain out of the box.
