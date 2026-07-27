import { SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { getUniV2LogAdapter } from "../../helpers/uniswap";

// AEON Protocol Factories on Robinhood Chain (Chain ID: 4663)
const FACTORY_V2 = "0xE27EA15dF9e69ce06aB8ee5a2029BD699f9cF9fC";
const FACTORY_V1 = "0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6";

const adapter: SimpleAdapter = {
  version: 2,
  adapter: {
    [CHAIN.ROBINHOOD]: {
      fetch: getUniV2LogAdapter({
        factories: [FACTORY_V2, FACTORY_V1],
        defaultFee: 0.01, // 1% default swap fee on vAMM pools
      }),
      start: "2026-07-02",
    },
  },
};

export default adapter;
