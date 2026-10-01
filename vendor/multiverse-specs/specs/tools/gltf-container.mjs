/** Shared GLB 2.0 container owner. UVM's historical packer stays byte-stable;
 * the strict profile uses canonical JSON and rejects ambiguous container bytes.
 */
import { jcsStringify } from './uv-canonical-form.mjs'

const MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true })
const refuse = message => { throw new TypeError(`glb-container: ${message}`) }
const le32 = value => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes }
const pad4 = (bytes, fill) => { const out = new Uint8Array((bytes.length + 3) & ~3); out.fill(fill); out.set(bytes); return out }
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0; for (const part of parts) { out.set(part, at); at += part.length } return out }

function pack(document, binary, canonical) {
  if (!(binary instanceof Uint8Array)) refuse('Expected Uint8Array BIN payload')
  const json = pad4(encoder.encode(canonical ? jcsStringify(document) : JSON.stringify(document)), 0x20)
  const bin = pad4(binary, 0x00)
  const jsonChunk = concat(le32(json.length), le32(JSON_CHUNK), json)
  const binChunk = concat(le32(bin.length), le32(BIN_CHUNK), bin)
  return concat(le32(MAGIC), le32(2), le32(12 + jsonChunk.length + binChunk.length), jsonChunk, binChunk)
}

/** Keep the UVM fixture packing rule unchanged. */
export function packGlb(document, binary) { return pack(document, binary, false) }
/** Canonical JSON writer for exact UVW logical documents. */
export function packCanonicalGlb(document, binary) { return pack(document, binary, true) }

function parse(bytes, strict, canonical = strict) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || (strict && bytes.length > 64 * 1024 * 1024))
    refuse('Expected bounded GLB bytes')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.length) refuse('Invalid GLB header or declared length')
  let cursor = 12, document, binary = new Uint8Array(), jsonChunks = 0, binChunks = 0
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) refuse('Truncated GLB chunk header')
    const length = view.getUint32(cursor, true), type = view.getUint32(cursor + 4, true)
    const start = cursor + 8, end = start + length
    if (end > bytes.length || (strict && length % 4 !== 0)) refuse('Invalid GLB chunk length')
    if (type === JSON_CHUNK) {
      if (strict && (cursor !== 12 || ++jsonChunks !== 1)) refuse('JSON must be the first and only JSON chunk')
      const chunk = bytes.subarray(start, end)
      const text = decoder.decode(chunk).replace(/[\u0000\u0020]+$/u, '')
      document = JSON.parse(text)
      if (canonical) {
        const canonicalBytes = encoder.encode(jcsStringify(document))
        if (canonicalBytes.length > chunk.length || canonicalBytes.some((byte, i) => byte !== chunk[i])
          || chunk.subarray(canonicalBytes.length).some(byte => byte !== 0x20))
          refuse('JSON is not canonical JCS with space padding')
      }
    } else if (type === BIN_CHUNK) {
      if (strict && (jsonChunks !== 1 || ++binChunks !== 1)) refuse('BIN must follow JSON once')
      binary = bytes.slice(start, end)
    } else if (strict) refuse('Unknown GLB chunk')
    cursor = end
  }
  if (document === undefined) refuse('Missing JSON chunk')
  if (!strict) return { document, binary }
  if (binChunks !== 1 || !Array.isArray(document.buffers) || document.buffers.length !== 1
    || document.buffers[0]?.uri !== undefined
    || !Number.isSafeInteger(document.buffers[0]?.byteLength))
    refuse('Strict GLB needs one embedded buffer')
  const declared = document.buffers[0].byteLength
  if (declared < 1 || binary.length - declared < 0 || binary.length - declared > 3
    || binary.subarray(declared).some(byte => byte !== 0))
    refuse('BIN length or padding differs from buffer.byteLength')
  return { document, binary: binary.subarray(0, declared) }
}

export function unpackGlb(bytes) { return parse(bytes, false) }
export function unpackStrictGlb(bytes) { return parse(bytes, true) }
/** Strict framing for existing UVM writers, whose JSON is not required to be JCS. */
export function unpackBoundedGlb(bytes) { return parse(bytes, true, false) }
