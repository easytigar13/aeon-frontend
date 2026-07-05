import { EngineSnapshot } from './engine'
import { MapDef, TowerTypeId, Vec2 } from './types'
import { TOWER_DEFS, towerRange } from './towers'
import { ENEMY_DEFS } from './enemies'

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  map: MapDef,
  snap: EngineSnapshot,
  opts: { selectedTowerId?: number; placingType?: TowerTypeId; mousePos?: Vec2; canPlaceAtMouse?: boolean },
) {
  ctx.clearRect(0, 0, map.width, map.height)

  // Background
  ctx.fillStyle = '#0F0F16'
  ctx.fillRect(0, 0, map.width, map.height)

  // Path
  ctx.strokeStyle = '#23232D'
  ctx.lineWidth = 46
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  map.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  ctx.strokeStyle = '#18181F'
  ctx.lineWidth = 40
  ctx.beginPath()
  map.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()

  // Start / base markers
  const start = map.path[0], end = map.path[map.path.length - 1]
  ctx.fillStyle = '#34D399'
  ctx.beginPath(); ctx.arc(start.x, start.y, 14, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#FFB800'
  ctx.beginPath(); ctx.arc(end.x, end.y, 14, 0, Math.PI * 2); ctx.fill()

  // Placement ghost / range preview
  if (opts.placingType && opts.mousePos) {
    const def = TOWER_DEFS[opts.placingType]
    ctx.beginPath()
    ctx.arc(opts.mousePos.x, opts.mousePos.y, def.range, 0, Math.PI * 2)
    ctx.fillStyle = opts.canPlaceAtMouse ? 'rgba(52,211,153,0.10)' : 'rgba(248,113,113,0.10)'
    ctx.fill()
    ctx.strokeStyle = opts.canPlaceAtMouse ? 'rgba(52,211,153,0.5)' : 'rgba(248,113,113,0.5)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(opts.mousePos.x, opts.mousePos.y, 14, 0, Math.PI * 2)
    ctx.fillStyle = def.color
    ctx.globalAlpha = 0.6
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Towers
  for (const t of snap.towers) {
    const def = TOWER_DEFS[t.typeId]
    if (t.instanceId === opts.selectedTowerId) {
      ctx.beginPath()
      ctx.arc(t.pos.x, t.pos.y, towerRange(def, t.level), 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,184,0,0.4)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(t.pos.x, t.pos.y, 15, 0, Math.PI * 2)
    ctx.fillStyle = def.color
    ctx.fill()
    ctx.strokeStyle = '#0A0A0F'
    ctx.lineWidth = 2
    ctx.stroke()
    // level pips
    for (let i = 0; i < t.level; i++) {
      ctx.beginPath()
      ctx.arc(t.pos.x - 6 + i * 6, t.pos.y + 22, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = '#F0EFE8'
      ctx.fill()
    }
  }

  // Enemies
  for (const e of snap.enemies) {
    const def = ENEMY_DEFS[e.typeId]
    const path = map.path
    const segIdx = Math.min(e.pathIndex, path.length - 2)
    const a = path[segIdx], b = path[Math.min(segIdx + 1, path.length - 1)]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const t = Math.min(1, e.distanceIntoSegment / segLen)
    const pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, def.radius, 0, Math.PI * 2)
    ctx.fillStyle = def.color
    ctx.fill()
    if (e.slowUntil > snap.elapsedSeconds) {
      ctx.strokeStyle = '#7DD3FC'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    // hp bar
    const w = def.radius * 2
    const pct = Math.max(0, e.hp / e.maxHp)
    ctx.fillStyle = '#23232D'
    ctx.fillRect(pos.x - w / 2, pos.y - def.radius - 8, w, 4)
    ctx.fillStyle = pct > 0.5 ? '#34D399' : pct > 0.25 ? '#FFB800' : '#F87171'
    ctx.fillRect(pos.x - w / 2, pos.y - def.radius - 8, w * pct, 4)
  }

  // Projectiles
  for (const p of snap.projectiles) {
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#F0EFE8'
    ctx.fill()
  }
}
