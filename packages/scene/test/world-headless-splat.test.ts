import { describe, expect, it } from 'vitest'
import type { WorldWebGlSplatBatch } from '../src/world/webgl.js'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'

const red = { id: 'red', width: 1, height: 1, rgba: Uint8Array.of(255, 0, 0, 255) }
const blue = { id: 'blue', width: 1, height: 1, rgba: Uint8Array.of(0, 0, 255, 255) }
const positions = Float32Array.from([
  0, 0, 0, 2, 0, 0, 2, 0, 2,
  0, 0, 0, 2, 0, 2, 0, 0, 2,
])
const uv = Float32Array.from([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])

function batch(
  textures: WorldWebGlSplatBatch['textures'],
  weights: readonly number[],
  ao = 1,
  weightTexture?: WorldWebGlSplatBatch['textures'][number],
): WorldWebGlSplatBatch {
  return {
    positions,
    normals: Float32Array.from(Array.from({ length: 6 }, () => [0, 1, 0]).flat()),
    colors: Float32Array.from(Array.from({ length: 6 }, () => [1, 1, 1, ao]).flat()),
    textures,
    normalTextures: textures.map(() => undefined),
    normalSwizzles: textures.map(() => 0),
    textureCoordinates: textures.map(() => uv),
    textureWeights0: Float32Array.from(Array.from({ length: 6 }, () => [
      weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0, weights[3] ?? 0,
    ]).flat()),
    textureWeights1: new Float32Array(24),
    ...(weightTexture === undefined
      ? {}
      : { weightTextures: [weightTexture], weightTextureCoordinates: uv }),
  }
}

const terrain = [
  [0, 0], [1, 0], [1, 1], [0, 1],
].map(([x, y], index) => ({
  facet: 'terrain' as const,
  id: `terrain-${index}`,
  layerId: 'terrain',
  coordinateSpaceId: 'height-grid',
  lod: 'exact' as const,
  x: x!, y: y!, heightBase: 0, heightAdjustment: 0, mask: 0,
  uvwPosition: { x: x! * 2, y: 0, z: y! * 2 },
}))
const basePlan = createWorldWebGlPlan({ items: terrain })
const camera = {
  azimuth: Math.PI / 2,
  elevation: 1.5,
  zoom: 1,
  target: [1, 0, 1] as const,
  frame: { center: [1, 0, 1] as const, radius: 1.5 },
}
const render = (splats: readonly WorldWebGlSplatBatch[], overlays: readonly WorldWebGlSplatBatch[] = []) =>
  renderWorldHeadless({ ...basePlan, splatTriangles: splats, splatOverlayTriangles: overlays }, {
    width: 64, height: 64, camera, clearColor: [0, 0, 0, 1],
  })
const colors = (rgba: Uint8Array) => Array.from({ length: rgba.length / 4 }, (_, index) =>
  [rgba[index * 4]!, rgba[index * 4 + 1]!, rgba[index * 4 + 2]!] as const)
const brightest = (rgba: Uint8Array) => colors(rgba).reduce((best, color) =>
  color[0] + color[2] > best[0] + best[2] ? color : best)

describe('headless world splat parity', () => {
  it('mixes two layer colors per fragment, not one strongest layer per batch', async () => {
    const specularBlue = { ...blue, rgba: Uint8Array.of(0, 0, 255, 0) }
    const splat = batch([red, specularBlue], [0.5, 0.5])
    const plan = { ...basePlan, splatTriangles: [splat] }
    const result = await render([splat])
    const [r, g, b] = brightest(result.rgba)
    expect(r).toBeGreaterThan(20)
    expect(b).toBeGreaterThan(20)
    expect(Math.abs(r! - b!)).toBeLessThan(4)
    expect(g).toBeLessThan(r! / 4)
    expect(worldHeadlessScene(plan).diagnostics.map(item => item.code)).not.toContain(
      'x3.scene/world-headless-splat-strongest-layer',
    )
  })

  it('samples raster weights inside a triangle and uses published AO as lighting', async () => {
    const raster = {
      id: 'weight', width: 2, height: 1, filter: 'nearest' as const,
      rgba: Uint8Array.of(255, 0, 0, 0, 0, 255, 0, 0),
    }
    const full = await render([batch([red, blue], [], 1, raster)])
    const dim = await render([batch([red, blue], [], 0.25, raster)])
    expect(colors(full.rgba).some(([r, , b]) => r > b * 2 && r > 20)).toBe(true)
    expect(colors(full.rgba).some(([r, , b]) => b > r * 2 && b > 20)).toBe(true)
    const [fullR, , fullB] = brightest(full.rgba)
    const [dimR, , dimB] = brightest(dim.rgba)
    expect((dimR ?? 0) + (dimB ?? 0)).toBeLessThan(((fullR ?? 0) + (fullB ?? 0)) * 0.5)
  })

  it('blends a later raster group by its published coverage', async () => {
    const half = {
      id: 'half', width: 1, height: 1,
      rgba: Uint8Array.of(128, 0, 0, 0),
    }
    const result = await render(
      [batch([red], [1])],
      [batch([blue], [], 1, half)],
    )
    const [r, g, b] = brightest(result.rgba)
    expect(r).toBeGreaterThan(20)
    expect(b).toBeGreaterThan(20)
    expect(Math.abs(r! - b!)).toBeLessThan(5)
    expect(g).toBeLessThan(r! / 4)
  })
})
