/*! Brotli decoder (src/lib/brotli): Copyright 2017 Google Inc., @license MIT */
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

/** Decode one whole Brotli stream (RFC 7932); throws `codec-kit/compression-output-limit` past the bound. */
export type BrotliSync = (payload: Uint8Array, maxOutputBytes: number) => Uint8Array

/** No Brotli decoder could be loaded in this realm: the caller refuses with this code. */
export const BROTLI_UNSUPPORTED = 'codec-kit/brotli-unsupported'

interface NodeZlib {
  brotliDecompressSync(payload: Uint8Array, options: { maxOutputLength: number }): Uint8Array
}

// A variable specifier, so a browser bundle does not try to resolve it.
const NODE_ZLIB = 'node:zlib'
// The vendored decoder's own refusal at options.maxOutputLength (src/lib/brotli/PROVENANCE.json).
const PORTABLE_LIMIT_MESSAGE = 'Brotli output exceeds maxOutputLength'
let loaded: Promise<BrotliSync> | undefined
let portable: Promise<BrotliSync> | undefined

function coded(error: Error, code: string): Error {
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

const pastBound = (maximum: number): Error =>
  coded(
    new RangeError(`decompressed output exceeds its ${maximum}-byte bound`),
    COMPRESSION_OUTPUT_LIMIT,
  )

/**
 * A synchronous, output-bounded Brotli decoder (UE5 `.usmap` schemas, Brotli streams in archives):
 * the platform's zlib in Node, a Node worker and Electron; in a realm without it (a browser, a web
 * worker) the vendored decoder, {@link loadPortableBrotliSync}.
 */
export function loadBrotliSync(): Promise<BrotliSync> {
  loaded ??= (async (): Promise<BrotliSync> => {
    const zlib = (await import(/* @vite-ignore */ NODE_ZLIB).catch(() => undefined)) as
      NodeZlib | undefined
    if (typeof zlib?.brotliDecompressSync !== 'function') return loadPortableBrotliSync()
    return (payload, maximum) => {
      let out: Uint8Array
      try {
        out = zlib.brotliDecompressSync(payload, { maxOutputLength: Math.max(1, maximum) })
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') throw pastBound(maximum)
        throw error
      }
      // zlib's bound is at least one byte; a bound of 0 allows only the empty stream
      if (out.byteLength > maximum) throw pastBound(maximum)
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
    }
  })()
  return loaded
}

/**
 * The vendored decoder (Google's MIT JavaScript decoder, owner decision 40 (a)) that a realm without
 * zlib uses; loaded on first use, since its RFC 7932 dictionary is 122 KiB of code. It stops within
 * 16 KiB past the bound.
 */
export function loadPortableBrotliSync(): Promise<BrotliSync> {
  portable ??= (async (): Promise<BrotliSync> => {
    const decoder = await import('../lib/brotli/decode.js').catch(() => undefined)
    if (decoder === undefined)
      return () => {
        throw coded(new Error('this realm has no Brotli decoder'), BROTLI_UNSUPPORTED)
      }
    return (payload, maximum) => {
      let out: Int8Array
      try {
        out = decoder.BrotliDecode(
          new Int8Array(payload.buffer, payload.byteOffset, payload.byteLength),
          { maxOutputLength: maximum },
        )
      } catch (error) {
        if (error instanceof RangeError && error.message === PORTABLE_LIMIT_MESSAGE)
          throw pastBound(maximum)
        throw error
      }
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
    }
  })()
  return portable
}

/** {@link loadBrotliSync} for one stream. */
export async function decodeBrotli(
  payload: Uint8Array,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  return (await loadBrotliSync())(payload, maxOutputBytes)
}
