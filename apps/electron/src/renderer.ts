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
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type SettingsDocument,
  type SettingsStore,
} from '@modkitx-x3/ui'
import { applyDensity, applyTheme } from '@modkitx-x3/ui/tokens'

import { PREVIEW_FALLBACK, PREVIEW_FORMATS, PREVIEW_STAGES } from './codecs.js'

const MAXIMUM_BYTES = 64 * 1024 * 1024

interface Broker {
  readonly channels: readonly string[]
  request(channel: string, payload: unknown): Promise<unknown>
}

interface HostBridge {
  profile(): Promise<{
    readonly renderer: { readonly realmId: string; readonly facilities: readonly string[] }
  }>
  initialFile(): Promise<{
    readonly present: boolean
    readonly root?: string
    readonly entry?: ExplorerEntry
    readonly selfTest?: boolean
  }>
  registerFileTypes(extensions: readonly string[]): Promise<{ readonly message: string }>
}

interface MenuBridge {
  on(command: 'open-folder' | 'open-file' | 'settings' | 'split', run: () => void): void
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

async function boot(): Promise<void> {
  if (
    host === undefined ||
    broker === undefined ||
    menu === undefined ||
    settingsBridge === undefined
  ) {
    throw new Error('preload bridge is missing: host, broker, menu or settings is undefined')
  }
  // Bound locally: the narrowing above does not reach the nested helpers declared later.
  const bridge = broker
  const profile = await host.profile()

  const shell = document.createElement('div')
  shell.className = 'modkit-shell'
  const body = document.createElement('div')
  body.className = 'modkit-body'
  const footer = document.createElement('footer')
  footer.className = 'modkit-footer'
  shell.append(body, footer)
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
    formats: PREVIEW_FORMATS,
    stages: PREVIEW_STAGES,
    fallback: PREVIEW_FALLBACK,
  })

  let access: FileAccess | undefined

  // ---------------------------------------------------------------- editors
  const editors: EditorArea = createEditorArea(document, {
    preview,
    async read(entry, signal) {
      if (access === undefined) throw new Error('no folder is open')
      return access.read(entry.id, MAXIMUM_BYTES, signal)
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
    ],
    onAppearance(appearance: SettingsDocument['appearance']) {
      applyTheme(document.documentElement, appearance.theme as never)
      applyDensity(document.documentElement, appearance.density)
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
    return { access, entry: result.entry }
  }

  // ---------------------------------------------------------------- menu
  menu?.on('open-folder', () => {
    void (async () => {
      const next = await openFolder()
      if (next !== undefined) await explorer.setAccess(next)
    })()
  })
  menu?.on('open-file', () => {
    void (async () => {
      const picked = await pickFile()
      if (picked === undefined) return
      await explorer.setAccess(picked.access)
      await editors.open(picked.entry)
    })()
  })
  menu?.on('settings', () => {
    toggleSettings()
  })
  menu?.on('split', () => {
    if (settingsOpen) toggleSettings(false)
    editors.split()
  })

  setFooter('', 'Ready')

  // Opened by double-click once this build is registered for the type.
  const initial = await host.initialFile()
  if (initial.present && initial.root !== undefined) {
    access = accessFor(initial.root)
    await explorer.setAccess(access)
    if (initial.entry !== undefined) await editors.open(initial.entry)
    if (initial.selfTest === true) await selfTest(access, preview, editors, settingsUi.root)
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
  console.log('selftest: done')
}

boot().catch((error: unknown) => {
  const failure = document.createElement('p')
  failure.className = 'bad'
  failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
  requireRoot().replaceChildren(failure)
})
