import { expect, it } from 'vitest'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless } from '../src/world/headless.js'

const terrain = Array.from({ length: 4 }, (_, i) => ({
  facet: 'terrain' as const, id: `t:${i}`, layerId: 'terrain', coordinateSpaceId: 'grid',
  lod: 'exact' as const, x: i % 2, y: Math.floor(i / 2), heightBase: 0, heightAdjustment: 0,
  mask: 0, uvwPosition: { x: i % 2 * 2, y: 0, z: Math.floor(i / 2) * 2 },
}))
const texture = { id: 'native-colour', width: 1, height: 1,
  rgba: Uint8Array.of(128, 96, 64, 255), filter: 'nearest' as const }
const batch = {
  positions: Float32Array.from([0,0,0, 2,0,2, 2,0,0, 0,0,0, 0,0,2, 2,0,2]),
  normals: Float32Array.from(Array.from({ length: 6 }, () => [0,1,0]).flat()),
  colors: Float32Array.from(Array.from({ length: 6 }, () => [1,1,1,1]).flat()),
  textureCoordinates: Float32Array.from([0,0, 1,1, 1,0, 0,0, 0,1, 1,1]), texture,
}
function plan(model: 'lit' | 'unlit', gain: [number, number, number], materialUnlit = false) {
  const base = createWorldWebGlPlan({ items: [...terrain, {
    facet: 'lighting', id: 'light', layerId: 'lighting', coordinateSpaceId: 'uvw-canonical',
    model, unlitColor: gain, ambientColor: [0,0,0], ambientIntensity: 0,
    directional: [{ id: 'sun', direction: [0,-1,0], color: [1,0,0], intensity: 1 }],
  }] })
  return { ...base, terrainOpaqueVertices: 0, terrainTexturedBatches: 1,
    opaqueTriangles: { ...base.opaqueTriangles, positions: new Float32Array(),
      normals: new Float32Array(), colors: new Float32Array() },
    texturedTriangles: [{ ...batch, ...(materialUnlit ? { unlit: true } : {}) }],
  }
}
async function pixel(p: ReturnType<typeof plan>) {
  const result = await renderWorldHeadless(p, { width: 32, height: 32, camera: {
    azimuth: Math.PI / 2, elevation: 1.5, zoom: 1, target: [0,0,0],
    frame: { center: [1,0,1], radius: 1.5 },
  } })
  expect(result.diagnostics).toEqual([])
  return Array.from(result.rgba.slice((16 * 32 + 16) * 4, (16 * 32 + 16) * 4 + 4))
}
it('multiplies unlit world texels by the authored colour and ignores the retained sun', async () => {
  expect(await pixel(plan('unlit', [0.25,0.5,0.75]))).toEqual([32,48,48,255])
})
it('keeps white unlit world texels and blackens a zero-gain world', async () => {
  expect(await pixel(plan('unlit', [1,1,1]))).toEqual([128,96,64,255])
  expect(await pixel(plan('unlit', [0,0,0]))).toEqual([0,0,0,255])
})
it('lights an ordinary textured surface while preserving explicitly unlit materials', async () => {
  expect(await pixel(plan('lit', [1,1,1]))).toEqual([128,0,0,255])
  expect(await pixel(plan('lit', [1,1,1], true))).toEqual([128,96,64,255])
})
