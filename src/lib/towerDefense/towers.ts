import { TowerDef, TowerTypeId } from './types'

export const TOWER_DEFS: Record<TowerTypeId, TowerDef> = {
  basic: {
    id: 'basic', name: 'Cannon', cost: 20, range: 120, fireRate: 1.2, damage: 10,
    color: '#FFB800', description: 'Cheap, reliable, single-target damage.',
  },
  sniper: {
    id: 'sniper', name: 'Sniper', cost: 50, range: 260, fireRate: 0.5, damage: 45,
    color: '#A78BFA', description: 'Long range, heavy hit, slow reload.',
  },
  splash: {
    id: 'splash', name: 'Mortar', cost: 60, range: 100, fireRate: 0.8, damage: 18, splashRadius: 50,
    color: '#34D399', description: 'Area damage -- hits everything nearby.',
  },
  slow: {
    id: 'slow', name: 'Frost', cost: 35, range: 110, fireRate: 1.0, damage: 4, slowFactor: 0.45, slowDuration: 2.2,
    color: '#7DD3FC', description: 'Weak damage, but slows enemies badly.',
  },
}

export const TOWER_ORDER: TowerTypeId[] = ['basic', 'sniper', 'splash', 'slow']

// Per-level scaling. Level 1 = base stats above. Buying level 2/3 costs the
// listed multiple of the tower's base cost.
export const UPGRADE_COST_MULT = [0, 0.6, 1.2] // index = level-1, level 1 itself is the initial placement cost
export const UPGRADE_DAMAGE_MULT = [1, 1.6, 2.4]
export const UPGRADE_RANGE_MULT  = [1, 1.15, 1.3]
export const MAX_TOWER_LEVEL = 3

export function towerDamage(def: TowerDef, level: number): number {
  return def.damage * UPGRADE_DAMAGE_MULT[level - 1]
}
export function towerRange(def: TowerDef, level: number): number {
  return def.range * UPGRADE_RANGE_MULT[level - 1]
}
export function upgradeCost(def: TowerDef, nextLevel: number): number {
  return Math.round(def.cost * UPGRADE_COST_MULT[nextLevel - 1])
}
export function sellValue(def: TowerDef, level: number): number {
  let spent = def.cost
  for (let l = 2; l <= level; l++) spent += upgradeCost(def, l)
  return Math.round(spent * 0.6)
}
