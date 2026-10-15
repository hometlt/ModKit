import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import { decodeUvmContainer, isGlb } from './legacy/container-kernels.js'
import { array, object, safeIndex } from './validation/values.js'

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const encoder = new TextEncoder()

export interface UvmContainerBudget {
  readonly maxInputBytes: number
  readonly maxJsonBytes: number
  readonly maxDepth: number
  readonly maxNodes: number
}
export const DEFAULT_UVM_CONTAINER_BUDGET: UvmContainerBudget = Object.freeze({
  maxInputBytes: 268_435_456,
  maxJsonBytes: 67_108_864,
  maxDepth: 128,
  maxNodes: 1_000_000,
})
export interface UvmOpaqueChunk {
  readonly type: number
  readonly bytes: Uint8Array
}
export interface UvmContainer {
  readonly format: 'glb' | 'gltf'
  readonly document: JsonObject
  readonly binary: Uint8Array
  /** Unknown GLB chunks stay inert, in their authored order after the standard chunks. */
  readonly extraChunks: readonly UvmOpaqueChunk[]
}

export function checkUvmContainerBudget(budget: UvmContainerBudget): void {
  for (const value of [budget.maxInputBytes, budget.maxJsonBytes, budget.maxDepth, budget.maxNodes])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('invalid UVM container budget')
}

/** Bounded MK2 container reader with explicit retention of additional GLB chunks. */
export function readUvmContainer(
  bytes: Uint8Array,
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): UvmContainer {
  checkUvmContainerBudget(budget)
  if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  if (bytes.byteLength > budget.maxInputBytes) throw new RangeError('UVM exceeds maxInputBytes')
  // Buffer.slice() aliases memory. Use the standard typed-array view so every slice below
  // (including those in the unchanged MK2 reader) owns its bytes and cannot rewrite the input.
  bytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const format = isGlb(bytes) ? 'glb' : 'gltf'
  const extraChunks: UvmOpaqueChunk[] = []
  let primary = bytes
  if (format === 'glb') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(8, true) !== bytes.byteLength || view.getUint32(4, true) !== 2)
      throw new TypeError('invalid GLB version or declared length')
    let cursor = 12
    let count = 0
    let primaryEnd = 12
    while (cursor < bytes.length) {
      if (cursor + 8 > bytes.length) throw new TypeError('truncated GLB chunk header')
      const length = view.getUint32(cursor, true)
      const type = view.getUint32(cursor + 4, true)
      const end = cursor + 8 + length
      if (length % 4 !== 0 || end > bytes.length)
        throw new TypeError('invalid GLB chunk length or alignment')
      if (count === 0 && type !== JSON_CHUNK) throw new TypeError('GLB JSON chunk must be first')
      if (type === JSON_CHUNK) {
        if (count !== 0) throw new TypeError('duplicate GLB JSON chunk')
        if (length > budget.maxJsonBytes) throw new RangeError('UVM exceeds maxJsonBytes')
        primaryEnd = end
      } else if (type === BIN_CHUNK) {
        if (count !== 1) throw new TypeError('GLB BIN chunk must be second and unique')
        primaryEnd = end
      } else {
        extraChunks.push(Object.freeze({ type, bytes: bytes.slice(cursor + 8, end) }))
      }
      cursor = end
      count++
      if (count > budget.maxNodes) throw new RangeError('GLB chunk count exceeds maxNodes')
    }
    if (extraChunks.length > 0) {
      // The immutable MK2 reader handles the two standard chunks; the envelope retains the rest.
      primary = bytes.slice(0, primaryEnd)
      new DataView(primary.buffer, primary.byteOffset, primary.byteLength).setUint32(
        8,
        primary.byteLength,
        true,
      )
    }
  } else if (bytes.byteLength > budget.maxJsonBytes)
    throw new RangeError('UVM exceeds maxJsonBytes')
  const decoded = decodeUvmContainer(primary)
  const document = snapshotJson(
    decoded.document,
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  ) as JsonObject
  return Object.freeze({
    format,
    document,
    binary: decoded.binary,
    extraChunks: Object.freeze(extraChunks),
  })
}

