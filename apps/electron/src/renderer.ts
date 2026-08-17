/**
 * Electron renderer — the file previewer.
 *
 * It composes nothing and touches no filesystem API. Everything it can do arrives through the
 * preload bridge: the main process owns the dialogs, the granted roots, the reads and the settings
 * file. This file adapts those to the shared `@modkitx-x3/ui` components.
 *
 * Chrome follows VS Code: a native File/View menu instead of a toolbar, a sidebar tree, an editor
 * area with tabs and split groups, and a footer reporting the active file. There is no app title
 * bar and no facilities panel — a user browsing files does not need the realm id, and it stays
 * available in the settings footer for anyone who does.
 *
 * This file must not import `./index.js` — the composition root pulls in `@modkitx-x3/host/node`,
 * and a renderer able to run that would need the Node access `nodeIntegration: false` denies. The
 * bundle failing to resolve `node:fs` is the guard doing its job.
 */
import {
  createCodecPreview,
  createEditorArea,
  createExplorer,
  createSettingsUi,
  normalizeSettings,
  serializeSettings,
  withRecent,
  type RecentEntry,
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type PreviewSession,
  type SettingsDocument,
  type SettingsStore,
} from '@modkitx-x3/ui'
import { applyDensity, applyTheme } from '@modkitx-x3/ui/tokens'

import { PREVIEW_FALLBACK, PREVIEW_STAGES } from '../generated/viewer-catalog.js'
import { createFileEditorPorts } from './editing.js'

/**
 * Hand Monaco its language workers. Monaco reads this the first time an editor asks for one, which
 * is always after module init, so declaring it here is early enough. Same-origin scripts satisfy
 * `worker-src 'self' blob:` — no relaxation needed.
 */
;(globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
  getWorkerUrl(_workerId: string, label: string): string {
    return label === 'json' ? './json.worker.js' : './editor.worker.js'
  },
}

const MAXIMUM_BYTES = 64 * 1024 * 1024

interface Broker {
  readonly channels: readonly string[]
  request(channel: string, payload: unknown): Promise<unknown>
}

interface HostBridge {
  profile(): Promise<{
    readonly renderer: { readonly realmId: string; readonly facilities: readonly string[] }
    readonly supportedExtensions: readonly string[]
  }>
  initialFile(): Promise<{
    readonly present: boolean
    readonly root?: string
    readonly entry?: ExplorerEntry
    readonly selfTest?: boolean
  }>
  registerFileTypes(extensions: readonly string[]): Promise<{ readonly message: string }>
  confirmClose(name: string): Promise<'save' | 'discard' | 'cancel'>
}

interface SubjectBridge {
  open(path: string): Promise<
    | {
        readonly state: 'opened'
        readonly sessionId: string
        readonly descriptor: Record<string, unknown>
        readonly presentation: NonNullable<PreviewSession['presentation']>
        readonly selected: {
          readonly contributionId: string
          readonly variantId: string
          readonly confidence: number
        }
        readonly candidates: readonly unknown[]
        readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
      }
    | {
        readonly state: 'unresolved'
        readonly reason: string
        readonly candidates: readonly unknown[]
        readonly diagnostics: readonly { readonly code: string; readonly message: string }[]
      }
  >
  call(
    sessionId: string,
    contract: string,
    major: number,
    method: string,
    args: readonly unknown[],
    handleId?: string,
  ): Promise<unknown>
  close(sessionId: string): Promise<{ readonly state: 'closed' }>
}

interface MenuBridge {
  on(
    command:
      | 'open-folder'
      | 'open-file'
      | 'settings'
      | 'split'
      | 'default-app'
      | 'open-recent'
      | 'clear-recent',
    run: (payload?: unknown) => void,
  ): void
  /** Recent entries live in the settings file, so the renderer pushes them into the native menu. */
  setRecent(recent: readonly RecentEntry[]): Promise<void>
}

