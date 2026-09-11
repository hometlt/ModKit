import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { BufferBuilder, addAccessor } from './legacy/rig-kernels.js'
import type { UvmJsonObject } from './legacy/rig-types.js'
import { uvmAccessorWidth } from './accessor.js'
import { array, object } from './validation/values.js'
import { validateUvmDocument } from './validation/index.js'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from './container.js'

export interface UvmAccessorInput {
  readonly values: Float32Array | Uint16Array | Uint32Array
  readonly type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4'
  readonly target?: 34962 | 34963
}
export interface UvmAccessorWriteBudget extends UvmContainerBudget {
  readonly maxScalarBytes: number
}

/** Append embedded scalar data without changing prior offsets, indices or bytes. Binary layout
 * uses the same frozen addAccessor/BufferBuilder as model materialization. The caller assigns
 * semantic references (mesh attributes, collision shapes, etc.) in its scene document operation.
 */
export function appendUvmAccessors(
  source: UvmContainer,
  inputs: readonly UvmAccessorInput[],
  budget: UvmAccessorWriteBudget = { ...DEFAULT_UVM_CONTAINER_BUDGET, maxScalarBytes: 536_870_912 },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  checkUvmContainerBudget(budget)
  if (!Number.isSafeInteger(budget.maxScalarBytes) || budget.maxScalarBytes < 0)
    throw new TypeError('invalid UVM accessor working budget')
  if (!Array.isArray(inputs) || inputs.length > budget.maxNodes)
    throw new RangeError('UVM accessor input count exceeds maxNodes')
  let appendedBytes = 0
  const requests = inputs.map(input => ({
    values: input.values,
    type: input.type,
    target: input.target,
  }))
  for (const input of requests) {
    signal?.throwIfAborted()
    const width = uvmAccessorWidth(input.type),
      values = input.values
    if (
      !(
        values instanceof Float32Array ||
        values instanceof Uint16Array ||
        values instanceof Uint32Array
      ) ||
      width === undefined ||
      values.length === 0 ||
      values.length % width !== 0 ||
      (input.target !== undefined && input.target !== 34962 && input.target !== 34963)
    )
      throw new TypeError('invalid UVM accessor input shape')
    if (input.target === 34963 && (input.type !== 'SCALAR' || values instanceof Float32Array))
      throw new TypeError('index buffer requires an unsigned integer scalar accessor')
    appendedBytes += Math.ceil(values.byteLength / 4) * 4
  }
  // Covers little-endian chunks, finished BIN, owned output and a serialization pass.
  const workingBytes = source.binary.byteLength * 3 + appendedBytes * 4
  if (!Number.isSafeInteger(workingBytes) || workingBytes > budget.maxScalarBytes)
    throw new RangeError('UVM accessor append exceeds maxScalarBytes')
  if (source.binary.length + appendedBytes > Math.min(budget.maxInputBytes, 0x7ffffffc))
    throw new RangeError('UVM accessor append exceeds maxInputBytes')
  for (const input of requests)
    for (let i = 0; i < input.values.length; i++) {
      if (i % 4096 === 0) signal?.throwIfAborted()
      if (!Number.isFinite(input.values[i]))
        throw new TypeError('UVM accessor values must be finite')
    }
  for (const key of ['buffers', 'bufferViews', 'accessors'])
    if (source.document[key] !== undefined && !Array.isArray(source.document[key]))
      throw new TypeError(`UVM ${key} must be an array`)
  writeUvmContainer(source, budget, signal)
  validateUvmDocument(source.document, {
    binaryByteLength: source.binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  if (inputs.length === 0) return { container: source, accessors: [] }
  if (source.format !== 'glb') throw new TypeError('accessor append requires embedded GLB storage')
  const buffers = array(source.document, 'buffers')
  const first = object(buffers[0] ?? {}, 'buffer 0')
  const declared = first['byteLength'] ?? 0
  if (
    first['uri'] !== undefined ||
    typeof declared !== 'number' ||
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    declared > source.binary.length ||
    source.binary.length - declared > 3
  )
    throw new TypeError('buffer 0 does not describe embedded BIN storage')
  const jsonBudget = {
    maxDepth: budget.maxDepth,
    maxNodes: budget.maxNodes,
    maxBytes: budget.maxJsonBytes,
  }
  // The snapshot validates JSON and owns nested metadata before the legacy mutable adapter.
  const document = object(snapshotJson(source.document, jsonBudget, signal), 'document')
  const views = [...array(document, 'bufferViews')] as UvmJsonObject[]
  const accessors = [...array(document, 'accessors')] as UvmJsonObject[]
  const buffer = new BufferBuilder()
  buffer.append(source.binary)
  const added: number[] = []
  for (const input of requests) {
    signal?.throwIfAborted()
    const componentType =
      input.values instanceof Float32Array
        ? 5126
        : input.values instanceof Uint16Array
          ? 5123
          : 5125
    added.push(
      addAccessor(buffer, views, accessors, input.values, input.type, componentType, input.target),
    )
  }
  const binary = buffer.finish()
  const next = snapshotJson(
    {
      ...document,
      buffers: [{ ...first, byteLength: binary.length }, ...buffers.slice(1)],
      bufferViews: views,
      accessors,
    },
    jsonBudget,
    signal,
  ) as JsonObject
  const container: UvmContainer = {
    format: source.format,
    document: next,
    binary,
    extraChunks: source.extraChunks.map(chunk => ({
      type: chunk.type,
      bytes: new Uint8Array(chunk.bytes),
    })),
  }
  validateUvmDocument(next, {
    binaryByteLength: binary.length,
    ...(signal === undefined ? {} : { signal }),
  })
  writeUvmContainer(container, budget, signal)
  return { container, accessors: Object.freeze(added) }
}
