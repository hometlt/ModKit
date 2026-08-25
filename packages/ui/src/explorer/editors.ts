/**
 * Editor area — VS Code's tabs and split groups, over any `PreviewResolver`.
 *
 * A group is a column with its own tab strip, breadcrumb and view picker. Splitting adds a group
 * beside the current one, so two files — or two views of the same file — sit side by side. Opening a
 * file targets the focused group, which is what makes "split, then click another file" behave the
 * way it does in an editor.
 *
 * Deliberately separate from the tree: the explorer owns browsing, this owns what is open. Hosts
 * that only need a single pane never construct it, and hosts that need tabs get them without the
 * tree component growing a second responsibility.
 *
 * Nothing here knows about codecs or filesystems. It asks a `PreviewResolver` to turn bytes into
 * views and a reader callback to produce the bytes, which is why the same area serves Electron's
 * broker, the web app's file handles and VS Code's workspace fs.
 */
import { setToken } from '../tokens/index.js'

/** Lowercase extension without the dot (`'png'`), or `'file'` when there is none. */
export function fileKindOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'file'
  const kind = name.slice(dot + 1).toLowerCase()
  return /^[a-z0-9_-]{1,16}$/u.test(kind) ? kind : 'file'
}
import { element, setPart, setState, safeViewerText } from '../viewer/index.js'
import { requestEditorSave } from '../editor/commands.js'
import type { ExplorerEntry, PreviewHandle, PreviewResolver } from './index.js'

export interface EditorAreaOptions {
  readonly preview: PreviewResolver
  /** Produce the bytes for an entry. The host owns caching and limits. */
  read(entry: ExplorerEntry, signal?: AbortSignal): Promise<Uint8Array>
  /** Reports the focused tab so a host can drive its own status bar. */
  onStatus?(status: EditorStatus): void
  /**
   * Asked before a tab with unsaved changes is closed. Resolving `'cancel'` keeps it open.
   * Absent means the host has no way to ask, and closing discards silently — which is why every
   * host that can edit should supply it.
   */
  confirmClose?(entry: ExplorerEntry): Promise<'save' | 'discard' | 'cancel'>
  /** Save the file behind a tab. Required for `confirmClose` to be able to offer "save". */
  save?(entry: ExplorerEntry): Promise<void>
  /**
   * Which pieces of this component's own chrome to draw.
   *
   * A host embedded in an editor that already has tabs and a breadcrumb of its own must not draw a
   * second set — two rows of file tabs for the same file is not a richer UI, it is a component
   * that did not know where it was mounted. Switching them off leaves the working area: the view
   * picker and the stage.
   *
   * Everything defaults to on, so a standalone host keeps the full component it has today.
   */
  readonly chrome?: {
    /** The per-group strip of open-file tabs. */
    readonly tabs?: boolean
    /** The path breadcrumb above the stage. */
    readonly breadcrumb?: boolean
  }
}

export interface EditorStatus {
  readonly path?: string
  readonly view?: string
  readonly detail: string
  readonly severity: 'info' | 'error' | 'busy'
}

export interface EditorArea {
  readonly root: HTMLElement
  /** Mark an open file as having unsaved changes, which shows on its tab. */
  markDirty(entryId: string, dirty: boolean): void
  /** True while any open tab has unsaved changes. */
  hasUnsaved(): boolean
  /** Open (or focus) a file in the currently focused group. */
  open(entry: ExplorerEntry): Promise<void>
  /**
   * Close a file's tab wherever it is open, as its own close control would.
   *
   * Resolves `true` when the tab is gone and `false` when nothing was open for that id or the
   * host's `confirmClose` cancelled — so "reopen this file at its new revision" is one awaited
   * call. Both shipped hosts were synthesising a click on the close button and polling the DOM
   * until the element disappeared, which is a component's internals doing duty as an API.
   */
  close(entryId: string): Promise<boolean>
  /** Save an open tab through its mounted editor, or the host fallback when it has none. */
  save(entryId: string): Promise<boolean>
  /** Add a group beside the focused one and make it the target for the next open. */
  split(): void
  /** Number of groups, for hosts that expose "close split" affordances. */
  readonly groupCount: number
  destroy(): void
}

interface OpenTab {
  readonly entry: ExplorerEntry
  readonly button: HTMLElement
  dirty?: boolean
  readonly content: HTMLElement
  handle?: PreviewHandle
  /** Aborts this tab's in-flight load so a fast switch cannot mount two stages. */
  run?: AbortController
}

