import { expect, it } from 'vitest'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'
import { TERRAIN_DEPTH_BIAS } from '../src/render/depth-bias.js'

// These tests isolate depth and painter order from the world's default light.
const neutralLighting = { facet: 'lighting' as const, id: 'light', layerId: 'lighting',
  coordinateSpaceId: 'uvw-canonical', model: 'unlit' as const,
  ambientColor: [1, 1, 1] as const, ambientIntensity: 1, directional: [] }

const batch = (z = 0) => ({
  positions: Float32Array.of(0, 0, z, 1, 0, z, 1, 0, z + 1, 0, 0, z, 1, 0, z + 1, 0, 0, z + 1),
  normals: Float32Array.from({ length: 18 }, (_, i) => (i % 3 === 1 ? 1 : 0)),
  colors: new Float32Array(24).fill(1),
})
const textured = (id: string, rgba: Uint8Array, z = 0) => ({
  ...batch(z),
  texture: { id, width: 1, height: 1, rgba },
  textureCoordinates: new Float32Array(12),
})

it('keeps a coplanar surface model visible over atlas terrain without moving it', async () => {
  const model = batch()
  for (let i = 0; i < model.colors.length; i += 4) { model.colors[i] = 1; model.colors[i + 1] = 0; model.colors[i + 2] = 0 }
  const plan = { ...createWorldWebGlPlan({ items: [neutralLighting] }), opaqueTriangles: model, terrainOpaqueVertices: 0,
    texturedTriangles: [textured('ground', Uint8Array.of(0, 255, 0, 255))], terrainTexturedBatches: 1 }
  const converted = worldHeadlessScene(plan).scene.primitives
  expect(converted.find(p => p.id === 'world/ground')!.depthBias).toBeUndefined()
  expect(converted.find(p => p.id === 'world/textured-0')!.depthBias).toEqual(TERRAIN_DEPTH_BIAS)
  expect(converted.find(p => p.id === 'world/ground')!.positions).toEqual(model.positions)
  const options = { width: 64, height: 64, camera: { azimuth: Math.PI / 2, elevation: 1.5, zoom: 1,
    target: [0, 0, 0] as const, frame: { center: [0.5, 0, 0.5] as const, radius: 0.6 } } }
  const pixels = (await renderWorldHeadless(plan, options)).rgba
  expect(Array.from(pixels.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4))).toEqual([255, 0, 0, 255])
  const old = (await renderWorldHeadless({ ...plan, terrainTexturedBatches: 0 }, options)).rgba
  expect(Array.from(old.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4))).toEqual([0, 255, 0, 255])
})

it('splits terrain prefixes without biasing model tails or water', () => {
  const a = batch(), b = batch(0.25)
  const joined = { positions: Float32Array.from([...a.positions, ...b.positions]),
    normals: Float32Array.from([...a.normals, ...b.normals]), colors: Float32Array.from([...a.colors, ...b.colors]) }
  const plan = { ...createWorldWebGlPlan({ items: [neutralLighting] }), opaqueTriangles: joined, terrainOpaqueVertices: 6,
    texturedTriangles: [textured('terrain', Uint8Array.of(255, 255, 255, 255)), textured('model', Uint8Array.of(255, 0, 0, 255))], terrainTexturedBatches: 1,
    transparentTriangles: batch(),
  }
  const primitives = worldHeadlessScene(plan).scene.primitives
  expect(primitives.find(p => p.id === 'world/ground')!.depthBias).toEqual(TERRAIN_DEPTH_BIAS)
  expect(primitives.find(p => p.id === 'world/opaque-models')!.depthBias).toBeUndefined()
  expect(primitives.find(p => p.id === 'world/opaque-models')!.positions).toEqual(b.positions)
  expect(primitives.find(p => p.id === 'world/textured-1')!.depthBias).toBeUndefined()
  expect(primitives.find(p => p.id === 'world/transparent')!.depthBias).toBeUndefined()
})

it.each([Math.PI / 2, -Math.PI / 2])(
  'keeps overlay painter order independent of camera %s',
  async azimuth => {
    const plan = {
      ...createWorldWebGlPlan({ items: [neutralLighting] }),
      texturedTriangles: [textured('ground', Uint8Array.of(255, 0, 0, 255))],
      terrainTexturedBatches: 1,
      terrainDecalTriangles: [
        textured('lower', Uint8Array.of(0, 0, 255, 255), 0.25),
        textured('upper', Uint8Array.of(0, 255, 0, 255)),
      ],
    }
    const materials = worldHeadlessScene(plan).scene.materials!
    expect(materials.find(m => m.id === 'world/decal-0')!.priority).toBeLessThan(
      materials.find(m => m.id === 'world/decal-1')!.priority!,
    )
    const frame = await renderWorldHeadless(plan, {
      width: 64,
      height: 64,
      camera: {
        azimuth,
        elevation: 1.5,
        zoom: 1,
        target: [0, 0, 0],
        frame: { center: [0.5, 0, 0.5], radius: 0.6 },
      },
    })
    expect(Array.from(frame.rgba.slice((32 * 64 + 32) * 4, (32 * 64 + 32) * 4 + 4))).toEqual([
      0, 255, 0, 255,
    ])
  },
)

it('replaces only the clipped-water prefix and retains non-water transparent triangles', () => {
  const original = {
    ...createWorldWebGlPlan({ items: [neutralLighting] }),
    transparentTriangles: batch(),
    transparentWaterTriangles: 1,
  }
  expect(
    worldHeadlessScene(original).scene.primitives.find(p => p.id === 'world/transparent')!.positions
      .length,
  ).toBe(18)
  const replaced = worldHeadlessScene({
    ...original,
    waterPlanes: [{ batch: batch(), colorFalloff: 0.1, receiveShadows: false }],
  })
  expect(replaced.scene.primitives.find(p => p.id === 'world/transparent')!.positions.length).toBe(
    9,
  )
  expect(replaced.scene.primitives.find(p => p.id === 'world/transparent')!.colors!.length).toBe(12)
  expect(replaced.water.get('world/water-0')).toBe(0.1)
})

it('places terrain layers before negative-priority transparent effects', () => {
  const plan = { ...createWorldWebGlPlan({ items: [neutralLighting] }),
    terrainDecalTriangles: [textured('ground', Uint8Array.of(0, 255, 0, 255))],
    transparentTexturedTriangles: [{ ...textured('effect', Uint8Array.of(255, 0, 0, 128)), blendMode: 'blend' as const, priority: -100, receiveShadows: false }],
  }
  expect(worldHeadlessScene(plan).scene.materials!.find(m => m.id === 'world/decal-0')!.priority).toBeLessThan(-100)
})
