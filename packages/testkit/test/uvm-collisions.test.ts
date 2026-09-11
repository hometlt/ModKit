import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { addUvmCollisions } from '../../scene/src/uvm/collisions.js'
import { createUvmCollisionOverlay } from '../../scene/src/uvm/collision-overlay.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { readUvmFacets } from '../../scene/src/uvm/facets.js'
import { createModelSceneSampler } from '../../scene/src/model/index.js'
import { rebaseUvmScene } from '../../scene/src/uvm/frame.js'
import { openUvmDocument } from '../../scene/src/uvm/index.js'
import { renderHeadless } from '../../scene/src/render/headless.js'
import { appendUvmAccessors } from '../../uv/src/model/accessor-write.js'

const budget = { maxScalarBytes: 1_000_000 }
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing collision fixture value')
  return value
}
async function fixture() {
  const source = readUvmContainer(
    Buffer.from(
      await readFile(
        new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url),
        'utf8',
      ),
      'base64',
    ),
  )
  const { rig } = readUvmModel(source.document, source.binary, budget)
  return { source, parent: Number(required(required(rig.bindings[0]).nodeId).slice(5)) }
}
const shapes: readonly JsonObject[] = [
  { kind: 'box', size: [2, 4, 6] },
  { kind: 'sphere', radius: 2 },
  { kind: 'capsule', radius: 1, height: 4, axis: 'z' },
  { kind: 'cylinder', radius: 2, height: 6, axis: 'x' },
]

it('displays an explicitly bounded plane preview and rejects projective shape matrices', async () => {
  const { source, parent } = await fixture()
  const result = addUvmCollisions(source, [
    { id: 'plane', parent, role: 'hit', shape: { kind: 'plane', normal: [0, 1, 0] } },
  ])
  const overlay = createUvmCollisionOverlay(
    result.container.document,
    result.container.binary,
    budget,
  )
  expect(overlay.diagnostics.map(item => item.code)).toEqual(['uvm/collision-plane-preview'])
  const planes = overlay.sample(
    new Map([[`node-${required(result.bindings[0]).node}`, new Float32Array(identity)]]),
  )
  expect(planes).toHaveLength(1)
  const positions = required(planes[0]).positions
  for (let i = 1; i < positions.length; i += 3)
    expect(Math.abs(required(positions[i]))).toBeLessThan(1e-7)
  const matrix = [...identity]
  matrix[3] = 1
  const projective = addUvmCollisions(source, [
    { id: 'projective', parent, role: 'hit', shape: { kind: 'sphere', radius: 1, matrix } },
  ])
  expect(() =>
    createUvmCollisionOverlay(projective.container.document, projective.container.binary, budget),
  ).toThrow(/affine/)
})

