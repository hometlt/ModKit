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

test('independent global node clocks preserve matrix parents, sockets and camera argument', () => {
  const clocks = {
    ...clip,
    channels: clip.channels.map((channel, index) =>
      index === 0 ? { ...channel, concurrent: true, wrapSeconds: 1 } : channel,
    ),
  }
  const sampler = createModelSceneSampler(projection(), { clip: clocks })
  const camera = { rotation: [0, 0, 0, 1], position: [1, 2, 3] }
  assert.deepEqual(
    [...sampler.sample(0.25, undefined, camera, 0.75).nodeTransforms.get('tip')].slice(12, 15),
    [15, 3, 7],
  )
  assert.deepEqual([...sampler.sample(0.25).nodeTransforms.get('tip')].slice(12, 15), [13, 3, 7])
  assert.deepEqual(
    [...sampler.sample(0.25, undefined, camera, 0).nodeTransforms.get('tip')].slice(12, 15),
    [12, 3, 7],
  )
  for (const invalid of [-1, NaN, Infinity, null, '0'])
    assert.throws(() => sampler.sample(0.25, undefined, camera, invalid), /global time/)
  assert.throws(() => sampler.sample(0.25, AbortSignal.abort(), camera, 0.75), {
    name: 'AbortError',
  })
  const empty = createModelSceneSampler({ nodes: [], meshes: [], primitives: [] })
  assert.throws(() => empty.sample(0, undefined, undefined, -1), /global time/)
})

test('concurrent morph and visibility use global time while ordinary channels stay local', () => {
  const source = {
    nodes: [{ ...node('root', []), meshIds: ['mesh'] }],
    meshes: [{ id: 'mesh', primitiveIds: ['body', 'marker'] }],
    primitives: ['body', 'marker'].map(id => ({
      id,
      topology: 'triangles',
      positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      ...(id === 'body'
        ? { morphTargets: [{ positions: Float32Array.from([0, 4, 0, 0, 0, 0, 0, 0, 0]) }] }
        : {}),
    })),
  }
  const tracks = [
    {
      target: 'root',
      kind: 'weights',
      samples: [
        { frame: 0, timeSeconds: 0, value: [0] },
        { frame: 1, timeSeconds: 1, value: [1] },
      ],
    },
    {
      target: 'marker',
      kind: 'visibility',
      samples: [
        { frame: 0, timeSeconds: 0, value: [1] },
        { frame: 1, timeSeconds: 0.5, value: [0] },
      ],
    },
  ]
  const create = concurrent =>
    createModelSceneSampler(source, {
      clip: {
        ...clip,
        channels: tracks.map(track => ({
          ...track,
          firstFrame: 0,
          lastFrame: 1,
          interpolation: track.kind === 'visibility' ? 'step' : 'linear',
          ...(concurrent ? { concurrent: true, wrapSeconds: 1 } : {}),
        })),
      },
    })
  const sampler = create(true)
  const global = sampler.sample(0.25, undefined, undefined, 0.75)
  assert.deepEqual(
    global.primitives.map(p => p.id),
    ['body'],
  )
  assert.equal(global.primitives[0].positions[1], 3)
  assert.equal(sampler.sample(0.25).primitives[0].positions[1], 1)
  assert.equal(sampler.sample(0.25, undefined, undefined, 0).primitives[0].positions[1], 0)
  const local = create(false).sample(0.25, undefined, undefined, 0.75)
  assert.equal(local.primitives[0].positions[1], 1)
  assert.deepEqual(
    local.primitives.map(p => p.id),
    ['body', 'marker'],
  )
})
