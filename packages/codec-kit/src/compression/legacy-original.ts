// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient typing for untyped pako
/// <reference path="./pako.d.ts" />

/**
 * Compression utilities for MPQ archives.
 *
 * Exports:
 * - `deflate()` / `inflate()` — zlib/deflate compression
 * - `bzip2Decompress()` — bzip2 decompression
 * - `adpcmDecompress()` — IMA ADPCM decompression
 */

// Lazy import pako (zlib)
let pakoDeflate: ((data: Uint8Array) => Uint8Array) | null = null
let pakoInflate: ((data: Uint8Array) => Uint8Array) | null = null

async function loadPako(): Promise<{
  deflate: (...args: any[]) => any
  inflate: (...args: any[]) => any
}> {
  if (!pakoDeflate) {
    const pako = await import('pako')
    pakoDeflate = pako.deflate
    pakoInflate = pako.inflate
  }
  return { deflate: pakoDeflate!, inflate: pakoInflate! }
}

/**
 * Compress data with zlib/deflate.
 * Adds compression type byte 0x02 prefix (MPQ format).
 *
 * @param data Raw bytes to compress
 * @returns Compressed data with type prefix
 */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0) {
    const empty = new Uint8Array(1)
    empty[0] = 0x02
    return empty
  }

  const { deflate: pakoDeflate } = await loadPako()
  const compressed = pakoDeflate(data, { raw: true })

  // Add compression type byte
  const result = new Uint8Array(compressed.length + 1)
  result[0] = 0x02 // zlib/deflate
  result.set(compressed, 1)
  return result
}

/**
 * Decompress zlib/deflate data.
 * Expects type byte 0x02 prefix.
 *
 * @param data Compressed data with type prefix
 * @returns Decompressed bytes
 */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0) return new Uint8Array()

  // Skip type byte
  const payload = data.slice(1)

  if (payload.length === 0) return new Uint8Array()

  const { inflate: pakoInflate } = await loadPako()
  return pakoInflate(payload, { raw: true })
}

/**
 * Check if data is compressed with zlib.
 */
export function isZlibCompressed(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === 0x02
}

// ─────────────────────────────────────────────────────────────────────────────
// bzip2 decompression (stub - requires external library)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decompress bzip2 data.
 *
 * Note: Full bzip2 implementation requires external library.
 * This is a stub that throws error.
 *
 * @param data Compressed data (with type byte 0x10 prefix)
 * @returns Decompressed bytes
 */
export function bzip2Decompress(data: Uint8Array): Uint8Array {
  // In real implementation, link to bzip2.js or similar
  throw new Error('bzip2 decompression requires external library')
}

export function isBzip2Compressed(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0x10 && data[1] === 0x42 // 'B'
}

// ─────────────────────────────────────────────────────────────────────────────
// ADPCM decompression (stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decompress IMA ADPCM data.
 *
 * @param data Compressed ADPCM data
 * @param channels Number of audio channels
 * @returns PCM samples
 */
export function adpcmDecompress(data: Uint8Array, channels = 1): Float32Array {
  // In real implementation, link to adpcm.js
  throw new Error('ADPCM decompression requires external library')
}

export function isAdpcmCompressed(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === 0x01
}

// ─────────────────────────────────────────────────────────────────────────────
// Compression detection
// ─────────────────────────────────────────────────────────────────────────────

export type CompressionType = 'none' | 'deflate' | 'bzip2' | 'adpcm' | 'unknown'

/**
 * Detect compression type from first byte.
 */
export function detectCompressionType(data: Uint8Array): CompressionType {
  if (data.length === 0) return 'none'

  const type = data[0]
  switch (type) {
    case 0x00:
      return 'none'
    case 0x01:
      return 'adpcm'
    case 0x02:
      return 'deflate'
    case 0x10:
      return 'bzip2'
    default:
      return 'unknown'
  }
}

export default {
  deflate,
  inflate,
  bzip2Decompress,
  adpcmDecompress,
  detectCompressionType,
}
