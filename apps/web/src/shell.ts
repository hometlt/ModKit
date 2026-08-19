/**
 * Browser entry point for the PWA — the workbench itself.
 *
 * The composition root (`./index.js`, `./subjects.js`) stays free of DOM and bootstrap concerns; the
 * file capability (`./files.js`), the preview policy (`./views.js`), the panel (`./inspector.js`)
 * and the settings store (`./settings.js`) stay free of it too, so all four are unit-tested in Node.
 * This file is the part that only makes sense in a page: it hands the real DOM globals to the
 * subject services (codecs run in module workers, never on this thread), composes the shipped
 * workbench, explorer, editor area, stages, panel and settings, and wires the browser's own ways of
 * getting at a file.
 *
 * Nothing here decides what a subject can be shown as. `createCodecPreview` answers that from the
 * descriptor the worker sent back, over the stage list in `./views.js`.
 *
 * Two deliberate departures from the shipped explorer's own affordances: the single preview pane is
 * replaced by the editor area (tabs and split groups), so this file owns "open a file" and "accept a
 * drop" rather than letting the explorer preview into a pane that is no longer in the document.
 */
import {
  revisionId,
  type AnyDescriptor,
  type ArtifactByteSource,
  type OperationSession,
} from '@modkitx-x3/sdk'
import type {
  BrowserBlobConstructorLike,
  BrowserMessageChannelConstructorLike,
  BrowserObjectUrlLike,
} from '@modkitx-x3/host/browser'
import {
  createCodecPreview,
  createEditorArea,
  createExplorer,
  createSettingsUi,
  element,
  EXPLORER_MAXIMUM_BYTES,
  setPart,
  setState,
  setViewerText,
  type EditorArea,
  type SettingsDocument,
} from '@modkitx-x3/ui'

import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { createWebTopology, mountWebWorkbench, probeWebFacilities } from './index.js'
import { createWebSubjectServices, type WebSubjectServices } from './subjects.js'
import {
  createDirectoryAccess,
  createSingleFileAccess,
  describeFileCapability,
  type WebDirectoryHandleLike,
  type WebFileAccess,
  type WebFileLike,
} from './files.js'
import { createInspector, type Inspector, type InspectorTarget } from './inspector.js'
import {
  applyAppearance,
  createWebSettingsStore,
  EXTENSIONS_READ_ONLY_REASON,
  WEB_THEMES,
} from './settings.js'
import { createWebPreviewStages, READ_ONLY_NOTICE, WEB_PREVIEW_FALLBACK } from './views.js'

/** Served resources the app offers as a starting point when no folder can be granted. */
const SAMPLES: readonly { readonly path: string; readonly label: string }[] = Object.freeze([
  { path: './favicon-32.png', label: 'favicon-32.png — PNG image' },
  { path: './samples/sample.csv', label: 'sample.csv — delimited table' },
  { path: './samples/sample.ini', label: 'sample.ini — INI tree' },
  { path: './samples/sample.svg', label: 'sample.svg — vector scene' },
  { path: './samples/sample.md', label: 'sample.md — markdown document' },
  { path: './samples/sample.zip', label: 'sample.zip — container namespace' },
])

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

function requireRoot(): Element {
  const node = document.querySelector('#root')
  if (node === null) throw new Error('missing #root')
  return node
}

/** The browser does not report OS/arch portably; a real host adapter supplies this. */
function identity(): { operatingSystem: 'windows' | 'darwin' | 'linux'; architecture: 'x64' } {
  const agent = navigator.userAgent
  // `darwin`, not `macos`: the wire vocabulary is the platform name, not the product name.
  const operatingSystem = agent.includes('Windows')
    ? 'windows'
    : agent.includes('Mac')
      ? 'darwin'
      : 'linux'
  return { operatingSystem, architecture: 'x64' }
}

