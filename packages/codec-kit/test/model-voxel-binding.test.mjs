import assert from 'node:assert/strict'
import { test } from 'node:test'
const { bindVoxelCellsToParts } = await import(
  process.env.MODKIT_VOXEL_MODULE ?? '../dist/model/geometry.js'
)

/** Fixture policy explicitly matches the accepted prototype; the library has no game threshold. */
function bind(centres, triangles, parts, options = {}) {
  return bindVoxelCellsToParts(centres, triangles, parts, {
    ambiguousWeightThreshold: 0.65,
    unweightedPolicy: 'lowest-slot',
    ...options,
  })
}

/** A query fixture with known barycentric weights; real geometry is qualified by the adapter tests. */
function triangle({
  slots = [0, 1, 1],
  weights = [1, 1, 1],
  bary = [0.5, 0.25, 0.25],
  distance = 2,
} = {}) {
  const joints = new Uint16Array(12),
    skinWeights = new Float32Array(12)
  for (let v = 0; v < 3; v++) {
    joints[v * 4] = slots[v]
    skinWeights[v * 4] = weights[v]
  }
  return {
    vertices: [0, 1, 2],
    joints,
    weights: skinWeights,
    boundsDistance() {
      return 0
    },
    closestDistance(_point, out) {
      out.set(bary)
      return distance
    },
  }
}

test('interpolated repeated slots, lower-slot ties and strict ambiguity threshold', () => {
  for (const threshold of [undefined, NaN, -1, 2])
    assert.throws(
      () =>
        bind(new Float64Array([0, 0, 0]), [triangle()], ['a', 'b'], {
          ambiguousWeightThreshold: threshold,
        }),
      /ambiguousWeightThreshold/,
    )
  const result = bind(new Float64Array([0, 0, 0]), [triangle()], ['zero', 'one'])
  assert.deepEqual([...result.slots], [0])
  assert.equal(result.ambiguousCells, 1)
  assert.equal(result.maxDroppedWeight, 0.5)
  assert.equal(result.maxSurfaceDistance, 2)
  assert.deepEqual(result.losses, ['rigid-skin-approximation'])
  const at = bind(
    new Float64Array([0, 0, 0]),
    [triangle({ bary: [0.65, 0.2, 0.15] })],
    ['zero', 'one'],
  )
  assert.equal(at.ambiguousCells, 0)
  const below = bind(
    new Float64Array([0, 0, 0]),
    [triangle({ bary: [0.649, 0.2, 0.151] })],
    ['zero', 'one'],
  )
  assert.equal(below.ambiguousCells, 1)
})

test('equidistant triangles keep source order and outputs keep cell order', () => {
  const first = triangle({ slots: [1, 1, 1] }),
    second = triangle({ slots: [0, 0, 0] })
  assert.deepEqual(
    [...bind(new Float64Array([1, 2, 3, 4, 5, 6]), [first, second], ['a', 'b']).slots],
    [1, 1],
  )
  assert.deepEqual([...bind(new Float64Array([1, 2, 3]), [second, first], ['a', 'b']).slots], [0])
  assert.equal(bind(new Float64Array(), [], []).triangleVisits, 0)
})

test('source slot order and 8 influences are explicit rather than inferred from bone IDs', () => {
  const surface = triangle({ slots: [1, 1, 1] })
  assert.equal(bind(new Float64Array([0, 0, 0]), [surface], ['bone-200', 'bone-7']).slots[0], 1)
  const eight = {
    ...surface,
    influences: 8,
    joints: new Uint32Array(24),
    weights: new Float32Array(24),
  }
  for (let v = 0; v < 3; v++) {
    eight.joints[v * 8 + 7] = 1
    eight.weights[v * 8 + 7] = 1
  }
  assert.equal(bind(new Float64Array([0, 0, 0]), [eight], ['a', 'b']).slots[0], 1)
})

