import { DexParams } from '../uniswap-v2/types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';

// TODO before submitting this PR: AEON moved from Avalanche to Robinhood
// Chain (chainId 4663). This fork's `Network` enum (src/constants.ts) has no
// ROBINHOOD_CHAIN member yet and paraswap doesn't run adapter contracts on
// Robinhood Chain yet either — both need to land upstream first. Once
// Network.ROBINHOOD_CHAIN exists, swap the keys below and update
// factoryAddress (already correct — see comment).
export const AeonVAMMConfig: DexConfigMap<DexParams> = {
  AeonVAMM: {
    [Network.AVALANCHE]: {
      // Real Robinhood Chain factory: 0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6
      // (left keyed under AVALANCHE until Network.ROBINHOOD_CHAIN exists upstream)
      factoryAddress: '0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6',
      initCode:
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      feeCode: 10,  // 0.1% default; actual per-pool fee is read on-chain
      poolGasCost: 80_000,
    },
  },
};

export const Adapters: {
  [chainId: number]: { [side: string]: { name: string; index: number }[] };
} = {
  [Network.AVALANCHE]: {
    [SwapSide.SELL]: [{ name: 'AvalancheAdapter01', index: 2 }],
    [SwapSide.BUY]: [{ name: 'AvalancheBuyAdapter', index: 1 }],
  },
};
