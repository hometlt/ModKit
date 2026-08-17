/**
 * Editor ports that actually write to disk.
 *
 * The gallery's ports log each step and stop there, because it has no backing store. This host has
 * one, so `commit` is where the propose → plan → prepare → authorize → commit chain stops being a
 * rehearsal: the bytes go through the broker to the main process, which writes them atomically
 * inside a granted root.
 *
 * The renderer never touches a file. It hands bytes to a channel; confinement, the temporary file
 * and the rename all live in main, where the grants are.
 */
import type { ExplorerEntry } from '@modkitx-x3/ui'

export interface WriteBroker {
  request(channel: string, payload: unknown): Promise<unknown>
}

export type EditorPortLog = (line: string) => void

/** Serialised text or raw bytes, depending on which stage produced the edit. */
function bytesOf(edits: readonly unknown[], fallback: Uint8Array): Uint8Array {
  const encoder = new TextEncoder()
  for (const edit of edits) {
    const payload = (edit as { payload?: { kind?: string; text?: string; bytes?: Uint8Array } })
      .payload
    if (payload === undefined) continue
    if (payload.kind === 'text' && typeof payload.text === 'string') {
      return encoder.encode(payload.text)
    }
    if (payload.bytes instanceof Uint8Array) return payload.bytes
  }
  return fallback
}

export interface EditorPorts {
  /** Commit whatever is pending, if anything. Used by "save before closing". */
  save(): Promise<void>
  readonly session: unknown
  readonly commit: unknown
  readonly payloads: unknown
  readonly authorization: unknown
}

/**
 * Build the four ports a `ViewerModule`-hosted editor expects.
 *
 * `authorization` grants unconditionally here: the user already chose this folder in a dialog, and
 * a second prompt on every save would be noise. A host with a stricter policy replaces this port
 * without touching the editor.
 */
export function createFileEditorPorts(
  broker: WriteBroker,
  entry: ExplorerEntry,
  original: Uint8Array,
  log: EditorPortLog,
  /** Reports unsaved state so the host can mark the tab and guard closing. */
  onDirty?: (dirty: boolean) => void,
): EditorPorts {
  const revision = `content-length:${original.length}`
  let pending: Uint8Array | undefined

  const session = {
    revision,
    targets: [],
    state() {
      return { kind: pending === undefined ? 'clean' : 'dirty' }
    },
    async propose(change: { edits?: readonly unknown[] }) {
      /*
       * Proposing a change means one exists, so this is where the file becomes dirty. Waiting for
       * `plan` would leave a byte edited in the grid while the tab still looked saved.
       */
      pending = bytesOf(change.edits ?? [], pending ?? original)
      onDirty?.(true)
      // Nothing to reject: the host writes whole files, so any byte sequence is a valid edit.
      return { state: 'valid', diagnostics: [] }
    },
    async plan(change: { edits?: readonly unknown[] }) {
      pending = bytesOf(change.edits ?? [], original)
      onDirty?.(true)
      return {
        baseRevisions: { content: revision },
        edits: change.edits ?? [],
        provenance: { origin: 'modkit-desktop' },
      }
    },
    async dispose() {
      pending = undefined
      onDirty?.(false)
    },
  }

  const commit = {
    async prepare(plan: { edits?: readonly unknown[] }) {
      pending = bytesOf(plan.edits ?? [], pending ?? original)
      return { state: 'prepared', prepared: { plan }, diagnostics: [] }
    },
    async commit() {
      if (pending === undefined) {
        log('nothing to save')
        return { state: 'committed', revision }
      }
      const result = (await broker.request('filesystem.write-file', {
        path: entry.id,
        bytes: pending,
      })) as { path: string; bytes: number }
      log(`saved ${result.bytes} bytes to ${result.path}`)
      pending = undefined
      onDirty?.(false)
      return { state: 'committed', revision: `content-length:${result.bytes}` }
    },
  }

  const payloads = {
    async open() {
      return {
        value: original,
        async release() {
          // The buffer is owned by the caller that read the file; nothing to free here.
        },
      }
    },
  }

  const authorization = {
    async request() {
      return { grant: { id: 'desktop-user', scope: 'file' } }
    },
  }

  return {
    session,
    commit,
    payloads,
    authorization,
    async save() {
      await commit.commit()
    },
  }
}
