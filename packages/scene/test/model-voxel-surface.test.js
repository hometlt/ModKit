import assert from 'node:assert/strict'
import { test } from 'node:test'
const { createVoxelBindingSurface } = await import(
  process.env.MODKIT_VOXEL_SURFACE_MODULE ?? '../src/model/voxel-surface.ts'
)

/** Three vertices with explicit four-slot weights, already in the desired reference frame. */
function mesh(overrides = {}) {
  return {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    joints: new Uint16Array(12),
    weights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    ...overrides,
  }
}

test('actual Three queries preserve the posed frame, barycentric weights and triangle order', () => {
  const data = mesh(),
    surface = createVoxelBindingSurface([data]),
    bary = new Float64Array(3)
  assert.equal(surface.length, 1)
  assert.equal(surface[0].boundsDistance([0.5, 0.5, 2]), 2)
  assert.equal(surface[0].closestDistance([0.5, 0.5, 2], bary), 2)
  assert.deepEqual([...bary], [0.5, 0.25, 0.25])
  assert.equal(surface[0].joints, data.joints)
  data.positions.fill(99)
  assert.equal(surface[0].closestDistance([0.5, 0.5, 2], bary), 2, 'geometry is snapshotted')
  const indexed = createVoxelBindingSurface([mesh({ indices: new Uint32Array([2, 0, 1]) })])
  assert.deepEqual(indexed[0].vertices, [2, 0, 1])
})

test('degenerate geometry is explicit, and 8 original influences remain unmodified', () => {
  const surface = createVoxelBindingSurface([mesh({ positions: new Float32Array(9) })]),
    bary = new Float64Array(3)
  assert.equal(surface[0].closestDistance([0, 0, 1], bary), 1)
  assert.deepEqual([...bary], [0, 0, 0])
  const source = mesh({ influences: 8, joints: new Uint32Array(24), weights: new Float32Array(24) })
  assert.equal(createVoxelBindingSurface([source])[0].influences, 8)
})

test('collapsed edges use Three segment queries and keep degenerate barycentric policy explicit', () => {
  const bary = new Float64Array(3)
  for (const positions of [
    [0, 0, 0, 0, 0, 0, 2, 0, 0],
    [0, 0, 0, 2, 0, 0, 0, 0, 0],
    [2, 0, 0, 0, 0, 0, 0, 0, 0],
  ]) {
    const surface = createVoxelBindingSurface([mesh({ positions: new Float32Array(positions) })])
    assert.equal(surface[0].closestDistance([1, 0, 1], bary), 1)
    assert.deepEqual([...bary], [0, 0, 0])
  }
})

test('surface budgets and malformed geometry fail before unsafe reads or allocations', () => {
  for (const options of [
    { maxMeshes: 0 },
    { maxTriangles: 0 },
    { maxVertices: 2 },
    { maxInputBytes: 0 },
  ])
    assert.throws(() => createVoxelBindingSurface([mesh()], options), /exceeds/)
  assert.throws(
    () => createVoxelBindingSurface([mesh({ indices: new Uint32Array([0, 1, 3]) })]),
    /out of range/,
  )
  assert.throws(
    () => createVoxelBindingSurface([mesh({ indices: new Uint32Array([0, 1]) })]),
    /triples/,
  )
  assert.throws(
    () =>
      createVoxelBindingSurface([
        mesh({ positions: new Float32Array([NaN, 0, 0, 0, 1, 0, 1, 0, 0]) }),
      ]),
    /nonfinite/,
  )
  assert.throws(
    () => createVoxelBindingSurface([mesh({ weights: new Float32Array(1) })]),
    /matching/,
  )
  const controller = new AbortController()
  controller.abort(Error('cancelled'))
  assert.throws(
    () => createVoxelBindingSurface([mesh()], { signal: controller.signal }),
    /cancelled/,
  )
})
