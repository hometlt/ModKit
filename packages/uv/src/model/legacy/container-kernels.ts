// Generated from immutable MK2 declarations. Change the strict adapter, not these algorithms.
// Source selection: packages/uv/model-container-kernels.config.json
import { ModkitError } from '@modkit/codec-kit/legacy/core'
import type { UvmJsonObject } from './rig-types.js'

const GLB_MAGIC = 0x46546c67

const GLB_JSON_CHUNK = 0x4e4f534a

const GLB_BIN_CHUNK = 0x004e4942

export interface UvmGlbContainer {
  document: UvmJsonObject
  binary: Uint8Array
}

export function decodeUvmContainer(bytes: Uint8Array): UvmGlbContainer {
  if (isGlb(bytes)) return decodeGlb(bytes)
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root')
    return { document: parsed as UvmJsonObject, binary: new Uint8Array() }
  } catch (cause) {
    throw new ModkitError({
      code: 'PARSE_FAILED',
      message: 'UVM input is neither a valid GLB nor a JSON glTF document.',
      cause,
    })
  }
}

export function isGlb(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && readUint32(bytes, 0) === GLB_MAGIC
}

function decodeGlb(bytes: Uint8Array): UvmGlbContainer {
  if (readUint32(bytes, 4) !== 2) throw corrupt('Only GLB version 2 is supported.')
  const declaredLength = readUint32(bytes, 8)
  if (declaredLength !== bytes.length) throw corrupt('GLB declared length does not match input.')
  if (bytes.length < 20 || readUint32(bytes, 16) !== GLB_JSON_CHUNK) {
    throw corrupt('GLB JSON chunk is missing or not first.')
  }
  const jsonLength = readUint32(bytes, 12)
  const jsonEnd = 20 + jsonLength
  if (jsonEnd > bytes.length) throw corrupt('GLB JSON chunk exceeds the input length.')
  let document: UvmJsonObject
  try {
    const text = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes.subarray(20, jsonEnd))
      .trimEnd()
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root')
    document = parsed as UvmJsonObject
  } catch (cause) {
    throw new ModkitError({
      code: 'PARSE_FAILED',
      message: 'UVM GLB JSON chunk is invalid.',
      cause,
    })
  }
  if (jsonEnd === bytes.length) return { document, binary: new Uint8Array() }
  if (jsonEnd + 8 > bytes.length || readUint32(bytes, jsonEnd + 4) !== GLB_BIN_CHUNK) {
    throw corrupt('UVM GLB contains an invalid second chunk.')
  }
  const binLength = readUint32(bytes, jsonEnd)
  const binStart = jsonEnd + 8
  if (binStart + binLength !== bytes.length) throw corrupt('GLB BIN chunk length is invalid.')
  return { document, binary: bytes.slice(binStart, binStart + binLength) }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw corrupt('GLB header is truncated.')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

function corrupt(message: string): ModkitError {
  return new ModkitError({ code: 'PARSE_FAILED', message })
}

export {  }
