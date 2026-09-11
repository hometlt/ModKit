import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { ModkitError, throwIfAborted } from '@modkit/core'
import type {
  Lease,
  PayloadChunk,
  PayloadChunkRequest,
  PayloadReader,
  PayloadSource,
  PayloadStagingStore,
  StagePayloadOptions,
  StagedPayloadRef,
} from '@modkit/sdk'

const DEFAULT_MAX_BYTES = 1024n * 1024n * 1024n

interface StoredPayload {
  readonly path: string
  readonly ref: StagedPayloadRef
}

export interface FilePayloadStoreOptions {
  readonly directory?: string
  readonly storeId?: string
  readonly maxBytes?: bigint
  readonly now?: () => string
}

export interface FilePayloadStore extends PayloadStagingStore {
  dispose(): Promise<void>
}

function unavailable(message: string): ModkitError {
  return new ModkitError({ code: 'x3.host/edit-payload-unavailable', message })
}

function sameRef(left: StagedPayloadRef, right: StagedPayloadRef): boolean {
  return (
    left.storeId === right.storeId &&
    left.handleId === right.handleId &&
    left.digest === right.digest &&
    left.bytes === right.bytes &&
    left.replayable === true &&
    left.expiresAt === right.expiresAt
  )
}

function chunks(source: PayloadSource): AsyncIterable<Uint8Array> {
  if (!(source instanceof Uint8Array)) return source
  return (async function* () {
    yield source
  })()
}

async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0
  while (offset < bytes.byteLength) {
    const written = await file.write(bytes, offset, bytes.byteLength - offset)
    if (written.bytesWritten <= 0) throw unavailable('staged payload write made no progress')
    offset += written.bytesWritten
  }
}

/** Node host store for large edit payloads. Files are opaque, digest-bound and explicitly owned. */
export function createFilePayloadStore(options: FilePayloadStoreOptions = {}): FilePayloadStore {
  const storeId = options.storeId ?? `node-file-payloads:${randomUUID()}`
  const directory = resolve(options.directory ?? join(tmpdir(), `modkit-payloads-${randomUUID()}`))
  const maximum = options.maxBytes ?? DEFAULT_MAX_BYTES
  const now = options.now ?? (() => new Date().toISOString())
  const stored = new Map<string, StoredPayload>()
  let disposed = false

  const record = (ref: StagedPayloadRef): StoredPayload | undefined => {
    if (disposed || ref.storeId !== storeId) return undefined
    const value = stored.get(ref.handleId)
    return value !== undefined && sameRef(value.ref, ref) ? value : undefined
  }

  const verify: FilePayloadStore['verify'] = async (ref, signal) => {
    throwIfAborted(signal)
    const value = record(ref)
    if (value === undefined) return false
    if (ref.expiresAt !== undefined && Date.parse(ref.expiresAt) <= Date.parse(now())) return false
    let file: FileHandle | undefined
    try {
      const info = await stat(value.path)
      if (!info.isFile() || BigInt(info.size) !== ref.bytes) return false
      file = await open(value.path, 'r')
      const hash = createHash('sha256')
      const buffer = new Uint8Array(1024 * 1024)
      let position = 0
      for (;;) {
        throwIfAborted(signal)
        const part = await file.read(buffer, 0, buffer.byteLength, position)
        if (part.bytesRead === 0) break
        hash.update(buffer.subarray(0, part.bytesRead))
        position += part.bytesRead
      }
      return `sha256:${hash.digest('hex')}` === ref.digest
    } catch {
      return false
    } finally {
      await file?.close().catch(() => undefined)
    }
  }

  return Object.freeze({
    async stage(
      source: PayloadSource,
      stageOptions: StagePayloadOptions = {},
      signal?: AbortSignal,
    ): Promise<StagedPayloadRef> {
      if (disposed) throw unavailable('staged payload store is disposed')
      throwIfAborted(signal)
      if (
        stageOptions.expiresAt !== undefined &&
        (!Number.isFinite(Date.parse(stageOptions.expiresAt)) ||
          Date.parse(stageOptions.expiresAt) <= Date.parse(now()))
      ) {
        throw unavailable('staged payload expiry must be a future ISO timestamp')
      }
      await mkdir(directory, { recursive: true })
      const handleId = randomUUID()
      const path = join(directory, `${handleId}.payload`)
      const hash = createHash('sha256')
      let total = 0n
      let file: FileHandle | undefined
      try {
        file = await open(path, 'wx', 0o600)
        for await (const part of chunks(source)) {
          throwIfAborted(signal)
          if (!(part instanceof Uint8Array)) throw new TypeError('payload source yielded non-bytes')
          total += BigInt(part.byteLength)
          if (total > maximum) throw unavailable(`staged payload exceeds ${maximum} bytes`)
          hash.update(part)
          await writeAll(file, part)
        }
        await file.sync()
        await file.close()
        file = undefined
        const ref: StagedPayloadRef = Object.freeze({
          storeId,
          handleId,
          digest: `sha256:${hash.digest('hex')}`,
          bytes: total,
          replayable: true,
          ...(stageOptions.expiresAt === undefined ? {} : { expiresAt: stageOptions.expiresAt }),
        })
        stored.set(handleId, { path, ref })
        return ref
      } catch (error) {
        await file?.close().catch(() => undefined)
        await rm(path, { force: true }).catch(() => undefined)
        throw error
      }
    },
    verify,
    async open(ref: StagedPayloadRef, signal?: AbortSignal): Promise<Lease<PayloadReader>> {
      if (!(await verify(ref, signal))) throw unavailable(`staged payload «${ref.handleId}» is unavailable`)
      const value = record(ref)
      if (value === undefined) throw unavailable(`staged payload «${ref.handleId}» is unavailable`)
      const file = await open(value.path, 'r')
      let released = false
      const reader: PayloadReader = Object.freeze({
        async read(
          request: PayloadChunkRequest,
          readSignal?: AbortSignal,
        ): Promise<PayloadChunk> {
          throwIfAborted(readSignal)
          if (released) throw unavailable(`staged payload lease «${ref.handleId}» is released`)
          if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0)
            throw new TypeError('payload read maxBytes must be a positive safe integer')
          const position = request.cursor === undefined ? 0 : Number(request.cursor)
          if (!Number.isSafeInteger(position) || position < 0 || BigInt(position) > ref.bytes)
            throw new TypeError('payload cursor is invalid')
          const remaining = Number(ref.bytes - BigInt(position))
          const buffer = new Uint8Array(Math.min(request.maxBytes, remaining))
          const result = await file.read(buffer, 0, buffer.byteLength, position)
          const bytes = buffer.subarray(0, result.bytesRead)
          const next = position + result.bytesRead
          return next >= Number(ref.bytes)
            ? { complete: true, bytes }
            : { complete: false, bytes, nextCursor: String(next) }
        },
      })
      return Object.freeze({
        value: reader,
        async release() {
          if (released) return
          released = true
          await file.close()
        },
      })
    },
    async release(ref: StagedPayloadRef) {
      const value = record(ref)
      if (value === undefined) return
      stored.delete(ref.handleId)
      await rm(value.path, { force: true })
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const paths = [...stored.values()].map(value => value.path)
      stored.clear()
      await Promise.all(paths.map(path => rm(path, { force: true })))
      await rm(directory, { recursive: true, force: true })
    },
  })
}
