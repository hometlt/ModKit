import type { JsonObject } from '@modkit/sdk'
import { snapshotJson } from '@modkit/codec-kit/json-snapshot'
import {
  DEFAULT_UVM_CONTAINER_BUDGET,
  checkUvmContainerBudget,
  readUvmContainer,
  writeUvmContainer,
  type UvmContainer,
  type UvmContainerBudget,
} from '@modkit/uv/model/container'
import { applyUvmJsonEdit, type UvmJsonEdit } from './json-edit.js'

export type { UvmJsonEdit } from './json-edit.js'
export interface UvmDocumentOptions {
  readonly budget?: UvmContainerBudget
  readonly maxHistoryEntries?: number
  /** Conservative total retained JSON, binary, opaque chunks and original input bytes. */
  readonly maxHistoryBytes?: number
  readonly maxEdits?: number
  /** Opt in to exact reset. The initial state stays pinned within maxHistoryBytes. */
  readonly resettable?: boolean
  /** Additional format/semantic validation, run before any state becomes visible. */
  readonly validate?: (container: UvmContainer) => void
  readonly signal?: AbortSignal
}
export interface UvmBinaryEdit {
  readonly byteOffset: number
  /** Fixed-size replacement; bufferView/accessor layout stays unchanged. */
  readonly bytes: Uint8Array
}
export interface UvmDocumentEdit {
  readonly expectedRevision: number
  readonly json?: readonly UvmJsonEdit[]
  readonly binary?: readonly UvmBinaryEdit[]
}
export interface UvmDocumentReplacement {
  readonly expectedRevision: number
  /** Complete prepared state, including appended storage; copied before validation and commit. */
  readonly container: UvmContainer
}
export interface UvmDocumentStatus {
  readonly revision: number
  readonly modified: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly retainedBytes: number
}
export interface UvmDocument {
  status(): UvmDocumentStatus
  /** Complete immutable JSON; binary and opaque bytes are returned as owned copies. */
  snapshot(): UvmContainer
  apply(edit: UvmDocumentEdit): UvmDocumentStatus
  replace(replacement: UvmDocumentReplacement): UvmDocumentStatus
  undo(expectedRevision: number): UvmDocumentStatus
  redo(expectedRevision: number): UvmDocumentStatus
  /** Restore original bytes and clear both histories. Requires resettable:true at open. */
  reset(expectedRevision: number): UvmDocumentStatus
  /** Prepares bytes only. Durable storage remains owned by the host writer/coordinator. */
  serialize(expectedRevision: number): Uint8Array
  dispose(): void
}
interface State {
  readonly id: number
  readonly container: UvmContainer
  readonly originalBytes?: Uint8Array
  readonly size: number
}
const encoder = new TextEncoder()

