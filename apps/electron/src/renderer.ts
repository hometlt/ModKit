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
import { connectElectronSubjectClient, type ElectronSubjectSession } from './subject-client.js'
import {
  createCodecPreview,
  createEditorArea,
  createExplorer,
  createSettingsUi,
  normalizeSettings,
  serializeSettings,
  setPart,
  withRecent,
  type RecentEntry,
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type PreviewResolver,
  type SettingsDocument,
  type SettingsStore,
} from '@modkitx-x3/ui'
import { applyDensity, applyTheme } from '@modkitx-x3/ui/tokens'
import type { OperationSession } from '@modkitx-x3/sdk'

import { PREVIEW_FALLBACK } from '../generated/viewer-catalog.js'
import { createFileEditorPorts } from './editing.js'
import { createInspectorDock, type InspectorSubject } from './inspector.js'
import { createElectronStages } from './stages.js'
import { preferredStage, selfTestLine } from './view-policy.js'

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

/**
 * R6: the preload no longer forwards subject methods — it mints a capability-RPC port. The
 * renderer connects a host-role endpoint over it and consumes materialized proxies whose methods
 * come from the contract-owned surfaces.
 */
interface SubjectBridge {
  requestPort(): Promise<{ readonly session: string }>
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

/**
 * Receive the DOM MessagePort the preload forwards after `requestPort()`. The listener is armed
 * before the request so the handover cannot race the response.
 */
async function acquireSubjectPort(bridge: SubjectBridge): Promise<{
  readonly port: MessagePort
  readonly session: string
}> {
  const arrival = new Promise<{ port: MessagePort; session: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the subject RPC port did not arrive')), 10_000)
    const listener = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; session?: unknown } | null
      if (data?.type !== 'modkit-subject-port') return
      const port = event.ports[0]
      if (port === undefined || typeof data.session !== 'string') return
      clearTimeout(timer)
      window.removeEventListener('message', listener)
      resolve({ port, session: data.session })
    }
    window.addEventListener('message', listener)
  })
  await bridge.requestPort()
  return arrival
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
  const { port: subjectPort, session: subjectSession } = await acquireSubjectPort(subjects)
  const subjectClient = await connectElectronSubjectClient({
    port: subjectPort,
    session: subjectSession,
    onDiagnostic: diagnostic =>
      console.warn(`[subject-rpc] ${diagnostic.code}: ${diagnostic.message}`),
  })
  const profile = await host.profile()

  const shell = document.createElement('div')
  shell.className = 'modkit-shell'
  // The shell is the application's workbench: the same public part the PWA's createWorkbench
  // stamps, so installable themes anchor their decor on one name in both hosts (the page's own
  // unlayered .modkit-shell rules keep this shell's flex layout; only the layered defaults apply)
  setPart(shell, 'workbench')
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

  /*
   * One record per open subject: the live session, its descriptor, the stage the host's
   * presentation plan made active, and the operation session — leased once and shared by the
   * inspector's toolbar, the transport bar and the archive stage's entry preview.
   */
  interface SubjectRecord {
    readonly path: string
    readonly descriptor: Record<string, unknown>
    readonly session: ElectronSubjectSession
    readonly planActive: string | undefined
    operations?: Promise<OperationSession | undefined>
  }
  const subjectsByPath = new Map<string, SubjectRecord>()
  /** Descriptor identity, so a viewer holding only a descriptor can find its own session. */
  const subjectsByDescriptor = new Map<string, SubjectRecord>()
  const descriptorKey = (descriptor: Record<string, unknown>): string =>
    `${String(descriptor['subjectUri'] ?? '')}@${String(descriptor['revision'] ?? '')}`

  const operationsFor = async (
    descriptor: Record<string, unknown>,
  ): Promise<OperationSession | undefined> => {
    const record = subjectsByDescriptor.get(descriptorKey(descriptor))
    if (record === undefined) return undefined
    record.operations ??= record.session
      .operations()
      .then(session => session as OperationSession | undefined)
      .catch((error: unknown) => {
        console.warn(`[subject] operations unavailable: ${String(error)}`)
        return undefined
      })
    return record.operations
  }

  const stages = createElectronStages({ operationsFor })

  const codecPreview = createCodecPreview({
    supported: profile.supportedExtensions,
    stages,
    fallback: PREVIEW_FALLBACK,
    async openSession(entry) {
      const result = await subjectClient.open(entry.id)
      if (result.state === 'unresolved') {
        const detail =
          result.snapshot.diagnostics[0]?.message ??
          `${result.snapshot.reason}; using the explicit text/hex fallback`
        setFooter(entry.id, detail, result.snapshot.reason !== 'no-candidate')
        subjectsByPath.delete(entry.id)
        return undefined
      }
      const snapshot = result.snapshot
      const boundary = snapshot.diagnostics.some(
        item => item.code === 'x3.host/full-process-authority',
      )
        ? ' · full process authority'
        : snapshot.diagnostics.some(item => item.code === 'x3.host/worker-shared-process')
          ? ' · worker'
          : ''
      setFooter(
        entry.id,
        `${snapshot.selected.contributionId}/${snapshot.selected.variantId} · ${Math.round(
          snapshot.selected.confidence * 100,
        )}%${boundary}`,
      )
      const record: SubjectRecord = {
        path: entry.id,
        descriptor: snapshot.descriptor,
        session: result.session,
        planActive: result.session.presentation?.activeStage,
      }
      subjectsByPath.set(entry.id, record)
      subjectsByDescriptor.set(descriptorKey(snapshot.descriptor), record)
      /*
       * The host's plan is kept as the *default* stage, not as the list of stages.
       * `resolvePresentationPlan` keeps one stage per `singletonGroup`, which is right for "what
       * opens first" and wrong for "what can this file be shown as" — a PNG would offer Image and
       * never Hex. Handing the previewer a session without the plan lets it evaluate every stage
       * in the app policy against the descriptor's own data sources and traits, and `planActive`
       * below restores the host's choice of which one starts.
       */
      return {
        descriptor: async () => snapshot.descriptor,
        dataSource: (contract, major) => result.session.dataSource(contract, major),
        dispose: async () => {
          subjectsByPath.delete(entry.id)
          subjectsByDescriptor.delete(descriptorKey(snapshot.descriptor))
          await result.session.dispose()
        },
      }
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

  /** Offer every applicable stage, then start on the one the host's plan selected. */
  const preview: PreviewResolver = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const handle = await codecPreview.open(container, entry, bytes, signal)
      if (handle === undefined) return undefined
      const wanted = preferredStage(
        handle.views.map(view => view.id),
        subjectsByPath.get(entry.id)?.planActive,
      )
      if (wanted !== undefined && wanted !== handle.activeView) await handle.show(wanted)
      return handle
    },
  }

  let access: FileAccess | undefined
  /** Live editor ports per open file, so a close prompt can save through the same session. */
  const openPorts = new Map<string, { save(): Promise<void> }>()

  // ---------------------------------------------------------------- inspector
  const inspector = createInspectorDock(document)
  const inspectorSubject = (path: string | undefined): InspectorSubject | undefined => {
    const record = path === undefined ? undefined : subjectsByPath.get(path)
    if (record === undefined) return undefined
    return {
      path: record.path,
      descriptor: record.descriptor,
      dataSource: (contract, major) => record.session.dataSource(contract, major),
      operations: () => operationsFor(record.descriptor),
    }
  }
  const showInspector = (path: string | undefined): void => {
    void inspector.show(inspectorSubject(path)).catch((error: unknown) => {
      console.warn(`[inspector] ${String(error)}`)
    })
  }

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
      // The dock describes whatever tab is focused, so it follows the same signal the footer does.
      if (status.severity !== 'busy') showInspector(status.path)
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

  // Tree · editors · inspector. The dock is a sibling of the explorer, not part of a tab, because
  // it describes the focused subject rather than one of its stages.
  const workspace = document.createElement('div')
  workspace.className = 'modkit-workspace'
  workspace.append(explorer.root, inspector.root)
  body.append(workspace)
  let inspectorOpen = true
  const toggleInspector = (open = !inspectorOpen): void => {
    inspectorOpen = open
    inspector.root.hidden = !open
  }

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
      { id: 'nexus-forge', label: 'Nexus Forge' },
      { id: 'nexus-dominion', label: 'Nexus Dominion' },
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
    body.replaceChildren(settingsOpen ? settingsUi.root : workspace)
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
  on('inspector', () => {
    if (settingsOpen) toggleSettings(false)
    toggleInspector()
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
  addMenu('View', [
    { label: 'Split Editor', command: 'split', hint: 'Ctrl+Backslash' },
    { label: 'Toggle Inspector', command: 'inspector' },
  ])

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
      await selfTest({
        access,
        preview,
        editors,
        settingsRoot: settingsUi.root,
        inspector,
        subjectFor: inspectorSubject,
        saveProbe: (entry, bytes) =>
          createFileEditorPorts(bridge, entry, bytes, line => setFooter(entry.id, line)),
      })
  }
}

/** Let the microtask queue and one animation frame settle after a mount. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 60))
}

/**
 * Drive the previewer without a human: list the granted folder, open every file, and report what
 * mounted. Verification has to reach the codecs, the tabs and the split, not just the window.
 */
async function selfTest(options: {
  readonly access: FileAccess
  readonly preview: PreviewResolver
  readonly editors: EditorArea
  readonly settingsRoot: HTMLElement
  readonly inspector: ReturnType<typeof createInspectorDock>
  subjectFor(path: string | undefined): InspectorSubject | undefined
  saveProbe?: (
    entry: ExplorerEntry,
    bytes: Uint8Array,
  ) => {
    readonly edit: unknown
    readonly commit: unknown
  }
}): Promise<void> {
  const { access, preview, editors, settingsRoot, inspector, saveProbe } = options
  const entries = await access.list(undefined)
  console.log(`selftest: ${entries.length} entries in ${access.label}`)
  console.log(`selftest: supported extensions ${preview.supported.join(', ')}`)

  /*
   * Everything below reads the *focused* group. After `split()` there are two, and the first one
   * in document order is no longer the one `editors.open` targets — reading `editors.root`
   * directly is what made the archive probe look at an empty picker.
   */
  const FOCUSED = '[data-mk-part="explorer.group"][data-mk-state~="active"]'
  const focusedPicker = (): HTMLSelectElement | undefined => {
    const node = editors.root.querySelector(`${FOCUSED} [data-mk-part="explorer.viewpicker"]`)
    return node instanceof HTMLSelectElement ? node : undefined
  }
  /** The visible tab's mounted viewer surface, or `null` when nothing mounted. */
  const mountedSurface = (): Element | null =>
    editors.root.querySelector(
      `${FOCUSED} [data-mk-part="explorer.tabcontent"]:not([hidden]) [data-mk-part="viewer"]`,
    )

  for (const entry of entries) {
    if (entry.directory) continue
    try {
      await editors.open(entry)
      await settle()
      const picker = focusedPicker()
      const views = picker === undefined ? [] : [...picker.options].map(item => item.value)

      /*
       * Every offered stage has to mount, not just the one that opens. The picker is the public
       * control, so the check drives it exactly as a user would instead of calling `show`.
       * `ok(degraded)` is a stage that mounted and then said honestly that it could not render —
       * a platform decoder refusing a fixture is not the same failure as nothing mounting.
       */
      const results: string[] = []
      let all = mountedSurface() !== null
      for (const view of views) {
        if (picker !== undefined) {
          picker.value = view
          picker.dispatchEvent(new Event('change'))
          await settle()
        }
        const surface = mountedSurface()
        if (surface === null) all = false
        const degraded = surface?.querySelector('[data-mk-state~="error"]') != null
        results.push(`${view}=${surface === null ? 'EMPTY' : degraded ? 'ok(degraded)' : 'ok'}`)
      }
      console.log(selfTestLine(entry.name, views, views.length > 0 && all))
      if (views.length > 1) console.log(`selftest: ${entry.name} stages ${results.join(' ')}`)

      const subject = options.subjectFor(entry.id)
      if (subject !== undefined) {
        // Every panel the policy offers has to mount too — cycle them the way the dock's own
        // control does, and report which produced a viewer surface.
        const panelResults: string[] = []
        await inspector.show(subject)
        for (const panel of inspector.panels) {
          await inspector.select(panel)
          await settle()
          const ok = inspector.root.querySelector('[data-mk-part="viewer"]') !== null
          panelResults.push(`${panel}=${ok ? 'ok' : 'EMPTY'}`)
        }
        console.log(
          `selftest: ${entry.name} panels [${inspector.panels.join(', ')}] ${panelResults.join(' ')}`,
        )
      }
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
      await (ports.edit as { plan(c: unknown): Promise<unknown> }).plan({ edits })
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

  // Every installed theme has to reach two places: the token cascade and the decor layer. Reading
  // the accent back proves the stylesheet is linked and its selector matches; reading the decor
  // animation name proves the theme found something to hang a background on in *this* host, which
  // is exactly what breaks silently when a host composes its own shell.
  for (const [id, accent] of [
    ['nexus-forge', '#b6f04a'],
    ['nexus-dominion', '#f0a02a'],
  ] as const) {
    document.documentElement.setAttribute('data-mk-theme', id)
    const themed = getComputedStyle(document.documentElement)
      .getPropertyValue('--mk-color-accent')
      .trim()
    const anchor = document.querySelector('[data-mk-part="workbench"]') ?? document.body
    const decor = getComputedStyle(anchor, '::before').animationName
    console.log(
      `selftest: theme ${id} accent ${themed} (expected ${accent}, ${themed === accent ? 'ok' : 'MISMATCH'}) decor ${decor}`,
    )
  }
  document.documentElement.setAttribute('data-mk-theme', 'sc2')

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

  // Operations: invoke the read-only standard verbs through the subject's own operation session.
  for (const entry of entries.filter(item => !item.directory)) {
    const subject = options.subjectFor(entry.id)
    if (subject === undefined) continue
    const session = await subject.operations()
    if (session === undefined) {
      console.log(`selftest: ${entry.name} operations -> no session`)
      continue
    }
    const declared = (
      subject.descriptor['operations'] as
        readonly { id?: string; handlerId?: string; state?: string }[] | undefined
    )?.filter(item => item.state === 'available')
    const outcomes: string[] = []
    for (const operation of declared ?? []) {
      if (!['view.inspect', 'asset.validate', 'export.raw'].includes(operation.id ?? '')) continue
      try {
        const result = await session.invoke(operation.handlerId ?? '', null)
        const output = (result as { output?: { kind?: string } }).output
        outcomes.push(
          `${operation.id ?? '?'}=${result.state}${
            result.state === 'ok' ? `/${output?.kind ?? '?'}` : `/${result.reason}`
          }`,
        )
      } catch (error) {
        outcomes.push(`${operation.id ?? '?'}=THREW ${String(error)}`)
      }
    }
    console.log(`selftest: ${entry.name} operations ${outcomes.join(' ')}`)
    break
  }

  // Archive: open the namespace stage, activate the first entry, and read the inline preview.
  const archive = entries.find(item => item.name.toLowerCase().endsWith('.zip'))
  if (archive !== undefined) {
    await editors.open(archive)
    await settle()
    const picker = focusedPicker()
    if (picker !== undefined && [...picker.options].some(option => option.value === 'archive')) {
      picker.value = 'archive'
      picker.dispatchEvent(new Event('change'))
      await settle()
      const label = editors.root.querySelector(
        `${FOCUSED} [data-mk-part="explorer.tabcontent"]:not([hidden]) [data-mk-part="namespace.label"]`,
      )
      ;(label as HTMLElement | null)?.click()
      await new Promise(resolve => setTimeout(resolve, 800))
      const pane = editors.root.querySelector(
        `${FOCUSED} [data-mk-part="explorer.tabcontent"]:not([hidden]) [data-mk-part="archive.preview"]`,
      )
      const status = pane?.querySelector('[data-mk-part="viewer.status"]')?.textContent ?? ''
      const rendered = pane?.querySelector('[data-mk-part="text"], [data-mk-part="hex"]') != null
      console.log(
        `selftest: archive entry clicked=${label !== null} preview=${rendered} status=${JSON.stringify(status)}`,
      )
    } else {
      console.log('selftest: archive stage was not offered for the zip sample')
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
