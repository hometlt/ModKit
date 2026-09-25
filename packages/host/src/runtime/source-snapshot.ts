/** Bounded read evidence for a Runtime composition prepared from a live ModContext.
 * Every game still reads through its own canonical loader. The host records only bytes
 * actually consumed, and verifies them again before admitting an executable receipt.
 */
import type { ModContext } from '@modkit/vfs/content-sources'
import { sha256 } from '../artifact-files.js'

const MAX_FILES = 4_096
const MAX_TOTAL_BYTES = 512 * 1024 * 1024
const MAX_PATH_LENGTH = 4_096
const encoder = new TextEncoder()

interface SourceRead {
  readonly layerId: string
  readonly path: string
  readonly maxBytes: number
  readonly size: number
  readonly digest: string
}

export interface RuntimeSourceSnapshot {
  readonly context: ModContext
  verify(signal?: AbortSignal): Promise<
    Readonly<{
      digest: string
      fileCount: number
      totalBytes: number
    }>
  >
}

export class RuntimeSourceChangedError extends Error {
  readonly code = 'x3.host/runtime-source-changed'
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSourceChangedError'
  }
}

export class RuntimeSourceBudgetError extends Error {
  readonly code = 'x3.host/runtime-source-budget'
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSourceBudgetError'
  }
}

function validAddress(layerId: string, path: string): boolean {
  return (
    layerId.length > 0 &&
    layerId.length <= MAX_PATH_LENGTH &&
    !layerId.includes('\0') &&
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.includes('\0')
  )
}

/** The returned context is only for this open attempt; caller still owns the original lease. */
export function captureRuntimeSourceReads(context: ModContext): RuntimeSourceSnapshot {
  const reads = new Map<string, SourceRead>()
  let totalBytes = 0
  let verifying = false
  let inFlight = 0
  const query = context.query?.bind(context)
  const wrapped: ModContext = Object.freeze({
    schemaVersion: context.schemaVersion,
    gameId: context.gameId,
    contextId: context.contextId,
    layers: context.layers,
    unresolved: context.unresolved,
    diagnostics: context.diagnostics,
    files: (...args: Parameters<ModContext['files']>) => context.files(...args),
    locate: (...args: Parameters<ModContext['locate']>) => context.locate(...args),
    ...(query === undefined ? {} : { query }),
    dispose: () => context.dispose(),
    async read(layerId: string, path: string, maxBytes: number) {
      if (verifying)
        throw new RuntimeSourceChangedError('Runtime inputs changed during verification')
      if (!validAddress(layerId, path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1)
        throw new TypeError('Runtime source read has an invalid address or byte limit')
      inFlight += 1
      try {
        const bytes = await context.read(layerId, path, maxBytes)
        const digest = await sha256(bytes)
        const key = `${layerId}\0${path}`
        const previous = reads.get(key)
        if (previous !== undefined) {
          if (previous.digest !== digest)
            throw new RuntimeSourceChangedError(`Runtime source changed while reading ${path}`)
          return bytes
        }
        if (reads.size >= MAX_FILES || bytes.byteLength > MAX_TOTAL_BYTES - totalBytes)
          throw new RuntimeSourceBudgetError(
            'Runtime source snapshot exceeds its file or byte budget',
          )
        reads.set(key, { layerId, path, maxBytes, size: bytes.byteLength, digest })
        totalBytes += bytes.byteLength
        return bytes
      } finally {
        inFlight -= 1
      }
    },
  })
  return {
    context: wrapped,
    async verify(signal) {
      if (inFlight !== 0)
        throw new RuntimeSourceChangedError('Runtime preparer left source reads unfinished')
      verifying = true
      const ordered = [...reads.values()].sort((a, b) => {
        const first = `${a.layerId}\0${a.path}`
        const second = `${b.layerId}\0${b.path}`
        return first < second ? -1 : first > second ? 1 : 0
      })
      for (const read of ordered) {
        signal?.throwIfAborted()
        let bytes: Uint8Array
        try {
          bytes = await context.read(read.layerId, read.path, read.maxBytes)
        } catch (error) {
          signal?.throwIfAborted()
          throw new RuntimeSourceChangedError(
            `Runtime source ${read.path} is no longer readable: ${String(error)}`,
          )
        }
        if (bytes.byteLength !== read.size || (await sha256(bytes)) !== read.digest)
          throw new RuntimeSourceChangedError(`Runtime source changed while preparing ${read.path}`)
      }
      const identity = ordered.map(read => [read.layerId, read.path, read.digest])
      return Object.freeze({
        digest: await sha256(encoder.encode(JSON.stringify(identity))),
        fileCount: ordered.length,
        totalBytes,
      })
    },
  }
}
