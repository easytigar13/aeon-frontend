import { createPublicClient, http, fallback, parseAbi, formatUnits } from 'viem'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { TOKENS } from '../src/config/contracts'
import { robinhoodChain } from '../src/config/chain'

dotenv.config({ path: fileURLToPath(new URL('.env', import.meta.url)) })

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const transport = fallback([http(RPC_URL)])
const publicClient = createPublicClient({ chain: robinhoodChain, transport })

const FRONG_TOKEN = TOKENS.FRONG.address

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

async function findHolders() {
  const supply = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'totalSupply' })
  const name = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'name' })
  const symbol = await publicClient.readContract({ address: FRONG_TOKEN, abi: ERC20_ABI, functionName: 'symbol' })
  console.log(`FRONG Metadata: ${name} (${symbol}), Total Supply: ${formatUnits(supply, 18)}`)
}

findHolders()