/** Serialize the complete JSON and BIN payload. Unknown metadata is never reconstructed from facets. */
export function writeUvmContainer(
  container: UvmContainer,
  budget: UvmContainerBudget = DEFAULT_UVM_CONTAINER_BUDGET,
  signal?: AbortSignal,
): Uint8Array {
  checkUvmContainerBudget(budget)
  if (container.format !== 'glb' && container.format !== 'gltf')
    throw new TypeError('invalid UVM container format')
  if (container.extraChunks.length > budget.maxNodes)
    throw new RangeError('GLB chunk count exceeds maxNodes')
  const document = snapshotJson(
    container.document,
    { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
    signal,
  ) as JsonObject
  const jsonBytes = encoder.encode(JSON.stringify(document))
  const length =
    container.format === 'gltf'
      ? jsonBytes.byteLength
      : 28 +
        Math.ceil(jsonBytes.byteLength / 4) * 4 +
        Math.ceil(container.binary.byteLength / 4) * 4 +
        container.extraChunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0)
  if (length > budget.maxInputBytes || length > 0xffffffff)
    throw new RangeError('UVM output exceeds maxInputBytes')
  if (container.format === 'gltf') {
    if (container.binary.byteLength || container.extraChunks.length)
      throw new TypeError('JSON glTF cannot carry unbound binary chunks')
    return jsonBytes
  }
  for (const chunk of container.extraChunks)
    if (
      !Number.isSafeInteger(chunk.type) ||
      chunk.type < 0 ||
      chunk.type > 0xffffffff ||
      chunk.type === JSON_CHUNK ||
      chunk.type === BIN_CHUNK ||
      chunk.bytes.length % 4 !== 0
    )
      throw new TypeError('invalid opaque GLB chunk')
  const standard = packSerializedUvmGlb(jsonBytes, container.binary)
  if (container.extraChunks.length === 0) return standard
  const parts: Uint8Array[] = [standard]
  for (const chunk of container.extraChunks)
    parts.push(le32(chunk.bytes.length), le32(chunk.type), chunk.bytes)
  const result = concat(parts)
  new DataView(result.buffer).setUint32(8, result.byteLength, true)
  return result
}

// Existing MK3 GLB packer is moved here unchanged; materialization and document editing share it.

function le32(value: number) {
  const result = new Uint8Array(4)
  new DataView(result.buffer).setUint32(0, value, true)
  return result
}

function pad4(bytes: Uint8Array, fill: number) {
  const result = new Uint8Array((bytes.byteLength + 3) & ~3)
  result.fill(fill)
  result.set(bytes)
  return result
}

function concat(parts: readonly Uint8Array[]) {
  const total = parts.reduce((size, part) => size + part.byteLength, 0)
  const result = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    result.set(part, cursor)
    cursor += part.byteLength
  }
  return result
}

/** Deterministic `.uvm.glb` bytes for a GLB-shaped document plus its BIN payload. */
export function packUvmGlb(document: object, binary: Uint8Array) {
  return packSerializedUvmGlb(encoder.encode(JSON.stringify(document)), binary)
}

function packSerializedUvmGlb(jsonBytes: Uint8Array, binary: Uint8Array) {
  const json = pad4(jsonBytes, 0x20)
  const bin = pad4(binary, 0x00)
  const length = 12 + 8 + json.byteLength + 8 + bin.byteLength
  return concat([
    le32(GLB_MAGIC),
    le32(2),
    le32(length),
    le32(json.byteLength),
    le32(JSON_CHUNK),
    json,
    le32(bin.byteLength),
    le32(BIN_CHUNK),
    bin,
  ])
}

/*
 * An image's logical id and its glTF `uri`.
 *
 * A glTF uri is a URI reference (RFC 3986), and a game's texture name is not always one: Emperor's
 * `!%shel` carries a bare `%`, map folders begin with `#`. The id is written with every character a
 * relative path reference may not hold as is percent-encoded — `%`, space, `#`, `?`, `:`, `\`,
 * non-ASCII — and nothing else, so a name that was already a valid reference is written unchanged.
 * Readers take the id back with uvmImageLogicalId, never by using the uri as it stands.
 */
const URI_PATH_CHARACTER = /^[A-Za-z0-9\-._~!$&'()*+,;=@/]$/u

/** The glTF image `uri` for a logical resource id. */
export function uvmImageUri(logicalId: string): string {
  let uri = ''
  for (const character of logicalId) {
    if (URI_PATH_CHARACTER.test(character)) uri += character
    else
      for (const byte of encoder.encode(character))
        uri += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return uri
}

/**
 * The logical id an image `uri` names. A uri written before ids were encoded may hold a bare `%`
 * that is not an escape; it names itself.
 */
export function uvmImageLogicalId(uri: string): string {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

/** Shared authored identity for material references, decoded images and UVP repackaging. */
export function uvmImageResourceId(document: JsonObject, index: number): string {
  const images = array(document, 'images')
  const image = object(images[safeIndex(index, images.length, 'image')], 'image')
  if (typeof image['name'] === 'string' && image['name'].length > 0) return image['name']
  if (typeof image['uri'] === 'string' && !image['uri'].startsWith('data:'))
    return uvmImageLogicalId(image['uri'])
  return `uvm-image-${index}`
}
