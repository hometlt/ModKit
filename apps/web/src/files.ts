/**
 * The browser's file capability, in the shape the explorer asks for.
 *
 * `@modkit/ui`'s `createExplorer` takes a `FileAccess` — list a folder, read a file — and
 * nothing else. This module is the browser implementation of exactly that: the File System Access
 * API when the page has it, a single picked `File` when it does not, and an honest report of which
 * of the two the user is getting.
 *
 * It also answers the two questions the editing arm (`./editing.js`) asks about an entry, because
 * they are questions about the *handle* and this module is what holds handles:
 *
 *  - `handleOf(entryId)` — the handle behind an entry, if this access has one. A file that arrived
 *    through a plain `<input type="file">`, a drop or a same-origin fetch has none, and no amount
 *    of wishing turns it into something that can be written back.
 *  - `snapshotOf(entryId)` — the file's `size`/`lastModified` as they are *now*, which is what the
 *    source revision is keyed on. Read fresh from the handle, never from the listing: a stale pair
 *    would let a save overwrite a file that changed under the tab.
 *
 * Every platform shape is declared structurally rather than imported from `lib.dom`, so the whole
 * module is unit-tested in Node against fakes and runs unchanged in the page. Nothing here reads
 * bytes eagerly: the explorer decides when to read and how much.
 */
import type { ExplorerEntry, FileAccess } from '@modkit/ui/explorer'

// ---------------------------------------------------------------------------------------------
// structural platform shapes

export interface WebBlobSlice {
  arrayBuffer(): Promise<ArrayBuffer>
}

/** A `File` as this module uses it. `lastModified` is part of the source's revision identity. */
export interface WebFileLike {
  readonly name: string
  readonly size: number
  readonly lastModified: number
  slice(start: number, end: number): WebBlobSlice
}

/** What a page may ask a handle for. Reading is granted on pick; writing has to be asked for. */
export type WebPermissionMode = 'read' | 'readwrite'

/** The three answers the File System Access permission surface gives. */
export type WebPermissionState = 'granted' | 'denied' | 'prompt'

/**
 * The permission surface a File System Access handle carries.
 *
 * Both methods are optional because both are absent in a browser that has no File System Access at
 * all — and a host that assumes they are there turns "this browser cannot" into a `TypeError`.
 * `requestPermission` may only be called from a user gesture; `queryPermission` never prompts.
 */
export interface WebPermissionHandleLike {
  queryPermission?(descriptor: { readonly mode: WebPermissionMode }): Promise<WebPermissionState>
  requestPermission?(descriptor: { readonly mode: WebPermissionMode }): Promise<WebPermissionState>
}

/** The writable stream `createWritable()` returns: a swap file that replaces the target on close. */
export interface WebWritableStreamLike {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort?(reason?: string): Promise<void>
}

export interface WebFileHandleLike extends WebPermissionHandleLike {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<WebFileLike>
  /**
   * Present only on a real File System Access handle. Its presence is exactly what separates a
   * file this page can save in place from one it can only look at, so the editing arm tests for
   * it rather than for the name of the browser.
   */
  createWritable?(options?: { readonly keepExistingData?: boolean }): Promise<WebWritableStreamLike>
}

/** A file handle that carries the write path. Narrowed from `WebFileHandleLike` by `isWritable`. */
export interface WebWritableFileHandleLike extends WebFileHandleLike {
  createWritable(options?: { readonly keepExistingData?: boolean }): Promise<WebWritableStreamLike>
}

export interface WebDirectoryHandleLike extends WebPermissionHandleLike {
  readonly kind: 'directory'
  readonly name: string
  /** The FSA iteration surface. Chromium ships both; a host only needs one of them. */
  entries?: () => AsyncIterable<readonly [string, WebFileSystemHandleLike]>
  values?: () => AsyncIterable<WebFileSystemHandleLike>
}

export type WebFileSystemHandleLike = WebFileHandleLike | WebDirectoryHandleLike

/** True when this handle offers the write path a save needs. */
export function isWritableHandle(
  handle: WebFileHandleLike | undefined,
): handle is WebWritableFileHandleLike {
  return handle !== undefined && typeof handle.createWritable === 'function'
}

/** Size and modification time as the file is right now — the pair a source revision is keyed on. */
export interface WebFileSnapshot {
  readonly size: number
  readonly lastModified: number
}

/**
 * How many children one folder contributes to the tree.
 *
 * A granted folder can be a whole drive. Listing it entry by entry would stat tens of thousands of
 * files before the first row appears, so the listing stops at this bound and says so through
 * `onNotice` rather than freezing the page or silently showing a partial folder as if it were whole.
 */
export const MAXIMUM_DIRECTORY_ENTRIES = 2000

