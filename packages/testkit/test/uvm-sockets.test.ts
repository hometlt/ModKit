import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { addUvmSockets } from '../../scene/src/uvm/sockets.js'
import { rebaseUvmScene } from '../../scene/src/uvm/frame.js'
import { readUvmFacets } from '../../scene/src/uvm/facets.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { createModelSceneSampler } from '../../scene/src/model/index.js'
import { openUvmDocument } from '../../scene/src/uvm/index.js'
import { readUvmContainer, writeUvmContainer } from '../../uv/src/model/container.js'

const scalarBudget = { maxScalarBytes: 1_000_000 }
const frame = [2, 0, 0, 0, 0, 0, -2, 0, 0, 2, 0, 0, 3, 4, 5, 1]
const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1]
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture value is absent')
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
  const { scene, rig } = readUvmModel(source.document, source.binary, scalarBudget)
  const bone = required(rig.bindings[0])
  const parent = Number(required(bone.nodeId).slice('node-'.length))
  return { source, scene, rig, parent }
}
function sampler(source: Awaited<ReturnType<typeof fixture>>['source']) {
  const { scene, rig } = readUvmModel(source.document, source.binary, scalarBudget)
  return createModelSceneSampler(
    { ...scene, skeleton: rig.bindings },
    { clip: required(rig.clips[0]) },
  )
}
const sockets = (parent: number) => [
  { id: 'socket/one', parent, role: 'attach', sourceName: 'Ref_Hardpoint' },
  { id: 'socket/two', parent, role: 'attach', sourceName: 'Ref_Hardpoint_Second' },
]

it('adds distinct sockets on one animated bone and samples their complete world matrices through the scene frame', async () => {
  const { source, parent } = await fixture()
  const before = sampler(source)
  const result = addUvmSockets(source, sockets(parent))
  expect(result.bindings).toHaveLength(2)
  const rebased = rebaseUvmScene(result.container, frame)
  const after = sampler(rebased)
  const facets = readUvmFacets(rebased.document, rebased.binary, scalarBudget)
  expect(facets.sockets.map(socket => socket.nodeId)).toEqual(
    result.bindings.map(binding => `node-${binding.node}`),
  )
  expect(facets.sockets.map(socket => socket.orientation)).toEqual([undefined, undefined])
  expect(facets.sockets.map(socket => socket.sourceName)).toEqual([
    'Ref_Hardpoint',
    'Ref_Hardpoint_Second',
  ])
  for (const time of [0, 0.12, 0.5, 1]) {
    const original = before.sample(time),
      actual = after.sample(time)
    expect(actual.diagnostics).toEqual([])
    expect(actual.joints).toHaveLength(original.joints.length)
    const nativeWorld = required(original.nodeTransforms.get(`node-${parent}`))
    for (const binding of result.bindings) {
      const world = required(actual.nodeTransforms.get(`node-${binding.node}`))
      expect(world).toEqual(actual.nodeTransforms.get(`node-${parent}`))
      for (let column = 0; column < 4; column++) {
        const offset = column * 4,
          position = column === 3
        expect(world[offset]).toBe(2 * required(nativeWorld[offset]) + (position ? 3 : 0))
        expect(world[offset + 1]).toBe(2 * required(nativeWorld[offset + 2]) + (position ? 4 : 0))
        expect(
          world[offset + 2] === -2 * required(nativeWorld[offset + 1]) + (position ? 5 : 0),
        ).toBe(true)
      }
    }
  }
  const first = after.sample(0.5),
    stable = after.sample(0.5)
  required(first.nodeTransforms.get(`node-${parent}`)).fill(99)
  expect(after.sample(0.5).nodeTransforms).toEqual(stable.nodeTransforms)
})

it('creates an owned bounded result, preserving BIN and unrelated extras without mutating source', async () => {
  const { source, parent } = await fixture()
  const originalBytes = writeUvmContainer(source)
  const withExtras = {
    ...source,
    document: { ...source.document, extras: { owner: { unknown: [1, 'kept'] } } },
  }
  const result = addUvmSockets(withExtras, sockets(parent))
  expect(result.container.document['extras']).toEqual(withExtras.document['extras'])
  expect(result.container.document['extras']).not.toBe(withExtras.document['extras'])
  expect(result.container.binary).toEqual(source.binary)
  expect(result.container.binary.buffer).not.toBe(source.binary.buffer)
  result.container.binary.fill(0)
  expect(writeUvmContainer(source)).toEqual(originalBytes)
  expect(addUvmSockets(source, []).container).toBe(source)
})

