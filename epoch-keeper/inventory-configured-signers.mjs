#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { privateKeyToAccount } from 'viem/accounts'

const root = path.resolve(import.meta.dirname, '..')
const files = [
  path.join(root, '.env.local'),
  path.join(root, 'epoch-keeper', '.env'),
  path.join(root, 'keeper', '.env'),
]
const found = []

for (const file of files) {
  if (!fs.existsSync(file)) continue
  const values = dotenv.parse(fs.readFileSync(file))
  for (const [name, raw] of Object.entries(values)) {
    if (!/(PRIVATE|SECRET|\bPK\b|_PK$)/i.test(name)) continue
    const value = raw.trim()
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) continue
    try {
      found.push({ file: path.relative(root, file), variable: name, address: privateKeyToAccount(value).address })
    } catch {}
  }
}

console.log(JSON.stringify({ configuredSigners: found }, null, 2))
