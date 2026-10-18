import { describe, expect, it } from 'vitest'
import type { WorldSceneObjectItem } from '@modkit/sdk/maps'
import { createWorldWebGlPlan, worldWebGlCameraFromSource } from '../src/world/webgl.js'
import { renderWorldHeadless } from '../src/world/headless.js'

// Two flat quads on the same spot: which one shows depends only on which is drawn first.
const quad = (id: string, rgba: readonly number[]) => ({
  state: 'converted' as const,
  sourceKey: id,
  complete: true,
  diagnostics: [],
  meshes: [],
  nodes: [],
  primitives: [{
    id: `${id}-quad`, materialId: id, topology: 'triangles' as const,
    positions: Float32Array.of(-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, 1),
    textureCoordinates: Float32Array.of(0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1),
  }],
  textures: [{ id: `${id}-texture`, width: 1, height: 1, rgba: Uint8Array.from(rgba) }],
  materials: [{ id, layers: [{ slot: 'diffuse' as const, resourceId: `${id}-texture`, uvSource: 0 }] }],
})
const placed = (id: string, typeId: string): WorldSceneObjectItem => ({
  facet: 'objects', id, objectId: id === 'first' ? 1 : 2, layerId: 'objects', coordinateSpaceId: 'uvw',
  kind: 'doodad', typeId, resourceId: typeId, position: { x: 0, y: 0, z: 0 },
  uvwPosition: { x: 0, y: 0, z: 0 }, uvwRotation: [0, 0, 0, 1],
})
const lighting = { facet: 'lighting' as const, id: 'light', layerId: 'light', coordinateSpaceId: 'uvw',
  model: 'unlit' as const, ambientColor: [1, 1, 1] as const, ambientIntensity: 1, directional: [] }
const models = new Map([['red', quad('red', [255, 0, 0, 255])], ['blue', quad('blue', [0, 0, 255, 255])]])
const camera = worldWebGlCameraFromSource({ eye: [0, 5, 0.001], target: [0, 0, 0], up: [0, 0, -1],
  near: 0.1, far: 20, verticalFieldOfView: 0.8 })

const draw = async (objects: readonly WorldSceneObjectItem[]) => {
  const plan = createWorldWebGlPlan({ items: [lighting, ...objects], models: models as never, camera })
  return (await renderWorldHeadless(plan, { width: 16, height: 16, camera })).rgba
}

describe('world object draw order', () => {
  it('draws coplanar objects the same whatever order the source lists them in', async () => {
    const red = placed('first', 'red'), blue = placed('second', 'blue')
    const listed = await draw([red, blue]), reversed = await draw([blue, red])
    const centre = (8 * 16 + 8) * 4
    expect(Array.from(listed.slice(centre, centre + 3)).some(value => value > 0)).toBe(true)
    expect(reversed).toEqual(listed)
  })
})
