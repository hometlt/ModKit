/**
 * Concrete Node file adapter for the portable `RandomAccessSource` contract — lives in
 * host/node, never in browser-safe `@modkitx-x3/vfs` (BRIEF-12 §5 S2; canon §5.9:
 * concrete file adapters are host-owned).
 */

import { open, stat, type FileHandle } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import { rangeError, type RandomAccessSource } from '@modkitx-x3/vfs'

const CHUNK = 256 * 1024

export async function openFileSource(path: string): Promise<RandomAccessSource> {
  const id = pathToFileURL(path).href
  const size = (await stat(path)).size
  let handle: FileHandle | undefined
  let disposed = false
  const ensure = async (): Promise<FileHandle> => {
    if (disposed) {
      throw new ModkitError({ code: 'x3.vfs/source-disposed', message: `source «${id}» disposed` })
    }
    handle ??= await open(path, 'r')
    return handle
  }
  const readAt = async (
    offset: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> => {
    throwIfAborted(signal)
    if (offset < 0 || length < 0 || offset + length > size) {
      throw rangeError(id, offset, length, size)
    }
    const file = await ensure()
    const buffer = new Uint8Array(length)
    let read = 0
    while (read < length) {
      throwIfAborted(signal)
      const result = await file.read(buffer, read, length - read, offset + read)
      if (result.bytesRead === 0) {
        throw new ModkitError({
          code: 'x3.vfs/short-read',
          message: `short read at ${offset + read} of «${id}»`,
          context: { id, offset, length, read },
        })
      }
      read += result.bytesRead
    }
    return buffer
  }
  return {
    id,
    async size(signal) {
      throwIfAborted(signal)
      return size
    },
    readAt,
    stream(start = 0, end = size, signal) {
      let position = Math.max(0, start)
      const stop = Math.min(end, size)
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          throwIfAborted(signal)
          if (position >= stop) {
            controller.close()
            return
          }
          const length = Math.min(CHUNK, stop - position)
          const chunk = await readAt(position, length, signal)
          controller.enqueue(chunk)
          position += length
        },
      })
    },
    async dispose() {
      disposed = true
      await handle?.close()
      handle = undefined
    },
  }
}
