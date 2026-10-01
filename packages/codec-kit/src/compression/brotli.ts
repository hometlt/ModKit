import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

/** Decode one whole Brotli stream (RFC 7932); throws `codec-kit/compression-output-limit` past the bound. */
export type BrotliSync = (payload: Uint8Array, maxOutputBytes: number) => Uint8Array

/** The realm has no Brotli decoder (a browser or web worker): the caller refuses with this code. */
export const BROTLI_UNSUPPORTED = 'codec-kit/brotli-unsupported'

interface NodeZlib {
  brotliDecompressSync(payload: Uint8Array, options: { maxOutputLength: number }): Uint8Array
}

// A variable specifier, so a browser bundle does not try to resolve it.
const NODE_ZLIB = 'node:zlib'
let loaded: Promise<BrotliSync> | undefined

function coded(error: Error, code: string): Error {
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

/**
 * A synchronous, output-bounded Brotli decoder (UE5 `.usmap` schemas, Brotli streams in archives):
 * the platform's zlib in Node, a Node worker and Electron. A realm without it resolves to a function
 * that throws `codec-kit/brotli-unsupported`.
 * ponytail: no portable decoder for the web build yet; add one here (the RFC 7932 dictionary is
 * 122 KiB of data) when the web build needs Brotli.
 */
export function loadBrotliSync(): Promise<BrotliSync> {
  loaded ??= (async (): Promise<BrotliSync> => {
    const zlib = (await import(/* @vite-ignore */ NODE_ZLIB).catch(() => undefined)) as
      NodeZlib | undefined
    if (typeof zlib?.brotliDecompressSync !== 'function')
      return () => {
        throw coded(new Error('this realm has no Brotli decoder'), BROTLI_UNSUPPORTED)
      }
    return (payload, maximum) => {
      try {
        const out = zlib.brotliDecompressSync(payload, { maxOutputLength: Math.max(1, maximum) })
        return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE')
          throw coded(
            new RangeError(`decompressed output exceeds its ${maximum}-byte bound`),
            COMPRESSION_OUTPUT_LIMIT,
          )
        throw error
      }
    }
  })()
  return loaded
}

/** {@link loadBrotliSync} for one stream. */
export async function decodeBrotli(
  payload: Uint8Array,
  maxOutputBytes: number,
): Promise<Uint8Array> {
  return (await loadBrotliSync())(payload, maxOutputBytes)
}
