/**
 * Explorer — tree on the left, preview on the right, drag-and-drop anywhere.
 *
 * One component for every host. It never asks which application it is running in: the host hands it
 * a `FileAccess` (list a folder, read a file) and a `PreviewResolver` (turn bytes into a view), and
 * those are the only capabilities it uses. That is doc 19 §4 in practice — Electron supplies access
 * through its broker, the web app through File System Access handles, VS Code through workspace fs,
 * and none of them needs a different explorer.
 *
 * The component owns no filesystem code and no codec code. It owns layout, selection, the drop
 * target and the failure states.
 */
import { createFileTree, type FileTree, type FileTreeNode } from '../primitives/file-tree.js'
import { createSearchField } from '../primitives/search-field.js'
import { matches, type CompiledSearch } from '../search/matcher.js'
import { element, setPart, setState, safeViewerText } from '../viewer/index.js'

/** One item in a browsed folder. `id` is opaque — a path, a handle key, whatever the host uses. */
export interface ExplorerEntry {
  readonly id: string
  readonly name: string
  readonly directory: boolean
  readonly size?: number
}

/** The host's file capability. Absent means no folder is open yet. */
export interface FileAccess {
  /** Shown as the tree's root label. */
  readonly label: string
  /** `undefined` lists the root. */
  list(entryId: string | undefined, signal?: AbortSignal): Promise<readonly ExplorerEntry[]>
  read(entryId: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array>
}

/** One rendering of an opened file. The explorer draws the picker; the resolver owns the stages. */
export interface PreviewView {
  readonly id: string
  readonly label: string
}

export interface PreviewHandle {
  /** Views this file can be shown as, in preferred order. */
  readonly views: readonly PreviewView[]
  readonly activeView: string
  show(viewId: string): Promise<void>
  /** Called before the next preview mounts. */
  unmount(): void | Promise<void>
}

export interface PreviewResolver {
  /**
   * Mount a preview for these bytes, or return `undefined` when no codec claims the name — the
   * explorer then shows an honest "no codec" state instead of a broken viewer.
   */
  open(
    container: HTMLElement,
    entry: ExplorerEntry,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<PreviewHandle | undefined>
  /** Extensions this host can preview, lowercase and without the dot. Used for the empty state. */
  readonly supported: readonly string[]
}

export interface ExplorerOptions {
  readonly preview: PreviewResolver
  /** Largest file the host will read into memory for a preview. */
  readonly maximumBytes?: number
  /** Invoked by the "Open folder" action. Return `undefined` when the user cancels. */
  openFolder?(): Promise<FileAccess | undefined>
  /** Invoked by the "Open file" action. */
  openFile?(): Promise<{ readonly access: FileAccess; readonly entry: ExplorerEntry } | undefined>
  /** Handle a native drop. Return the access plus what to show first. */
  acceptDrop?(
    transfer: DataTransfer,
    signal?: AbortSignal,
  ): Promise<{ readonly access?: FileAccess; readonly entry?: ExplorerEntry } | undefined>
  /** Offered as an action only when the host can actually register file associations. */
  registerFileTypes?(): Promise<string>
  /**
   * Hide the built-in toolbar. A desktop host with a native menu turns this off rather than
   * showing the same commands twice.
   */
  readonly showToolbar?: boolean
  /**
   * Take over opening. When present the explorer browses but does not preview: the host routes the
   * entry to its own editor area, which is what lets tabs and split groups exist above the tree.
   */
  onOpen?(entry: ExplorerEntry): void
  /**
   * Element that accepts drops. Defaults to the preview pane, or to the explorer root when this
   * host took over opening — because such a host has replaced the pane and drops on it never fire.
   */
  readonly dropTarget?: unknown
}

export interface Explorer {
  readonly root: HTMLElement
  setAccess(access: FileAccess): Promise<void>
  open(entry: ExplorerEntry): Promise<void>
  destroy(): void
}

export const EXPLORER_MAXIMUM_BYTES = 64 * 1024 * 1024

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function createExplorer(document: Document, options: ExplorerOptions): Explorer {
  const maximumBytes = options.maximumBytes ?? EXPLORER_MAXIMUM_BYTES
  const supported = new Set(options.preview.supported.map(item => item.toLowerCase()))

  const root = document.createElement('div')
  root.className = 'modkit-viewer modkit-explorer'
  setPart(root, 'explorer')

  const toolbar = element(root, 'div', { part: 'explorer.toolbar', role: 'toolbar' })
  toolbar.setAttribute('aria-label', 'Explorer actions')
  if (options.showToolbar === false) toolbar.hidden = true

  const sidebar = element(root, 'div', { part: 'explorer.sidebar' })
  const previewPane = element(root, 'div', { part: 'explorer.preview' })
  const previewHeader = element(previewPane, 'div', { part: 'explorer.header' })
  const breadcrumb = element(previewHeader, 'div', { part: 'explorer.breadcrumb' })
  const viewPicker = element(previewHeader, 'select', {
    part: 'explorer.viewpicker',
  }) as HTMLSelectElement
  viewPicker.setAttribute('aria-label', 'Preview view')
  previewHeader.hidden = true
  const stage = element(previewPane, 'div', { part: 'explorer.stage' })
  const status = element(root, 'output', { part: 'explorer.status' })

  let access: FileAccess | undefined
  let tree: FileTree | undefined
  let query: CompiledSearch | undefined
  let mounted: PreviewHandle | undefined
  /** Aborts the in-flight preview so a fast double-click cannot mount two stages. */
  let previewRun: AbortController | undefined
  let destroyed = false

  const say = (message: string, state: 'error' | 'loading' | undefined = undefined): void => {
    status.textContent = message
    setState(status, state === undefined ? [] : [state])
  }

  const placeholder = (message: string): void => {
    stage.replaceChildren()
    element(stage, 'p', { part: 'explorer.placeholder', text: message })
  }

  // ------------------------------------------------------------------ actions
  const action = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const node = element(toolbar, 'button', {
      part: 'explorer.action',
      text: label,
    }) as HTMLButtonElement
    node.type = 'button'
    node.title = title
    node.addEventListener('click', run)
    return node
  }

