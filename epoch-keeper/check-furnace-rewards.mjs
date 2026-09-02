import 'dotenv/config'
import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
const RPC = process.env.RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com'
const c = createPublicClient({ transport: http(RPC) })

const VOTER    = '0xbC75c2e29d145816aE65164Ab531839e7EbA12Cb'
const FURNACE  = '0xdeC58B16B24536bc5009Ad4AfDd0C48fF69F919A'
const BUYBACK  = '0x51Aa877E1a5337Ba5804E025c16080Ea459363c4'
const BOT      = '0x32A3FC106f77300524Dc2dC4D5E672EF08615391'
const AEON     = '0xd4c93eD1843606f92CccA078941f3d52A585982f'

const VOTER_ABI = parseAbi([
  'function usedWeights(address) view returns (uint256)',
  'function lastVoted(address) view returns (uint256)',
  'function totalWeight() view returns (uint256)',
])
const FURNACE_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function claimable(address) view returns (uint256)',
  'function earned(address) view returns (uint256)',
])
const BUYBACK_ABI = parseAbi([
  'function claimable(address) view returns (uint256)',
  'function earned(address) view returns (uint256)',
  'function rewardPerToken() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

const rd = (addr,abi,fn,args=[]) => c.readContract({address:addr,abi,functionName:fn,args}).catch(e=>'ERR:'+e.shortMessage)

// Furnace voting state
const [furnaceUsed, furnaceLastVoted, totalWeight] = await Promise.all([
  rd(VOTER, VOTER_ABI, 'usedWeights', [FURNACE]),
  rd(VOTER, VOTER_ABI, 'lastVoted', [FURNACE]),
  rd(VOTER, VOTER_ABI, 'totalWeight'),
])
console.log('=== FURNACE VOTE STATE ===')
console.log('usedWeight :', typeof furnaceUsed==='bigint' ? formatUnits(furnaceUsed,18)+' veAEON' : furnaceUsed)
console.log('lastVoted  :', typeof furnaceLastVoted==='bigint' && furnaceLastVoted>0n ? new Date(Number(furnaceLastVoted)*1000).toISOString() : 'never')
console.log('totalWeight:', typeof totalWeight==='bigint' ? formatUnits(totalWeight,18)+' veAEON' : totalWeight)

// Bot wallet furnace balance
const [botFurnaceBal, furnaceSupply] = await Promise.all([
  rd(FURNACE, FURNACE_ABI, 'balanceOf', [BOT]),
  rd(FURNACE, FURNACE_ABI, 'totalSupply'),
])
console.log('\n=== BOT WALLET FURNACE POSITION ===')
console.log('bot furnace bal  :', typeof botFurnaceBal==='bigint' ? formatUnits(botFurnaceBal,18) : botFurnaceBal)
console.log('furnace totalSup :', typeof furnaceSupply==='bigint' ? formatUnits(furnaceSupply,18) : furnaceSupply)

// Bot wallet claimable from furnace/buyback
const [claimable, earned, bbClaimable, bbEarned, bbBal] = await Promise.all([
  rd(FURNACE, FURNACE_ABI, 'claimable', [BOT]),
  rd(FURNACE, FURNACE_ABI, 'earned', [BOT]),
  rd(BUYBACK, BUYBACK_ABI, 'claimable', [BOT]),
  rd(BUYBACK, BUYBACK_ABI, 'earned', [BOT]),
  rd(BUYBACK, BUYBACK_ABI, 'balanceOf', [BOT]),
])
console.log('\n=== BOT CLAIMABLE REWARDS ===')
console.log('Furnace claimable:', typeof claimable==='bigint' ? formatUnits(claimable,18)+' AEON' : claimable)
console.log('Furnace earned   :', typeof earned==='bigint' ? formatUnits(earned,18)+' AEON' : earned)
console.log('Buyback claimable:', typeof bbClaimable==='bigint' ? formatUnits(bbClaimable,18)+' AEON' : bbClaimable)
console.log('Buyback earned   :', typeof bbEarned==='bigint' ? formatUnits(bbEarned,18)+' AEON' : bbEarned)
console.log('Buyback balance  :', typeof bbBal==='bigint' ? formatUnits(bbBal,18) : bbBal)

// Bot AEON balance
const botAeon = await rd(AEON, ERC20_ABI, 'balanceOf', [BOT])
console.log('\nBot AEON balance :', typeof botAeon==='bigint' ? formatUnits(botAeon,18)+' AEON' : botAeon)