interface Group {
  readonly root: HTMLElement
  readonly strip: HTMLElement
  readonly breadcrumb: HTMLElement
  readonly picker: HTMLSelectElement
  readonly stage: HTMLElement
  readonly tabs: OpenTab[]
  active?: OpenTab | undefined
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

export function createEditorArea(document: Document, options: EditorAreaOptions): EditorArea {
  const root = document.createElement('div')
  setPart(root, 'explorer.editors')

  const groups: Group[] = []
  let focused: Group
  let destroyed = false
  // Named `element`, not `node`: the browser-bundle gate greps for the substring `node:`.
  let openMenu: { element: HTMLElement; dismiss: (event: Event) => void } | undefined

  const report = (status: EditorStatus): void => {
    options.onStatus?.(status)
  }

  // ------------------------------------------------------------------ breadcrumb
  function drawBreadcrumb(group: Group, entry: ExplorerEntry | undefined): void {
    group.breadcrumb.replaceChildren()
    if (entry === undefined) return
    // Split on both separators: a host may hand back POSIX or Windows paths.
    const parts = entry.id.split(/[\\/]/u).filter(Boolean)
    // Only the tail is useful; a full absolute path pushes the filename off the row.
    for (const [index, part] of parts.slice(-4).entries()) {
      if (index > 0) element(group.breadcrumb, 'span', { part: 'explorer.crumb', text: '›' })
      element(group.breadcrumb, 'span', {
        part: 'explorer.crumb',
        text: safeViewerText(part, 120),
      })
    }
  }

  function syncPicker(group: Group): void {
    const handle = group.active?.handle
    group.picker.replaceChildren()
    if (handle === undefined || handle.views.length === 0) {
      group.picker.disabled = true
      return
    }
    for (const view of handle.views) {
      const option = document.createElement('option')
      option.value = view.id
      option.textContent = view.label
      group.picker.append(option)
    }
    group.picker.value = handle.activeView
    // One view is not a choice; leaving the control enabled invites a pointless click.
    group.picker.disabled = handle.views.length < 2
  }

  function placeholder(group: Group, message: string): void {
    group.stage.replaceChildren()
    element(group.stage, 'p', { part: 'explorer.placeholder', text: message })
  }

  // ------------------------------------------------------------------ tabs
  async function activate(group: Group, tab: OpenTab): Promise<void> {
    for (const other of group.tabs) {
      const selected = other === tab
      other.button.setAttribute('aria-selected', String(selected))
      setState(other.button, selected ? ['selected'] : [])
      other.content.hidden = !selected
    }
    group.active = tab
    drawBreadcrumb(group, tab.entry)

    if (tab.handle === undefined) {
      await load(group, tab)
      return
    }
    syncPicker(group)
    report({
      path: tab.entry.id,
      view: group.picker.selectedOptions[0]?.textContent ?? '',
      detail: tab.entry.name,
      severity: 'info',
    })
  }

  async function load(group: Group, tab: OpenTab): Promise<void> {
    tab.run?.abort()
    const run = new AbortController()
    tab.run = run
    tab.content.replaceChildren()
    report({ path: tab.entry.id, detail: `Opening ${tab.entry.name}…`, severity: 'busy' })

    try {
      const bytes = await options.read(tab.entry, run.signal)
      if (run.signal.aborted) return
      const handle = await options.preview.open(tab.content, tab.entry, bytes, run.signal)
      if (run.signal.aborted) {
        await handle?.unmount()
        return
      }
      if (handle === undefined) {
        placeholder({ ...group, stage: tab.content }, `Nothing could render “${tab.entry.name}”.`)
        report({ path: tab.entry.id, detail: 'no viewer', severity: 'error' })
        return
      }
      tab.handle = handle
      syncPicker(group)
      report({
        path: tab.entry.id,
        view: handle.views.find(view => view.id === handle.activeView)?.label ?? '',
        detail: formatBytes(bytes.length),
        severity: 'info',
      })
    } catch (error) {
      if (run.signal.aborted) return
      placeholder(
        { ...group, stage: tab.content },
        `Could not preview ${tab.entry.name}: ${describe(error)}`,
      )
      report({ path: tab.entry.id, detail: describe(error), severity: 'error' })
    }
  }

  async function closeTab(group: Group, tab: OpenTab): Promise<void> {
    /*
     * Unsaved work is never discarded without asking. The decision belongs to the host, which owns
     * the dialog and the save path; this component only refuses to proceed on `cancel`.
     */
    if (tab.dirty === true && options.confirmClose !== undefined) {
      const answer = await options.confirmClose(tab.entry)
      if (answer === 'cancel') return
      if (answer === 'save' && !(await saveTab(tab))) return
    }
    tab.run?.abort()
    await tab.handle?.unmount()
    const index = group.tabs.indexOf(tab)
    if (index !== -1) group.tabs.splice(index, 1)
    tab.button.remove()
    tab.content.remove()

    if (group.active === tab) {
      group.active = undefined
      /*
       * No `stage.replaceChildren()` here: every open tab keeps its content element mounted in
       * the stage (hidden when inactive), and clearing the stage would detach them all —
       * `activate(next)` only flips `hidden`, so every surviving tab rendered blank until it was
       * closed and reopened. The closed tab's own element left the tree via `tab.content.remove()`
       * above; the siblings are exactly what must stay.
       */
      const next = group.tabs[Math.max(0, index - 1)]
      if (next !== undefined) {
        await activate(group, next)
      } else {
        drawBreadcrumb(group, undefined)
        syncPicker(group)
        placeholder(group, 'No file open in this group.')
      }
    }

    // An emptied extra group is noise. The first group always stays so the area is never blank.
    if (group.tabs.length === 0 && groups.length > 1 && group !== groups[0]) {
      groups.splice(groups.indexOf(group), 1)
      group.root.remove()
      const first = groups[0]
      if (first !== undefined) focus(first)
    }
  }

  async function saveTab(tab: OpenTab): Promise<boolean> {
    const editorAnswer = await requestEditorSave(tab.content)
    if (editorAnswer !== undefined) return editorAnswer
    if (options.save === undefined) return false
    await options.save(tab.entry)
    return true
  }

  // ------------------------------------------------------------------ tab menu
  /**
   * VS Code's tab context menu. Rendered in-document rather than as a native menu so the same code
   * serves the web and VS Code hosts, where no native menu is available.
   */
  function openTabMenu(group: Group, tab: OpenTab, x: number, y: number): void {
    closeTabMenu()
    const menu = element(root, 'div', { part: 'explorer.tabmenu' })
    menu.setAttribute('role', 'menu')
    // Position is per-instance and pixel-valued, so it goes through registered tokens (C3).
    setToken(menu, 'explorer.menu-x', `${Math.round(x)}px`)
    setToken(menu, 'explorer.menu-y', `${Math.round(y)}px`)

    const item = (label: string, enabled: boolean, run: () => void): void => {
      const node = element(menu, 'button', { part: 'explorer.tabmenu-item', text: label })
      node.setAttribute('type', 'button')
      node.setAttribute('role', 'menuitem')
      if (!enabled) {
        node.setAttribute('disabled', '')
        setState(node, ['disabled'])
        return
      }
      node.addEventListener('click', () => {
        closeTabMenu()
        run()
      })
    }

    const index = group.tabs.indexOf(tab)
    const others = group.tabs.filter(other => other !== tab)
    const toRight = group.tabs.slice(index + 1)

    item('Close', true, () => void closeTab(group, tab))
    item('Close Others', others.length > 0, () => {
      void (async () => {
        for (const other of [...others]) await closeTab(group, other)
      })()
    })
    item('Close to the Right', toRight.length > 0, () => {
      void (async () => {
        for (const other of [...toRight]) await closeTab(group, other)
      })()
    })
    item('Close All', group.tabs.length > 0, () => {
      void (async () => {
        for (const other of [...group.tabs]) await closeTab(group, other)
      })()
    })

    // Dismiss on the next interaction anywhere, the way a context menu is expected to behave.
    const dismiss = (event: Event): void => {
      if (event.target instanceof Node && menu.contains(event.target)) return
      closeTabMenu()
    }
    root.ownerDocument.addEventListener('pointerdown', dismiss, { capture: true })
    root.ownerDocument.addEventListener('keydown', escapeMenu, true)
    openMenu = { element: menu, dismiss }
  }

  function escapeMenu(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeTabMenu()
  }

  function closeTabMenu(): void {
    if (openMenu === undefined) return
    root.ownerDocument.removeEventListener('pointerdown', openMenu.dismiss, { capture: true })
    root.ownerDocument.removeEventListener('keydown', escapeMenu, true)
    openMenu.element.remove()
    openMenu = undefined
  }

  // ------------------------------------------------------------------ groups
  function focus(group: Group): void {
    focused = group
    for (const item of groups) setState(item.root, item === group ? ['active'] : [])
  }

  function createGroup(): Group {
    const groupRoot = element(root, 'div', { part: 'explorer.group' })

    /*
     * A switched-off part is still built, just never attached: the tab bookkeeping below writes
     * into `strip` and `breadcrumb` unconditionally, and making every one of those writes
     * conditional would spread the decision across the whole component. Off-screen elements keep
     * the invariant in one place — the DOM is the only thing that changes.
     */
    const strip = element(groupRoot, 'div', { part: 'explorer.tabstrip', role: 'tablist' })
    strip.setAttribute('aria-label', 'Open files')
    if (options.chrome?.tabs === false) strip.remove()

    const header = element(groupRoot, 'div', { part: 'explorer.header' })
    const breadcrumb = element(header, 'nav', { part: 'explorer.breadcrumb' })
    breadcrumb.setAttribute('aria-label', 'File path')
    if (options.chrome?.breadcrumb === false) breadcrumb.remove()
    const picker = element(header, 'select', { part: 'explorer.viewpicker' }) as HTMLSelectElement
    picker.setAttribute('aria-label', 'View')
    picker.disabled = true

    const stage = element(groupRoot, 'div', { part: 'explorer.stage' })

    const group: Group = { root: groupRoot, strip, breadcrumb, picker, stage, tabs: [] }

    // Pointer-down rather than click: the next open should target whichever group the user is
    // interacting with, even if the click lands on a viewer that stops propagation.
    groupRoot.addEventListener('pointerdown', () => {
      focus(group)
    })

    picker.addEventListener('change', () => {
      const handle = group.active?.handle
      if (handle === undefined) return
      void handle.show(picker.value).then(() => {
        report({
          ...(group.active === undefined ? {} : { path: group.active.entry.id }),
          view: picker.selectedOptions[0]?.textContent ?? picker.value,
          detail: group.active?.entry.name ?? '',
          severity: 'info',
        })
      })
    })

    groups.push(group)
    placeholder(group, 'No file open in this group.')
    return group
  }

  focused = createGroup()
  focus(focused)

  const area: EditorArea = {
    root,

    get groupCount() {
      return groups.length
    },

    async close(entryId) {
      for (const group of groups) {
        const tab = group.tabs.find(item => item.entry.id === entryId)
        if (tab === undefined) continue
        await closeTab(group, tab)
        // `closeTab` honours `confirmClose`: a cancelled close leaves the tab in place, and
        // reporting that truthfully is what lets a caller decide whether to reopen
        return !group.tabs.includes(tab)
      }
      return false
    },

    async save(entryId) {
      for (const group of groups) {
        const tab = group.tabs.find(item => item.entry.id === entryId)
        if (tab !== undefined) return saveTab(tab)
      }
      return false
    },

    async open(entry) {
      const group = focused
      const existing = group.tabs.find(tab => tab.entry.id === entry.id)
      if (existing !== undefined) {
        await activate(group, existing)
        return
      }

      const button = element(group.strip, 'div', { part: 'explorer.filetab' })
      button.setAttribute('role', 'tab')
      button.title = entry.id
      // the file kind (lowercase extension, or 'file') as data for themes — a tab's kind dot or
      // icon is theme decoration, never a new part
      button.setAttribute('data-mk-kind', fileKindOf(entry.name))

      if (group.tabs.length === 0) group.stage.replaceChildren()
      const content = element(group.stage, 'div', { part: 'explorer.tabcontent' })
      const tab: OpenTab = { entry, button, content }

      const label = element(button, 'span', { text: safeViewerText(entry.name, 120) })
      label.addEventListener('click', () => {
        focus(group)
        void activate(group, tab)
      })

      button.addEventListener('contextmenu', event => {
        event.preventDefault()
        focus(group)
        openTabMenu(group, tab, event.clientX, event.clientY)
      })

      const close = element(button, 'button', { part: 'explorer.filetab-close', text: '×' })
      close.setAttribute('type', 'button')
      close.setAttribute('aria-label', `Close ${entry.name}`)
      close.addEventListener('click', event => {
        event.stopPropagation()
        void closeTab(group, tab)
      })

      group.tabs.push(tab)
      await activate(group, tab)
    },

    markDirty(entryId, dirty) {
      for (const group of groups) {
        for (const tab of group.tabs) {
          if (tab.entry.id !== entryId) continue
          tab.dirty = dirty
          // `mutating` is the registered state for "changed but not committed".
          setState(tab.button, dirty ? ['mutating'] : tab === group.active ? ['selected'] : [])
          if (dirty && tab === group.active) setState(tab.button, ['selected', 'mutating'])
        }
      }
    },

    hasUnsaved() {
      return groups.some(group => group.tabs.some(tab => tab.dirty === true))
    },

    split() {
      focus(createGroup())
    },

    destroy() {
      if (destroyed) return
      destroyed = true
      closeTabMenu()
      for (const group of groups) {
        for (const tab of group.tabs) {
          tab.run?.abort()
          void tab.handle?.unmount()
        }
      }
      root.remove()
    },
  }

  return area
}