interface SettingsBridge {
  read(): Promise<{ readonly location: string; readonly raw?: unknown; readonly problem?: string }>
  write(text: string): Promise<{ readonly location: string }>
}

const broker = (globalThis as { modkitBroker?: Broker }).modkitBroker
const host = (globalThis as { modkitHost?: HostBridge }).modkitHost
const files = (globalThis as { modkitFiles?: { pathFor(file: File): string } }).modkitFiles
const menu = (globalThis as { modkitMenu?: MenuBridge }).modkitMenu
const settingsBridge = (globalThis as { modkitSettings?: SettingsBridge }).modkitSettings
const subjects = (globalThis as { modkitSubjects?: SubjectBridge }).modkitSubjects
const windowBridge = (
  globalThis as {
    modkitWindow?: {
      send(command: string): Promise<{ state: string }>
      onState(handler: (state: { maximized: boolean; fullscreen: boolean }) => void): void
    }
  }
).modkitWindow

/**
 * The app's own title bar, drawn because the native frame is hidden so a theme can style it.
 *
 * The bar is the drag region; the buttons opt out with `-webkit-app-region: no-drag`, otherwise a
 * click on Close would start a window drag instead of firing. Labels are glyphs with real
 * `aria-label`s — a screen reader must not read "✕".
 */
function createTitleBar(document: Document, title: string): HTMLElement {
  const bar = document.createElement('header')
  bar.dataset['mkPart'] = 'titlebar'

  const drag = document.createElement('div')
  drag.dataset['mkPart'] = 'titlebar.drag'
  const label = document.createElement('span')
  label.dataset['mkPart'] = 'titlebar.title'
  label.textContent = title
  drag.append(label)

  const controls = document.createElement('div')
  controls.dataset['mkPart'] = 'titlebar.controls'

  const button = (glyph: string, name: string, command: string): void => {
    const node = document.createElement('button')
    node.type = 'button'
    node.dataset['mkPart'] = 'titlebar.button'
    node.dataset['command'] = command
    node.textContent = glyph
    node.setAttribute('aria-label', name)
    node.title = name
    node.addEventListener('click', () => {
      void windowBridge?.send(command)
    })
    controls.append(node)
  }

  button('—', 'Minimise', 'minimize')
  button('▢', 'Maximise or restore', 'toggle-maximize')
  button('✕', 'Close', 'close')

  windowBridge?.onState(state => {
    bar.dataset['mkState'] = state.maximized ? 'active' : ''
    const maximise = controls.querySelector('[data-command="toggle-maximize"]')
    if (maximise !== null) maximise.textContent = state.maximized ? '❐' : '▢'
  })

  bar.append(drag, controls)
  return bar
}

function requireRoot(): Element {
  const node = document.querySelector('#root')
  if (node === null) throw new Error('missing #root')
  return node
}

const basename = (value: string): string => {
  const parts = value.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

/** Wrap the broker in the capability shape the explorer asks for. */
function accessFor(rootPath: string): FileAccess {
  if (broker === undefined) throw new Error('preload bridge is missing')
  return {
    label: basename(rootPath) || rootPath,
    async list(entryId) {
      const result = (await broker.request('directory.list', { path: entryId ?? rootPath })) as {
        entries: readonly ExplorerEntry[]
      }
      return result.entries
    },
    async read(entryId, maxBytes) {
      const result = (await broker.request('filesystem.read-file', {
        path: entryId,
        maxBytes,
      })) as { bytes: Uint8Array }
      // Structured clone may hand back a plain object view; normalise to a real Uint8Array.
      return result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes)
    },
  }
}

/** The settings file lives in the main process; the renderer only serialises and parses. */
function settingsStore(bridge: SettingsBridge): SettingsStore {
  let location = 'settings'
  return {
    get location() {
      return location
    },
    async read() {
      const response = await bridge.read()
      location = response.location
      const normalized = normalizeSettings(response.raw)
      return response.problem === undefined
        ? normalized
        : { document: normalized.document, problems: [response.problem, ...normalized.problems] }
    },
    async write(document) {
      const response = await bridge.write(serializeSettings(document))
      location = response.location
    },
  }
}

