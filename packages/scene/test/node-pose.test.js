import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createModelSceneSampler } from '../src/model/sampler.js'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const rest = { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
const clip = {
  id: 'move',
  name: 'move',
  kind: 'animation',
  provenance: 'direct',
  frames: 2,
  durationSeconds: 1,
  looping: false,
  channels: ['parent', 'child'].map((target, index) => ({
    target,
    kind: 'translation',
    firstFrame: 0,
    lastFrame: 1,
    interpolation: 'linear',
    samples: [
      { frame: 0, timeSeconds: 0, value: [0, 0, 0] },
      { frame: 1, timeSeconds: 1, value: index === 0 ? [2, 0, 0] : [0, 4, 0] },
    ],
  })),
}
const node = (id, childIds, transform = identity) => ({ id, childIds, transform, meshIds: [] })
function projection() {
  const frame = [...identity],
    bridge = [...identity],
    tip = [...identity]
  frame[0] = 2
  frame[5] = 3
  frame[12] = 10
  bridge[14] = 7
  tip[12] = 1
  return {
    // Deliberately unordered; a matrix intermediary must not be decomposed or discarded.
    nodes: [
      node('tip', [], tip),
      node('frame', ['parent'], frame),
      node('parent', ['bridge']),
      node('bridge', ['child'], bridge),
      node('child', ['tip']),
    ],
    meshes: [],
    primitives: [],
    nodePoses: ['parent', 'child'].map(nodeId => ({ nodeId, localPose: structuredClone(rest) })),
  }
}
test('rigid node animation composes nested local poses, matrix intermediaries and socket descendants without joints', () => {
  const source = projection(),
    sampler = createModelSceneSampler(source, { clip })
  source.nodePoses[0].localPose.translation[0] = 900
  const sample = sampler.sample(0.5)
  assert.deepEqual([...sample.nodeTransforms.get('tip')].slice(12, 15), [14, 6, 7])
  assert.deepEqual(sample.joints, [])
  assert.deepEqual(sample.diagnostics, [])
  assert.deepEqual([...sampler.sample(0).nodeTransforms.get('tip')].slice(12, 15), [12, 0, 7])
})
test('rigid node blending uses the same hierarchy and signed historical offset as the primary sampler', () => {
  const sampler = createModelSceneSampler(projection(), {
    poseSamples: [{ clip, time: 1, weight: 1 }],
    poseTime: 0.5,
  })
  assert.deepEqual([...sampler.sample(0.5).nodeTransforms.get('tip')].slice(12, 15), [16, 12, 7])
  assert.deepEqual([...sampler.sample(0).nodeTransforms.get('tip')].slice(12, 15), [14, 6, 7])
  const invalid = projection()
  invalid.nodePoses[0].nodeId = 'missing'
  assert.throws(() => createModelSceneSampler(invalid, { clip }), /absent or overlaps/)
})
test('primitive visibility channels hide only their exact portable target at the sampled time', () => {
  const source = {
    nodes: [{ ...node('root', []), meshIds: ['mesh'] }],
    meshes: [{ id: 'mesh', primitiveIds: ['visible', 'animated'] }],
    primitives: ['visible', 'animated'].map(id => ({
      id,
      topology: 'triangles',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    })),
  }
  const visibility = {
    id: 'visibility', name: 'visibility', kind: 'animation', provenance: 'direct', frames: 2,
    channels: [{
      target: 'animated', kind: 'visibility', firstFrame: 0, lastFrame: 1,
      interpolation: 'step',
      samples: [
        { frame: 0, timeSeconds: 0, value: [1] },
        { frame: 1, timeSeconds: 1, value: [0] },
      ],
    }],
  }
  const sampler = createModelSceneSampler(source, { clip: visibility })
  assert.deepEqual(sampler.sample(0).primitives.map(item => item.id), ['visible', 'animated'])
  assert.deepEqual(sampler.sample(1).primitives.map(item => item.id), ['visible'])
  assert.deepEqual(sampler.sample(1).diagnostics, [])
})
