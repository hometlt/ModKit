import { expect, it } from 'vitest'
import {
  terrainUvTransformFromOrigin,
  transformTerrainUv,
  type MapTerrainUvTransform,
} from '../src/maps/index.js'

const close = (actual: readonly [number, number], expected: readonly [number, number]) => {
  expect(actual[0]).toBeCloseTo(expected[0], 12)
  expect(actual[1]).toBeCloseTo(expected[1], 12)
}

it('turns, flips and scales a coordinate about the centre, then offsets it', () => {
  const identity: MapTerrainUvTransform = { offset: [0, 0], scale: [1, 1], rotation: 0 }
  close(transformTerrainUv([0.25, 0.4], identity), [0.25, 0.4])
  // a flipped tile stays on its cell: u' = 1 − u
  close(transformTerrainUv([0.25, 0.4], { ...identity, scale: [-1, 1] }), [0.75, 0.4])
  // a quarter turn takes the right edge's middle to the bottom edge's middle (u toward v)
  close(transformTerrainUv([1, 0.5], { ...identity, rotation: Math.PI / 2 }), [0.5, 1])
  close(transformTerrainUv([1, 1], { ...identity, scale: [2, 2] }), [1.5, 1.5])
  close(transformTerrainUv([0, 0], { ...identity, offset: [0.125, -2] }), [0.125, -2])
})

it('converts a transform written about the UV origin into the same mapping', () => {
  const originForms: readonly MapTerrainUvTransform[] = [
    // SC2 ground: 24 repeats over 256 cells, v flipped
    { offset: [0, 1], scale: [24 / 256, -24 / 256], rotation: 0 },
    // Warzone 2100 ground: (map y, map x) over the ground's size
    { offset: [0, 0], scale: [1 / 64, -1 / 64], rotation: Math.PI / 2 },
    // Emperor detail texture
    { offset: [0.3, 0.7], scale: [0.25, -0.25], rotation: 0 },
    { offset: [-1.5, 2], scale: [3, 0.5], rotation: -0.75 },
  ]
  for (const origin of originForms) {
    const centred = terrainUvTransformFromOrigin(origin)
    expect(centred.scale).toEqual(origin.scale)
    expect(centred.rotation).toBe(origin.rotation)
    expect(Object.isFrozen(centred) && Object.isFrozen(centred.offset)).toBe(true)
    for (const uv of [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [17.25, -3],
    ] as const) {
      const x = uv[0] * origin.scale[0]
      const y = uv[1] * origin.scale[1]
      const cosine = Math.cos(origin.rotation)
      const sine = Math.sin(origin.rotation)
      close(transformTerrainUv(uv, centred), [
        origin.offset[0] + x * cosine - y * sine,
        origin.offset[1] + x * sine + y * cosine,
      ])
    }
  }
})
