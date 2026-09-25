// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient typing for untyped pako
/// <reference path="./pako.d.ts" />
import { COMPRESSION_OUTPUT_LIMIT } from './bounded.js'

/** `zlib` (RFC 1950), `deflate-raw` (RFC 1951) or `gzip` (RFC 1952). */
export type InflateFormat = 'zlib' | 'deflate-raw' | 'gzip'

/** Inflate one whole stream; throws `codec-kit/compression-output-limit` past `maxOutputBytes`. */
export type InflateSync = (payload: Uint8Array, maxOutputBytes: number) => Uint8Array

type NativeOptions = { maxOutputLength: number; chunkSize: number }
interface NodeZlib {
  inflateSync(payload: Uint8Array, options: NativeOptions): Uint8Array
  inflateRawSync(payload: Uint8Array, options: NativeOptions): Uint8Array
  gunzipSync(payload: Uint8Array, options: NativeOptions): Uint8Array
}

// A variable specifier, so a browser bundle does not try to resolve it.
const NODE_ZLIB = 'node:zlib'
const loaded = new Map<InflateFormat, Promise<InflateSync>>()

function outputLimit(maximum: number): Error {
  const error = new RangeError(`decompressed output exceeds its ${maximum}-byte bound`)
  Object.defineProperty(error, 'code', { value: COMPRESSION_OUTPUT_LIMIT, enumerable: true })
  return error
}

/**
 * A synchronous, output-bounded inflate, for codecs that decode inside a synchronous loop (BLTE
 * chunks, archive sectors, PNG `IDAT`): the platform's zlib when the realm has one — Node, a Node
 * worker, Electron — and pako otherwise. Loading is asynchronous so a browser realm pays for pako
 * only when it inflates; the function it resolves to is not.
 *
 * Native zlib is ~4x faster on real data: an installed StarCraft II's 20 MB CASC root inflates in
 * 78 ms against 302 ms for a JavaScript inflate, and 24 MB of models in 80 ms against 337 ms.
 */
export function loadInflateSync(format: InflateFormat = 'zlib'): Promise<InflateSync> {
  let pending = loaded.get(format)
  if (pending === undefined) {
    pending = resolveInflate(format)
    loaded.set(format, pending)
  }
  return pending
}

async function resolveInflate(format: InflateFormat): Promise<InflateSync> {
  const zlib = (await import(/* @vite-ignore */ NODE_ZLIB).catch(() => undefined)) as
    | NodeZlib
    | undefined
  if (typeof zlib?.inflateSync === 'function') {
    const run =
      format === 'zlib'
        ? zlib.inflateSync.bind(zlib)
        : format === 'gzip'
          ? zlib.gunzipSync.bind(zlib)
          : zlib.inflateRawSync.bind(zlib)
    return (payload, maximum) => {
      try {
        const out = run(payload, {
          maxOutputLength: Math.max(1, maximum),
          // An exact bound (a BLTE chunk) is inflated into one buffer, without a join.
          chunkSize: Math.min(Math.max(maximum, 64), 1 << 20),
        })
        // A Node Buffer may be a slice of a shared pool or of a larger chunk; the result owns
        // its whole buffer, as the host's worker RPC requires of anything a codec returns.
        return out.byteOffset === 0 && out.byteLength === out.buffer.byteLength
          ? new Uint8Array(out.buffer)
          : new Uint8Array(out)
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw outputLimit(maximum)
        }
        throw error
      }
    }
  }
  return loadPortableInflateSync(format)
}

/** The JavaScript half of {@link loadInflateSync}, for a realm without native zlib (and tests). */
export async function loadPortableInflateSync(format: InflateFormat = 'zlib'): Promise<InflateSync> {
  const pako = await import('pako')
  return (payload, maximum) => {
    const chunks: Uint8Array[] = []
    let total = 0
    // pako detects zlib and gzip headers by itself; only a raw stream has to be named.
    const inflater = new pako.Inflate(format === 'deflate-raw' ? { raw: true } : {})
    inflater.onData = chunk => {
      total += chunk.length
      if (total > maximum) throw outputLimit(maximum)
      chunks.push(chunk)
    }
    inflater.push(payload, true)
    if (inflater.err !== 0) throw new Error(`inflate failed: ${inflater.msg}`)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}