  if (options.openFolder !== undefined) {
    action('Open folder…', 'Grant access to a folder and browse it', () => {
      void (async () => {
        try {
          const next = await options.openFolder?.()
          if (next !== undefined) await explorer.setAccess(next)
        } catch (error) {
          say(`Could not open the folder: ${describe(error)}`, 'error')
        }
      })()
    })
  }

  if (options.openFile !== undefined) {
    action('Open file…', 'Open a single file for preview', () => {
      void (async () => {
        try {
          const picked = await options.openFile?.()
          if (picked === undefined) return
          await explorer.setAccess(picked.access)
          await activate(picked.entry)
        } catch (error) {
          say(`Could not open the file: ${describe(error)}`, 'error')
        }
      })()
    })
  }

  const registerFileTypes = options.registerFileTypes
  if (registerFileTypes !== undefined) {
    action('Set as default app…', 'Register this app for the file types it can preview', () => {
      void (async () => {
        try {
          say(await registerFileTypes())
        } catch (error) {
          say(`Could not register file types: ${describe(error)}`, 'error')
        }
      })()
    })
  }

  // ------------------------------------------------------------------ search
  const search = createSearchField(document, {
    label: 'Filter files',
    placeholder: 'Filter',
    onChange(state) {
      // The field compiles the query itself, including the whole-word and regexp toggles.
      query = state.query === '' ? undefined : state.compiled
      tree?.applyFilter()
    },
  })
  sidebar.append(search.root)

  // ------------------------------------------------------------------ preview
  async function unmountPrevious(): Promise<void> {
    previewRun?.abort()
    previewRun = undefined
    if (mounted === undefined) return
    const previous = mounted
    mounted = undefined
    await previous.unmount()
    previewHeader.hidden = true
    breadcrumb.textContent = ''
    viewPicker.replaceChildren()
  }

  viewPicker.addEventListener('change', () => {
    const current = mounted
    if (current === undefined) return
    const selected = viewPicker.value
    say(`Opening ${breadcrumb.textContent ?? 'view'}…`, 'loading')
    void current
      .show(selected)
      .then(() => {
        if (mounted === current) say(`${breadcrumb.textContent ?? ''} · ${selected}`)
      })
      .catch(error => {
        if (mounted === current) say(`Could not change view: ${describe(error)}`, 'error')
      })
  })

  async function preview(entry: ExplorerEntry): Promise<void> {
    if (access === undefined) return
    await unmountPrevious()
    stage.replaceChildren()

    if (entry.size !== undefined && entry.size > maximumBytes) {
      placeholder(
        `${entry.name} is ${formatBytes(entry.size)}, over the ${formatBytes(maximumBytes)} preview limit.`,
      )
      say(`${entry.name} — too large`, 'error')
      return
    }

    const run = new AbortController()
    previewRun = run
    say(`Opening ${entry.name}…`, 'loading')
    try {
      const bytes = await access.read(entry.id, maximumBytes, run.signal)
      if (run.signal.aborted) return
      const handle = await options.preview.open(stage, entry, bytes, run.signal)
      if (run.signal.aborted) {
        await handle?.unmount()
        return
      }
      if (handle === undefined) {
        placeholder(
          `Nothing could render “${entry.name}”. The host publishes no codec for it and no ` +
            'built-in text or hex viewer was configured.',
        )
        say(`${entry.name} — no viewer`)
        return
      }
      mounted = handle
      breadcrumb.textContent = safeViewerText(entry.name, 300)
      viewPicker.replaceChildren(
        ...handle.views.map(view => {
          const option = document.createElement('option')
          option.value = view.id
          option.textContent = view.label
          return option
        }),
      )
      viewPicker.value = handle.activeView
      viewPicker.hidden = handle.views.length <= 1
      previewHeader.hidden = false
      say(`${entry.name} · ${formatBytes(bytes.length)}`)
    } catch (error) {
      if (run.signal.aborted) return
      placeholder(`Could not preview ${entry.name}: ${describe(error)}`)
      say(`${entry.name} — failed`, 'error')
    } finally {
      if (previewRun === run) previewRun = undefined
    }
  }

