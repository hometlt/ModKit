import type { RenderModel } from '../legacy-model-support.js'

/**
 * P9 — binary RenderModel transport for webviews and workers.
 *
 * One `Uint8Array` per model: a JSON descriptor (typed arrays replaced by
 * `{ __typedArray, byteOffset, length }` references) followed by the packed
 * buffer data, each view aligned to its element size. Replaces the
 * `Array.from(bytes)` JSON sink; P10's worker loading posts the same blob as
 * a transferable. Deserialization reconstructs views ON the received buffer —
 * zero copies on the consuming side.
 */

const HEADER_BYTES = 8 // [u32 magic][u32 jsonByteLength]
const TRANSPORT_MAGIC = 0x4d444d52 // 'RMDM'

const TYPED_ARRAY_CTORS = {
  Float32Array,
  Float64Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Uint8ClampedArray,
} as const

type TypedArrayName = keyof typeof TYPED_ARRAY_CTORS
type AnyTypedArray = InstanceType<(typeof TYPED_ARRAY_CTORS)[TypedArrayName]>

interface TypedArrayRef {
  __typedArray: TypedArrayName
  byteOffset: number
  length: number
}

function isTypedArray(value: unknown): value is AnyTypedArray {
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}

function align(offset: number, alignment: number): number {
  const rest = offset % alignment
  return rest === 0 ? offset : offset + (alignment - rest)
}

export function serializeRenderModel(model: RenderModel): Uint8Array {
  const arrays: AnyTypedArray[] = []
  const arrayRefsByBuffer = new Map<ArrayBufferLike, Map<string, TypedArrayRef>>()
  let dataBytes = 0

  // First pass: build the descriptor, recording each typed array's slot.
  const descriptorJson = JSON.stringify(model, (_key, value: unknown) => {
    if (isTypedArray(value)) {
      const name = value.constructor.name as TypedArrayName
      if (!(name in TYPED_ARRAY_CTORS)) {
        throw new Error(`RenderModel transport: unsupported typed array ${name}`)
      }
      // Keep the descriptor shape unchanged: aliases simply point at the same
      // packed offset, so blobs remain readable by older transport consumers.
      let refsForBuffer = arrayRefsByBuffer.get(value.buffer)
      if (!refsForBuffer) {
        refsForBuffer = new Map()
        arrayRefsByBuffer.set(value.buffer, refsForBuffer)
      }
      const viewKey = `${name}:${value.byteOffset}:${value.length}`
      const existingRef = refsForBuffer.get(viewKey)
      if (existingRef) return existingRef

      dataBytes = align(dataBytes, value.BYTES_PER_ELEMENT)
      const ref: TypedArrayRef = { __typedArray: name, byteOffset: dataBytes, length: value.length }
      dataBytes += value.byteLength
      arrays.push(value)
      refsForBuffer.set(viewKey, ref)
      return ref
    }
    if (typeof value === 'bigint') {
      throw new Error('RenderModel transport: bigint values are not supported')
    }
    return value
  })

  const jsonBytes = new TextEncoder().encode(descriptorJson)
  const dataStart = align(HEADER_BYTES + jsonBytes.byteLength, 8)
  const out = new Uint8Array(dataStart + dataBytes)
  const view = new DataView(out.buffer)
  view.setUint32(0, TRANSPORT_MAGIC, true)
  view.setUint32(4, jsonBytes.byteLength, true)
  out.set(jsonBytes, HEADER_BYTES)

  // Second pass: copy buffers at the offsets recorded during the first pass.
  let offset = 0
  for (const array of arrays) {
    offset = align(offset, array.BYTES_PER_ELEMENT)
    out.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), dataStart + offset)
    offset += array.byteLength
  }
  return out
}

export function deserializeRenderModel(bytes: Uint8Array): RenderModel {
  if (bytes.byteLength < HEADER_BYTES) throw new Error('RenderModel transport: blob too small')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== TRANSPORT_MAGIC) {
    throw new Error('RenderModel transport: bad magic')
  }
  const jsonLength = view.getUint32(4, true)
  const descriptorJson = new TextDecoder().decode(
    bytes.subarray(HEADER_BYTES, HEADER_BYTES + jsonLength),
  )
  const dataStart = align(HEADER_BYTES + jsonLength, 8)
  const revivedArrays = new Map<string, AnyTypedArray>()

  const revive = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(revive)
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      if (typeof record['__typedArray'] === 'string') {
        const ref = record as unknown as TypedArrayRef
        const Ctor = TYPED_ARRAY_CTORS[ref.__typedArray]
        if (!Ctor) throw new Error(`RenderModel transport: unknown typed array ${ref.__typedArray}`)
        const refKey = `${ref.__typedArray}:${ref.byteOffset}:${ref.length}`
        const existingArray = revivedArrays.get(refKey)
        if (existingArray) return existingArray

        const absoluteOffset = bytes.byteOffset + dataStart + ref.byteOffset
        if (absoluteOffset % Ctor.BYTES_PER_ELEMENT === 0) {
          // View onto the received buffer — no copy.
          const array = new Ctor(bytes.buffer as ArrayBuffer, absoluteOffset, ref.length)
          revivedArrays.set(refKey, array)
          return array
        }
        // The received view is not element-aligned in its buffer (e.g. a
        // sliced message payload) — fall back to a copy.
        const copy = bytes.slice(
          dataStart + ref.byteOffset,
          dataStart + ref.byteOffset + ref.length * Ctor.BYTES_PER_ELEMENT,
        )
        const array = new Ctor(copy.buffer as ArrayBuffer, 0, ref.length)
        revivedArrays.set(refKey, array)
        return array
      }
      const out: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(record)) out[key] = revive(entry)
      return out
    }
    return value
  }

  return revive(JSON.parse(descriptorJson)) as RenderModel
}