const REMOTE_ITERABLE_METHODS = new Set(['search'])

function serializableArguments(args: readonly unknown[]): readonly unknown[] {
  return args.filter(argument => !(argument instanceof AbortSignal))
}

function remoteDataSource(
  bridge: SubjectBridge,
  sessionId: string,
  contract: string,
  major: number,
  handleId?: string,
): unknown {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, property) {
      if (property === 'then') return undefined
      if (typeof property !== 'string') return undefined
      if (REMOTE_ITERABLE_METHODS.has(property)) {
        return (...args: readonly unknown[]) => ({
          async *[Symbol.asyncIterator]() {
            const values = (await bridge.call(
              sessionId,
              contract,
              major,
              property,
              serializableArguments(args),
              handleId,
            )) as readonly unknown[]
            for (const value of values) yield value
          },
        })
      }
      return async (...args: readonly unknown[]) => {
        const result = await bridge.call(
          sessionId,
          contract,
          major,
          property,
          serializableArguments(args),
          handleId,
        )
        if (
          typeof result === 'object' &&
          result !== null &&
          (result as { kind?: unknown }).kind === 'remote-data-source-value' &&
          typeof (result as { handleId?: unknown }).handleId === 'string'
        ) {
          return remoteDataSource(
            bridge,
            sessionId,
            contract,
            major,
            (result as { handleId: string }).handleId,
          )
        }
        return result
      }
    },
  })
}

function remotePreviewSession(
  bridge: SubjectBridge,
  sessionId: string,
  descriptor: Record<string, unknown>,
  presentation: NonNullable<PreviewSession['presentation']>,
): PreviewSession {
  return {
    presentation,
    async descriptor() {
      return descriptor
    },
    async dataSource(contract, major) {
      return { value: remoteDataSource(bridge, sessionId, contract, major) }
    },
    async dispose() {
      await bridge.close(sessionId)
    },
  }
}