export interface DirectoryAccessOptions {
  /** Reported when a listing was cut short, or a child could not be read. Never thrown away. */
  onNotice?(message: string): void
}

// ---------------------------------------------------------------------------------------------
// capability report

export interface FileCapabilityReport {
  /** `showDirectoryPicker` — a browsable folder tree. */
  readonly directories: boolean
  /** `showOpenFilePicker` — a single file with a handle. */
  readonly filePicker: boolean
  /** The `<input type="file">` floor, which every browser has. */
  readonly inputFallback: boolean
  /** One sentence for the UI. Says what this browser can do, not what the app wishes it could. */
  readonly notice: string
}

/** What this page can actually open, probed without asking for a permission prompt. */
export function describeFileCapability(scope: unknown): FileCapabilityReport {
  const pickers = scope as {
    readonly showDirectoryPicker?: unknown
    readonly showOpenFilePicker?: unknown
  }
  const directories = typeof pickers.showDirectoryPicker === 'function'
  const filePicker = typeof pickers.showOpenFilePicker === 'function'
  const notice = directories
    ? 'This browser grants folder access: pick a folder and the tree browses it in place.'
    : filePicker
      ? 'This browser has no folder picker, only a file picker: one file opens at a time and there ' +
        'is no tree to browse.'
      : 'This browser has neither picker, so files arrive through a plain file input: one file ' +
        'opens at a time and there is no tree to browse.'
  return Object.freeze({ directories, filePicker, inputFallback: true, notice })
}

// ---------------------------------------------------------------------------------------------
// helpers

const joinPath = (parent: string, name: string): string =>
  parent === '' ? name : `${parent}/${name}`

/**
 * Children of one directory handle, over whichever iteration surface the handle exposes.
 *
 * Exported because `./extension-roots.ts` walks a granted folder for a different reason (reading
 * an extension, not browsing it) and must not disagree with the explorer about what a folder
 * contains or which browsers it can read.
 */
