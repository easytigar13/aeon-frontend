import { Difficulty, GameStatus, MapDef, PlacedTower, ActiveEnemy, Projectile, TowerTypeId, Vec2, Wave } from './types'
import { TOWER_DEFS, towerDamage, towerRange, upgradeCost, sellValue, MAX_TOWER_LEVEL } from './towers'
import { ENEMY_DEFS, enemyStatsForWave } from './enemies'
import { generateWaves } from './waves'

const STARTING_GOLD = 120
const STARTING_LIVES = 20
const MIN_DIST_FROM_PATH = 32
const MIN_TOWER_SPACING = 34
const PROJECTILE_SPEED = 480
const PROJECTILE_HIT_RADIUS = 9

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x, aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby })
}

export interface EngineSnapshot {
  status: GameStatus
  gold: number
  lives: number
  waveNumber: number
  totalWaves: number
  waveInProgress: boolean
  enemiesRemaining: number
  towers: PlacedTower[]
  enemies: ActiveEnemy[]
  projectiles: Projectile[]
  elapsedSeconds: number
}

export class TowerDefenseEngine {
  readonly map: MapDef
  readonly difficulty: Difficulty
  readonly waves: Wave[]
  private segLengths: number[] = []
  private cumLengths: number[] = []
  private totalPathLength = 0

  private towers: PlacedTower[] = []
  private enemies: ActiveEnemy[] = []
  private projectiles: Projectile[] = []
  private spawnQueue: { typeId: string; atTime: number }[] = []

  private gold = STARTING_GOLD
  private lives = STARTING_LIVES
  private waveNumber = 0
  private waveInProgress = false
  private status: GameStatus = 'idle'
  private elapsed = 0
  private nextInstanceId = 1

  constructor(map: MapDef, difficulty: Difficulty) {
    this.map = map
    this.difficulty = difficulty
    this.waves = generateWaves(difficulty)
    this.computePathLengths()
  }

  private computePathLengths() {
    const path = this.map.path
    let cum = 0
    for (let i = 0; i < path.length - 1; i++) {
      const len = dist(path[i], path[i + 1])
      this.segLengths.push(len)
      this.cumLengths.push(cum)
      cum += len
    }
    this.totalPathLength = cum
  }

  private positionFor(pathIndex: number, distIntoSeg: number): Vec2 {
    const path = this.map.path
    if (pathIndex >= path.length - 1) return path[path.length - 1]
    const a = path[pathIndex], b = path[pathIndex + 1]
    const segLen = this.segLengths[pathIndex] || 1
    const t = Math.min(1, distIntoSeg / segLen)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }

  private progressOf(e: ActiveEnemy): number {
    return (this.cumLengths[e.pathIndex] ?? this.totalPathLength) + e.distanceIntoSegment
  }

  getStatus(): GameStatus { return this.status }
  getTotalWaves(): number { return this.waves.length }

  snapshot(): EngineSnapshot {
    return {
      status: this.status,
      gold: this.gold,
      lives: this.lives,
      waveNumber: this.waveNumber,
      totalWaves: this.waves.length,
      waveInProgress: this.waveInProgress,
      enemiesRemaining: this.enemies.length + this.spawnQueue.length,
      towers: this.towers,
      enemies: this.enemies,
      projectiles: this.projectiles,
      elapsedSeconds: this.elapsed,
    }
  }

  canPlaceTower(pos: Vec2): boolean {
    const path = this.map.path
    for (let i = 0; i < path.length - 1; i++) {
      if (distToSegment(pos, path[i], path[i + 1]) < MIN_DIST_FROM_PATH) return false
    }
    for (const t of this.towers) {
      if (dist(pos, t.pos) < MIN_TOWER_SPACING) return false
    }
    return pos.x >= 16 && pos.y >= 16 && pos.x <= this.map.width - 16 && pos.y <= this.map.height - 16
  }

  placeTower(pos: Vec2, typeId: TowerTypeId): boolean {
    const def = TOWER_DEFS[typeId]
    if (this.gold < def.cost) return false
    if (!this.canPlaceTower(pos)) return false
    this.gold -= def.cost
    this.towers.push({ instanceId: this.nextInstanceId++, typeId, pos: { ...pos }, level: 1, cooldownRemaining: 0 })
    return true
  }

  upgradeTower(instanceId: number): boolean {
    const t = this.towers.find(x => x.instanceId === instanceId)
    if (!t || t.level >= MAX_TOWER_LEVEL) return false
    const def = TOWER_DEFS[t.typeId]
    const cost = upgradeCost(def, t.level + 1)
    if (this.gold < cost) return false
    this.gold -= cost
    t.level += 1
    return true
  }

  sellTower(instanceId: number): boolean {
    const idx = this.towers.findIndex(x => x.instanceId === instanceId)
    if (idx === -1) return false
    const t = this.towers[idx]
    this.gold += sellValue(TOWER_DEFS[t.typeId], t.level)
    this.towers.splice(idx, 1)
    return true
  }

