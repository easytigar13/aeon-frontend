import fs from 'fs'
import path from 'path'
import * as dotenv from 'dotenv'
import { writeBotStatus } from '../src/lib/botStore.ts'

dotenv.config({ path: path.join(process.cwd(), 'keeper', '.env') })

async function push() {
  const statusPath = path.join(process.cwd(), 'keeper', 'status.json')
  const raw = fs.readFileSync(statusPath, 'utf-8')
  const status = JSON.parse(raw)
  console.log(`Pushing fresh status to Upstash Redis... (opportunities count: ${status.lastOpportunities?.length ?? 0})`)
  await writeBotStatus(status, 'mirajane')
  await writeBotStatus(status)
  console.log('✅ Successfully updated Upstash Redis status key!')
}

push().catch(console.error)
