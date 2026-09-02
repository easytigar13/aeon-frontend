import { keccak256, toBytes } from 'viem'

const target = '0xf4d678b8'

const errors = [
  'TradingNotActive()',
  'TradingNotEnabled()',
  'TradingDisabled()',
  'MaxTxExceeded()',
  'MaxWalletExceeded()',
  'TransferPaused()',
  'TokenPaused()',
  'Blacklisted()',
  'NotWhitelisted()',
  'InsufficientBalance()',
  'ERC20InsufficientBalance(address,uint256,uint256)',
  'ERC20InsufficientAllowance(address,uint256,uint256)',
  'ERC20InvalidSender(address)',
  'ERC20InvalidReceiver(address)',
  'ERC20InvalidSpender(address)',
  'OwnableUnauthorizedAccount(address)',
  'InvalidTax()',
  'FeeTooHigh()',
]

for (const e of errors) {
  const hash = keccak256(toBytes(e)).slice(0, 10)
  if (hash.toLowerCase() === target.toLowerCase()) {
    console.log(`🎯 MATCH FOUND: ${e} === ${hash}`)
  }
}