  startNextWave(): boolean {
    if (this.waveInProgress || this.status === 'won' || this.status === 'lost') return false
    if (this.waveNumber >= this.waves.length) return false
    if (this.status === 'idle') this.status = 'playing'
    const wave = this.waves[this.waveNumber]
    this.waveNumber += 1
    this.waveInProgress = true

    let t = this.elapsed;
    for (const spawn of wave.spawns) {
      for (let i = 0; i < spawn.count; i++) {
        this.spawnQueue.push({ typeId: spawn.typeId, atTime: t })
        t += spawn.intervalMs / 1000
      }
    }
    // Sort combined spawn queue by time so multiple spawn groups interleave sensibly.
    this.spawnQueue.sort((a, b) => a.atTime - b.atTime)
    return true
  }

  update(dt: number) {
    if (this.status !== 'playing') return
    this.elapsed += dt

    // Spawning
    while (this.spawnQueue.length && this.spawnQueue[0].atTime <= this.elapsed) {
      const s = this.spawnQueue.shift()!
      const typeId = s.typeId as ActiveEnemy['typeId']
      const stats = enemyStatsForWave(ENEMY_DEFS[typeId], this.waveNumber, this.difficulty)
      this.enemies.push({
        instanceId: this.nextInstanceId++,
        typeId,
        hp: stats.hp,
        maxHp: stats.hp,
        pathIndex: 0,
        distanceIntoSegment: 0,
        slowUntil: 0,
        slowFactor: 1,
      })
    }

    // Enemy movement
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      const baseSpeed = enemyStatsForWave(ENEMY_DEFS[e.typeId], this.waveNumber, this.difficulty).speed
      const speedMult = this.elapsed < e.slowUntil ? e.slowFactor : 1
      let travel = baseSpeed * speedMult * dt
      while (travel > 0 && e.pathIndex < this.segLengths.length) {
        const segLen = this.segLengths[e.pathIndex]
        const remaining = segLen - e.distanceIntoSegment
        if (travel < remaining) {
          e.distanceIntoSegment += travel
          travel = 0
        } else {
          travel -= remaining
          e.pathIndex += 1
          e.distanceIntoSegment = 0
        }
      }
      if (e.pathIndex >= this.segLengths.length) {
        // Reached the base
        this.enemies.splice(i, 1)
        this.lives -= 1
        if (this.lives <= 0) {
          this.lives = 0
          this.status = 'lost'
          return
        }
      }
    }

    // Towers: cooldown + targeting + firing
    for (const t of this.towers) {
      t.cooldownRemaining = Math.max(0, t.cooldownRemaining - dt)
      if (t.cooldownRemaining > 0) continue
      const def = TOWER_DEFS[t.typeId]
      const range = towerRange(def, t.level)
      let best: ActiveEnemy | null = null
      let bestProgress = -1
      for (const e of this.enemies) {
        const pos = this.positionFor(e.pathIndex, e.distanceIntoSegment)
        if (dist(pos, t.pos) <= range) {
          const p = this.progressOf(e)
          if (p > bestProgress) { bestProgress = p; best = e }
        }
      }
      if (best) {
        this.projectiles.push({
          instanceId: this.nextInstanceId++,
          pos: { ...t.pos },
          targetId: best.instanceId,
          damage: towerDamage(def, t.level),
          speed: PROJECTILE_SPEED,
          splashRadius: def.splashRadius,
          slowFactor: def.slowFactor,
          slowDuration: def.slowDuration,
        })
        t.cooldownRemaining = 1 / def.fireRate
      }
    }

    // Projectiles: homing movement + impact
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const target = this.enemies.find(e => e.instanceId === p.targetId)
      if (!target) { this.projectiles.splice(i, 1); continue }
      const targetPos = this.positionFor(target.pathIndex, target.distanceIntoSegment)
      const d = dist(p.pos, targetPos)
      if (d <= PROJECTILE_HIT_RADIUS) {
        this.applyDamage(target, p.damage)
        if (p.slowFactor && p.slowDuration) {
          target.slowFactor = p.slowFactor
          target.slowUntil = this.elapsed + p.slowDuration
        }
        if (p.splashRadius) {
          for (const other of this.enemies) {
            if (other.instanceId === target.instanceId) continue
            const otherPos = this.positionFor(other.pathIndex, other.distanceIntoSegment)
            if (dist(targetPos, otherPos) <= p.splashRadius) this.applyDamage(other, p.damage * 0.6)
          }
        }
        this.projectiles.splice(i, 1)
      } else {
        const stepDist = Math.min(d, p.speed * dt)
        p.pos = {
          x: p.pos.x + (targetPos.x - p.pos.x) / d * stepDist,
          y: p.pos.y + (targetPos.y - p.pos.y) / d * stepDist,
        }
      }
    }

    // Remove dead enemies, award gold
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i]
      if (e.hp <= 0) {
        const stats = enemyStatsForWave(ENEMY_DEFS[e.typeId], this.waveNumber, this.difficulty)
        this.gold += stats.goldReward
        this.enemies.splice(i, 1)
      }
    }

    // Wave clear check
    if (this.waveInProgress && this.spawnQueue.length === 0 && this.enemies.length === 0) {
      this.waveInProgress = false
      if (this.waveNumber >= this.waves.length) {
        this.status = 'won'
      }
    }
  }

  private applyDamage(e: ActiveEnemy, amount: number) {
    e.hp -= amount
  }
}
