# Submitting AEON Protocol Fees & Volume to DefiLlama

To get your 24h Fees, 7d Fees, and Volume stats populated on DefiLlama for AEON Protocol on Robinhood Chain, follow these steps to open a Pull Request (PR) to DefiLlama's open-source repository.

---

## Step-by-Step Instructions

### 1. Fork DefiLlama's `dimension-adapters` repository
Go to GitHub: [https://github.com/DefiLlama/dimension-adapters](https://github.com/DefiLlama/dimension-adapters) and click **Fork** (top right).

### 2. Add the AEON Adapter File
In your forked repository, create a new directory and file:
- **Path:** `fees/aeon-protocol/index.ts` (or `dexs/aeon-protocol/index.ts`)

Paste the contents of `integrations/defillama/index.ts`:

```typescript
import { SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { getUniV2LogAdapter } from "../../helpers/uniswap";

const FACTORY_V2 = "0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC";
const FACTORY_V1 = "0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6";

const adapter: SimpleAdapter = {
  version: 2,
  adapter: {
    [CHAIN.ROBINHOOD]: {
      fetch: getUniV2LogAdapter({
        factories: [FACTORY_V2, FACTORY_V1],
        defaultFee: 0.01, // 1% default swap fee
      }),
      start: "2026-07-02",
    },
  },
};

export default adapter;
```

### 3. Test locally (Optional)
Run the test command in your terminal inside the `dimension-adapters` clone:
```bash
npm test fees aeon-protocol
```

### 4. Create Pull Request
Open a **Pull Request** from your fork to `DefiLlama/dimension-adapters:master`.
- Title: `add AEON Protocol fees and dex adapter`
- Category: `DEXs / Fees`

---

Once merged by the DefiLlama team (typically within 24 hours), DefiLlama will backfill swap fees and volume data for AEON Protocol on Robinhood Chain!
