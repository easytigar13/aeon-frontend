import { MapDef } from './types'

export const CANVAS_WIDTH = 900
export const CANVAS_HEIGHT = 520

export const MAPS: MapDef[] = [
  {
    id: 'switchback',
    name: 'Switchback',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    path: [
      { x: 0,   y: 60  },
      { x: 780, y: 60  },
      { x: 780, y: 180 },
      { x: 120, y: 180 },
      { x: 120, y: 300 },
      { x: 780, y: 300 },
      { x: 780, y: 420 },
      { x: 900, y: 420 },
    ],
  },
  {
    id: 'spiral',
    name: 'Spiral',
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    path: [
      { x: 0,   y: 40  },
      { x: 860, y: 40  },
      { x: 860, y: 480 },
      { x: 40,  y: 480 },
      { x: 40,  y: 120 },
      { x: 740, y: 120 },
      { x: 740, y: 400 },
      { x: 160, y: 400 },
      { x: 160, y: 200 },
      { x: 620, y: 200 },
      { x: 620, y: 280 },
      { x: 300, y: 280 },
    ],
  },
]

export function mapById(id: string): MapDef {
  return MAPS.find(m => m.id === id) ?? MAPS[0]
}
