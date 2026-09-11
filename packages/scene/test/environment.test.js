import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createStandardMaterialPrograms } from '../src/materials/index.js'
import { snapshotEnvironment, snapshotEyePosition } from '../src/materials/environment.js'

const budget = { maxDepth: 64, maxNodes: 10000, maxBytes: 1048576 }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const layer = (slot, value = {}) => ({
  slot,
  texturePath: null,
  constantColor: { value: [1, 1, 1, 1] },
  uvSource: 0,
  channels: 1,
  op: 2,
  teamColorMode: 0,
  invert: false,
  clampResult: true,
  wrapX: true,
  wrapY: true,
  ...value,
})
const material = (layers, options = {}) => ({
  renderModel: {
    version: 1,
    standard: {
      layers,
      blendMode: 0,
      priority: 0,
      specularity: 10,
      specMult: 1,
      emisMult: 1,
      specMode: 0,
      alphaTestThreshold: 0,
      twoSided: false,
      unshaded: true,
      doubleLambert: false,
      clampOutput: false,
      usesVertexColor: false,
      usesVertexAlpha: false,
      ...options,
    },
  },
})
const close = (actual, expected) =>
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-7))

it('samples the surface normal before environment texels exist, with the bound channel conventions', () => {
  const sampler = createStandardMaterialPrograms(
    material({
      normal: layer('normal', { texturePath: 'normal.dds' }),
      envi: layer('envi', { texturePath: 'cube.dds', uvSource: 7 }),
    }),
    { budget },
  )
  const p = sampler.sample({ time: 0 }, { normalMapFormats: new Map([['normal.dds', 'bc5']]) })[0]
  close(p.sampleNormal({ texels: { normal: [0.8, 0.6, 0, 0.2] } }), [0.6, 0.2, Math.sqrt(0.6)])
  assert.throws(() => p.shade({ texels: { normal: [0.8, 0.6, 0, 0.2] } }), /cube.dds/)
  assert.throws(() => p.sampleNormal({ texels: { normal: [0.8, NaN, 0, 0.2] } }), /finite/)
})

it('uses the existing normal-mask weights and sequential detail policy in the separate normal stage', () => {
  const p = createStandardMaterialPrograms(
    material(
      {
        normal: layer('normal', { constantColor: { value: [0.5, 0.5, 1, 1] } }),
        normalBlend1: layer('normalBlend1', { constantColor: { value: [1, 0.5, 0.5, 1] } }),
        normalBlend1Mask: layer('normalBlend1Mask', { constantColor: { value: [0.25, 0, 0, 1] } }),
      },
      {
        normalMapFormat: 'rgb8',
        normalBlendFactors: Array.from({ length: 8 }, (_, i) => ({ value: i === 0 ? 2 : 0 })),
      },
    ),
    { budget },
  ).sample({ time: 0 })[0]
  close(p.sampleNormal(), [Math.SQRT1_2, 0, Math.SQRT1_2])
})

it('owns each explicit environment frame and changes uniform values without retaining caller matrices', () => {
  const sampler = createStandardMaterialPrograms(
    material({
      envi: layer('envi', { texturePath: 'cube.dds', uvSource: 7 }),
    }),
    { budget },
  )
  const matrix = [...identity]
  const options = {
    textureDimensions: new Map([['cube.dds', 'cube']]),
    environment: { worldToEnvironment: matrix },
  }
  const first = sampler.sample({ time: 0 }, options)[0]
  matrix[12] = 0.25
  const second = sampler.sample({ time: 1 }, options)[0]
  assert.deepEqual(first.environment.worldToEnvironment, identity)
  assert.equal(second.environment.worldToEnvironment[12], 0.25)
  assert.equal(first.key, second.key)
  assert.equal(first.fragmentSource, second.fragmentSource)
  assert.notDeepEqual(first.uniforms, second.uniforms)
  assert.throws(() => {
    first.environment.worldToEnvironment[12] = 4
  }, TypeError)
})

it('does not assign environment emitter rules to another cube material slot', () => {
  const sampler = createStandardMaterialPrograms(
    material({
      diffuse: layer('diffuse', {
        texturePath: 'cube.dds',
        uvSource: 7,
        uvOffset: { value: [0.25, 0] },
      }),
    }),
    { budget },
  )
  assert.throws(
    () =>
      sampler.sample(
        { time: 0 },
        {
          textureDimensions: new Map([['cube.dds', 'cube']]),
          environment: { worldToEnvironment: identity },
        },
      ),
    /direction-space/,
  )
})

it('validates and snapshots explicit world-coordinate inputs without deriving absent values', () => {
  assert.equal(snapshotEnvironment(undefined), undefined)
  assert.equal(snapshotEyePosition(undefined), undefined)
  const eye = [1, 2, 3],
    captured = snapshotEyePosition(eye)
  eye[0] = 4
  assert.deepEqual(captured, [1, 2, 3])
  for (const value of [null, [], {}, { worldToEnvironment: identity, extra: true }])
    assert.throws(() => snapshotEnvironment(value), TypeError)
})

it('rejects missing vector components instead of accepting sparse matrices or observer positions', () => {
  const matrix = [...identity]
  delete matrix[4]
  assert.throws(() => snapshotEnvironment({ worldToEnvironment: matrix }), /finite float32/)
  assert.throws(() => snapshotEyePosition([1, , 3]), /finite float32/)
})

it('captures each coordinate once before validating it', () => {
  const eye = [1, 2, 3]
  let reads = 0
  Object.defineProperty(eye, 0, { get: () => (++reads === 1 ? 4 : Infinity) })
  assert.deepEqual(snapshotEyePosition(eye), [4, 2, 3])
  assert.equal(reads, 1)
  assert.throws(() => snapshotEyePosition(eye), /finite float32/)
})

it('refuses finite matrices whose reflection arithmetic can overflow float32', () => {
  const matrix = [...identity]
  matrix[0] = matrix[5] = matrix[10] = 1e20
  assert.throws(() => snapshotEnvironment({ worldToEnvironment: matrix }), /reflection arithmetic/)
})