/** In-memory UVM editing with atomic batches, revision checks and bounded undo/redo. */
export function openUvmDocument(bytes: Uint8Array, options: UvmDocumentOptions = {}): UvmDocument {
  const budget = Object.freeze({ ...(options.budget ?? DEFAULT_UVM_CONTAINER_BUDGET) })
  checkUvmContainerBudget(budget)
  const maxHistoryEntries = options.maxHistoryEntries ?? 100
  const maxHistoryBytes = options.maxHistoryBytes ?? 536_870_912
  const maxEdits = options.maxEdits ?? 4096
  const resettable = options.resettable ?? false
  if (typeof resettable !== 'boolean') throw new TypeError('invalid UVM reset option')
  for (const limit of [maxHistoryEntries, maxHistoryBytes, maxEdits])
    if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError('invalid UVM document limit')
  const signal = options.signal
  const validate = options.validate
  let disposed = false
  const checkAlive = (): void => {
    if (disposed) throw new TypeError('UVM document is disposed')
    if (signal?.aborted) throw new DOMException('operation cancelled', 'AbortError')
  }
  checkAlive()
  if (bytes.byteLength > budget.maxInputBytes) throw new RangeError('UVM exceeds maxInputBytes')
  const originalBytes = Uint8Array.from(bytes)
  const container = readUvmContainer(originalBytes, budget, signal)
  const ownView = (value: UvmContainer): UvmContainer =>
    Object.freeze({
      ...value,
      binary: Uint8Array.from(value.binary),
      extraChunks: Object.freeze(
        value.extraChunks.map(chunk =>
          Object.freeze({
            type: chunk.type,
            bytes: Uint8Array.from(chunk.bytes),
          }),
        ),
      ),
    })
  const validateState = (value: UvmContainer): void => {
    const asset = value.document['asset']
    if (
      asset === null ||
      typeof asset !== 'object' ||
      Array.isArray(asset) ||
      (asset as JsonObject)['version'] !== '2.0'
    )
      throw new TypeError('UVM requires glTF asset.version 2.0')
    // Validators cannot mutate the candidate's binary state through their view.
    validate?.(ownView(value))
    checkAlive()
  }
  validateState(container)
  const sizeOf = (value: UvmContainer): number =>
    encoder.encode(JSON.stringify(value.document)).length +
    value.binary.byteLength +
    value.extraChunks.reduce((sum, chunk) => sum + chunk.bytes.byteLength, 0)
  let current: State | undefined = {
    id: 0,
    container,
    originalBytes,
    size: sizeOf(container) + originalBytes.length,
  }
  if (current.size > maxHistoryBytes) throw new RangeError('UVM document exceeds maxHistoryBytes')
  let resetState: State | undefined = resettable ? current : undefined
  let revision = 0
  let nextStateId = 1
  const undo: State[] = []
  const redo: State[] = []
  const currentState = (): State => {
    checkAlive()
    if (current === undefined) throw new TypeError('UVM document is disposed')
    return current
  }
  const retainedBytes = (): number => {
    const states = new Set([currentState(), ...undo, ...redo])
    if (resetState !== undefined) states.add(resetState)
    let bytes = 0
    for (const state of states) bytes += state.size
    return bytes
  }
  const status = (): UvmDocumentStatus => {
    checkAlive()
    return Object.freeze({
      revision,
      modified: currentState().id !== 0,
      canUndo: undo.length > 0,
      canRedo: redo.length > 0,
      retainedBytes: retainedBytes(),
    })
  }
  const checkRevision = (expected: number): State => {
    checkAlive()
    if (!Number.isSafeInteger(expected) || expected !== revision)
      throw new TypeError('stale UVM document revision')
    if (revision === Number.MAX_SAFE_INTEGER)
      throw new RangeError('UVM document revision exhausted')
    return currentState()
  }
  const prune = (): void => {
    while (
      undo.length > 0 &&
      (undo.length > maxHistoryEntries || retainedBytes() > maxHistoryBytes)
    )
      undo.shift()
  }
  const commit = (before: State, expected: number, candidate: UvmContainer): UvmDocumentStatus => {
    validateState(candidate)
    // Validation may re-enter or dispose the document. Publish only against the captured revision.
    writeUvmContainer(candidate, budget, signal)
    checkRevision(expected)
    const size = sizeOf(candidate)
    // These are the minimum non-evictable states after commit. Reject before publishing or
    // clearing redo; pruning undo cannot reduce this retained total any further.
    if (size + (resetState?.size ?? 0) > maxHistoryBytes)
      throw new RangeError('UVM document exceeds maxHistoryBytes')
    undo.push(before)
    redo.length = 0
    current = { id: nextStateId++, container: candidate, size }
    revision++
    prune()
    return status()
  }
  return Object.freeze({
    status,
    snapshot: () => {
      checkAlive()
      return ownView(currentState().container)
    },
    apply: (edit: UvmDocumentEdit) => {
      const expected = edit.expectedRevision
      const before = checkRevision(expected)
      const json = edit.json ?? []
      const binary = edit.binary ?? []
      if (json.length + binary.length > maxEdits)
        throw new RangeError('UVM edit batch exceeds maxEdits')
      if (json.length + binary.length === 0) return status()
      let document = before.container.document
      for (const change of json) {
        checkAlive()
        // Snapshot every edit value before constructing a candidate, including caller-owned arrays.
        const owned = snapshotJson(
          change,
          {
            maxDepth: budget.maxDepth + 2,
            maxNodes: budget.maxNodes,
            maxBytes: budget.maxJsonBytes,
          },
          signal,
        ) as unknown as UvmJsonEdit
        document = snapshotJson(
          applyUvmJsonEdit(document, owned, budget.maxDepth),
          { maxDepth: budget.maxDepth, maxNodes: budget.maxNodes, maxBytes: budget.maxJsonBytes },
          signal,
        ) as JsonObject
      }
      const ranges = binary
        .map(change => {
          const start = change.byteOffset
          const end = start + change.bytes.byteLength
          if (
            !Number.isSafeInteger(start) ||
            start < 0 ||
            !Number.isSafeInteger(end) ||
            end > before.container.binary.length
          )
            throw new RangeError('UVM binary edit exceeds the BIN chunk')
          return { start, end, bytes: change.bytes }
        })
        .sort((a, b) => a.start - b.start)
      let previousEnd = 0
      for (const range of ranges) {
        if (range.start < previousEnd) throw new TypeError('overlapping UVM binary edits')
        previousEnd = range.end
      }
      const nextBinary = ranges.length
        ? Uint8Array.from(before.container.binary)
        : before.container.binary
      for (const range of ranges) nextBinary.set(range.bytes, range.start)
      const candidate = Object.freeze({ ...before.container, document, binary: nextBinary })
      return commit(before, expected, candidate)
    },
    replace: (replacement: UvmDocumentReplacement) => {
      const expected = replacement.expectedRevision
      const before = checkRevision(expected)
      // The existing container reader/writer owns JSON, appended binary and opaque chunks alike.
      const candidate = readUvmContainer(
        writeUvmContainer(replacement.container, budget, signal),
        budget,
        signal,
      )
      return commit(before, expected, candidate)
    },
    undo: (expected: number) => {
      const before = checkRevision(expected)
      const previous = undo.pop()
      if (previous === undefined) return status()
      redo.push(before)
      current = previous
      revision++
      return status()
    },
    redo: (expected: number) => {
      const before = checkRevision(expected)
      const next = redo.pop()
      if (next === undefined) return status()
      undo.push(before)
      current = next
      revision++
      return status()
    },
    reset: (expected: number) => {
      const before = checkRevision(expected)
      if (resetState === undefined) throw new TypeError('UVM document reset was not enabled')
      if (before === resetState && undo.length === 0 && redo.length === 0) return status()
      current = resetState
      undo.length = 0
      redo.length = 0
      revision++
      return status()
    },
    serialize: (expected: number) => {
      const state = checkRevision(expected)
      return state.originalBytes
        ? Uint8Array.from(state.originalBytes)
        : writeUvmContainer(state.container, budget, signal)
    },
    dispose: () => {
      disposed = true
      current = undefined
      resetState = undefined
      undo.length = 0
      redo.length = 0
    },
  })
}
