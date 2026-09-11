import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderHeadless } from '../src/render/headless.js'
import { readSimpleEffect } from '../src/render/simple-effect.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const screenUv = { offset: [0, 0], tiling: [1, 1], angle: 0, threshold: 0 }
const state = {
  blend: 'opaque',
  depthTest: true,
  depthWrite: true,
  doubleSided: true,
  alphaCutoff: 0,
  wrapU: 'clamp',
  wrapV: 'clamp',
}
const red = [255, 0, 0, 255],
  green = [0, 255, 0, 255],
  blue = [0, 0, 255, 255],
  white = [255, 255, 255, 255]
const request = value => ({
  outputKind: 'rgba8',
  viewport: { width: 2, height: 2 },
  camera: { viewProjection: identity },
  scene: {
    materials: [
      {
        id: 'effect',
        baseColor: [1, 1, 1, 1],
        baseColorTexture: 'grid',
        simpleEffect: { ...state, screenUv: value },
      },
    ],
    textures: [
      {
        id: 'grid',
        width: 2,
        height: 2,
        rgba: Uint8Array.from([...red, ...green, ...blue, ...white]),
      },
    ],
    primitives: [
      {
        id: 'quad',
        materialId: 'effect',
        topology: 'triangles',
        positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
        indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
      },
    ],
  },
})

test('screen UV uses bottom-left fragment coordinates even without geometry UVs', async () => {
  assert.deepEqual(
    (await renderHeadless(request(screenUv))).rgba,
    Uint8Array.from([...blue, ...white, ...red, ...green]),
  )
})
test('screen extent threshold retains ordinary UVs below its exact boundary', async () => {
  assert.deepEqual(
    (await renderHeadless(request({ ...screenUv, threshold: 3 }))).rgba,
    Uint8Array.from([...red, ...red, ...red, ...red]),
  )
  assert.deepEqual(
    (await renderHeadless(request({ ...screenUv, threshold: 2 }))).rgba,
    Uint8Array.from([...blue, ...white, ...red, ...green]),
  )
})
test('screen UV follows pinned column-major rotation and owns float32 uniform input', async () => {
  assert.deepEqual(
    (await renderHeadless(request({ ...screenUv, angle: Math.PI / 2 }))).rgba,
    Uint8Array.from([...white, ...green, ...blue, ...red]),
  )
  const source = { ...state, screenUv: { ...screenUv, offset: [0.1, 0.2] } }
  const captured = readSimpleEffect(source)
  source.screenUv.offset[0] = 7
  assert.equal(captured.screenUv.offset[0], Math.fround(0.1))
})
test('invalid and overflowing screen uniforms refuse instead of sampling undefined GPU coordinates', () => {
  for (const value of [
    { ...screenUv, angle: Infinity },
    { ...screenUv, threshold: -1 },
    { ...screenUv, offset: [0] },
    { ...screenUv, tiling: [3e38, 1] },
  ])
    assert.throws(() => readSimpleEffect({ ...state, screenUv: value }))
})
