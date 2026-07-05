import { Difficulty, EnemyDef, EnemyTypeId } from './types'

export const ENEMY_DEFS: Record<EnemyTypeId, EnemyDef> = {
  basic: { id: 'basic', name: 'Drone',   hp: 40,  speed: 60,  goldReward: 5,   color: '#F87171', radius: 10 },
  fast:  { id: 'fast',  name: 'Runner',  hp: 24,  speed: 115, goldReward: 6,   color: '#FDE047', radius: 8  },
  tank:  { id: 'tank',  name: 'Bulwark', hp: 170, speed: 34,  goldReward: 16,  color: '#A8A29E', radius: 14 },
  boss:  { id: 'boss',  name: 'Warlord', hp: 900, speed: 28,  goldReward: 120, color: '#DC2626', radius: 22 },
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  normal: 'Normal', hard: 'Hard', nightmare: 'Nightmare',
}
// Matches AeonTowerDefenseArena.startSession(uint8 difficulty) and the
// reward-tier table in /api/games/tower-defense/claim -- the on-chain session
// record is the source of truth for which difficulty was played, never the
// client's own claim-time report.
export const DIFFICULTY_INDEX: Record<Difficulty, number> = {
  normal: 0, hard: 1, nightmare: 2,
}
export const DIFFICULTY_ORDER: Difficulty[] = ['normal', 'hard', 'nightmare']

// Reward for actually winning (reaching the final wave), in whole AEON --
// used both for display on the setup screen and as the authoritative payout
// table in /api/games/tower-defense/claim, so they can never drift apart.
// Below the 50 AEON entry fee for Normal (net loss -- the easiest tier isn't
// meant to be profitable), above it for Hard/Nightmare.
export const REWARD_FOR_WIN: Record<Difficulty, number> = {
  normal: 40, hard: 65, nightmare: 140,
}

// Conservative floor on real elapsed time per wave reached, used server-side
// to reject claims that couldn't possibly reflect genuine play (e.g. a
// scripted instant claim). Deliberately generous/conservative -- a real
// player should always clear this easily; it's a backstop, not the primary
// game-balance lever.
export const MIN_SECONDS_PER_WAVE: Record<Difficulty, number> = {
  normal: 12, hard: 16, nightmare: 20,
}
export const DIFFICULTY_TOTAL_WAVES: Record<Difficulty, number> = {
  normal: 15, hard: 18, nightmare: 20,
}
export const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  normal: 1, hard: 1.35, nightmare: 1.75,
}

// hp/speed scale gently with wave number so late waves are meaningfully
// tougher even at a fixed enemy mix.
export function enemyStatsForWave(def: EnemyDef, wave: number, difficulty: Difficulty) {
  const scale = DIFFICULTY_SCALE[difficulty]
  const waveHpMult = 1 + wave * 0.11
  return {
    hp: Math.round(def.hp * waveHpMult * scale),
    speed: def.speed * (1 + Math.min(wave * 0.01, 0.25)),
    goldReward: Math.round(def.goldReward * (1 + wave * 0.05)),
  }
}