export async function* iterateDirectoryChildren(
  directory: WebDirectoryHandleLike,
): AsyncIterable<WebFileSystemHandleLike> {
  const entries = directory.entries
  if (entries !== undefined) {
    for await (const pair of entries.call(directory)) yield pair[1]
    return
  }
  const values = directory.values
  if (values === undefined) {
    throw new TypeError('directory handle exposes neither entries() nor values()')
  }
  for await (const handle of values.call(directory)) yield handle
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// ---------------------------------------------------------------------------------------------
// folder access

/**
 * A `FileAccess` that can still answer "how big is it?" after the listing.
 *
 * The explorer's tree rebuilds an `ExplorerEntry` from its own node when a file is activated, and
 * that rebuilt entry has no `size` — so a host that wants to refuse an over-large file before
 * reading it has to ask the access, not the entry.
 */
export interface WebFileAccess extends FileAccess {
  /** Size this access observed while listing, or `undefined` if it never could read one. */
  sizeOf(entryId: string): number | undefined
  /**
   * The handle behind an entry, when this access has one.
   *
   * `undefined` is the honest answer for a file that arrived through a plain file input, a drop or
   * a fetch: there is nothing to write back to, and the editing arm must offer no editor for it.
   */
  handleOf(entryId: string): WebFileHandleLike | undefined
  /** `size`/`lastModified` read from the handle now, not from the listing. */
  snapshotOf(entryId: string, signal?: AbortSignal): Promise<WebFileSnapshot | undefined>
  /**
   * The handle whose `readwrite` permission covers this access — the granted folder, or the one
   * picked file. Absent when nothing here could ever be written.
   */
  readonly writeGrant?: WebPermissionHandleLike
}

/**
 * Browse a granted directory handle.
 *
 * Entry ids are paths relative to the granted root (`assets/icons/logo.png`), which makes them
 * stable, readable in a breadcrumb, and impossible to point outside the grant: a path is only ever
 * resolved through a handle this access has already listed, never by re-parsing user input.
 */
export function createDirectoryAccess(
  root: WebDirectoryHandleLike,
  options: DirectoryAccessOptions = {},
): WebFileAccess {
  const directories = new Map<string, WebDirectoryHandleLike>([['', root]])
  const files = new Map<string, WebFileHandleLike>()
  const sizes = new Map<string, number>()

  const requireDirectory = (entryId: string | undefined): WebDirectoryHandleLike => {
    const found = directories.get(entryId ?? '')
    if (found === undefined) {
      throw new TypeError(`«${entryId ?? ''}» is not a folder this session has browsed`)
    }
    return found
  }

  return {
    label: root.name === '' ? 'Granted folder' : root.name,
    /*
     * One `readwrite` grant covers the whole tree: the user picked this folder, so asking again per
     * file would be a prompt storm for a permission the browser already scopes to the directory.
     */
    writeGrant: root,

    async list(entryId, signal) {
      signal?.throwIfAborted()
      const directory = requireDirectory(entryId)
      const prefix = entryId ?? ''
      const listed: ExplorerEntry[] = []
      let truncated = false
      for await (const handle of iterateDirectoryChildren(directory)) {
        signal?.throwIfAborted()
        if (listed.length >= MAXIMUM_DIRECTORY_ENTRIES) {
          truncated = true
          break
        }
        const path = joinPath(prefix, handle.name)
        if (handle.kind === 'directory') {
          directories.set(path, handle)
          listed.push({ id: path, name: handle.name, directory: true })
          continue
        }
        files.set(path, handle)
        /*
         * The size comes from the handle's own snapshot. It costs one `getFile()` per file, and it
         * is what lets the explorer refuse a file over the preview limit *before* reading it — the
         * cheaper alternative is to omit the size, which turns that limit into a surprise.
         */
        try {
          const file = await handle.getFile()
          sizes.set(path, file.size)
          listed.push({ id: path, name: handle.name, directory: false, size: file.size })
        } catch (error) {
          options.onNotice?.(`${path} could not be read: ${describe(error)}`)
          listed.push({ id: path, name: handle.name, directory: false })
        }
      }
      if (truncated) {
        options.onNotice?.(
          `${prefix === '' ? root.name : prefix} has more than ${MAXIMUM_DIRECTORY_ENTRIES} ` +
            'entries; the tree shows the first ones only.',
        )
      }
      return listed
    },

    sizeOf(entryId) {
      return sizes.get(entryId)
    },

    handleOf(entryId) {
      return files.get(entryId)
    },

    async snapshotOf(entryId, signal) {
      signal?.throwIfAborted()
      const handle = files.get(entryId)
      if (handle === undefined) return undefined
      const file = await handle.getFile()
      return { size: file.size, lastModified: file.lastModified }
    },

    async read(entryId, maxBytes, signal) {
      signal?.throwIfAborted()
      const handle = files.get(entryId)
      if (handle === undefined) {
        throw new TypeError(`«${entryId}» is not a file this session has browsed`)
      }
      const file = await handle.getFile()
      const length = Math.min(file.size, maxBytes)
      return new Uint8Array(await file.slice(0, length).arrayBuffer())
    },
  }
}

// ---------------------------------------------------------------------------------------------
// single-file access

export interface SingleFileAccess {
  readonly access: WebFileAccess
  readonly entry: ExplorerEntry
}

/**
 * One picked file as a one-entry folder.
 *
 * The fallback path — a file picker without directory access, or a plain `<input type="file">` —
 * still produces a real `FileAccess`, so the explorer, the tabs and every stage behave exactly as
 * they do over a granted folder. Only the tree is shorter.
 *
 * `handle` is what separates the two ways one file arrives. `showOpenFilePicker` yields a handle
 * and the file can be saved in place; an `<input type="file">`, a drop and a same-origin fetch
 * yield a `File` and nothing else, and that file can never be written back from this page. The
 * distinction is carried in the data rather than guessed at later.
 */
export function createSingleFileAccess(
  file: WebFileLike,
  handle?: WebFileHandleLike,
): SingleFileAccess {
  const entry: ExplorerEntry = { id: file.name, name: file.name, directory: false, size: file.size }
  const access: WebFileAccess = {
    label: file.name,
    ...(handle === undefined ? {} : { writeGrant: handle }),
    async list(entryId, signal) {
      signal?.throwIfAborted()
      return entryId === undefined ? [entry] : []
    },
    sizeOf(entryId) {
      return entryId === entry.id ? file.size : undefined
    },
    handleOf(entryId) {
      return entryId === entry.id ? handle : undefined
    },
    async snapshotOf(entryId, signal) {
      signal?.throwIfAborted()
      if (entryId !== entry.id) return undefined
      // The handle's own snapshot, not the `File` this access was built from: the picked file may
      // be minutes old by the time a save is attempted, and the revision has to be current.
      const current = handle === undefined ? file : await handle.getFile()
      return { size: current.size, lastModified: current.lastModified }
    },
    async read(entryId, maxBytes, signal) {
      signal?.throwIfAborted()
      if (entryId !== entry.id) throw new TypeError(`«${entryId}» is not the opened file`)
      // Through the handle when there is one, so the bytes a tab holds and the revision it pins
      // describe the same moment; a picked `File` alone is a snapshot that never refreshes.
      const current = handle === undefined ? file : await handle.getFile()
      const length = Math.min(current.size, maxBytes)
      return new Uint8Array(await current.slice(0, length).arrayBuffer())
    },
  }
  return { access, entry }
}
