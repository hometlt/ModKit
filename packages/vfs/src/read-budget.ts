import { ModkitError, throwIfAborted } from '@modkitx-x3/core'

import { rangeError, type RandomAccessSource } from './source.js'
import type { VfsLimits } from './vfs.js'

interface ReadReservation {
  commit(bytes: number): void
  release(): void
}

export class VfsReadBudget {
  private consumed = 0n
  private reserved = 0n

  constructor(private readonly maximum: bigint) {}

  reserve(bytes: number, sourceId: string): ReadReservation {
    const requested = BigInt(bytes)
    if (this.consumed + this.reserved + requested > this.maximum) {
      throw new ModkitError({
        code: 'x3.vfs/read-byte-budget-exceeded',
        message: 'VFS mount exhausted its cumulative read-byte budget',
        context: {
          sourceId,
          requestedBytes: bytes,
          consumedBytes: String(this.consumed),
          reservedBytes: String(this.reserved),
          maxReadBytes: String(this.maximum),
        },
      })
    }
    this.reserved += requested
    let remaining = requested
    return {
      commit: bytesRead => {
        const committed = BigInt(bytesRead)
        if (committed < 0n || committed > remaining) {
          throw new ModkitError({
            code: 'x3.vfs/read-budget-accounting-invalid',
            message: 'VFS provider reported an invalid read-budget commitment',
            context: {
              sourceId,
              committedBytes: bytesRead,
              reservedBytes: String(remaining),
            },
          })
        }
        remaining -= committed
        this.reserved -= committed
        this.consumed += committed
      },
      release: () => {
        this.reserved -= remaining
        remaining = 0n
      },
    }
  }
}

export function assertReadRangeLimit(sourceId: string, length: number, limits: VfsLimits): void {
  if (length <= limits.maxReadRangeBytes) return
  throw new ModkitError({
    code: 'x3.vfs/read-range-limit-exceeded',
    message: 'random-access read exceeds the configured per-range limit',
    context: { sourceId, length, maxReadRangeBytes: limits.maxReadRangeBytes },
  })
}

export function assertStreamLimit(
  sourceId: string,
  start: number,
  end: number,
  limits: VfsLimits,
): void {
  const bytes = BigInt(end - start)
  if (bytes <= limits.maxStreamBytes) return
  throw new ModkitError({
    code: 'x3.vfs/stream-byte-limit-exceeded',
    message: 'random-access stream exceeds the configured per-stream limit',
    context: { sourceId, bytes: String(bytes), maxStreamBytes: String(limits.maxStreamBytes) },
  })
}

export function budgetRandomAccessSource(
  source: RandomAccessSource,
  size: number,
  limits: VfsLimits,
  budget: VfsReadBudget,
): RandomAccessSource {
  let disposed = false
  const assertLive = () => {
    if (!disposed) return
    throw new ModkitError({
      code: 'x3.vfs/source-disposed',
      message: `source «${source.id}» disposed`,
    })
  }
  const checkedRange = (start: number, end: number) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > size
    ) {
      throw new ModkitError({
        code: 'x3.vfs/read-out-of-range',
        message: `stream [${start}, ${end}) exceeds source «${source.id}» of size ${size}`,
        context: { id: source.id, start, end, size },
      })
    }
  }
  const wrapped: RandomAccessSource = {
    id: source.id,
    async size(signal) {
      assertLive()
      return source.size(signal)
    },
    async readAt(offset, length, signal) {
      assertLive()
      throwIfAborted(signal)
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > size
      ) {
        throw rangeError(source.id, offset, length, size)
      }
      assertReadRangeLimit(source.id, length, limits)
      const reservation = budget.reserve(length, source.id)
      try {
        const bytes = await source.readAt(offset, length, signal)
        reservation.commit(bytes.byteLength)
        return bytes
      } finally {
        reservation.release()
      }
    },
    stream(start = 0, end = size, signal) {
      assertLive()
      checkedRange(start, end)
      assertStreamLimit(source.id, start, end, limits)
      let position = start
      return new ReadableStream<Uint8Array>({
        pull: async controller => {
          if (position >= end) {
            controller.close()
            return
          }
          const length = Math.min(64 * 1024, end - position)
          const bytes = await wrapped.readAt(position, length, signal)
          position += bytes.byteLength
          controller.enqueue(bytes)
        },
      })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      await source.dispose()
    },
  }
  return wrapped
}
