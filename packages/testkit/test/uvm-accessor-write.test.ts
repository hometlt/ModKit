import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { appendUvmAccessors } from '../../uv/src/model/accessor-write.js'
import { readUvmAccessor } from '../../uv/src/model/accessor.js'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  readUvmContainer,
  writeUvmContainer,
} from '../../uv/src/model/container.js'
import type { JsonObject } from '@modkit/sdk'

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('accessor fixture value is absent')
  return value
}
async function fixture() {
  return readUvmContainer(
    Buffer.from(
      await readFile(
        new URL('./fixtures/uvm/m3-triangle.uvm.glb.b64', import.meta.url),
        'utf8',
      ),
      'base64',
    ),
  )
}
const budget = { ...DEFAULT_UVM_CONTAINER_BUDGET, maxScalarBytes: 1_000_000 }

it('appends aligned accessors through the common writer without rewriting old storage or metadata', async () => {
  const source = await fixture(),
    before = writeUvmContainer(source)
  const positions = new Float32Array([1.5, -2, 3, 4, 5, 6])
  const inputs = [
    { values: new Uint16Array([3, 4, 5]), type: 'SCALAR' as const },
    { values: positions, type: 'VEC3' as const },
    { values: new Uint32Array([0xffffffff, 0x1000001]), type: 'SCALAR' as const },
  ]
  const result = appendUvmAccessors(source, inputs, budget)
  const reopened = readUvmContainer(writeUvmContainer(result.container))
  expect(writeUvmContainer(source)).toEqual(before)
  expect(reopened.binary.slice(0, source.binary.length)).toEqual(source.binary)
  const oldViews = source.document['bufferViews'] as JsonObject[],
    oldAccessors = source.document['accessors'] as JsonObject[]
  expect((reopened.document['bufferViews'] as JsonObject[]).slice(0, oldViews.length)).toEqual(
    oldViews,
  )
  expect((reopened.document['accessors'] as JsonObject[]).slice(0, oldAccessors.length)).toEqual(
    oldAccessors,
  )
  expect(reopened.document['extras']).toEqual(source.document['extras'])
  for (const [i, input] of inputs.entries()) {
    const accessor = required(result.accessors[i])
    const read = readUvmAccessor(
      reopened.document,
      reopened.binary,
      accessor,
      budget,
      i === 1 ? 'positions' : 'indices',
    )
    expect(Array.from(read.values)).toEqual(Array.from(input.values))
    const viewIndex = Number(
      required((reopened.document['accessors'] as JsonObject[])[accessor])['bufferView'],
    )
    expect(
      Number(
        required((reopened.document['bufferViews'] as JsonObject[])[viewIndex])['byteOffset'],
      ) % 4,
    ).toBe(0)
  }
  positions.fill(99)
  expect(
    Array.from(
      readUvmAccessor(
        result.container.document,
        result.container.binary,
        required(result.accessors[1]),
        budget,
        'positions',
      ).values,
    ),
  ).toEqual([1.5, -2, 3, 4, 5, 6])
  expect(appendUvmAccessors(source, [], budget).container).toBe(source)
})

it('refuses invalid arrays, nonfinite values, non-index storage and limits before writing', async () => {
  const source = await fixture()
  expect(() =>
    appendUvmAccessors(source, [{ values: new Float32Array([1, 2]), type: 'VEC3' }], budget),
  ).toThrow(/shape/)
  expect(() =>
    appendUvmAccessors(source, [{ values: new Float32Array([NaN]), type: 'SCALAR' }], budget),
  ).toThrow(/finite/)
  expect(() =>
    appendUvmAccessors(
      source,
      [{ values: new Float32Array([1]), type: 'SCALAR', target: 34963 }],
      budget,
    ),
  ).toThrow(/unsigned/)
  expect(() =>
    appendUvmAccessors(source, [{ values: new Uint16Array([1]), type: 'SCALAR' }], {
      ...budget,
      maxScalarBytes: 0,
    }),
  ).toThrow(/maxScalarBytes/)
  expect(() =>
    appendUvmAccessors({ ...source, document: { ...source.document, accessors: {} } }, [], budget),
  ).toThrow(/array/)
  expect(() => appendUvmAccessors(source, [], budget, AbortSignal.abort())).toThrow()
})
