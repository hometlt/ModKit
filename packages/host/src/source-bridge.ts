/**
 * Checked bridge from the current portable VFS source to the A-1 codec ABI.
 *
 * `RandomAccessSource` is intentionally limited to JavaScript-safe numeric offsets while
 * `ArtifactByteSource` exposes bigint wire/runtime coordinates. The bridge rejects anything that
 * cannot be represented exactly; it never rounds an offset or silently truncates a range.
 */

import { ModkitError, throwIfAborted } from '@modkitx-x3/core'
import type { ArtifactByteSource, AssetSourceRef, RevisionId } from '@modkitx-x3/sdk'
import type { RandomAccessSource } from '@modkitx-x3/vfs'

export interface ArtifactByteSourceBridgeOptions {
  readonly ref: AssetSourceRef
  readonly revision: RevisionId
  readonly signal?: AbortSignal
}

function invalidRange(
  sourceId: string,
  offset: bigint,
  length: bigint,
  size: bigint,
  message: string,
): ModkitError {
  return new ModkitError({
    code: 'x3.host/source-range-unrepresentable',
    message,
    context: {
      sourceId,
      offset: offset.toString(),
      length: length.toString(),
      size: size.toString(),
    },
  })
}

function checkedRange(
  sourceId: string,
  size: bigint,
  offset: bigint,
  length: bigint,
): { readonly start: number; readonly length: number; readonly end: number } {
  if (offset < 0n || length < 0n || offset > size || length > size - offset) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read [${offset}, ${offset + length}) exceeds source «${sourceId}» of size ${size}`,
    )
  }
  if (offset > BigInt(Number.MAX_SAFE_INTEGER) || length > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read range for source «${sourceId}» cannot be represented exactly by the current VFS`,
    )
  }
  const start = Number(offset)
  const numericLength = Number(length)
  const end = start + numericLength
  if (!Number.isSafeInteger(end)) {
    throw invalidRange(
      sourceId,
      offset,
      length,
      size,
      `read end for source «${sourceId}» cannot be represented exactly by the current VFS`,
    )
  }
  return { start, length: numericLength, end }
}

/**
 * Snapshot the source size once and expose the A-1 byte-source contract without transferring
 * ownership. The caller still owns and disposes the `RandomAccessSource`.
 */
export async function artifactByteSourceFromRandomAccess(
  source: RandomAccessSource,
  options: ArtifactByteSourceBridgeOptions,
): Promise<ArtifactByteSource> {
  throwIfAborted(options.signal)
  const numericSize = await source.size(options.signal)
  throwIfAborted(options.signal)
  if (!Number.isSafeInteger(numericSize) || numericSize < 0) {
    throw new ModkitError({
      code: 'x3.host/source-size-unrepresentable',
      message: `source «${source.id}» reported a size outside the exact JavaScript integer range`,
      context: { sourceId: source.id, size: String(numericSize) },
    })
  }
  const size = BigInt(numericSize)
  const ref = Object.freeze({
    ...options.ref,
    ...(options.ref.parentIds === undefined
      ? {}
      : {
          parentIds: Object.freeze([...options.ref.parentIds]) as readonly [string, ...string[]],
        }),
  }) as AssetSourceRef

  const bridged: ArtifactByteSource = {
    kind: 'bytes',
    ref,
    revision: options.revision,
    size,
    async read(offset, length, signal) {
      throwIfAborted(signal)
      if (!Number.isSafeInteger(length) || length < 0) {
        throw invalidRange(
          source.id,
          offset,
          BigInt(Number.isFinite(length) ? Math.trunc(length) : 0),
          size,
          `read length for source «${source.id}» must be a non-negative safe integer`,
        )
      }
      const range = checkedRange(source.id, size, offset, BigInt(length))
      const bytes = await source.readAt(range.start, range.length, signal)
      throwIfAborted(signal)
      if (bytes.byteLength !== range.length) {
        throw new ModkitError({
          code: 'x3.host/source-short-read',
          message: `source «${source.id}» returned ${bytes.byteLength} bytes for an exact ${range.length}-byte read`,
          context: { sourceId: source.id, expected: range.length, actual: bytes.byteLength },
        })
      }
      return bytes
    },
    async *stream(range, signal) {
      throwIfAborted(signal)
      const offset = range?.offset ?? 0n
      const length = range?.length ?? size - offset
      const checked = checkedRange(source.id, size, offset, length)
      const reader = source.stream(checked.start, checked.end, signal).getReader()
      let seen = 0
      try {
        for (;;) {
          throwIfAborted(signal)
          const next = await reader.read()
          if (next.done) break
          seen += next.value.byteLength
          if (seen > checked.length) {
            throw new ModkitError({
              code: 'x3.host/source-stream-overrun',
              message: `source «${source.id}» streamed beyond its requested range`,
              context: { sourceId: source.id, expected: checked.length, actual: seen },
            })
          }
          yield next.value
        }
        if (seen !== checked.length) {
          throw new ModkitError({
            code: 'x3.host/source-short-stream',
            message: `source «${source.id}» streamed ${seen} bytes for an exact ${checked.length}-byte range`,
            context: { sourceId: source.id, expected: checked.length, actual: seen },
          })
        }
      } finally {
        if (seen < checked.length) await reader.cancel().catch(() => undefined)
        reader.releaseLock()
      }
    },
  }
  return Object.freeze(bridged)
}
