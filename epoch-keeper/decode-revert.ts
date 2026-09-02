import { keccak256, toBytes } from 'viem'

const target = '0x13be252b'

const candidateErrors = [
  'InvalidHop()',
  'InvalidPool()',
  'InvalidRoute()',
  'InvalidPoolType()',
  'InvalidFee()',
  'FeeMismatch()',
  'InvalidAmount()',
  'ZeroAmount()',
  'TransferFailed()',
  'InsufficientOutputAmount()',
  'InsufficientInputAmount()',
  'K()',
  'Expired()',
  'Unauthorized()',
  'PoolNotFound()',
  'InvalidPair()',
  'IdenticalAddresses()',
  'ZeroAddress()',
]

for (const err of candidateErrors) {
  const hash = keccak256(toBytes(err)).slice(0, 10)
  if (hash.toLowerCase() === target.toLowerCase()) {
    console.log(`🎯 MATCH FOUND: ${err} === ${hash}`)
  }
}
