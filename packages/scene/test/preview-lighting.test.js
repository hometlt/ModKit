import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readPreviewLighting, samplePreviewLighting } from '../src/render/preview-lighting.js'
import { readUvmSceneLights } from '../src/uvm/lights.js'
import { renderHeadless } from '../src/render/headless.js'

const identity = Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
const directional = { type: 'directional', direction: [0, 0, 1], color: [1, 0.5, 0.25] }
const point = {
  ...directional,
  type: 'point',
  position: [0, 0, 2],
  attenuationStart: 0,
  attenuationEnd: 4,
  decayExponent: 2,
}
test('preview lighting preserves full directional, distance/decay, cone and four-light average equations', () => {
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([directional]), [0, 0, 1], [0, 0, 0]),
    [1, 0.5, 0.25],
  )
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([directional]), [0, 0, -1], [0, 0, 0]),
    [0.25, 0.125, 0.0625],
  )
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([point]), [0, 0, 1], [0, 0, 0]),
    [0.25, 0.125, 0.0625],
  )
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([{ ...point, range: 1 }]), [0, 0, 1], [0, 0, 0]),
    [0, 0, 0],
  )
  const spot = {
    ...point,
    type: 'spot',
    direction: [0, 0, -1],
    innerConeAngle: Math.PI / 4,
    outerConeAngle: Math.PI / 2,
  }
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([spot]), [0, 0, 1], [0, 0, 0]),
    [0.25, 0.125, 0.0625],
  )
  assert.deepEqual(
    samplePreviewLighting(
      readPreviewLighting([{ ...spot, direction: [0, 0, 1] }]),
      [0, 0, 1],
      [0, 0, 0],
    ),
    [0, 0, 0],
  )
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting([directional, point]), [0, 0, 1], [0, 0, 0]),
    [0.625, 0.3125, 0.15625],
  )
})
test('preview inputs are bounded owned snapshots and invalid directions/local positions refuse', () => {
  const light = { ...directional, color: [1, 0.5, 0.25] },
    rig = readPreviewLighting([light])
  light.color.fill(0)
  assert.deepEqual(rig.lights[0].color, [1, 0.5, 0.25])
  assert.throws(() => readPreviewLighting(Array(5).fill(directional)), /four/)
  assert.throws(() => readPreviewLighting([{ ...point, position: undefined }]), /position/)
  assert.throws(() => readPreviewLighting([{ ...directional, direction: [0, 0, 0] }]), /zero/)
  assert.throws(() => readPreviewLighting([{ ...point, decayExponent: Infinity }]), /decay/)
})
test('UVM light frame transforms positions and distance units together and refuses nonuniform scale', () => {
  const document = {
    asset: { version: '2.0' },
    nodes: [{}],
    extensions: { UV_scene_lights: { version: 1, spaceNode: 0, lights: [point] } },
  }
  const matrix = identity.slice()
  matrix[0] = matrix[5] = matrix[10] = 2
  matrix[12] = 3
  const result = readUvmSceneLights(document, new Map([['node-0', matrix]]), new Set(['node-0']), {
    maxBytes: 100000,
    maxNodes: 1000,
  })
  assert.deepEqual(result.lights[0], { ...point, position: [3, 0, 4], attenuationEnd: 8 })
  assert.deepEqual(
    samplePreviewLighting(readPreviewLighting(result.lights), [0, 0, 1], [3, 0, 0]),
    [0.25, 0.125, 0.0625],
  )
  matrix[0] = 3
  assert.throws(
    () =>
      readUvmSceneLights(document, new Map([['node-0', matrix]]), new Set(['node-0']), {
        maxBytes: 100000,
        maxNodes: 1000,
      }),
    /uniform/,
  )
})
test('UVM light color, intensity, attenuation and cone follow the selected sequence clock', () => {
  const track = (from, to) => [
    {
      sequenceIndex: 3,
      track: {
        lineType: 1,
        globalSeqId: null,
        keys: [
          { frame: 0, vector: from },
          { frame: 1, vector: to },
        ],
      },
    },
  ]
  const animated = {
    ...point,
    type: 'spot',
    direction: [0, 0, -1],
    color: [0.5, 1, 1.5],
    animationDefaults: {
      color: [0.25, 0.5, 0.75],
      intensity: 2,
      attenuationStart: 1,
      decayExponent: 2,
      innerConeAngle: 0.2,
      outerConeAngle: 0.6,
    },
    sequenceAnimation: {
      color: track([0.25, 0.5, 0.75], [1, 0, 0]),
      intensity: track([2], [0.5]),
      attenuationStart: track([1], [2]),
      decayExponent: track([2], [1]),
      innerConeAngle: track([0.2], [0.3]),
      outerConeAngle: track([0.6], [0.8]),
    },
  }
  const document = {
    asset: { version: '2.0' },
    nodes: [{}],
    extensions: { UV_scene_lights: { version: 1, spaceNode: 0, lights: [animated] } },
  }
  const matrix = identity.slice()
  matrix[0] = matrix[5] = matrix[10] = 2
  const result = readUvmSceneLights(
    document,
    new Map([['node-0', matrix]]),
    new Set(['node-0']),
    { maxBytes: 100000, maxNodes: 1000, time: 1, sequenceIndex: 3 },
  )
  assert.deepEqual(result.lights[0], {
    ...point,
    type: 'spot',
    direction: [0, 0, -1],
    position: [0, 0, 4],
    color: [0.5, 0, 0],
    attenuationStart: 4,
    attenuationEnd: 8,
    decayExponent: 1,
    innerConeAngle: Math.fround(0.3),
    outerConeAngle: Math.fround(0.8),
  })
})
test('actual CPU preview renderer consumes directional lights without requiring the old single light', async () => {
  const frame = await renderHeadless({
    outputKind: 'rgba8',
    viewport: { width: 2, height: 2 },
    camera: { viewProjection: identity },
    scene: {
      lights: [directional],
      materials: [{ id: 'm', baseColor: [1, 1, 1, 1], shading: 'lambert' }],
      primitives: [
        {
          id: 'p',
          materialId: 'm',
          topology: 'triangles',
          positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
          normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        },
      ],
    },
  })
  assert.deepEqual([...frame.rgba], Array(4).fill([255, 128, 64, 255]).flat())
})