/** Bytes the explorer already read, as the random-access source `openSubject` asks for. */
function bytesSource(name: string, bytes: Uint8Array, token: string): ArtifactByteSource {
  const uri = `file-picker://${encodeURIComponent(name)}`
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(`provider-token:${token}`),
    size: BigInt(bytes.byteLength),
    async read(offset, length) {
      const start = Number(offset)
      return bytes.slice(start, Math.min(bytes.byteLength, start + length))
    },
    async *stream(range) {
      const start = Number(range?.offset ?? 0n)
      const end = range?.length === undefined ? bytes.byteLength : start + Number(range.length)
      yield bytes.slice(start, Math.min(bytes.byteLength, end))
    },
  }
}

/** Identity of a mounted descriptor, so a stage can find the session the shell still holds. */
const descriptorKey = (descriptor: AnyDescriptor): string =>
  `${descriptor.subjectUri} :: ${descriptor.revision}`

async function pickFile(): Promise<WebFileLike | undefined> {
  const picker = (window as { showOpenFilePicker?: () => Promise<{ getFile(): Promise<File> }[]> })
    .showOpenFilePicker
  if (picker !== undefined) {
    const [handle] = await picker.call(window)
    return handle === undefined ? undefined : await handle.getFile()
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? undefined), { once: true })
    input.click()
  })
}

async function pickDirectory(): Promise<WebDirectoryHandleLike | undefined> {
  const picker = (window as { showDirectoryPicker?: () => Promise<WebDirectoryHandleLike> })
    .showDirectoryPicker
  if (picker === undefined) return undefined
  return picker.call(window)
}

/** Fetch a same-origin resource and present it exactly like a picked file. */
async function fetchServed(baseUrl: URL, path: string): Promise<WebFileLike | undefined> {
  const target = new URL(path, baseUrl)
  if (target.origin !== baseUrl.origin) return undefined
  const response = await fetch(target.href)
  if (!response.ok) return undefined
  const blob = await response.blob()
  const name = target.pathname.split('/').pop() ?? 'resource'
  return new File([blob], name, { lastModified: Date.now() })
}

// ---------------------------------------------------------------------------------------------