  // ------------------------------------------------------------------ tree
  async function buildTree(): Promise<void> {
    tree?.destroy()
    if (access === undefined) return
    const current = access
    tree = createFileTree(document, {
      label: current.label,
      async loadChildren(node, signal) {
        const entries = await current.list(node?.id, signal)
        return [...entries]
          .sort((a, b) =>
            a.directory === b.directory ? a.name.localeCompare(b.name) : a.directory ? -1 : 1,
          )
          .map(entry => ({
            id: entry.id,
            label: entry.name,
            hasChildren: entry.directory,
            // No arrow here: the tree draws its own twisty for `hasChildren`, and a second
            // chevron in the icon slot reads as two arrows on every folder.
            icon: entry.directory ? '🗀' : supported.has(extensionOf(entry.name)) ? '◆' : '·',
            ...(entry.size === undefined || entry.directory
              ? {}
              : { badge: formatBytes(entry.size), size: entry.size }),
            kind: entry.directory ? 'directory' : extensionOf(entry.name),
          }))
      },
      onActivate(node) {
        if (node.kind === 'directory') return
        void activate(nodeToEntry(node))
      },
      matches(node) {
        return query === undefined ? true : matches(node.label, query)
      },
    })
    sidebar.append(tree.root)
    await tree.refresh()
  }

  const nodeToEntry = (node: FileTreeNode): ExplorerEntry => ({
    id: node.id,
    name: node.label,
    directory: node.kind === 'directory',
    ...(node.size === undefined ? {} : { size: node.size }),
  })

  /**
   * Open an entry the way this host asked for.
   *
   * Every path that opens a file goes through here — the tree, the file picker, a drop. It used to
   * be only the tree: the picker and the drop called `explorer.open`, which previews into
   * `explorer.preview`, the one element a host with its own editor area replaces. Those two paths
   * therefore mounted into a detached node and appeared to do nothing.
   */
  const activate = async (entry: ExplorerEntry): Promise<void> => {
    if (options.onOpen !== undefined) options.onOpen(entry)
    else await preview(entry)
  }

  // ------------------------------------------------------------------ drop
  if (options.acceptDrop !== undefined) {
    /*
     * The preview pane is the natural target for a host that uses the built-in preview. A host that
     * replaced it (an editor area of its own) has removed this element from the document, so drops
     * on it never fire — hence `dropTarget`, and the root as the default in that case.
     */
    const dropZone =
      (options.dropTarget as HTMLElement | undefined) ??
      (options.onOpen === undefined ? previewPane : root)
    setPart(previewPane, 'explorer.preview')
    const stop = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    dropZone.addEventListener('dragover', event => {
      stop(event)
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
      setState(dropZone, ['drop-target'])
    })
    dropZone.addEventListener('dragleave', event => {
      stop(event)
      setState(dropZone, [])
    })
    dropZone.addEventListener('drop', event => {
      stop(event)
      setState(dropZone, [])
      const transfer = event.dataTransfer
      if (transfer === null) return
      void (async () => {
        try {
          say('Reading dropped item…', 'loading')
          const result = await options.acceptDrop?.(transfer)
          if (result === undefined) {
            say('The dropped item could not be read.', 'error')
            return
          }
          if (result.access !== undefined) await explorer.setAccess(result.access)
          if (result.entry !== undefined) await activate(result.entry)
          else say('Folder opened. Pick a file in the tree.')
        } catch (error) {
          say(`Drop failed: ${describe(error)}`, 'error')
        }
      })()
    })
  }

  placeholder(
    options.openFolder === undefined
      ? 'Drop a file here to preview it.'
      : 'Open a folder, or drop a file here to preview it.',
  )
  say('Ready')

  const explorer: Explorer = {
    root,

    async setAccess(next) {
      access = next
      await buildTree()
      // No "Browsing …" line: the footer's job is the active file, and the root is already the
      // tree's own label right above it.
      say('')
    },

    async open(entry) {
      if (access === undefined) throw new TypeError('no file access is configured')
      await preview(entry)
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      void unmountPrevious()
      tree?.destroy()
      search.destroy()
      root.remove()
    },
  }

  return explorer
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  createCodecPreview,
  type CodecPreviewOptions,
  type PreviewSession,
  type PreviewStage,
} from './preview.js'
export {
  createEditorArea,
  type EditorArea,
  type EditorAreaOptions,
  type EditorStatus,
} from './editors.js'