it('renders indexed mesh and convex hull volumes from the same bounded embedded accessors', async () => {
  const { source, parent } = await fixture()
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  const indices = new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
  const storage = appendUvmAccessors(source, [
    { type: 'VEC3', values: positions },
    { type: 'SCALAR', values: indices },
  ])
  const accessor = required(storage.accessors[0]),
    index = required(storage.accessors[1])
  const result = addUvmCollisions(storage.container, [
    {
      id: 'mesh',
      parent,
      role: 'effect',
      shape: { kind: 'mesh', positions: accessor, indices: index },
    },
    { id: 'hull', parent, role: 'physics', shape: { kind: 'convex-hull', positions: accessor } },
  ])
  const overlay = createUvmCollisionOverlay(
    result.container.document,
    result.container.binary,
    budget,
  )
  expect(overlay.diagnostics).toEqual([])
  const worlds = new Map(
    result.bindings.map(item => [`node-${item.node}`, new Float32Array(identity)]),
  )
  const primitives = overlay.sample(worlds)
  expect(required(primitives[0]).positions).toEqual(positions)
  expect(required(primitives[0]).indices).toEqual(Uint32Array.from(indices))
  const hull = required(primitives[1])
  expect(hull.positions.length / 9).toBe(4)
  const corners = new Set<string>()
  for (let i = 0; i < hull.positions.length; i += 3)
    corners.add(Array.from(hull.positions.slice(i, i + 3)).join(','))
  expect(corners).toEqual(new Set(['0,0,0', '1,0,0', '0,1,0', '0,0,1']))
  const facets = readUvmFacets(result.container.document, result.container.binary, budget)
  expect(facets.collisions.byKind).toEqual({ mesh: 1, 'convex-hull': 1 })
  expect(() =>
    readUvmFacets(result.container.document, result.container.binary, { maxScalarBytes: 100 }),
  ).toThrow(/maxScalarBytes/)
  expect(() =>
    createUvmCollisionOverlay(result.container.document, result.container.binary, {
      ...budget,
      maxHullVertices: 3,
    }),
  ).toThrow(/maxHullVertices/)
  for (const primitive of primitives) {
    const frame = await renderHeadless({
      outputKind: 'rgba8',
      scene: { primitives: [primitive] },
      camera: { viewProjection: new Float32Array(identity) },
      viewport: { width: 64, height: 64 },
    })
    expect(frame.statistics.fragments).toBeGreaterThan(0)
    expect(frame.diagnostics).toEqual([])
  }
  const invalid = addUvmCollisions(storage.container, [
    {
      id: 'invalid',
      parent,
      role: 'hit',
      shape: { kind: 'mesh', positions: accessor, indices: accessor },
    },
  ])
  expect(() =>
    createUvmCollisionOverlay(invalid.container.document, invalid.container.binary, budget),
  ).toThrow(/integer triangles/)
})

it('preserves distinct volumes on one bone, unrelated bytes and live collision facet identities', async () => {
  const { source, parent } = await fixture()
  const before = writeUvmContainer(source)
  const inputs = shapes.map((shape, i) => ({ id: `volume-${i}`, parent, shape, role: 'effect' }))
  const result = addUvmCollisions(source, inputs)
  expect(result.bindings).toHaveLength(4)
  expect(new Set(result.bindings.map(item => item.node)).size).toBe(4)
  expect(writeUvmContainer(source)).toEqual(before)
  expect(result.container.binary).toEqual(source.binary)
  expect(result.container.binary.buffer).not.toBe(source.binary.buffer)
  const facets = readUvmFacets(result.container.document, result.container.binary, budget)
  expect(facets.collisions.byKind).toEqual({ box: 1, sphere: 1, capsule: 1, cylinder: 1 })
  expect(facets.collisions.volumes.map(item => item.id)).toEqual(
    result.bindings.map(item => `node-${item.node}-collision-0`),
  )
  expect(facets.collisions.volumes.every(item => item.types?.[0] === 'effect')).toBe(true)
  expect(addUvmCollisions(source, []).container).toBe(source)
  expect(() => addUvmCollisions(result.container, inputs)).toThrow(/duplicate/)
})

it('renders all four analytic shapes through the common renderer with exact dimensions and axis conventions', async () => {
  const { source, parent } = await fixture()
  const result = addUvmCollisions(
    source,
    shapes.map((shape, i) => ({ id: `volume-${i}`, parent, shape, role: 'effect' })),
  )
  const overlay = createUvmCollisionOverlay(
    result.container.document,
    result.container.binary,
    budget,
  )
  expect(overlay.diagnostics).toEqual([])
  const transforms = new Map(
    result.bindings.map(item => [`node-${item.node}`, new Float32Array(identity)]),
  )
  const primitives = overlay.sample(transforms)
  const extents = primitives.map(item =>
    [0, 1, 2].map(axis => {
      const values = Array.from(item.positions).filter((_, i) => i % 3 === axis)
      return Math.max(...values) - Math.min(...values)
    }),
  )
  expect(extents).toEqual([
    [2, 4, 6],
    [4, 4, 4],
    [2, 2, 6],
    [6, 4, 4],
  ])
  for (const primitive of primitives) {
    const frame = await renderHeadless({
      outputKind: 'rgba8',
      scene: { primitives: [primitive] },
      camera: {
        viewProjection: new Float32Array([0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 0.2, 0, 0, 0, 0, 1]),
      },
      viewport: { width: 64, height: 64 },
    })
    expect(frame.diagnostics).toEqual([])
    expect(frame.statistics.fragments).toBeGreaterThan(0)
  }
  required(primitives[0]).positions.fill(999)
  required(required(primitives[0]).transform).fill(999)
  expect(required(overlay.sample(transforms)[0]).positions.some(value => value === 999)).toBe(false)
})

