/**
 * Portable random-access source contract. Provider implementations live behind explicit
 * subpath imports; the package root remains browser-safe and provider-neutral.
 * Every potentially blocking call takes an `AbortSignal`.
 */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

export interface RandomAccessSource {
  /** Stable source locator id (also the subject root URI, MK3/25 §3). */
  readonly id: string
  size(signal?: AbortSignal): Promise<number>
  /** Reads exactly [offset, offset+length) or throws a structured range error. */
  readAt(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>
  /** Sequential stream over [start, end) — end exclusive, defaults to the full size. */
  stream(start?: number, end?: number, signal?: AbortSignal): ReadableStream<Uint8Array>
  dispose(): void | Promise<void>
}

export function rangeError(id: string, offset: number, length: number, size: number): ModkitError {
  return new ModkitError({
    code: 'x3.vfs/read-out-of-range',
    message: `read [${offset}, ${offset + length}) exceeds source «${id}» of size ${size}`,
    context: { id, offset, length, size },
  })
}

const CHUNK = 64 * 1024

export function createMemorySource(id: string, bytes: Uint8Array): RandomAccessSource {
  let disposed = false
  const ensureLive = () => {
    if (disposed) {
      throw new ModkitError({ code: 'x3.vfs/source-disposed', message: `source «${id}» disposed` })
    }
  }
  return {
    id,
    // async so cancellation/disposal surface as rejections, never sync throws
    async size(signal) {
      throwIfAborted(signal)
      ensureLive()
      return bytes.length
    },
    async readAt(offset, length, signal) {
      throwIfAborted(signal)
      ensureLive()
      if (offset < 0 || length < 0 || offset + length > bytes.length) {
        throw rangeError(id, offset, length, bytes.length)
      }
      return bytes.slice(offset, offset + length)
    },
    stream(start = 0, end = bytes.length, signal) {
      ensureLive()
      let position = Math.max(0, start)
      const stop = Math.min(end, bytes.length)
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          throwIfAborted(signal)
          if (position >= stop) {
            controller.close()
            return
          }
          const next = Math.min(position + CHUNK, stop)
          controller.enqueue(bytes.slice(position, next))
          position = next
        },
      })
    },
    dispose() {
      disposed = true
    },
  }
}

export async function collectStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  try {
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
