export interface Vec2 { x: number; y: number }

export type TowerTypeId = 'basic' | 'sniper' | 'splash' | 'slow'
export type EnemyTypeId = 'basic' | 'fast' | 'tank' | 'boss'
export type Difficulty = 'normal' | 'hard' | 'nightmare'
export type GameStatus = 'idle' | 'playing' | 'won' | 'lost'

export interface TowerDef {
  id: TowerTypeId
  name: string
  cost: number
  range: number
  fireRate: number       // shots per second at level 1
  damage: number         // per shot at level 1
  splashRadius?: number  // splash tower only
  slowFactor?: number    // slow tower only -- multiplies enemy speed (0.5 = half speed)
  slowDuration?: number  // seconds
  color: string
  description: string
}

export interface EnemyDef {
  id: EnemyTypeId
  name: string
  hp: number
  speed: number   // px/sec at wave 1
  goldReward: number
  color: string
  radius: number
}

export interface PlacedTower {
  instanceId: number
  typeId: TowerTypeId
  pos: Vec2
  level: number   // 1..3
  cooldownRemaining: number
}

export interface ActiveEnemy {
  instanceId: number
  typeId: EnemyTypeId
  hp: number
  maxHp: number
  pathIndex: number         // current segment index (path[pathIndex] -> path[pathIndex+1])
  distanceIntoSegment: number
  slowUntil: number         // engine elapsed-time timestamp when slow wears off
  slowFactor: number
}

export interface Projectile {
  instanceId: number
  pos: Vec2
  targetId: number
  damage: number
  speed: number
  splashRadius?: number
  slowFactor?: number
  slowDuration?: number
}

export interface MapDef {
  id: string
  name: string
  width: number
  height: number
  path: Vec2[]
}

export interface WaveSpawn {
  typeId: EnemyTypeId
  count: number
  intervalMs: number
}

export interface Wave {
  spawns: WaveSpawn[]
}
