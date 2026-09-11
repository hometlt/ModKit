import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expandOrderedEulerNode } from '../src/model/ordered-euler.js'
import { createModelAnimationSampler } from '@modkit/codec-kit/model/animation'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const nodes = [
  { id: 'root', transform: identity, childIds: ['tip'], meshIds: ['mesh'] },
  { id: 'tip', transform: identity, childIds: [], meshIds: [] },
]
const budget = { maxBytes: 1000000, maxNodes: 10000, maxDepth: 32 }
const keys = [
  { timeSeconds: 0, value: [-3, 0.4, 0.7] },
  { timeSeconds: 1, value: [3, 1.2, -0.5] },
]
test('ordered rotation preserves long authored arcs and ordinary child/mesh hierarchy', () => {
  const expanded = expandOrderedEulerNode(nodes, 'root', keys, 'linear', budget)
  assert.equal(expanded.nodes.length, 5)
  assert.deepEqual(expanded.nodes[0].meshIds, [])
  assert.deepEqual(expanded.nodes.at(-1).meshIds, ['mesh'])
  assert.deepEqual(expanded.nodes.at(-1).childIds, ['tip'])
  const sampler = createModelAnimationSampler({
    id: 'turn',
    name: 'Turn',
    kind: 'animation',
    provenance: 'direct',
    frames: 2,
    channels: expanded.channels,
  })
  for (const time of [0, 0.13, 0.37, 0.5, 0.79, 1]) {
    const sampled = sampler.sample(time)
    for (let axis = 0; axis < 3; axis++) {
      const angle = keys[0].value[axis] + (keys[1].value[axis] - keys[0].value[axis]) * time
      assert.ok(Math.abs(sampled[axis].value[axis] - Math.sin(angle / 2)) < 1e-6)
      assert.ok(Math.abs(sampled[axis].value[3] - Math.cos(angle / 2)) < 1e-6)
    }
  }
  assert.deepEqual(nodes[0].meshIds, ['mesh'])
})
test('ordered rotation refuses excessive subdivision, matrix decomposition, collisions and cancellation', () => {
  assert.throws(
    () =>
      expandOrderedEulerNode(
        nodes,
        'root',
        [keys[0], { timeSeconds: 1, value: [1e20, 0, 0] }],
        'linear',
        budget,
      ),
    /budget/,
  )
  assert.throws(
    () =>
      expandOrderedEulerNode(
        [{ ...nodes[0], transform: identity.map((value, index) => (index === 12 ? 1 : value)) }],
        'root',
        keys,
        'linear',
        budget,
      ),
    /identity/,
  )
  const first = expandOrderedEulerNode(nodes, 'root', keys, 'step', budget)
  assert.equal(first.channels[0].samples.length, 2)
  assert.throws(
    () => expandOrderedEulerNode(first.nodes, 'root', keys, 'linear', budget),
    /collision/,
  )
  assert.throws(() =>
    expandOrderedEulerNode(nodes, 'root', keys, 'linear', budget, AbortSignal.abort()),
  )
})