async function boot(): Promise<void> {
  if (
    host === undefined ||
    broker === undefined ||
    menu === undefined ||
    settingsBridge === undefined ||
    subjects === undefined
  ) {
    throw new Error(
      'preload bridge is missing: host, broker, menu, settings or subjects is undefined',
    )
  }
  // Bound locally: the narrowing above does not reach the nested helpers declared later.
  const bridge = broker
  const subjectBridge = subjects
  const profile = await host.profile()

  const shell = document.createElement('div')
  shell.className = 'modkit-shell'
  const body = document.createElement('div')
  body.className = 'modkit-body'
  const footer = document.createElement('footer')
  footer.className = 'modkit-footer'
  const titleBar = createTitleBar(document, 'Modkit MK3')
  shell.append(titleBar, body, footer)
  requireRoot().replaceChildren(shell)

  const footerPath = document.createElement('span')
  const footerDetail = document.createElement('span')
  footerDetail.className = 'muted'
  footer.append(footerPath, footerDetail)

  const setFooter = (path: string, detail: string, bad = false): void => {
    footerPath.textContent = path
    footerDetail.textContent = detail
    footer.classList.toggle('bad', bad)
  }

  const preview = createCodecPreview({
    formats: [],
    supported: profile.supportedExtensions,
    stages: PREVIEW_STAGES,
    fallback: PREVIEW_FALLBACK,
    async openSession(entry) {
      const result = await subjectBridge.open(entry.id)
      if (result.state === 'unresolved') {
        const detail =
          result.diagnostics[0]?.message ?? `${result.reason}; using the explicit text/hex fallback`
        setFooter(entry.id, detail, result.reason !== 'no-candidate')
        return undefined
      }
      const authority = result.diagnostics.some(
        item => item.code === 'x3.host/full-process-authority',
      )
      setFooter(
        entry.id,
        `${result.selected.contributionId}/${result.selected.variantId} · ${Math.round(
          result.selected.confidence * 100,
        )}%${authority ? ' · full process authority' : ''}`,
      )
      return remotePreviewSession(
        subjectBridge,
        result.sessionId,
        result.descriptor,
        result.presentation,
      )
    },
    // Editable stages get a real save path: bytes go through the broker to an atomic write.
    editorPorts: (entry, bytes) => {
      const ports = createFileEditorPorts(
        bridge,
        entry,
        bytes,
        line => setFooter(entry.id, line),
        dirty => editors.markDirty(entry.id, dirty),
      )
      // Kept so "save before closing" can commit the very ports the editor is holding.
      openPorts.set(entry.id, ports)
      return ports
    },
  })

  let access: FileAccess | undefined
  /** Live editor ports per open file, so a close prompt can save through the same session. */
  const openPorts = new Map<string, { save(): Promise<void> }>()

  // ---------------------------------------------------------------- editors
  const editors: EditorArea = createEditorArea(document, {
    preview,
    async read(entry, signal) {
      if (access === undefined) throw new Error('no folder is open')
      return access.read(entry.id, MAXIMUM_BYTES, signal)
    },
    async confirmClose(entry) {
      return host.confirmClose(entry.name)
    },
    async save(entry) {
      await openPorts.get(entry.id)?.save()
    },
    onStatus(status) {
      setFooter(
        status.path ?? '',
        [status.view, status.detail].filter(Boolean).join(' · '),
        status.severity === 'error',
      )
    },
  })

  // ---------------------------------------------------------------- explorer
  const explorer = createExplorer(document, {
    preview,
    // The desktop app uses the native menu; a second row of buttons would duplicate it.
    showToolbar: false,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry)
    },
    async openFolder() {
      return openFolder()
    },
    async openFile() {
      const picked = await pickFile()
      return picked
    },
    /*
     * A native drop carries real paths, which the preload reads with `webUtils.getPathForFile`.
     * The grant still happens in the main process: the drop is the user's consent, but only main
     * may widen what is readable.
     */
    async acceptDrop(transfer) {
      if (files === undefined) throw new Error('preload file bridge is missing')
      const paths = [...transfer.files]
        .map(file => files.pathFor(file))
        .filter(value => value !== '')
      if (paths.length === 0) {
        throw new Error('the drop carried no filesystem path (was it dragged from a browser?)')
      }
      const result = (await broker.request('dialog.accept-drop', { paths })) as {
        accepted: readonly { root: string; entry?: ExplorerEntry }[]
      }
      const first = result.accepted[0]
      if (first === undefined) return undefined
      access = accessFor(first.root)
      if (first.entry !== undefined) void editors.open(first.entry)
      return { access }
    },
    async registerFileTypes() {
      return (await host.registerFileTypes(preview.supported)).message
    },
  })

  // The explorer's own single preview pane is replaced by the editor area, which owns tabs/splits.
  const singlePane = explorer.root.querySelector('[data-mk-part="explorer.preview"]')
  if (singlePane === null) throw new Error('explorer has no preview pane to replace')
  singlePane.replaceWith(editors.root)
  body.append(explorer.root)

  // ---------------------------------------------------------------- settings
  const store = settingsStore(settingsBridge)

  const settingsUi = createSettingsUi(document, {
    store,
    themes: [
      { id: 'modkit-dark', label: 'Modkit Dark' },
      { id: 'modkit-light', label: 'Modkit Light' },
      { id: 'modkit-high-contrast', label: 'High contrast' },
      // An installed theme is just an id plus a stylesheet; nothing about it is special-cased.
      { id: 'sc2', label: 'StarCraft II' },
    ],
    onAppearance(appearance: SettingsDocument['appearance']) {
      applyTheme(document.documentElement, appearance.theme as never)
      applyDensity(document.documentElement, appearance.density)
    },
    // Offer exactly the formats the loaded codecs can open — never advertise for what we cannot read.
    associableTypes: preview.supported,
    async registerFileTypes(extensions) {
      return (await host.registerFileTypes(extensions)).message
    },
    onClose() {
      toggleSettings(false)
    },
  })
  await settingsUi.reload()

  let settingsOpen = false
  function toggleSettings(open = !settingsOpen): void {
    settingsOpen = open
    body.replaceChildren(settingsOpen ? settingsUi.root : explorer.root)
    setFooter(
      settingsOpen ? 'Settings' : '',
      settingsOpen ? `${store.location} · realm ${profile.renderer.realmId}` : 'Ready',
    )
    if (settingsOpen) void settingsUi.reload()
  }

  // ---------------------------------------------------------------- open helpers
  async function openFolder(): Promise<FileAccess | undefined> {
    const result = (await bridge.request('dialog.open-directory', {
      requestId: crypto.randomUUID(),
    })) as { canceled: boolean; root?: string }
    if (result.canceled || result.root === undefined) return undefined
    access = accessFor(result.root)
    if (settingsOpen) toggleSettings(false)
    await remember({ path: result.root, kind: 'folder' })
    return access
  }

  async function pickFile(): Promise<
    { readonly access: FileAccess; readonly entry: ExplorerEntry } | undefined
  > {
    const result = (await bridge.request('dialog.open-file', {
      requestId: crypto.randomUUID(),
    })) as { canceled: boolean; root?: string; entry?: ExplorerEntry }
    if (result.canceled || result.root === undefined || result.entry === undefined) return undefined
    access = accessFor(result.root)
    if (settingsOpen) toggleSettings(false)
    await remember({ path: result.entry.id, kind: 'file' })
    return { access, entry: result.entry }
  }

  // ---------------------------------------------------------------- menu
  const commands: Record<string, (payload?: unknown) => void> = {}
  /** Mirror of the recent list, so opening the File menu never has to await the settings file. */
  let recentCache: readonly RecentEntry[] = []
  const on = (command: string, run: (payload?: unknown) => void): void => {
    commands[command] = run
    menu?.on(command as 'settings', run)
  }

  on('open-folder', () => {
    void (async () => {
      const next = await openFolder()
      if (next !== undefined) await explorer.setAccess(next)
    })()
  })
  on('open-file', () => {
    void (async () => {
      const picked = await pickFile()
      if (picked === undefined) return
      await explorer.setAccess(picked.access)
      await editors.open(picked.entry)
    })()
  })
  on('settings', () => {
    toggleSettings()
  })
  on('split', () => {
    if (settingsOpen) toggleSettings(false)
    editors.split()
  })
  on('default-app', () => {
    // The full picker lives in settings; the menu item is a shortcut to it, not a second flow.
    toggleSettings(true)
  })

  on('open-recent', payload => {
    const entry = payload as RecentEntry | undefined
    if (entry === undefined) return
    void (async () => {
      try {
        if (settingsOpen) toggleSettings(false)
        /*
         * Re-grant before listing. Filesystem grants are per-session and live in the main process,
         * so a path picked from Recent after a restart has no grant and `directory.list` rejects
         * it — which is exactly why Open Recent did nothing. Main re-grants only paths it finds in
         * its own copy of the recent list, so this cannot widen access to anything else.
         */
        const granted = (await bridge.request('dialog.reopen-recent', { path: entry.path })) as {
          root: string
          entry?: ExplorerEntry
        }
        access = accessFor(granted.root)
        await explorer.setAccess(access)
        if (granted.entry !== undefined) await editors.open(granted.entry)
        else setFooter(granted.root, 'folder')
        await remember(entry)
      } catch (error) {
        // A recent path can be deleted or on an unplugged drive; say so instead of failing silently.
        setFooter(entry.path, `unavailable: ${error instanceof Error ? error.message : ''}`, true)
      }
    })()
  })

  on('clear-recent', () => {
    void (async () => {
      const { document: current } = await store.read()
      await store.write({ ...current, recent: [] })
      recentCache = []
      await menu?.setRecent([])
    })()
  })

  /** Record an opened path and push the new list into the native menu. */
  async function remember(entry: RecentEntry): Promise<void> {
    const { document: current } = await store.read()
    const next = withRecent(current, entry)
    await store.write(next)
    recentCache = next.recent
    await menu?.setRecent(next.recent)
  }

  /*
   * The menu bar lives in our own title bar.
   *
   * Hiding the native frame to style the window also removes the native menu, so the application
   * has to draw one. It dispatches through the same command table as the native menu signals, so
   * the two can never offer different sets of actions.
   */
  const menuBar = document.createElement('nav')
  menuBar.dataset['mkPart'] = 'titlebar.menu'
  menuBar.setAttribute('aria-label', 'Application menu')

  let openMenu: HTMLElement | undefined
  const closeMenu = (): void => {
    openMenu?.remove()
    openMenu = undefined
  }
  document.addEventListener('pointerdown', event => {
    if (event.target instanceof Node && menuBar.contains(event.target)) return
    closeMenu()
  })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu()
  })

  const addMenu = (
    label: string,
    items: readonly (
      | { readonly label: string; readonly command: string; readonly hint?: string }
      | { readonly separator: true }
      | { readonly recent: true }
    )[],
  ): void => {
    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.dataset['mkPart'] = 'titlebar.menu-item'
    trigger.textContent = label
    trigger.addEventListener('click', () => {
      const wasOpen = openMenu !== undefined
      closeMenu()
      if (wasOpen) return

      const panel = document.createElement('div')
      panel.dataset['mkPart'] = 'titlebar.menu-panel'
      panel.setAttribute('role', 'menu')

      const entry = (text: string, run: () => void, enabled = true): void => {
        const node = document.createElement('button')
        node.type = 'button'
        node.dataset['mkPart'] = 'titlebar.menu-entry'
        node.setAttribute('role', 'menuitem')
        node.textContent = text
        if (!enabled) node.setAttribute('disabled', '')
        else
          node.addEventListener('click', () => {
            closeMenu()
            run()
          })
        panel.append(node)
      }

      for (const item of items) {
        if ('separator' in item) {
          const rule = document.createElement('div')
          rule.dataset['mkPart'] = 'titlebar.menu-separator'
          panel.append(rule)
          continue
        }
        if ('recent' in item) {
          const list = recentCache
          if (list.length === 0) entry('No recent items', () => undefined, false)
          for (const recent of list) {
            entry(`${recent.kind === 'file' ? 'File' : 'Folder'} — ${recent.path}`, () =>
              commands['open-recent']?.(recent),
            )
          }
          continue
        }
        entry(item.hint === undefined ? item.label : `${item.label} ${item.hint}`, () =>
          commands[item.command]?.(),
        )
      }

      trigger.append(panel)
      openMenu = panel
    })
    menuBar.append(trigger)
  }

  addMenu('File', [
    { label: 'Open Folder…', command: 'open-folder', hint: 'Ctrl+K' },
    { label: 'Open File…', command: 'open-file', hint: 'Ctrl+O' },
    { separator: true },
    { recent: true },
    { separator: true },
    { label: 'Clear Recent', command: 'clear-recent' },
    { separator: true },
    { label: 'Set as Default App…', command: 'default-app' },
    { label: 'Settings', command: 'settings', hint: 'Ctrl+,' },
  ])
  addMenu('View', [{ label: 'Split Editor', command: 'split', hint: 'Ctrl+Backslash' }])

  titleBar.prepend(menuBar)

  // Keyboard shortcuts, which the native menu used to provide and a hidden frame no longer does.
  document.addEventListener('keydown', event => {
    if (!event.ctrlKey && !event.metaKey) return
    const key = event.key.toLowerCase()
    const command =
      key === 'k' ? 'open-folder' : key === 'o' ? 'open-file' : key === ',' ? 'settings' : undefined
    if (command === undefined) return
    event.preventDefault()
    commands[command]?.()
  })

  // Populate the menu from whatever the settings file already holds.
  recentCache = (await store.read()).document.recent
  await menu?.setRecent(recentCache)

  setFooter('', 'Ready')

  // Opened by double-click once this build is registered for the type.
  const initial = await host.initialFile()
  if (initial.present && initial.root !== undefined) {
    access = accessFor(initial.root)
    await explorer.setAccess(access)
    if (initial.entry !== undefined) await editors.open(initial.entry)
    if (initial.selfTest === true)
      await selfTest(access, preview, editors, settingsUi.root, (entry, bytes) =>
        createFileEditorPorts(bridge, entry, bytes, line => setFooter(entry.id, line)),
      )
  }
}

