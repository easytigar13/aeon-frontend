import { keccak256, toBytes } from 'viem'

const target = '0x13be252b'

const prefixes = [
  'Invalid', 'Err', 'Error', 'Router', 'Swap', 'Hop', 'Pool', 'Amount', 'Fee', 'Slippage', 'Tax', 'Balance', 'Allowance',
]

const nouns = [
  'Hop', 'Pool', 'Route', 'Fee', 'FeeBps', 'Amount', 'Input', 'Output', 'Slippage', 'Deadline', 'PoolType', 'Pair', 'Reserve', 'Token', 'Owner', 'Sender', 'Zero', 'Min', 'Max',
]

const suffixes = [
  '()',
  '(address)',
  '(uint256)',
  '(uint8)',
  '(uint24)',
  '(address,address)',
  '(uint256,uint256)',
  '(uint8,address)',
]

for (const p of prefixes) {
  for (const n of nouns) {
    for (const s of suffixes) {
      const name = `${p}${n}${s}`
      const hash = keccak256(toBytes(name)).slice(0, 10)
      if (hash.toLowerCase() === target.toLowerCase()) {
        console.log(`🎯 MATCH FOUND: ${name} === ${hash}`)
      }
    }
  }
}
