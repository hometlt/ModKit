import { expect, it } from 'vitest'
import { renderHeadless } from '../src/render/headless.js'
import { waterDepthColor } from '../src/render/water-color.js'

// View world X/Z from above, with height Y becoming negative clip depth.
const projection = Float32Array.of(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1)
const quad = (id: string, height: number, size = 1) => ({
  id,
  materialId: id,
  topology: 'triangles' as const,
  positions: Float32Array.of(
    -size,
    height,
    -size,
    size,
    height,
    -size,
    size,
    height,
    size,
    -size,
    height,
    size,
  ),
  indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
})
const perspective = Float32Array.of(
  1,
  0,
  0,
  0,
  0,
  0,
  -10.1 / 9.9,
  -1,
  0,
  1,
  0,
  0,
  0,
  0,
  20 / 9.9,
  2,
)
const draw = async (bottom: number, objectHeight?: number, viewProjection = projection) =>
  renderHeadless(
    {
      outputKind: 'rgba8',
      viewport: { width: 8, height: 8 },
      camera: { viewProjection },
      clearColor: [0, 0, 0, 1],
      scene: {
        materials: [
          { id: 'floor', baseColor: [0, 1, 0, 1] },
          { id: 'object', baseColor: [1, 0, 0, 1] },
          { id: 'water', baseColor: [0, 0, 1, 0.5], alphaMode: 'blend', depthWrite: false },
        ],
        primitives: [
          quad('floor', bottom),
          ...(objectHeight === undefined ? [] : [quad('object', objectHeight, 0.5)]),
          quad('water', 0),
        ],
      },
    },
    undefined,
    new Map([['water', 0.1]]),
  )

it('uses the shared GPU depth tint, including shallow and dry coverage', () => {
  expect(waterDepthColor([1, 1, 1, 0.5], -1)[3]).toBe(0)
  expect(waterDepthColor([1, 1, 1, 0.5], 0.02)[3]).toBeCloseTo(
    (0.5 + 0.5 * (1 - Math.exp(-0.002))) * 0.5,
  )
  expect(waterDepthColor([1, 1, 1, 0.5], Infinity)).toEqual([0.65, 0.65, 0.65, 1])
  expect(waterDepthColor([1, 1, 1, 0.5], Infinity, 0)).toEqual([1, 1, 1, 0.5])
})

it.each([
  { name: 'orthographic', matrix: projection },
  { name: 'perspective', matrix: perspective },
])(
  'follows the drawn bottom with $name projection and preserves objects above the surface',
  async ({ matrix }) => {
    const wet = await draw(-0.5, undefined, matrix),
      shallow = await draw(-0.01, undefined, matrix),
      dry = await draw(0.5, undefined, matrix),
      object = await draw(-0.5, 0.5, matrix)
    const center = (frame: typeof wet) =>
      Array.from(frame.rgba.slice((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4))
    expect(center(wet)[2]).toBeGreaterThan(100)
    expect(center(shallow)[2]).toBeLessThan(center(wet)[2]!)
    expect(center(dry)).toEqual([0, 255, 0, 255])
    expect(center(object)).toEqual([255, 0, 0, 255])
    const submerged = await draw(-0.5, -0.1, matrix)
    expect(center(submerged)[2]).toBeGreaterThan(100)
  },
)