it('uses animated full node worlds and shape-local transforms after a scene rebase', async () => {
  const { source, parent } = await fixture()
  const matrix = [...identity]
  matrix[12] = 7
  matrix[13] = 8
  matrix[14] = 9
  const result = addUvmCollisions(source, [
    { id: 'volume', parent, role: 'hit', shape: { kind: 'sphere', radius: 1, matrix } },
  ])
  const rebased = rebaseUvmScene(
    result.container,
    [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1],
  )
  const { scene, rig } = readUvmModel(rebased.document, rebased.binary, budget)
  const sampler = createModelSceneSampler(
    { ...scene, skeleton: rig.bindings },
    { clip: required(rig.clips[0]) },
  )
  const overlay = createUvmCollisionOverlay(rebased.document, rebased.binary, budget)
  for (const time of [0, 0.12, 0.5, 1]) {
    const frame = sampler.sample(time)
    const world = required(frame.nodeTransforms.get(`node-${parent}`))
    const actual = required(required(overlay.sample(frame.nodeTransforms)[0]).transform)
    expect(actual.slice(0, 12)).toEqual(world.slice(0, 12))
    for (let axis = 0; axis < 3; axis++)
      expect(actual[12 + axis]).toBe(
        Math.fround(
          required(world[axis]) * 7 +
            required(world[axis + 4]) * 8 +
            required(world[axis + 8]) * 9 +
            required(world[axis + 12]),
        ),
      )
  }
})

it('supports document undo, rejects malformed inputs and budgets before tessellation, and honors cancellation', async () => {
  const { source, parent } = await fixture()
  const result = addUvmCollisions(source, [
    { id: 'volume', parent, role: 'hit', shape: required(shapes[0]) },
  ])
  const document = openUvmDocument(writeUvmContainer(result.container))
  const node = required(result.bindings[0]).node
  const original = document.serialize(0)
  document.apply({
    expectedRevision: 0,
    json: [
      {
        op: 'replace',
        path: `/nodes/${node}/extensions/UV_game_collision/shapes/0/size`,
        value: [8, 9, 10],
      },
    ],
  })
  document.undo(1)
  expect(document.serialize(2)).toEqual(original)
  for (const input of [
    { id: 'bad', parent: 999999, role: 'hit', shape: required(shapes[0]) },
    { id: 'bad', parent, role: 'unknown', shape: required(shapes[0]) },
    { id: 'bad', parent, role: 'hit', shape: { kind: 'sphere', radius: -1 } },
  ])
    expect(() => addUvmCollisions(source, [input])).toThrow()
  expect(() =>
    createUvmCollisionOverlay(result.container.document, result.container.binary, {
      maxScalarBytes: 1,
    }),
  ).toThrow(/budget/)
  expect(() =>
    createUvmCollisionOverlay(result.container.document, result.container.binary, {
      ...budget,
      maxShapes: 0,
    }),
  ).toThrow(/budget/)
  const abort = AbortSignal.abort()
  expect(() => addUvmCollisions(source, [], undefined, abort)).toThrow()
  const overlay = createUvmCollisionOverlay(
    result.container.document,
    result.container.binary,
    budget,
  )
  expect(() => overlay.sample(new Map())).toThrow(/missing/)
  expect(() => overlay.sample(new Map(), abort)).toThrow()
  document.dispose()
})
