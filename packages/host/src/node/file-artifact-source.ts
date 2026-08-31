/**
 * A file on disk as the A-1 `ArtifactByteSource` (S7) — the one production adapter for the Node
 * products (CLI, server, automation, Electron main). The revision is the file's identity and
 * modification snapshot (`provider-token:<dev>-<ino>-<size>-<mtimeNs>`); every bounded read
 * re-checks it, so a file rewritten while a subject is open fails the read
 * (`x3.host/source-revision-changed`) instead of returning bytes of a different revision.
 * Reads are bounded to the snapshotted size and never allocate beyond what was asked.
 */

import { open, stat, type FileHandle } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { ModkitError, throwIfAborted } from '@modkit/core'
import { revisionId, type ArtifactByteSource } from '@modkit/sdk'

const STREAM_CHUNK = 1024n * 1024n

interface FileSnapshot {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
}

const sameSnapshot = (left: FileSnapshot, right: FileSnapshot): boolean =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs

export interface FileArtifactSourceOptions {
  /** Overrides the source ref id/uri (default: the file: URL of the path). */
  readonly uri?: string
  readonly signal?: AbortSignal
}

export async function openFileArtifactSource(
  path: string,
  options: FileArtifactSourceOptions = {},
): Promise<ArtifactByteSource> {
  throwIfAborted(options.signal)
  const initial = await stat(path, { bigint: true })
  if (!initial.isFile()) {
    throw new ModkitError({
      code: 'x3.host/source-not-a-file',
      message: `subject path «${path}» is not a regular file`,
      context: { path },
    })
  }
  if (initial.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ModkitError({
      code: 'x3.host/source-size-unrepresentable',
      message: `subject «${path}» exceeds the exact random-access range of the Node adapter`,
      context: { path, size: String(initial.size) },
    })
  }
  const uri = options.uri ?? pathToFileURL(path).href
  const snapshot: FileSnapshot = {
    dev: initial.dev,
    ino: initial.ino,
    size: initial.size,
    mtimeNs: initial.mtimeNs,
  }
  const revision = revisionId(
    `provider-token:${snapshot.dev}-${snapshot.ino}-${snapshot.size}-${snapshot.mtimeNs}`,
  )

  const read = async (
    offset: bigint,
    length: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> => {
    throwIfAborted(signal)
    if (offset < 0n || !Number.isSafeInteger(length) || length < 0) {
      throw new ModkitError({
        code: 'x3.host/invalid-source-range',
        message: `file read of «${uri}» must use a non-negative exact range`,
        context: { uri, offset: String(offset), length },
      })
    }
    if (offset > snapshot.size) {
      throw new ModkitError({
        code: 'x3.host/invalid-source-range',
        message: `file read of «${uri}» starts beyond the source size`,
        context: { uri, offset: String(offset), size: String(snapshot.size) },
      })
    }
    const available = snapshot.size - offset
    const bounded = Number(available < BigInt(length) ? available : BigInt(length))
    const current = await stat(path, { bigint: true })
    if (!sameSnapshot(snapshot, current)) {
      throw new ModkitError({
        code: 'x3.host/source-revision-changed',
        message: `«${uri}» changed on disk while it was open (revision ${revision})`,
        context: { uri, revision },
      })
    }
    let handle: FileHandle | undefined
    try {
      handle = await open(path, 'r')
      const bytes = new Uint8Array(bounded)
      let filled = 0
      while (filled < bounded) {
        throwIfAborted(signal)
        const { bytesRead } = await handle.read(
          bytes,
          filled,
          bounded - filled,
          Number(offset) + filled,
        )
        if (bytesRead === 0) break
        filled += bytesRead
      }
      return filled === bounded ? bytes : bytes.slice(0, filled)
    } finally {
      await handle?.close()
    }
  }

  const source: ArtifactByteSource = {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision,
    size: snapshot.size,
    read,
    async *stream(range, signal) {
      const start = range?.offset ?? 0n
      const total = range?.length ?? (snapshot.size > start ? snapshot.size - start : 0n)
      let consumed = 0n
      while (consumed < total) {
        const remaining = total - consumed
        const bytes = await read(
          start + consumed,
          Number(remaining > STREAM_CHUNK ? STREAM_CHUNK : remaining),
          signal,
        )
        if (bytes.byteLength === 0) return
        consumed += BigInt(bytes.byteLength)
        yield bytes
      }
    },
  }
  return Object.freeze(source)
}
