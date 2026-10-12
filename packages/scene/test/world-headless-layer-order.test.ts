import { expect, it } from 'vitest'
import { createWorldWebGlPlan } from '../src/world/webgl.js'
import { renderWorldHeadless, worldHeadlessScene } from '../src/world/headless.js'

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

it.each([Math.PI / 2, -Math.PI / 2])(
  'keeps overlay painter order independent of camera %s',
  async azimuth => {
    const plan = {
      ...createWorldWebGlPlan({ items: [] }),
      texturedTriangles: [textured('ground', Uint8Array.of(255, 0, 0, 255))],
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
    ...createWorldWebGlPlan({ items: [] }),
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
  const plan = { ...createWorldWebGlPlan({ items: [] }),
    terrainDecalTriangles: [textured('ground', Uint8Array.of(0, 255, 0, 255))],
    transparentTexturedTriangles: [{ ...textured('effect', Uint8Array.of(255, 0, 0, 128)), blendMode: 'blend' as const, priority: -100, receiveShadows: false }],
  }
  expect(worldHeadlessScene(plan).scene.materials!.find(m => m.id === 'world/decal-0')!.priority).toBeLessThan(-100)
})
