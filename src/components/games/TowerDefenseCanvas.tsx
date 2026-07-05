'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { clsx } from 'clsx'
import { TowerDefenseEngine, EngineSnapshot } from '@/lib/towerDefense/engine'
import { mapById, CANVAS_WIDTH, CANVAS_HEIGHT } from '@/lib/towerDefense/maps'
import { renderFrame } from '@/lib/towerDefense/render'
import { TOWER_DEFS, TOWER_ORDER, towerRange, upgradeCost, sellValue, MAX_TOWER_LEVEL } from '@/lib/towerDefense/towers'
import { Difficulty, TowerTypeId, Vec2 } from '@/lib/towerDefense/types'

export interface GameEndResult {
  status: 'won' | 'lost'
  waveReached: number
  totalWaves: number
  elapsedSeconds: number
}

interface Props {
  mapId: string
  difficulty: Difficulty
  onGameEnd: (result: GameEndResult) => void
}

export function TowerDefenseCanvas({ mapId, difficulty, onGameEnd }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const engineRef  = useRef<TowerDefenseEngine | null>(null)
  const rafRef     = useRef<number>()
  const lastTsRef  = useRef<number | null>(null)
  const endFiredRef = useRef(false)

  const [placingType, setPlacingType] = useState<TowerTypeId | null>(null)
  const [selectedTowerId, setSelectedTowerId] = useState<number | null>(null)
  const [mousePos, setMousePos] = useState<Vec2 | null>(null)
  const [hud, setHud] = useState<{ gold: number; lives: number; wave: number; totalWaves: number; waveInProgress: boolean; status: string }>({
    gold: 0, lives: 0, wave: 0, totalWaves: 0, waveInProgress: false, status: 'idle',
  })

  const map = mapById(mapId)

  // Init engine fresh whenever map/difficulty changes
  useEffect(() => {
    const engine = new TowerDefenseEngine(map, difficulty)
    engineRef.current = engine
    endFiredRef.current = false
    setSelectedTowerId(null)
    setPlacingType(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, difficulty])

  // Game loop
  useEffect(() => {
    function loop(ts: number) {
      const engine = engineRef.current
      const canvas = canvasRef.current
      if (engine && canvas) {
        const dt = lastTsRef.current == null ? 0 : Math.min(0.05, (ts - lastTsRef.current) / 1000)
        lastTsRef.current = ts
        engine.update(dt)

        const snap = engine.snapshot()
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const selTower = snap.towers.find(t => t.instanceId === selectedTowerId)
          renderFrame(ctx, map, snap, {
            selectedTowerId: selectedTowerId ?? undefined,
            placingType: placingType ?? undefined,
            mousePos: mousePos ?? undefined,
            canPlaceAtMouse: placingType && mousePos ? engine.canPlaceTower(mousePos) : undefined,
          })
        }

        if ((snap.status === 'won' || snap.status === 'lost') && !endFiredRef.current) {
          endFiredRef.current = true
          onGameEnd({
            status: snap.status,
            waveReached: snap.waveNumber,
            totalWaves: snap.totalWaves,
            elapsedSeconds: snap.elapsedSeconds,
          })
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastTsRef.current = null }
  }, [map, selectedTowerId, placingType, mousePos, onGameEnd])

  // Throttled HUD sync (separate from the render loop so React re-renders stay cheap)
  useEffect(() => {
    const id = setInterval(() => {
      const engine = engineRef.current
      if (!engine) return
      const snap = engine.snapshot()
      setHud({ gold: snap.gold, lives: snap.lives, wave: snap.waveNumber, totalWaves: snap.totalWaves, waveInProgress: snap.waveInProgress, status: snap.status })
    }, 150)
    return () => clearInterval(id)
  }, [])

  const toCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Vec2 => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / rect.width * CANVAS_WIDTH,
      y: (e.clientY - rect.top) / rect.height * CANVAS_HEIGHT,
    }
  }, [])

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    setMousePos(toCanvasPos(e))
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const engine = engineRef.current
    if (!engine) return
    const pos = toCanvasPos(e)

    if (placingType) {
      engine.placeTower(pos, placingType)
      return
    }

    // Select an existing tower if the click landed on one
    const snap = engine.snapshot()
    const hit = snap.towers.find(t => Math.hypot(t.pos.x - pos.x, t.pos.y - pos.y) <= 16)
    setSelectedTowerId(hit ? hit.instanceId : null)
  }

  function handleRightClick(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    setPlacingType(null)
    setSelectedTowerId(null)
  }

  const selectedTower = engineRef.current?.snapshot().towers.find(t => t.instanceId === selectedTowerId)
  const isGameOver = hud.status === 'won' || hud.status === 'lost'

  return (
    <div className="space-y-3">
      {/* HUD */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <HudStat label="Gold" value={hud.gold} color="text-aeon-400" />
        <HudStat label="Lives" value={hud.lives} color={hud.lives <= 5 ? 'text-red-400' : 'text-emerald-400'} />
        <HudStat label="Wave" value={`${hud.wave}/${hud.totalWaves}`} color="text-text-primary" />
        <button
          onClick={() => engineRef.current?.startNextWave()}
          disabled={hud.waveInProgress || isGameOver}
          className="ml-auto btn-primary px-4 py-1.5 text-sm disabled:opacity-40"
        >
          {hud.waveInProgress ? 'Wave in progress…' : hud.wave === 0 ? 'Start Wave 1' : 'Start Next Wave'}
        </button>
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-bg-border">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full h-auto block cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setMousePos(null)}
          onClick={handleClick}
          onContextMenu={handleRightClick}
        />
        {isGameOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base/80 backdrop-blur-sm">
            <div className="text-center">
              <div className={clsx('font-display font-bold text-3xl mb-1', hud.status === 'won' ? 'text-aeon-400' : 'text-red-400')}>
                {hud.status === 'won' ? 'Victory!' : 'Defeated'}
              </div>
              <div className="text-text-secondary text-sm">Reached wave {hud.wave} / {hud.totalWaves}</div>
            </div>
          </div>
        )}
      </div>

      {/* Tower shop */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TOWER_ORDER.map(id => {
          const def = TOWER_DEFS[id]
          const affordable = hud.gold >= def.cost
          return (
            <button
              key={id}
              onClick={() => { setPlacingType(placingType === id ? null : id); setSelectedTowerId(null) }}
              disabled={isGameOver}
              className={clsx(
                'card p-2.5 text-left transition-all border',
                placingType === id ? 'border-aeon-400/60 bg-aeon-400/5' : 'border-bg-border hover:border-bg-hover',
                !affordable && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: def.color }} />
                <span className="font-semibold text-sm text-text-primary">{def.name}</span>
                <span className="ml-auto font-mono text-xs text-aeon-400">{def.cost}g</span>
              </div>
              <div className="text-2xs text-text-muted mt-1">{def.description}</div>
            </button>
          )
        })}
      </div>

      {/* Selected tower panel */}
      {selectedTower && (
        <div className="card p-3 flex items-center gap-3">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: TOWER_DEFS[selectedTower.typeId].color }} />
          <div className="text-sm">
            <span className="font-semibold text-text-primary">{TOWER_DEFS[selectedTower.typeId].name}</span>
            <span className="text-text-muted ml-2 font-mono text-xs">Lv{selectedTower.level} · Range {Math.round(towerRange(TOWER_DEFS[selectedTower.typeId], selectedTower.level))}</span>
          </div>
          <div className="ml-auto flex gap-2">
            {selectedTower.level < MAX_TOWER_LEVEL && (
              <button
                onClick={() => engineRef.current?.upgradeTower(selectedTower.instanceId)}
                disabled={hud.gold < upgradeCost(TOWER_DEFS[selectedTower.typeId], selectedTower.level + 1)}
                className="btn-ghost px-3 py-1 text-xs disabled:opacity-40"
              >
                Upgrade ({upgradeCost(TOWER_DEFS[selectedTower.typeId], selectedTower.level + 1)}g)
              </button>
            )}
            <button
              onClick={() => { engineRef.current?.sellTower(selectedTower.instanceId); setSelectedTowerId(null) }}
              className="btn-ghost px-3 py-1 text-xs text-red-400"
            >
              Sell (+{sellValue(TOWER_DEFS[selectedTower.typeId], selectedTower.level)}g)
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HudStat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-bg-raised border border-bg-border">
      <span className="text-2xs text-text-muted uppercase tracking-wider">{label}</span>
      <span className={clsx('font-mono font-semibold text-sm', color)}>{value}</span>
    </div>
  )
}
