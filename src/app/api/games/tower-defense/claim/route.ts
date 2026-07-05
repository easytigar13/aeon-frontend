// POST /api/games/tower-defense/claim
//
// Signs a reward attestation for AeonTowerDefenseArena.claimReward(). The
// Tower Defense game runs entirely in the player's browser, so this route is
// the only thing standing between "I won" (client-side, always fakeable) and
// a real AEON payout. It re-derives everything it can from chain instead of
// trusting the request body:
//   - session.player / session.claimed / session.difficulty come from the
//     contract's own storage, not the request.
//   - reward amount is looked up from a fixed per-difficulty table (only a
//     genuine finish -- wavesReached >= that difficulty's total waves --
//     pays anything).
//   - a minimum-elapsed-time floor (real wall-clock time since the on-chain
//     session started, not a client-reported timer) rejects claims that
//     couldn't reflect a real playthrough.
// The signer key here holds no funds -- only its address matters on-chain
// (trustedSigner) -- and the contract itself hard-caps maxRewardPerClaim and
// maxClaimsPerDay regardless of what gets signed, so even a leaked key has a
// bounded blast radius.
import { NextResponse } from 'next/server'
import { createPublicClient, http, encodePacked, keccak256, verifyMessage, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodChain } from '@/config/chain'
import { CONTRACTS, CHAIN_ID, TOKENS } from '@/config/contracts'
import { TOWER_DEFENSE_ARENA_ABI } from '@/config/abis'
import { DIFFICULTY_ORDER, REWARD_FOR_WIN, MIN_SECONDS_PER_WAVE, DIFFICULTY_TOTAL_WAVES } from '@/lib/towerDefense/enemies'

const client = createPublicClient({ chain: robinhoodChain, transport: http('https://rpc.mainnet.chain.robinhood.com') })

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: Request) {
  const signerPk = process.env.TOWER_DEFENSE_SIGNER_PK
  if (!signerPk) return jsonError('Signer not configured', 500)

  let body: any
  try { body = await req.json() } catch { return jsonError('Invalid JSON body') }

  const { sessionId, player, wavesReached, proof } = body ?? {}
  if (typeof sessionId !== 'string' || !/^[0-9]+$/.test(sessionId)) return jsonError('Invalid sessionId')
  if (typeof player !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(player)) return jsonError('Invalid player address')
  if (typeof wavesReached !== 'number' || !Number.isInteger(wavesReached) || wavesReached < 0) return jsonError('Invalid wavesReached')
  if (typeof proof !== 'string') return jsonError('Missing proof')

  const sessionIdBig = BigInt(sessionId)

  // Proves the caller actually controls `player` -- prevents arbitrary web
  // requests from burning this route's effort on someone else's session.
  // (Not a fund-safety requirement by itself: claimReward() on-chain already
  // checks msg.sender === session.player, so this only matters for abuse/spam.)
  const validProof = await verifyMessage({
    address: player as `0x${string}`,
    message: `Claim Tower Defense reward for session ${sessionId}`,
    signature: proof as `0x${string}`,
  }).catch(() => false)
  if (!validProof) return jsonError('Invalid ownership proof', 401)

  const [sessionPlayer, startedAt, difficultyIndex, claimed] = await client.readContract({
    address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'sessions', args: [sessionIdBig],
  }) as [string, number, number, boolean]

  if (sessionPlayer === '0x0000000000000000000000000000000000000000') return jsonError('Session not found', 404)
  if (sessionPlayer.toLowerCase() !== player.toLowerCase()) return jsonError('Session belongs to a different wallet', 403)
  if (claimed) return jsonError('Session already claimed', 409)

  const difficulty = DIFFICULTY_ORDER[difficultyIndex]
  if (!difficulty) return jsonError('Unknown difficulty on session', 500)

  const totalWaves = DIFFICULTY_TOTAL_WAVES[difficulty]
  if (wavesReached < totalWaves) return jsonError('Session did not reach a winning wave', 422)

  // Real wall-clock time since the on-chain session started -- never trust a
  // client-reported elapsed time for this check.
  const nowSeconds = Math.floor(Date.now() / 1000)
  const realElapsed = nowSeconds - startedAt
  const minRequired = MIN_SECONDS_PER_WAVE[difficulty] * wavesReached
  if (realElapsed < minRequired) {
    return jsonError(`Claimed result too fast for a genuine playthrough (${realElapsed}s elapsed, need at least ${minRequired}s)`, 422)
  }

  const rewardAmount = parseUnits(String(REWARD_FOR_WIN[difficulty]), TOKENS.AEON.decimals)

  const maxRewardPerClaim = await client.readContract({
    address: CONTRACTS.TowerDefenseArena, abi: TOWER_DEFENSE_ARENA_ABI, functionName: 'maxRewardPerClaim',
  }) as bigint
  if (rewardAmount > maxRewardPerClaim) return jsonError('Reward tier exceeds contract cap -- contact support', 500)

  const hash = keccak256(encodePacked(
    ['address', 'uint256', 'uint256', 'address', 'uint256'],
    [CONTRACTS.TowerDefenseArena, BigInt(CHAIN_ID), sessionIdBig, player as `0x${string}`, rewardAmount],
  ))
  const signerAccount = privateKeyToAccount(signerPk as `0x${string}`)
  const signature = await signerAccount.signMessage({ message: { raw: hash } })

  return NextResponse.json({ rewardAmount: rewardAmount.toString(), signature })
}