async function boot(): Promise<void> {
  const probe = probeWebFacilities()
  const baseUrl = new URL('./', document.baseURI)
  const capability = describeFileCapability(window)
  const bootDiagnostics: string[] = []

  const services: WebSubjectServices = await createWebSubjectServices({
    baseUrl,
    catalog: WEB_EXTENSION_CATALOG,
    identity: identity(),
    probe,
    dom: {
      fetch: (url, init) => fetch(url, init),
      subtle: {
        digest: (algorithm, data) =>
          crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>),
      },
      // the structural DOM shapes take readonly parts / any blob; the platform types are wider
      Blob: Blob as unknown as BrowserBlobConstructorLike,
      objectUrls: URL as unknown as BrowserObjectUrlLike,
      Worker,
      MessageChannel: MessageChannel as unknown as BrowserMessageChannelConstructorLike,
    },
    onDiagnostic: diagnostic => {
      bootDiagnostics.push(`${diagnostic.code}: ${diagnostic.message}`)
      console.info(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    },
  })

  const workbench = mountWebWorkbench(
    document,
    requireRoot(),
    {
      topology: createWebTopology(identity(), probe),
      main: services.main,
      worker: services.worker,
    },
    'Modkit MK3',
  )

  const statusLine = document.createElement('output')
  statusLine.className = 'web-status'
  workbench.root.querySelector('[data-mk-part="workbench.statusbar"]')?.append(statusLine)
  const say = (message: string): void => setViewerText(statusLine, message, 400)

  // ---------------------------------------------------------------- sessions the shell holds
  /*
   * A stage that needs to invoke an operation (the container stage) and the inspector panel both
   * need the live session, which `createCodecPreview` deliberately does not hand to a viewer. The
   * shell opened it, so the shell keeps it, keyed by the descriptor identity a viewer is given.
   */
  const operationSessions = new Map<string, OperationSession>()
  /** What the panel should show for each open tab, so switching tabs re-targets it. */
  const inspected = new Map<string, InspectorTarget>()
  const inspector: Inspector = createInspector(document)
  workbench.setPanel(inspector.root)
  let inspecting: string | undefined
  const inspect = (entryId: string | undefined): void => {
    if (inspecting === entryId) return
    inspecting = entryId
    void inspector
      .show(entryId === undefined ? undefined : inspected.get(entryId))
      .catch((error: unknown) => console.warn('inspector failed', error))
  }

  // ---------------------------------------------------------------- preview policy
  let openCount = 0
  const stages = createWebPreviewStages({
    operationsFor: descriptor => operationSessions.get(descriptorKey(descriptor)),
  })

  const preview = createCodecPreview({
    supported: services.supportedExtensions,
    stages,
    fallback: WEB_PREVIEW_FALLBACK,
    // No `editorPorts`: every `editable` stage is dropped before it mounts. See views.ts.
    async openSession(entry, bytes, signal) {
      openCount += 1
      const token = `${entry.name}-${bytes.byteLength}-${openCount}`.replace(/[^a-z0-9-]/giu, '-')
      const result = await services.open({
        source: bytesSource(entry.name, bytes, token),
        path: entry.name,
        intent: 'full',
        grant: { id: `pwa-${openCount}`, classes: ['read-source'] },
        budget: {
          maxInputBytes: BigInt(EXPLORER_MAXIMUM_BYTES),
          maxDepth: 256,
          maxNodes: 1_000_000,
          maxScalarBytes: 64 * 1024 * 1024,
          maxDiagnostics: 10_000,
          deadlineMs: 30_000,
        },
        ...(signal === undefined ? {} : { signal }),
      })
      if (result.state === 'unresolved') {
        say(`${entry.name} — no codec claimed it (${result.reason}); showing the raw bytes.`)
        return undefined
      }
      const boundary = result.diagnostics.some(
        item => item.code === 'x3.host/worker-shared-process',
      )
        ? 'worker-brokered'
        : 'unknown boundary'
      say(
        `${entry.name} · ${result.selected.contributionId}/${result.selected.variantId} · ` +
          `${Math.round(result.selected.confidence * 100)}% · ${boundary}`,
      )
      /*
       * `AssetSession` answers exactly the questions `PreviewSession` asks, but its `dataSource` is
       * generic over the known contracts while the previewer calls it with plain strings. One
       * narrow structural view keeps that in a single place.
       */
      const session = result.session as unknown as {
        descriptor(): Promise<Record<string, unknown>>
        dataSource(contract: string, major: number): Promise<{ value: unknown }>
        operations(): OperationSession
        dispose(): Promise<void>
      }
      const key = descriptorKey(result.descriptor)
      const operations = session.operations()
      operationSessions.set(key, operations)
      inspected.set(entry.id, { label: entry.name, descriptor: result.descriptor, operations })
      inspecting = undefined
      inspect(entry.id)
      return {
        descriptor: () => session.descriptor(),
        dataSource: (contract, major) => session.dataSource(contract, major),
        async dispose() {
          operationSessions.delete(key)
          inspected.delete(entry.id)
          if (inspecting === entry.id) inspect(undefined)
          await session.dispose()
        },
      }
    },
  })

  // ---------------------------------------------------------------- editors + explorer
  let access: WebFileAccess | undefined

  const editors: EditorArea = createEditorArea(document, {
    preview,
    async read(entry, signal) {
      if (access === undefined) throw new Error('no folder or file is open')
      /*
       * Refuse rather than truncate. `read` caps at the limit, and a codec handed the first 64 MiB
       * of a larger file would detect and describe something that is not the file — the explorer's
       * own preview pane refuses for the same reason, and this path replaced that pane. The size
       * comes from the access: the tree rebuilds its `ExplorerEntry` without one.
       */
      const size = access.sizeOf(entry.id) ?? entry.size
      if (size !== undefined && size > EXPLORER_MAXIMUM_BYTES) {
        throw new Error(
          `${entry.name} is ${(size / (1024 * 1024)).toFixed(1)} MiB, over the ` +
            `${EXPLORER_MAXIMUM_BYTES / (1024 * 1024)} MiB this host will read into memory`,
        )
      }
      return access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal)
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(' · '))
      // The panel is about the focused tab, so switching tabs re-targets it rather than
      // leaving the last opened file's diagnostics on screen.
      inspect(status.path)
    },
  })

  const explorer = createExplorer(document, {
    preview,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry)
    },
    async openFolder() {
      const handle = await pickDirectory()
      if (handle === undefined) {
        say(capability.notice)
        return undefined
      }
      access = createDirectoryAccess(handle, { onNotice: say })
      return access
    },
  })

  // The explorer's single preview pane is replaced by the editor area, which owns tabs and splits.
  const singlePane = explorer.root.querySelector('[data-mk-part="explorer.preview"]')
  if (singlePane === null) throw new Error('explorer has no preview pane to replace')
  singlePane.replaceWith(editors.root)

  /*
   * "Open file…" and the drop target are the shell's, not the explorer's: the explorer would route
   * both into the preview pane that is no longer in the document, and a browser drop carries `File`
   * objects rather than paths, so each dropped file is its own one-entry access.
   */
  const toolbar = explorer.root.querySelector('[data-mk-part="explorer.toolbar"]')
  const toolbarAction = (label: string, title: string, run: () => void): void => {
    if (!(toolbar instanceof HTMLElement)) return
    const button = element(toolbar, 'button', {
      part: 'explorer.action',
      text: label,
    }) as HTMLButtonElement
    button.type = 'button'
    button.title = title
    button.addEventListener('click', run)
  }

  async function openFile(file: WebFileLike): Promise<void> {
    const picked = createSingleFileAccess(file)
    access = picked.access
    await explorer.setAccess(picked.access)
    await editors.open(picked.entry)
  }

  toolbarAction('Open file…', 'Open a single file in a new tab', () => {
    void (async () => {
      try {
        const file = await pickFile()
        if (file !== undefined) await openFile(file)
      } catch (error) {
        say(`Could not open the file: ${describe(error)}`)
      }
    })()
  })
  toolbarAction('Split editor', 'Open the next file beside this one', () => editors.split())

  const stopEvent = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
  }
  editors.root.addEventListener('dragover', event => {
    stopEvent(event)
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    setState(editors.root, ['drop-target'])
  })
  editors.root.addEventListener('dragleave', event => {
    stopEvent(event)
    setState(editors.root, [])
  })
  editors.root.addEventListener('drop', event => {
    stopEvent(event)
    setState(editors.root, [])
    const file = event.dataTransfer?.files[0]
    if (file === undefined) return
    void openFile(file).catch((error: unknown) => say(`Drop failed: ${describe(error)}`))
  })

  // ---------------------------------------------------------------- settings
  const store = createWebSettingsStore(window.localStorage)
  const settingsUi = createSettingsUi(document, {
    store,
    themes: WEB_THEMES,
    onAppearance(appearance: SettingsDocument['appearance']) {
      applyAppearance(document.documentElement, appearance)
    },
    onClose() {
      showView('explorer')
    },
  })

  function bundledExtensionsSection(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'web-extensions'
    element(section, 'h2', { text: 'Bundled extensions' })
    element(section, 'p', {
      part: 'settings.description',
      text:
        `${WEB_EXTENSION_CATALOG.extensions.length} extensions were attested at build time and are ` +
        `served from this origin under extensions/. They are listed read-only because ` +
        `${EXTENSIONS_READ_ONLY_REASON}.`,
    })
    const list = element(section, 'div', { part: 'settings.list' })
    for (const entry of WEB_EXTENSION_CATALOG.extensions) {
      const item = element(list, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: entry.name })
      element(text, 'div', { part: 'settings.description', text: entry.artifactRoot })
    }
    if (WEB_EXTENSION_CATALOG.excluded.length > 0) {
      element(section, 'h2', { text: 'Bundled but not served here' })
      const excluded = element(section, 'div', { part: 'settings.list' })
      for (const entry of WEB_EXTENSION_CATALOG.excluded) {
        const item = element(excluded, 'div', { part: 'settings.extension' })
        const text = element(item, 'div', { part: 'settings.extension-text' })
        element(text, 'div', { part: 'settings.label', text: entry.name })
        element(text, 'div', { part: 'settings.description', text: entry.reason })
      }
    }
    return section
  }

  const settingsView = document.createElement('div')
  settingsView.className = 'web-settings-view'
  settingsView.append(settingsUi.root, bundledExtensionsSection())
  await settingsUi.reload()

  // ---------------------------------------------------------------- sidebar: the host itself
  const sidebar = document.createElement('div')
  sidebar.className = 'web-host-panel'
  element(sidebar, 'h2', { text: 'Host' })
  element(sidebar, 'p', {
    part: 'settings.description',
    text:
      `${services.main.inventory.extensions.length} extensions · ` +
      `${services.supportedExtensions.length} detectable types · codecs run ` +
      `${services.executionProfiles.join('/')} in ${services.worker.profile.realmId} · ` +
      `shared memory ${probe.sharedMemory ? 'yes' : 'no'}`,
  })
  element(sidebar, 'p', { part: 'settings.description', text: capability.notice })
  element(sidebar, 'p', { part: 'settings.description', text: READ_ONLY_NOTICE })
  element(sidebar, 'h2', { text: 'Facilities' })
  const facilities = element(sidebar, 'ul', { part: 'settings.list' })
  for (const facility of services.main.profile.facilities) {
    element(facilities, 'li', { text: facility })
  }
  element(sidebar, 'h2', { text: 'Served samples' })
  const sampleList = element(sidebar, 'div', { part: 'settings.list' })
  for (const sample of SAMPLES) {
    const button = element(sampleList, 'button', {
      part: 'explorer.action',
      text: sample.label,
    }) as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', () => {
      void openServed(sample.path).catch((error: unknown) => say(describe(error)))
    })
  }
  workbench.setSidebar(sidebar)

  // ---------------------------------------------------------------- activity bar
  type ViewName = 'explorer' | 'settings'
  let activeView: ViewName = 'explorer'

  function showView(name: ViewName): void {
    activeView = name
    workbench.setMain(name === 'explorer' ? explorer.root : settingsView)
    if (name === 'settings') void settingsUi.reload()
    for (const node of workbench.activitybar.querySelectorAll('button')) {
      node.setAttribute('aria-pressed', String(node.dataset['view'] === name))
    }
  }

  const activity = (label: string, title: string, run: () => void, view?: ViewName): void => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', title)
    if (view !== undefined) button.dataset['view'] = view
    button.addEventListener('click', run)
    workbench.activitybar.append(button)
  }

  activity('Files', 'Explorer', () => showView('explorer'), 'explorer')
  activity('Host', 'Show or hide the host panel', () => {
    workbench.sidebar.hidden = !workbench.sidebar.hidden
  })
  activity('Info', 'Show or hide diagnostics and operations', () => {
    workbench.panel.hidden = !workbench.panel.hidden
  })
  activity('Settings', 'Settings', () => showView('settings'), 'settings')

  workbench.panel.hidden = true
  workbench.sidebar.hidden = false
  showView('explorer')
  // The empty state is drawn once here; `inspect` only redraws when the focused file changes.
  await inspector.show(undefined)
  say(
    `Ready · ${services.main.inventory.extensions.length} extensions · ` +
      `${bootDiagnostics.length} boot notice(s)`,
  )

  // ---------------------------------------------------------------- served resources
  async function openServed(path: string): Promise<void> {
    const file = await fetchServed(baseUrl, path)
    if (file === undefined) {
      say(`${path} could not be fetched from this origin.`)
      return
    }
    if (activeView !== 'explorer') showView('explorer')
    await openFile(file)
  }

  // `?open=<same-origin path>` — launch the app on a served resource (also the manual smoke path).
  const query = new URL(window.location.href).searchParams
  const requested = query.get('open')
  if (requested !== null) await openServed(requested)

  if (query.get('selftest') !== null) {
    await selfTest({ openServed, editors, settingsView, inspector })
  }
}

