import { createPublicClient, http, fallback, parseAbi, parseUnits, getAddress } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const FRONG_TOKEN = TOKENS.FRONG.address
const USER_WALLET = getAddress('0x6d93ab63068f9b9f71c4c1144f0bcc4d3dcbb557')
const DUMMY_RECIPIENT = '0x0000000000000000000000000000000000000001' as `0x${string}`

const TOKEN_TEST_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
  'function paused() view returns (bool)',
  'function tradingEnabled() view returns (bool)',
  'function maxTxAmount() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
])

async function testToken() {
  console.log(`🔍 Inspecting FRONG Token Contract (${FRONG_TOKEN})...`)

  try {
    const bal = await publicClient.readContract({ address: FRONG_TOKEN, abi: TOKEN_TEST_ABI, functionName: 'balanceOf', args: [USER_WALLET] })
    console.log(`User FRONG Balance: ${bal.toString()}`)
  } catch (e: any) {
    console.log(`balanceOf: ${e?.shortMessage ?? e?.message}`)
  }

  try {
    const owner = await publicClient.readContract({ address: FRONG_TOKEN, abi: TOKEN_TEST_ABI, functionName: 'owner' })
    console.log(`Token Owner: ${owner}`)
  } catch {}

  try {
    const paused = await publicClient.readContract({ address: FRONG_TOKEN, abi: TOKEN_TEST_ABI, functionName: 'paused' })
    console.log(`Paused: ${paused}`)
  } catch {}

  try {
    const trading = await publicClient.readContract({ address: FRONG_TOKEN, abi: TOKEN_TEST_ABI, functionName: 'tradingEnabled' })
    console.log(`Trading Enabled: ${trading}`)
  } catch {}

  // Simulate direct transfer of 1 FRONG from user to DUMMY_RECIPIENT
  try {
    console.log('\nSimulating direct transfer(DUMMY_RECIPIENT, 1 FRONG)...')
    await publicClient.simulateContract({
      address: FRONG_TOKEN,
      abi: TOKEN_TEST_ABI,
      functionName: 'transfer',
      args: [DUMMY_RECIPIENT, parseUnits('1', 18)],
      account: USER_WALLET,
    })
    console.log('✅ Direct transfer simulation SUCCESS!')
  } catch (e: any) {
    console.error('❌ Direct transfer simulation failed:', e?.shortMessage ?? e?.message ?? e)
  }
}

testToken()
