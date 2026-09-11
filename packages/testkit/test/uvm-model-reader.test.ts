import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import type { JsonObject } from '@modkit/sdk'
import { readUvmAccessor, uvmAccessorWidth } from '../../uv/src/model/accessor.js'
import { readUvmContainer } from '../../uv/src/model/container.js'
import { readUvmModel } from '../../scene/src/uvm/model.js'
import { createModelSceneSampler } from '../../scene/src/model/index.js'

const fixtureUrl = new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url)
const budget = { maxScalarBytes: 1_000_000 }
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture value')
  return value
}
const fixture = async () =>
  readUvmContainer(Buffer.from(await readFile(fixtureUrl, 'utf8'), 'base64'))
const accessorDocument = (accessor: JsonObject = {}, view: JsonObject = {}): JsonObject => ({
  accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3', ...accessor }],
  bufferViews: [{ buffer: 0, byteLength: 24, ...view }],
})

describe('shared UVM embedded accessor reader', () => {
  it('reads interleaved values from an offset view and owns the decoded scalars', () => {
    const parent = new Uint8Array(48).fill(0xcd)
    const binary = parent.subarray(4, 44)
    const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
    for (const [offset, value] of [
      [4, 1],
      [8, 2],
      [12, 3],
      [20, 4],
      [24, 5],
      [28, 6],
    ] as const)
      view.setFloat32(offset, value, true)
    const document = accessorDocument({ byteOffset: 4 }, { byteStride: 16, byteLength: 32 })
    const result = readUvmAccessor(document, binary, 0, { maxScalarBytes: 24 }, 'positions')
    expect(Array.from(result.values)).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.values.buffer).not.toBe(binary.buffer)
    result.values[0] = 99
    expect(view.getFloat32(4, true)).toBe(1)
  })

  it('retains uint32 indices beyond the exact float32 integer range', () => {
    const binary = new Uint8Array(8)
    const view = new DataView(binary.buffer)
    view.setUint32(0, 16_777_217, true)
    view.setUint32(4, 4_294_967_295, true)
    const result = readUvmAccessor(
      accessorDocument({ componentType: 5125, type: 'SCALAR' }, { byteLength: 8 }),
      binary,
      0,
      { maxScalarBytes: 8 },
      'indices',
    )
    expect(result.values).toEqual(new Uint32Array([16_777_217, 4_294_967_295]))
  })

  it.each([
    ['sparse', { sparse: {} }, {}, /sparse/u],
    ['external buffer', {}, { buffer: 1 }, /external buffer/u],
    ['short stride', {}, { byteStride: 8 }, /range is invalid/u],
    ['view outside BIN', {}, { byteLength: 28 }, /exceeds the UVM BIN/u],
    ['empty accessor outside BIN', { count: 0, byteOffset: 25 }, {}, /exceeds the UVM BIN/u],
    [
      'unsafe offset sum',
      { byteOffset: Number.MAX_SAFE_INTEGER },
      { byteOffset: 1 },
      /exceeds the UVM BIN/u,
    ],
    ['prototype shape', { type: 'constructor' }, {}, /shape is invalid/u],
  ] as const)('rejects %s before allocation', (_label, accessor, view, message) => {
    expect(() =>
      readUvmAccessor(accessorDocument(accessor, view), new Uint8Array(24), 0, budget, 'positions'),
    ).toThrow(message)
  })

  it('rejects exhausted or invalid budgets and cancellation', () => {
    const document = accessorDocument()
    expect(() =>
      readUvmAccessor(document, new Uint8Array(24), 0, { maxScalarBytes: 23 }, 'positions'),
    ).toThrow(/maxScalarBytes/u)
    for (const value of [-1, NaN, Infinity, 1.5])
      expect(() =>
        readUvmAccessor(document, new Uint8Array(24), 0, { maxScalarBytes: value }, 'positions'),
      ).toThrow('invalid UVM scalar budget')
    const controller = new AbortController()
    controller.abort(new Error('cancelled by reader test'))
    expect(() =>
      readUvmAccessor(document, new Uint8Array(24), 0, budget, 'positions', controller.signal),
    ).toThrow('cancelled by reader test')
    expect(uvmAccessorWidth('MAT4')).toBe(16)
    expect(uvmAccessorWidth('__proto__')).toBeUndefined()
  })
})

describe('UVM model processing without an extension runtime', () => {
  it('reads the M3-derived model and samples its complete skin with the scene API', async () => {
    const { document, binary } = await fixture()
    const before = binary.slice()
    const { scene, rig } = readUvmModel(document, binary, budget)
    expect(scene).toMatchObject({ decodedGeometryBytes: 228, materials: 1, animations: 1 })
    expect(rig).toMatchObject({ decodedBytes: 116, incompleteBindings: 0 })
    expect(rig.bindings).toMatchObject([
      { boneName: 'Root', nodeId: 'node-1', hierarchyId: 'skin-0', parentBoneIndex: null },
    ])
    expect(rig.clips).toMatchObject([
      {
        name: 'Stand',
        durationSeconds: 1,
        looping: true,
        channels: [
          { kind: 'translation', interpolation: 'step' },
          { kind: 'rotation', interpolation: 'step' },
          { kind: 'scale', interpolation: 'step' },
        ],
      },
    ])
    const sampler = createModelSceneSampler(
      { ...scene, skeleton: rig.bindings },
      { clip: required(rig.clips[0]) },
    )
    const sample = sampler.sample(0.5)
    expect(sample.diagnostics).toEqual([])
    expect(sample.joints).toMatchObject([{ name: 'Root', position: [0, 0, 0] }])
    expect(required(sample.primitives[0]).positions).toEqual(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    )
    required(scene.primitives[0]).positions.fill(100)
    expect(binary).toEqual(before)
    expect(required(readUvmModel(document, binary, budget).scene.primitives[0]).positions[0]).toBe(
      0,
    )
  })

  it('charges geometry and rig against one exact aggregate budget', async () => {
    const { document, binary } = await fixture()
    expect(() => readUvmModel(document, binary, { maxScalarBytes: 344 })).not.toThrow()
    expect(() => readUvmModel(document, binary, { maxScalarBytes: 343 })).toThrow(/maxScalarBytes/u)
    expect(() => readUvmModel({}, new Uint8Array(), { maxScalarBytes: -1 })).toThrow(
      'invalid UVM scalar budget',
    )
    const controller = new AbortController()
    controller.abort(new Error('cancelled model'))
    expect(() => readUvmModel(document, binary, budget, controller.signal)).toThrow(
      'cancelled model',
    )
  })

  it('refuses malformed indices and positions at the shared boundary', () => {
    const binary = new Uint8Array(48)
    const view = new DataView(binary.buffer)
    ;[0, 1, 9].forEach((value, index) => view.setUint32(36 + index * 4, value, true))
    const document: JsonObject = {
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 },
        { bufferView: 1, componentType: 5125, type: 'SCALAR', count: 3 },
      ],
      bufferViews: [
        { buffer: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 12 },
      ],
    }
    expect(() => readUvmModel(document, binary, budget)).toThrow('UVM index exceeds POSITION count')
    view.setUint32(44, 2, true)
    view.setFloat32(0, NaN, true)
    expect(() => readUvmModel(document, binary, budget)).toThrow(
      'UVM POSITION contains non-finite values',
    )
  })
})