/**
 * Drive the previewer without a human: list the granted folder, open every file, and report what
 * mounted. Verification has to reach the codecs, the tabs and the split, not just the window.
 */
async function selfTest(
  access: FileAccess,
  preview: ReturnType<typeof createCodecPreview>,
  editors: EditorArea,
  settingsRoot: HTMLElement,
  saveProbe?: (
    entry: ExplorerEntry,
    bytes: Uint8Array,
  ) => {
    readonly session: unknown
    readonly commit: unknown
  },
): Promise<void> {
  const entries = await access.list(undefined)
  console.log(`selftest: ${entries.length} entries in ${access.label}`)
  console.log(`selftest: supported extensions ${preview.supported.join(', ')}`)

  for (const entry of entries) {
    if (entry.directory) continue
    try {
      await editors.open(entry)
      const picker = editors.root.querySelector('[data-mk-part="explorer.viewpicker"]')
      const views =
        picker instanceof HTMLSelectElement ? [...picker.options].map(item => item.textContent) : []
      const mounted = editors.root.querySelector('[data-mk-part="explorer.stage"] [data-mk-part]')
      console.log(
        `selftest: ${entry.name} -> views [${views.join(', ')}] mounted=${mounted !== null}`,
      )
    } catch (error) {
      console.log(`selftest: ${entry.name} -> FAILED ${String(error)}`)
    }
  }

  const tabs = editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]').length
  console.log(`selftest: ${tabs} tabs open in ${editors.groupCount} group(s)`)
  editors.split()
  const groups = editors.root.querySelectorAll('[data-mk-part="explorer.group"]').length
  console.log(`selftest: after split groups=${editors.groupCount}, rendered=${groups}`)

  const settingsGroups = settingsRoot.querySelectorAll('[data-mk-part="settings.group"]').length
  console.log(`selftest: settings groups=${settingsGroups}`)

  // Prove the save path reaches disk: write through the same ports an editor uses.
  const target = entries.find(item => item.name === 'savetest.txt')
  if (target !== undefined && saveProbe !== undefined) {
    try {
      const ports = saveProbe(target, new TextEncoder().encode('original text'))
      const edits = [{ payload: { kind: 'text', text: 'SAVED BY SELFTEST' } }]
      await (ports.session as { plan(c: unknown): Promise<unknown> }).plan({ edits })
      const plan = { edits }
      await (ports.commit as { prepare(p: unknown): Promise<unknown> }).prepare(plan)
      await (ports.commit as { commit(): Promise<unknown> }).commit()
      const after = await access.read(target.id, 1024)
      console.log(`selftest: save -> ${JSON.stringify(new TextDecoder().decode(after))}`)
    } catch (error) {
      console.log(`selftest: save FAILED ${String(error)}`)
    }
  }
  // An installed theme must reach the tokens, not just the picker.
  const before = getComputedStyle(document.documentElement).getPropertyValue('--mk-color-accent')
  document.documentElement.setAttribute('data-mk-theme', 'sc2')
  const after = getComputedStyle(document.documentElement).getPropertyValue('--mk-color-accent')
  const scan = getComputedStyle(document.body, '::before').animationName
  console.log(`selftest: theme accent ${before.trim()} -> ${after.trim()}, background ${scan}`)

  const bar = document.querySelector('[data-mk-part="titlebar"]')
  const buttons = [...document.querySelectorAll('[data-mk-part="titlebar.button"]')].map(node =>
    node.getAttribute('data-command'),
  )
  const railed = bar === null ? '' : getComputedStyle(bar, '::after').animationName
  const sheen = getComputedStyle(document.body, '::after').animationName
  console.log(
    `selftest: titlebar=${bar !== null} controls=[${buttons.join(', ')}] rail=${railed} sheen=${sheen}`,
  )
  const sheets = [...document.styleSheets].map(sheet => sheet.href?.split('/').pop() ?? 'inline')
  let sheenRule = 'not found'
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        const text = rule.cssText
        if (text.includes('mk-sc2-sheen') && text.includes('body')) sheenRule = text.slice(0, 90)
      }
    } catch {
      sheenRule = 'unreadable sheet'
    }
  }
  console.log(`selftest: sheets=[${sheets.join(', ')}] sheenRule=${sheenRule.length} chars`)

  const menus = [...document.querySelectorAll('[data-mk-part="titlebar.menu-item"]')].map(
    node => node.textContent,
  )
  const fileMenu = document.querySelector('[data-mk-part="titlebar.menu-item"]')
  ;(fileMenu as HTMLElement | null)?.click()
  const menuEntries = [...document.querySelectorAll('[data-mk-part="titlebar.menu-entry"]')].map(
    node => (node.textContent ?? '').split(' ')[0],
  )
  console.log(`selftest: menus=[${menus.join(', ')}] fileEntries=${menuEntries.length}`)

  // The dirty marker must appear on edit and clear on save.
  if (target !== undefined) {
    editors.markDirty(target.id, true)
    const marked = document.querySelectorAll(
      '[data-mk-part="explorer.filetab"][data-mk-state~="mutating"]',
    ).length
    const unsaved = editors.hasUnsaved()
    editors.markDirty(target.id, false)
    const cleared = document.querySelectorAll(
      '[data-mk-part="explorer.filetab"][data-mk-state~="mutating"]',
    ).length
    console.log(`selftest: dirty marked=${marked} hasUnsaved=${unsaved} cleared=${cleared}`)
  }

  // Hex: edit a cell and check the ASCII twin follows and the tab is marked.
  const bin = entries.find(item => item.name === 'unknown.bin')
  if (bin !== undefined) {
    await editors.open(bin)
    const cell = document.querySelector('[data-mk-part="hex.cell"]') as HTMLElement | null
    const twin = document.querySelector('[data-mk-part="hex.ascii"] > span') as HTMLElement | null
    if (cell !== null && twin !== null) {
      const asciiBefore = twin.textContent
      cell.textContent = '41'
      cell.dispatchEvent(new FocusEvent('blur'))
      await new Promise(resolve => setTimeout(resolve, 120))
      const marked = document.querySelectorAll(
        '[data-mk-part="explorer.filetab"][data-mk-state~="mutating"]',
      ).length
      console.log(
        `selftest: hex ascii ${JSON.stringify(asciiBefore)} -> ${JSON.stringify(twin.textContent)} tabMarked=${marked}`,
      )
    }
  }

  console.log('selftest: done')
}

boot().catch((error: unknown) => {
  const failure = document.createElement('p')
  failure.className = 'bad'
  failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
  requireRoot().replaceChildren(failure)
})