test('linear work/output limits refuse before calling geometry', () => {
  const surface = triangle()
  surface.boundsDistance = () => {
    throw Error('geometry visited')
  }
  const centres = new Float64Array([0, 0, 0, 1, 1, 1])
  for (const options of [
    { maxCells: 1 },
    { maxTriangles: 0 },
    { maxTriangleVisits: 1 },
    { maxOutputBytes: 7 },
  ])
    assert.throws(() => bind(centres, [surface], ['a', 'b'], options), /exceeds/)
  for (const value of [-1, NaN, Infinity, 0.5])
    assert.throws(
      () => bind(centres, [surface], ['a', 'b'], { maxTriangleVisits: value }),
      /invalid/,
    )
})

test('malformed surfaces and unbound identity slots fail explicitly', () => {
  const centres = new Float64Array([0, 0, 0])
  assert.throws(() => bind(centres, [], ['a']), /no source/)
  assert.throws(() => bind(centres, [triangle({ slots: [2, 2, 2] })], ['a', 'b']), /unbound/)
  assert.throws(() => bind(new Float64Array([NaN, 0, 0]), [triangle()], ['a', 'b']), /nonfinite/)
  assert.throws(() => bind(new Float64Array(1), [triangle()], ['a', 'b']), /triples/)
  const bad = triangle()
  bad.weights[0] = NaN
  assert.throws(() => bind(centres, [bad], ['a', 'b']), /joint or weight/)
  assert.throws(
    () => bind(centres, [{ ...triangle(), vertices: [3, 1, 2] }], ['a', 'b']),
    /out of range/,
  )
  for (const bary of [
    [NaN, 0, 0],
    [1, 1, 1],
    [-1, 1, 1],
  ])
    assert.throws(() => bind(centres, [triangle({ bary })], ['a', 'b']), /barycentric/)
  assert.throws(() => bind(centres, [triangle({ distance: NaN })], ['a', 'b']), /distance/)
})

test('degenerate and unweighted surfaces preserve lowest-slot fallback with explicit losses', () => {
  for (const surface of [triangle({ bary: [0, 0, 0] }), triangle({ weights: [0, 0, 0] })])
    assert.throws(
      () =>
        bindVoxelCellsToParts(new Float64Array([0, 0, 0]), [surface], ['a', 'b'], {
          ambiguousWeightThreshold: 0.65,
        }),
      /source surface/,
    )
  for (const surface of [triangle({ bary: [0, 0, 0] }), triangle({ weights: [0, 0, 0] })]) {
    const result = bind(new Float64Array([0, 0, 0]), [surface], ['a', 'b'])
    assert.equal(result.slots[0], 0)
    assert.equal(result.zeroWeightCells, 1)
    assert.equal(result.maxDroppedWeight, 1)
    assert(result.losses.includes('unweighted-surface-assignment'))
  }
  assert.equal(
    bind(new Float64Array([0, 0, 0]), [triangle({ bary: [0, 0, 0] })], ['a', 'b']).degenerateCells,
    1,
  )
  const ignored = bind(
    new Float64Array([0, 0, 0]),
    [triangle({ bary: [NaN, 0, 0], distance: 3 }), triangle({ distance: 2 })],
    ['a', 'b'],
  )
  assert.equal(ignored.degenerateCells, 0)
})

test('cancel before work, during a long cell traversal and before returning a result', () => {
  const early = new AbortController()
  early.abort(Error('early'))
  assert.throws(() => bind(new Float64Array(), [], [], { signal: early.signal }), /early/)
  const mid = new AbortController(),
    surface = triangle()
  surface.closestDistance = (_point, out) => {
    out.set([1, 0, 0])
    mid.abort(Error('mid'))
    return 0
  }
  assert.throws(
    () =>
      bind(new Float64Array([0, 0, 0]), [surface], ['a', 'b'], {
        signal: mid.signal,
      }),
    /mid/,
  )
  const during = new AbortController(),
    many = Array.from({ length: 1025 }, () => triangle())
  many[0].boundsDistance = () => {
    during.abort(Error('during'))
    return 0
  }
  assert.throws(
    () =>
      bind(new Float64Array([0, 0, 0]), many, ['a', 'b'], {
        signal: during.signal,
      }),
    /during/,
  )
})
