import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createWorldWebGlPlan } from '../src/world/webgl.js'

// A 3×3 terrain grid (2×2 cells); `hidden` names the cells (by their low corner) the map cut out.
const grid = (...hidden) =>
  Array.from({ length: 9 }, (_, index) => {
    const x = index % 3,
      y = Math.floor(index / 3)
    return {
      facet: 'terrain',
      id: `t:${index}`,
      layerId: 'terrain',
      coordinateSpaceId: 'height-grid',
      lod: 'exact',
      x,
      y,
      heightBase: 0,
      heightAdjustment: 0,
      mask: 0,
      uvwPosition: { x, y: 0, z: -y },
      ...(hidden.includes(`${x}:${y}`) ? { presentationCellHidden: true } : {}),
    }
  })

it('neither draws nor casts a cell the map cut out of its ground', () => {
  const whole = createWorldWebGlPlan({ items: grid() })
  // Lockdown's platform stands in space: t3CellFlags value 3 around it.
  const holed = createWorldWebGlPlan({ items: grid('0:0', '1:1') })
  assert.equal(whole.stats.terrainTriangles, 8)
  assert.equal(holed.stats.terrainTriangles, 4)
  assert.equal(holed.terrainShadowCasters.length, 0)
  const empty = createWorldWebGlPlan({ items: grid('0:0', '1:0', '0:1', '1:1') })
  assert.equal(empty.stats.terrainTriangles, 0)
})

it('leaves a hole where a sample has no ground, as the world leaves it out (П26)', () => {
  // the centre sample of the 3×3 grid is an air column: every cell touches it
  const air = grid().filter(item => !(item.x === 1 && item.y === 1))
  const plan = createWorldWebGlPlan({ items: air })
  assert.equal(plan.stats.terrainTriangles, 0)
  // a corner sample takes only its own cell
  const corner = createWorldWebGlPlan({
    items: grid().filter(item => !(item.x === 0 && item.y === 0)),
  })
  assert.equal(corner.stats.terrainTriangles, 6)
})
