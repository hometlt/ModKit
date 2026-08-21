import { decompressSync } from 'fflate'
import { readUintBE, sliceExact } from './binary.js'
function parseChunks(data) {
  if (
    data.length < 8 ||
    data[0] !== 0x42 ||
    data[1] !== 0x4c ||
    data[2] !== 0x54 ||
    data[3] !== 0x45
  ) {
    throw new Error('Missing BLTE header')
  }
  const headerSize = readUintBE(data, 4, 4)
  if (headerSize === 0) {
    return { chunks: [{ compressedSize: data.length - 8 }], dataOffset: 8 }
  }
  if (headerSize > data.length) throw new Error('BLTE header extends beyond buffer')
  if (data[8] !== 0x0f) throw new Error(`Unsupported BLTE chunk flags 0x${data[8].toString(16)}`)
  const count = readUintBE(data, 9, 3)
  const chunks = []
  let offset = 12
  for (let i = 0; i < count; i++) {
    chunks.push({
      compressedSize: readUintBE(data, offset, 4),
      decompressedSize: readUintBE(data, offset + 4, 4),
    })
    offset += 24
  }
  if (offset !== headerSize) throw new Error('BLTE header has trailing bytes')
  return { chunks, dataOffset: headerSize }
}
function decodeChunk(chunk, decompressedSize, options) {
  if (chunk.length === 0) throw new Error('Empty BLTE chunk')
  const mode = String.fromCharCode(chunk[0])
  const payload = chunk.slice(1)
  if (mode === 'N') {
    if (payload.length > options.maxOutputBytes) {
      throw new Error('BLTE uncompressed chunk exceeds output budget')
    }
    if (decompressedSize !== undefined && payload.length !== decompressedSize) {
      throw new Error('BLTE uncompressed chunk size mismatch')
    }
    return payload
  }
  if (mode === 'Z') {
    if (decompressedSize === undefined || decompressedSize > options.maxOutputBytes) {
      throw new Error('BLTE compressed chunk has no safe output size')
    }
    const out = decompressSync(payload, new Uint8Array(decompressedSize))
    if (decompressedSize !== undefined && out.length !== decompressedSize) {
      throw new Error('BLTE zlib chunk size mismatch')
    }
    return out
  }
  throw new Error(`Unsupported BLTE mode '${mode}'`)
}
export function decodeBlte(data, options) {
  const { chunks, dataOffset } = parseChunks(data)
  let readOffset = dataOffset
  const decodedChunks = []
  let totalSize = 0
  for (const chunk of chunks) {
    const declared = chunk.decompressedSize ?? chunk.compressedSize
    if (totalSize + declared > options.maxOutputBytes) {
      throw new Error('BLTE output exceeds configured budget')
    }
    const encoded = sliceExact(data, readOffset, chunk.compressedSize, 'BLTE chunk')
    const decoded = decodeChunk(encoded, chunk.decompressedSize, options)
    decodedChunks.push(decoded)
    totalSize += decoded.length
    if (totalSize > options.maxOutputBytes) {
      throw new Error('BLTE output exceeds configured budget')
    }
    readOffset += chunk.compressedSize
  }
  const out = new Uint8Array(totalSize)
  let writeOffset = 0
  for (const decoded of decodedChunks) {
    out.set(decoded, writeOffset)
    writeOffset += decoded.length
  }
  return out
}
