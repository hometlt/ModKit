import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clipProjectorReceivers } from '../src/uvm/projector-receivers.js'

// A terrain-sized receiver takes the grid path; the same triangles split into small receivers take
// the full scan. Both must emit the same clipped triangles in the same order.
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const cells = 48
const positions = new Float32Array((cells + 1) * (cells + 1) * 3)
for (let z = 0; z <= cells; z++)
  for (let x = 0; x <= cells; x++) {
    const vertex = (z * (cells + 1) + x) * 3
    positions[vertex] = x
    positions[vertex + 1] = Math.sin(x * 0.7) * 0.4 + Math.cos(z * 0.3) * 0.3
    positions[vertex + 2] = -z
  }
const indices = []
for (let z = 0; z < cells; z++)
  for (let x = 0; x < cells; x++) {
    const a = z * (cells + 1) + x
    indices.push(a, a + cells + 2, a + 1, a, a + cells + 1, a + cells + 2)
  }
const allIndices = Uint32Array.from(indices)
const whole = { id: 'terrain', topology: 'triangles', positions, indices: allIndices }
const chunks = []
for (let start = 0; start < allIndices.length; start += 900 * 3)
  chunks.push({
    id: `chunk-${start}`,
    topology: 'triangles',
    positions,
    indices: allIndices.subarray(start, start + 900 * 3),
  })
// A downward orthographic decal box centred over (cx, cz), in receiver space.
const decal = (cx, cz, halfWidth, halfDepth) => ({
  projectionType: 'orthographic',
  origin: [cx, 4, cz],
  rightAxis: [1, 0, 0],
  upAxis: [0, 0, -1],
  forwardAxis: [0, -1, 0],
  near: 0.1,
  far: 8,
  left: -halfWidth,
  rightExtent: halfWidth,
  bottom: -halfDepth,
  top: halfDepth,
  tangentX: 1,
  tangentY: 1,
})
const budget = { maxBytes: 64 * 1024 * 1024, maxTriangles: 1_000_000 }
const clip = (frame, primitives, transform = identity) =>
  clipProjectorReceivers(
    frame,
    primitives.map(primitive => ({ primitive, transform })),
    budget,
  )

test('a large receiver clips through its grid exactly as a full scan does', () => {
  for (const frame of [
    decal(10.3, -7.6, 2.5, 1.5),
    decal(0, 0, 1, 1),
    decal(47.9, -47.9, 3, 3),
    decal(24, -24, 30, 30),
  ]) {
    const grid = clip(frame, [whole])
    const scan = clip(frame, chunks)
    assert.ok(grid.indices.length > 0)
    assert.deepEqual([...grid.positions], [...scan.positions])
    assert.deepEqual([...grid.textureCoordinates], [...scan.textureCoordinates])
    assert.deepEqual([...grid.indices], [...scan.indices])
  }
  // A transformed receiver answers the same question in its own space.
  const moved = [...identity]
  moved[12] = -5
  moved[14] = 3
  const frame = decal(4.2, -2.1, 2, 2)
  assert.deepEqual(
    [...clip(frame, [whole], moved).positions],
    [...clip(frame, chunks, moved).positions],
  )
})

test('a decal beside the receiver clips nothing and the budget still counts every triangle', () => {
  assert.equal(clip(decal(200, 200, 2, 2), [whole]).indices.length, 0)
  assert.throws(
    () =>
      clipProjectorReceivers(decal(10, -10, 2, 2), [{ primitive: whole, transform: identity }], {
        ...budget,
        maxTriangles: allIndices.length / 3 - 1,
      }),
    /receiver work exceeds budget/u,
  )
})
