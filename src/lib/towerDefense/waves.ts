import { Difficulty, Wave } from './types'
import { DIFFICULTY_SCALE, DIFFICULTY_TOTAL_WAVES } from './enemies'

// Formulaic wave composition rather than hand-authored per-wave arrays --
// basic enemies scale up from wave 1, fast enemies join at wave 3, tanks at
// wave 5, and a boss (or more, at higher waves) shows up every 5th wave.
export function generateWaves(difficulty: Difficulty): Wave[] {
  const totalWaves = DIFFICULTY_TOTAL_WAVES[difficulty]
  const scale = DIFFICULTY_SCALE[difficulty]
  const waves: Wave[] = []

  for (let w = 1; w <= totalWaves; w++) {
    const spawns: Wave['spawns'] = []
    spawns.push({ typeId: 'basic', count: Math.round((4 + w * 1.4) * scale), intervalMs: 600 })
    if (w >= 3) spawns.push({ typeId: 'fast', count: Math.round((2 + w * 0.55) * scale), intervalMs: 380 })
    if (w >= 5) spawns.push({ typeId: 'tank', count: Math.round((1 + w * 0.28) * scale), intervalMs: 900 })
    if (w % 5 === 0) spawns.push({ typeId: 'boss', count: Math.max(1, Math.round(w / 5)), intervalMs: 1600 })
    waves.push({ spawns })
  }
  return waves
}
