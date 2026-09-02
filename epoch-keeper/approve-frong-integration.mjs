#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { spawn } from 'node:child_process'
import { stdin as input, stdout as output } from 'node:process'

console.log('AEON FRONG/WETH FULL PROTOCOL INTEGRATION')
console.log('This registers the pool with AeonVoterV3, creates its vAMM gauge,')
console.log('sets the FRONG buyback route, starts and validates a 30-minute TWAP,')
console.log('then wires FRONG pricing into AeonOracle.')
console.log('The window may remain open for about 30 minutes.')

const rl = createInterface({ input, output })
const answer = await rl.question('\nType Yes to authorize this single integration: ')
rl.close()
if (answer.trim().toUpperCase() !== 'YES') {
  console.error('\nABORTED: Authorization cancelled')
  process.exit(1)
}

const child = spawn(process.execPath, ['epoch-keeper/integrate-frong-weth.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, AEON_FRONG_INTEGRATION_APPROVED: 'FRONG-WETH-INTEGRATION-SINGLE-USE' },
})
child.once('error', error => {
  console.error(`\nABORTED: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', code => { process.exitCode = code ?? 1 })