it('uses current node joins even when preserved publisher ids came from another node namespace', async () => {
  const { source, parent } = await fixture()
  const result = addUvmSockets(source, sockets(parent))
  const nodes = result.container.document['nodes'] as JsonObject[]
  const target = required(result.bindings[0]).node
  const node = required(nodes[target])
  const extension = (node['extensions'] as JsonObject)['UV_game_socket'] as JsonObject
  const document: JsonObject = {
    ...result.container.document,
    nodes: nodes.map((candidate, index) =>
      index !== target
        ? candidate
        : {
            ...candidate,
            extensions: {
              ...(node['extensions'] as JsonObject),
              UV_game_socket: {
                ...extension,
                extras: { modkit: { id: 'socket/one', nodeId: 'old-native/bone-7' } },
              },
            },
          },
    ),
  }
  const facets = readUvmFacets(document, result.container.binary, scalarBudget)
  const { scene } = readUvmModel(document, result.container.binary, scalarBudget)
  for (const socket of facets.sockets)
    expect(scene.nodes.some(item => item.id === socket.nodeId)).toBe(true)
  expect(facets.sockets[0]?.id).toBe('socket/one')
})

it('retains explicit axes and local offsets, and ordinary UVM history changes and restores socket transforms', async () => {
  const { source, parent } = await fixture()
  const result = addUvmSockets(source, [
    {
      id: 'offset',
      parent,
      role: 'attach',
      transform: translation,
      orientation: { forward: '+x', up: '+z' },
    },
  ])
  const binding = required(result.bindings[0])
  expect(
    readUvmFacets(result.container.document, source.binary, scalarBudget).sockets[0]?.orientation,
  ).toEqual({ forward: '+x', up: '+z' })
  const bytes = writeUvmContainer(result.container)
  const document = openUvmDocument(bytes)
  try {
    const original = sampler(result.container).sample(0.5)
    const moved = [...translation]
    moved[12] = 12
    document.apply({
      expectedRevision: 0,
      json: [{ op: 'replace', path: `/nodes/${binding.node}/matrix`, value: moved }],
    })
    const current = sampler(readUvmContainer(document.serialize(1))).sample(0.5)
    expect(current.nodeTransforms.get(`node-${binding.node}`)).not.toEqual(
      original.nodeTransforms.get(`node-${binding.node}`),
    )
    expect(current.nodeTransforms.get(`node-${parent}`)).toEqual(
      original.nodeTransforms.get(`node-${parent}`),
    )
    document.undo(1)
    expect(document.serialize(2)).toEqual(bytes)
    expect(sampler(readUvmContainer(document.serialize(2))).sample(0.5).nodeTransforms).toEqual(
      original.nodeTransforms,
    )
  } finally {
    document.dispose()
  }
})

it('rejects missing parents, duplicate identities, malformed lists/transforms and budget/cancellation failures', async () => {
  const { source, parent } = await fixture()
  const request = required(sockets(parent)[0])
  for (const invalid of [-1, 999999, 0.5])
    expect(() => addUvmSockets(source, [{ ...request, parent: invalid }])).toThrow('parent')
  expect(() => addUvmSockets(source, [request, request])).toThrow('duplicate')
  const result = addUvmSockets(source, [request])
  expect(() => addUvmSockets(result.container, [request])).toThrow('duplicate')
  expect(() => addUvmSockets(source, [{ ...request, transform: [1, 2, 3] }])).toThrow('transform')
  expect(() =>
    addUvmSockets(source, [{ ...request, orientation: { forward: '+x', up: '-x' } }]),
  ).toThrow('axes')
  expect(() =>
    addUvmSockets({ ...source, document: { ...source.document, nodes: 'invalid' } }, [request]),
  ).toThrow('nodes')
  const nodes = source.document['nodes'] as JsonObject[]
  expect(() =>
    addUvmSockets(
      {
        ...source,
        document: {
          ...source.document,
          nodes: nodes.map((node, index) =>
            index === parent ? { ...node, children: false } : node,
          ),
        },
      },
      [request],
    ),
  ).toThrow('children')
  expect(() =>
    addUvmSockets(source, [request], {
      maxInputBytes: 1_000_000,
      maxJsonBytes: 1,
      maxDepth: 128,
      maxNodes: 1_000_000,
    }),
  ).toThrow()
  expect(() => addUvmSockets(source, [request], undefined, AbortSignal.abort())).toThrow()
})

it('bounds the static and returned node matrices even in a scene without geometry', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const nodes = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    childIds: [],
    meshIds: [],
    transform: identity,
  }))
  expect(() =>
    createModelSceneSampler({ nodes, meshes: [], primitives: [] }, { maxBytes: 8 * 128 - 1 }),
  ).toThrow('matrices')
  expect(
    createModelSceneSampler({ nodes, meshes: [], primitives: [] }, { maxBytes: 8 * 128 }).sample(0)
      .nodeTransforms.size,
  ).toBe(8)
})