// ---------------------------------------------------------------------------------------------
// self test

interface SelfTestParts {
  openServed(path: string): Promise<void>
  readonly editors: EditorArea
  readonly settingsView: HTMLElement
  readonly inspector: Inspector
}

/**
 * Drive the workbench without a human.
 *
 * It opens every served sample, walks each view the picker offers, and reports what actually
 * mounted — into `console.info` and into a `<pre data-mk-part="viewer.status">`, so a run in a real
 * browser can be read off the page itself rather than out of a devtools session.
 */
async function selfTest(parts: SelfTestParts): Promise<void> {
  const report = document.createElement('pre')
  setPart(report, 'viewer.status')
  report.className = 'web-selftest'
  document.body.append(report)
  const lines: string[] = []
  const log = (line: string): void => {
    console.info(line)
    lines.push(line)
    report.textContent = lines.join('\n')
  }

  const picker = (): HTMLSelectElement | undefined => {
    const node = parts.editors.root.querySelector('[data-mk-part="explorer.viewpicker"]')
    return node instanceof HTMLSelectElement ? node : undefined
  }
  const mountedPart = (): boolean =>
    parts.editors.root.querySelector('[data-mk-part="explorer.tabcontent"] [data-mk-part]') !== null
  const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80))

  for (const sample of SAMPLES) {
    const name = sample.path.split('/').pop() ?? sample.path
    try {
      await parts.openServed(sample.path)
      await settle()
      const select = picker()
      const options = select === undefined ? [] : [...select.options]
      const views = options.map(option => option.textContent ?? option.value)
      let mounted = mountedPart()
      for (const option of options) {
        if (select === undefined) break
        select.value = option.value
        select.dispatchEvent(new Event('change'))
        await settle()
        const ok = mountedPart()
        mounted = mounted && ok
        log(`selftest: ${name} view ${option.value} mounted=${ok}`)
      }
      log(`selftest: ${name} -> views [${views.join(', ')}] mounted=${mounted}`)
    } catch (error) {
      log(`selftest: ${name} -> FAILED ${describe(error)}`)
    }
  }

  const tabs = parts.editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]').length
  parts.editors.split()
  log(`selftest: ${tabs} tab(s) open, groups=${parts.editors.groupCount}`)

  const groups = parts.settingsView.querySelectorAll('[data-mk-part="settings.group"]').length
  const themes = parts.settingsView.querySelectorAll('[data-mk-part="settings.select"] option')
  log(`selftest: settings groups=${groups} appearance options=${themes.length}`)

  const operations = parts.inspector.root.querySelectorAll(
    '[data-mk-part="operations.button"]',
  ).length
  const diagnostics = parts.inspector.root.querySelectorAll(
    '[data-mk-part="diagnostics.group"]',
  ).length
  log(`selftest: inspector operations=${operations} diagnosticGroups=${diagnostics}`)

  const editable = [...(picker()?.options ?? [])].some(option => option.value.endsWith('-editor'))
  log(`selftest: editable stages offered=${editable} (expected false: no browser editing backend)`)

  for (const theme of WEB_THEMES) {
    document.documentElement.setAttribute('data-mk-theme', theme.id)
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--mk-color-accent')
      .trim()
    log(`selftest: theme ${theme.id} accent ${accent}`)
  }
  document.documentElement.setAttribute('data-mk-theme', 'modkit-dark')
  log('selftest: done')
}

// Registered after boot so a service-worker failure can never block the app from starting.
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register('./service-worker.js', { scope: './' })
  } catch (error) {
    console.warn('service worker registration failed', error)
  }
}

boot()
  .then(registerServiceWorker)
  .catch((error: unknown) => {
    const node = requireRoot()
    node.replaceChildren()
    const failure = document.createElement('p')
    failure.className = 'booting'
    failure.textContent = `Boot failed: ${describe(error)}`
    node.append(failure)
  })
