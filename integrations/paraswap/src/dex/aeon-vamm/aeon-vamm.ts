import { Network } from '../../constants';
import { IDexHelper } from '../../dex-helper/index';
import { UniswapV2 } from '../uniswap-v2/uniswap-v2';
import { AeonVAMMConfig } from './config';
import { getDexKeysWithNetwork } from '../../utils';

/**
 * AEON Protocol vAMM — constant product (x*y=k) AMM on Robinhood Chain.
 * Factory: 0xD8495E398Fd7F0293Ccfca4a16181216CfDa6ED6
 * Chain:   Robinhood Chain (4663)
 * Docs:    https://aeonprotocol.net/docs
 */
export class AeonVAMM extends UniswapV2 {
  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(AeonVAMMConfig);

  constructor(
    protected network: Network,
    dexKey: string,
    protected dexHelper: IDexHelper,
  ) {
    const cfg = AeonVAMMConfig[dexKey][network];
    super(
      network,
      dexKey,
      dexHelper,
      false,              // isDynamicFees
      cfg.factoryAddress,
      cfg.subgraphURL,
      cfg.initCode,
      cfg.feeCode,
      cfg.poolGasCost,
    );
  }
}
