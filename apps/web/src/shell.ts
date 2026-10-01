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
 * Nothing here decides what a subject can be *saved* as either. `./editing.js` composes the browser
 * editing backend, the raw writer and the commit coordinator; this file holds what only a session
 * can know — which entry has a writable handle, which revision each tab pinned, and which grant a
 * subject was opened under — and hands `editorPorts` to the previewer for exactly those subjects.
 * The same surface carries ADR-HOST-002 Path A: `./edit-panel.js` invokes a codec's mutating
 * operation and hands the plan back through it, and this file owns the one thing a panel cannot
 * know — which tab a descriptor belongs to, so a committed change can close and reopen it at the
 * revision the write just created.
 *
 * Two deliberate departures from the shipped explorer's own affordances: the single preview pane is
 * replaced by the editor area (tabs and split groups), so this file owns "open a file" and "accept a
 * drop" rather than letting the explorer preview into a pane that is no longer in the document.
 */
import { CONTAINER_EXTRACT_OPERATION_ID } from '@modkit/core'
import {
  revisionId,
  type AnyDescriptor,
  type AssetSession,
  type ArtifactByteSource,
  type NamespaceEntrySource,
  type OperationSession,
  type PermissionGrant,
  type PresentationPlan,
  type RasterResourcePort,
} from '@modkit/sdk'
import {
  nestedSubjectServices,
  openNestedSubject,
  resolveFormatWriter,
  resolveCommonPresentationPlan,
  withoutHiddenEntries,
  type OpenSubjectResult,
} from '@modkit/host'
import type {
  BrowserBlobConstructorLike,
  BrowserMessageChannelConstructorLike,
  BrowserObjectUrlLike,
} from '@modkit/host/browser'
import {
  createCodecPreview,
  createEditorArea,
  createExplorer,
  EXPLORER_MAXIMUM_BYTES,
  type EditorArea,
  type ExplorerEntry,
  type PreviewResolver,
} from '@modkit/ui/explorer'
import { createSettingsUi, readAppThemeChoices, type SettingsDocument } from '@modkit/ui/settings'
import { resolveModelViewerTextures } from '@modkit/ui/model'
import { element, setPart, setState, setViewerText } from '@modkit/ui/viewer'
import type { UiMessageKey } from '@modkit/ui/localization'

import { WEB_EXTENSION_CATALOG } from '../generated/extension-catalog.js'
import { createWebTopology, mountWebWorkbench, probeWebFacilities } from './index.js'
import {
  catalogCoordinates,
  createWebSubjectServices,
  resolveModuleMap,
  type WebSubjectServices,
} from './subjects.js'
import { prepareWebMapPreview } from './map-preview.js'
import type { WebCommandSubjectLease } from './commands.js'
import { createIndexedDbExtensionStore, type IdbFactoryLike } from './extension-store.js'
import { mountExtensionsUi } from './extensions-ui.js'
import { createManagedExtensionsController } from './managed-extensions-controller.js'
import { createWebExtensionSubjectCatalog } from './extension-subjects.js'
import { createBrowserExtensionManager } from './browser-extension-manager.js'
import { WEB_OFFLINE_RELEASE } from '../generated/offline-release.js'
import type {
  BrowserCacheStorageLike,
  ManagedExtensionIdbFactoryLike,
} from './managed-extension-storage.js'
import {
  combineLoadedExtensionRoots,
  loadManagedExtensionRoots,
} from './managed-extension-roots.js'
import {
  createDirectoryAccess,
  createSingleFileAccess,
  describeFileCapability,
  isWritableHandle,
  type WebDirectoryHandleLike,
  type WebFileAccess,
  type WebFileHandleLike,
  type WebFileLike,
  type WebWritableFileHandleLike,
} from './files.js'
import {
  createWebEditingArm,
  describeEditability,
  requestWriteAccess,
  sourceRevisionToken,
  sourceUriFor,
  type EditabilityReport,
  type WebSubjectEditor,
} from './editing.js'
import { createEditPanel } from './edit-panel.js'
import { createInspector, type Inspector, type InspectorTarget } from './inspector.js'
import {
  createWebSessionRecovery,
  type WebSessionDiagnostic,
  type WebSessionRecovery,
} from './session-recovery.js'
import { applyAppearance, createWebSettingsStore, EXTENSIONS_READ_ONLY_REASON } from './settings.js'
import { createWebPreviewFallback, createWebPreviewStages, stageIdOf } from './views.js'
import { createWebLocalizer, loadWebLocalizationCatalogs } from './localization.js'
import {
  createPwaFormatSmokeAcceptance,
  loadPwaFormatSmokeAuthority,
  type FormatSmokeAuthorityCase,
  type FormatSmokeCaseId,
  type FormatSmokeRouteStep,
  type PwaFormatSmokeOpenedResult,
  type PwaFormatSmokeStageEvidence,
} from './format-smoke.js'

declare const __MODKIT_FORMAT_SMOKE_AUTHORITY_SHA256__: string

/** Served resources the app offers as a starting point when no folder can be granted. */
const SAMPLES: readonly { readonly path: string; readonly labelKey: UiMessageKey }[] =
  Object.freeze([
    { path: './favicon-32.png', labelKey: 'web.sample.png' },
    { path: './samples/sample.csv', labelKey: 'web.sample.csv' },
    { path: './samples/sample.ini', labelKey: 'web.sample.ini' },
    { path: './samples/sample.svg', labelKey: 'web.sample.svg' },
    { path: './samples/sample.md', labelKey: 'web.sample.md' },
    { path: './samples/sample.mp3', labelKey: 'web.sample.mp3' },
    { path: './samples/sample.zip', labelKey: 'web.sample.zip' },
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

/**
 * Bytes the explorer already read, as the random-access source `openSubject` asks for.
 *
 * The id is the *entry id*, not the file name: two files with the same name in different folders
 * of one grant are two subjects, and the editing arm looks a writable handle up by this id. The
 * revision is the file's own `size`/`lastModified` pair, so the backend can re-derive it from the
 * live handle and refuse a write to a file that changed under the tab.
 */
function bytesSource(entryId: string, bytes: Uint8Array, token: string): ArtifactByteSource {
  const uri = sourceUriFor(entryId)
  return {
    kind: 'bytes',
    ref: { id: uri, uri },
    revision: revisionId(token),
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

/**
 * One file and — when the browser gave one — the handle behind it.
 *
 * The handle is the whole difference between a file this page can save and one it can only read:
 * `showOpenFilePicker` yields one, an `<input type="file">` yields a `File` and nothing else.
 * Dropping it on the floor (as this function used to) is what made every opened file view-only.
 */
interface PickedFile {
  readonly file: WebFileLike
  readonly handle?: WebFileHandleLike
}

async function pickFile(): Promise<PickedFile | undefined> {
  const picker = (window as { showOpenFilePicker?: () => Promise<WebFileHandleLike[]> })
    .showOpenFilePicker
  if (picker !== undefined) {
    const [handle] = await picker.call(window)
    if (handle === undefined) return undefined
    return { file: await handle.getFile(), handle }
  }
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener(
      'change',
      () => {
        const chosen = input.files?.[0]
        resolve(chosen === undefined ? undefined : { file: chosen })
      },
      { once: true },
    )
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
  const appThemes = readAppThemeChoices(document)
  const settingsStore = createWebSettingsStore(window.localStorage)
  let settingsDocument = (await settingsStore.read()).document
  const baseUrl = new URL('./', document.baseURI)
  const pageUrl = new URL(window.location.href)
  const requestedLocale = pageUrl.searchParams.get('lang') ?? navigator.languages
  let localizer = createWebLocalizer(requestedLocale)
  let locale = localizer.locale
  let t = localizer.text
  document.documentElement.lang = locale
  document.title = t('app.title')
  const booting = document.querySelector('.booting')
  if (booting !== null) setViewerText(booting, t('app.starting'))
  const capability = describeFileCapability(window)
  let capabilityNotice = t(
    capability.directories
      ? 'web.capability.folder'
      : capability.filePicker
        ? 'web.capability.file'
        : 'web.capability.input',
  )
  const bootDiagnostics: string[] = []
  const bootSessionDiagnostics: WebSessionDiagnostic[] = []
  const recoveryHost: { current?: WebSessionRecovery } = {}

  /*
   * The user's own extension folders, read and re-hashed before the host is composed — their
   * codecs have to be in the inventory this page runs, not added to it afterwards. Loading only
   * *queries* each grant; a folder whose permission lapsed appears in the panel as "needs
   * permission" with a button, because a prompt on page load is a prompt nobody asked for.
   */
  // the structural shape takes a plain `Event`; the platform types it as `IDBVersionChangeEvent`
  const extensionStore = createIndexedDbExtensionStore(indexedDB as unknown as IdbFactoryLike)
  const managedRuntime = createBrowserExtensionManager({
    indexedDB: indexedDB as unknown as ManagedExtensionIdbFactoryLike,
    ...(typeof caches === 'undefined'
      ? {}
      : { cacheStorage: caches as unknown as BrowserCacheStorageLike }),
    registry: {
      catalogUri: new URL(WEB_OFFLINE_RELEASE.catalogPath, document.baseURI).href,
      trustedPublicKeys: { [WEB_OFFLINE_RELEASE.keyId]: WEB_OFFLINE_RELEASE.publicJwk },
      cacheKey: `modkit.app.web/offline-release/${WEB_OFFLINE_RELEASE.catalogSha256}`,
    },
    allowedOrigins: [window.location.origin],
    maxArtifactBytes: WEB_OFFLINE_RELEASE.maxArtifactBytes,
  })
  const managedStorage = managedRuntime.storage
  const managedExtensions = createManagedExtensionsController({
    client: managedRuntime.client,
    catalogLocation: managedRuntime.catalogLocation,
  })
  const subtle = {
    digest: (algorithm: string, data: Uint8Array) =>
      crypto.subtle.digest(algorithm, data as Uint8Array<ArrayBuffer>),
  }
  const managedRoots = await loadManagedExtensionRoots(managedStorage, {
    subtle,
    claimed: catalogCoordinates(WEB_EXTENSION_CATALOG),
  })
  for (const failure of managedRoots.failures) {
    bootDiagnostics.push(`${failure.code}: ${failure.message}`)
  }
  const composedDisabledExtensions = (): readonly string[] =>
    Object.freeze(
      [
        ...new Set([
          ...settingsDocument.disabledExtensions,
          ...managedRoots.disabledExtensionCoordinates,
        ]),
      ].sort(),
    )
  /*
   * Filled once the host exists. The panel renders — and therefore asks for conflicts — during
   * `reload()`, which runs *before* the composition, because the folders have to be read before
   * the inventory is built. Reading the binding directly here is a temporal dead zone and the app
   * fails to boot with "Cannot access 'services' before initialization"; a holder says plainly
   * that there are no conflicts to report yet, because nothing has been composed to conflict.
   */
  const host: { services?: WebSubjectServices } = {}
  const extensionsUi = mountExtensionsUi(document, {
    localizer,
    store: extensionStore,
    catalog: WEB_EXTENSION_CATALOG,
    managedExtensions,
    additionalClaimedCoordinates: managedRoots.coordinates,
    subtle,
    pickDirectory: async () => {
      const picker = (window as unknown as { showDirectoryPicker?: () => Promise<unknown> })
        .showDirectoryPicker
      if (picker === undefined) throw new Error('this browser has no folder picker')
      return (await picker.call(window)) as never
    },
    conflicts: () => host.services?.userExtensionConflicts ?? [],
    extensionSubjects: () => {
      const inventory = host.services?.main.inventory
      if (inventory === undefined) return undefined
      const packageEnablement = Object.fromEntries(
        managedExtensions
          .snapshot()
          .rows.filter(row => row.installed)
          .map(row => [row.id, row.enabled] as const),
      )
      return createWebExtensionSubjectCatalog(inventory, {
        disabledExtensions: settingsDocument.disabledExtensions,
        disabledContributions: settingsDocument.disabledContributions,
        managedPackageByExtension: managedRoots.packageByCoordinate,
        managedPackageEnablement: packageEnablement,
      })
    },
    setContributionEnabled: async (id, enabled) => {
      const disabled = new Set(settingsDocument.disabledContributions)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      settingsDocument = {
        ...settingsDocument,
        disabledContributions: Object.freeze([...disabled].sort()),
      }
      await settingsStore.write(settingsDocument)
    },
    setExtensionEnabled: async (id, enabled) => {
      const disabled = new Set(settingsDocument.disabledExtensions)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      settingsDocument = {
        ...settingsDocument,
        disabledExtensions: Object.freeze([...disabled].sort()),
      }
      await settingsStore.write(settingsDocument)
    },
    onChanged: loaded => {
      // `say` is not in scope yet at boot; the status line is created below, so report where a
      // user is already looking for load news
      console.info(
        `[extensions] ${loaded.inputs.length} user extension(s) loaded. Reload the page to compose ` +
          'a host with a changed list: this app builds its inventory once, at startup.',
      )
    },
  })
  await extensionsUi.reload()
  for (const failure of extensionsUi.current().failures) {
    bootDiagnostics.push(`${failure.code}: ${failure.message}`)
  }

  const loadedExtensionRoots = combineLoadedExtensionRoots(managedRoots, extensionsUi.current())
  const services: WebSubjectServices = await createWebSubjectServices({
    baseUrl,
    catalog: WEB_EXTENSION_CATALOG,
    // Downloaded packages precede user-picked folders. Both already passed the same root loader,
    // and the combined serve function is the one synthetic fetch used by the worker verifier.
    userExtensions: loadedExtensionRoots,
    moduleMap: Object.freeze({
      ...resolveModuleMap(baseUrl),
      ...loadedExtensionRoots.moduleMap,
    }),
    identity: identity(),
    disabledExtensions: composedDisabledExtensions(),
    disabledContributions: settingsDocument.disabledContributions,
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
      bootSessionDiagnostics.push({ code: diagnostic.code, message: diagnostic.message })
      recoveryHost.current?.report(diagnostic)
      console.info(`[worker] ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    },
  })

  /*
   * The host inventory above is the exact inventory built from bundled, downloaded and
   * user-granted roots. Localization is data-only and is loaded from that inventory through the
   * Extension Manager browser VFS before the workbench or settings view is mounted. The extension
   * picker itself had to exist earlier to recover granted roots, but it is still detached; hand it
   * the final localizer and rerender it before any user can see the provisional built-in copy.
   */
  const loadedLocalization = await loadWebLocalizationCatalogs({
    inventory: services.main.inventory,
    baseUrl,
    loadedExtensionRoots,
    fetch: (url, init) => fetch(url, init),
  })
  for (const diagnostic of loadedLocalization.diagnostics) {
    bootDiagnostics.push(`${diagnostic.code}: ${diagnostic.message}`)
  }
  localizer = createWebLocalizer(requestedLocale, loadedLocalization.catalogs)
  locale = localizer.locale
  t = localizer.text
  capabilityNotice = t(
    capability.directories
      ? 'web.capability.folder'
      : capability.filePicker
        ? 'web.capability.file'
        : 'web.capability.input',
  )
  document.documentElement.lang = locale
  document.title = t('app.title')
  if (booting !== null) setViewerText(booting, t('app.starting'))
  extensionsUi.setLocalizer(localizer)
  window.addEventListener(
    'pagehide',
    () => void Promise.all([services.dispose(), managedRuntime.dispose()]),
    { once: true },
  )

  host.services = services
  // conflicts are only knowable once both lists are in one inventory; the panel re-reads them
  await extensionsUi.reload()

  const workbench = mountWebWorkbench(
    document,
    requireRoot(),
    {
      topology: createWebTopology(identity(), probe),
      main: services.main,
      worker: services.worker,
    },
    t('app.title'),
    localizer,
  )

  const statusLine = document.createElement('output')
  statusLine.className = 'web-status'
  const restartSession = document.createElement('button')
  restartSession.className = 'web-session-restart'
  restartSession.type = 'button'
  restartSession.hidden = true
  restartSession.textContent = t('action.restartSession')
  restartSession.title = t('action.restartSessionTitle')
  workbench.root
    .querySelector('[data-mk-part="workbench.statusbar"]')
    ?.append(statusLine, restartSession)
  const say = (message: string): void => setViewerText(statusLine, message, 400)

  // ---------------------------------------------------------------- sessions the shell holds
  /*
   * A stage that needs to invoke an operation (the container stage) and the inspector panel both
   * need the live session, which `createCodecPreview` deliberately does not hand to a viewer. The
   * shell opened it, so the shell keeps it, keyed by the descriptor identity a viewer is given.
   */
  const operationSessions = new Map<string, OperationSession>()
  /*
   * The container's live session, kept beside its operations arm.
   *
   * The archive stage can reach `container.extract` through `operationSessions` and read a
   * member's bytes; opening that member *as a subject* needs the session itself, because
   * `openNestedSubject` leases the parent's namespace for as long as the child lives so the
   * child's companions resolve inside the same archive. Bytes could never carry that.
   */
  const assetSessions = new Map<string, AssetSession>()
  /** Bounded image decoding owned by each open subject; model viewers receive only copied RGBA. */
  const rasterResources = new Map<string, RasterResourcePort>()
  /**
   * Subjects already opened by the nested route, waiting for their tab to mount.
   *
   * The editor area opens a tab from an entry and bytes; this host now has a second way to reach a
   * subject, and rather than teach the tab about it, the opened result is left here under the
   * virtual entry id the tab will ask for. `openSession` takes it instead of opening again — which
   * matters for more than speed: opening again from bytes would lose the archive the member came
   * from, and with it every companion inside that archive.
   */
  const pendingNested = new Map<
    string,
    {
      readonly result: OpenSubjectResult
      readonly bytes: Uint8Array
      readonly label: string
      readonly selectedRoute: readonly FormatSmokeRouteStep[]
    }
  >()
  /** Actual product-selected route for a live descriptor, never a subject URI or explorer id. */
  const selectedRoutes = new Map<string, readonly FormatSmokeRouteStep[]>()
  let activeFormatSmokeCase: FormatSmokeCaseId | undefined
  let activeFormatSmokeStage: FormatSmokeAuthorityCase['stage'] | undefined
  let lastFormatSmokeOpen:
    | {
        readonly caseId: FormatSmokeCaseId
        readonly descriptor: AnyDescriptor
        readonly selectedRoute: readonly FormatSmokeRouteStep[]
      }
    | undefined
  let lastFormatSmokeHostFailure: string | undefined
  let lastFormatSmokeCandidates: string | undefined
  const summarizeFormatSmokeCandidates = (result: OpenSubjectResult): string =>
    JSON.stringify({
      candidates: result.candidates.map(candidate => ({
        extensionId: candidate.extensionId,
        contributionId: candidate.contributionId,
        variantId: candidate.variantId,
        state: candidate.state,
        ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
        diagnostics: candidate.diagnostics.map(diagnostic => ({
          code: diagnostic.code,
          message: diagnostic.message,
        })),
      })),
      diagnostics: result.diagnostics.map(diagnostic => ({
        code: diagnostic.code,
        message: diagnostic.message,
      })),
    })
  /** What the panel should show for each open tab, so switching tabs re-targets it. */
  const inspected = new Map<string, InspectorTarget>()
  /** The entry id behind a mounted descriptor, so a panel holding only one finds its tab. */
  const entryOfDescriptor = new Map<string, string>()
  /** The entry each open tab was opened from, so a committed edit can reopen the same tab. */
  const openedEntries = new Map<string, ExplorerEntry>()
  /**
   * What the last applied mutating operation did, per file.
   *
   * Applying one reopens the tab, which remounts the panel that reported it — so the panel would
   * come back with no memory of the change the user just made. The shell keeps the sentence and
   * hands it back on the next mount. It deliberately outlives the tab's dispose.
   */
  const editOutcomes = new Map<string, string>()
  /** The editing surface behind each open tab: the stages' ports and Path A's plan gate. */
  const subjectEditors = new Map<string, WebSubjectEditor>()
  const entryIdOf = (descriptor: AnyDescriptor): string | undefined =>
    entryOfDescriptor.get(descriptorKey(descriptor))

  /**
   * Close and reopen the tab on `entryId`, so its stages read the bytes the file holds now.
   *
   * A committed edit moves the subject's revision; the open session is pinned to the old one and
   * every stage in the tab is showing it. This host has no refresh-in-place, so it does the honest
   * thing and reopens — through the tab's own close control and `editors.open`, the two things a
   * user would do, which also releases the subject's editing surface and composes a fresh one at
   * the new revision.
   */
  const tabsOn = (entryId: string): readonly HTMLElement[] =>
    [...editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.title === entryId,
    )

  const reopenEntry = async (entryId: string): Promise<boolean> => {
    // Read before closing: the tab's dispose forgets the entry it was opened from.
    const entry = openedEntries.get(entryId)
    if (entry === undefined) return false
    for (const tab of tabsOn(entryId)) {
      const close = tab.querySelector('[data-mk-part="explorer.filetab-close"]')
      if (close instanceof HTMLElement) close.click()
    }
    // `closeTab` unmounts the stage and disposes the session asynchronously; opening before it has
    // finished would find the old tab and only focus it.
    for (let attempt = 0; attempt < 100 && tabsOn(entryId).length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (tabsOn(entryId).length > 0) return false
    await editors.open(entry)
    return true
  }

  const editPanel = createEditPanel({
    localizer,
    portsFor: descriptor => {
      const entryId = entryIdOf(descriptor)
      return entryId === undefined ? undefined : subjectEditors.get(entryId)
    },
    reopen: async descriptor => {
      const entryId = entryIdOf(descriptor)
      return entryId === undefined ? false : reopenEntry(entryId)
    },
    lastOutcome: descriptor => editOutcomes.get(descriptor.subjectUri),
    recordOutcome: (descriptor, outcome) => {
      editOutcomes.set(descriptor.subjectUri, outcome)
    },
    // The panel is chrome beside the tab, so its result belongs on the same status line and in the
    // same host-rail sentence every other editing surface in this app reports to.
    onStatus: status => {
      say(status.message)
      noteEditing(status.message)
    },
  })

  const inspector: Inspector = createInspector(document, { editPanel, localizer })
  workbench.setPanel(inspector.root)
  let inspecting: string | undefined
  const inspect = (entryId: string | undefined): void => {
    if (inspecting === entryId) return
    inspecting = entryId
    void inspector
      .show(entryId === undefined ? undefined : inspected.get(entryId))
      .catch((error: unknown) => console.warn('inspector failed', error))
  }

  // ---------------------------------------------------------------- editing arm
  /*
   * Everything a save needs, kept by the shell because the shell is what opened the subject and
   * what holds the handles. `./editing.js` owns the composition; this owns the session state.
   */
  let access: WebFileAccess | undefined
  /** The revision token each tab pinned, taken from the handle *before* the bytes were read. */
  const pinnedRevisions = new Map<string, string>()
  /** Writable handles by source id — exactly what the editing backend resolves a write through. */
  const writableHandles = new Map<string, WebWritableFileHandleLike>()
  /** Why each open tab does or does not get the editors, decided before its stages are chosen. */
  const editability = new Map<string, EditabilityReport>()

  /**
   * The host rail's live editing line. Made here and appended into the rail below, so everything
   * that has something to say about editing can say it without waiting for the rail to exist.
   */
  const editingStatus = document.createElement('p')
  setPart(editingStatus, 'settings.status')
  setViewerText(editingStatus, t('status.noFileEditable'))
  const noteEditing = (message: string): void => setViewerText(editingStatus, message, 400)
  /** Bound once the editor area exists; the arm is built before it and needs to mark its tabs. */
  let markDirty: (entryId: string, dirty: boolean) => void = () => undefined
  /** Entry id of the focused tab, which is the only tab that can receive a keystroke. */
  let focused: string | undefined

  const editing = createWebEditingArm({
    localizer,
    inventory: services.main.inventory,
    handleFor: sourceId => writableHandles.get(sourceId),
    onNotice(message) {
      say(message)
      noteEditing(message)
    },
    onDirty: (entryId, dirty) => markDirty(entryId, dirty),
    /*
     * Reached from an editor's Save click, which is the only place the browser will honour
     * `requestPermission`. Asking on load is both refused by the browser and rude.
     */
    async ensureWriteAccess(entryId) {
      const current = await describeEditability(access, entryId, entryId, localizer)
      if (current.state === 'granted' || current.state === 'no-permission-surface') return 'granted'
      if (current.state !== 'prompt') {
        noteEditing(current.sentence)
        return 'denied'
      }
      const asked = await requestWriteAccess(access, localizer)
      noteEditing(asked.sentence)
      return asked.state === 'granted' ? 'granted' : asked.state === 'denied' ? 'denied' : 'prompt'
    },
  })

  // ---------------------------------------------------------------- preview policy
  let openCount = 0
  /** The id a member of a container gets as a tab; derived, so reopening the same member reuses it. */
  const nestedEntryId = (containerKey: string, entryPath: string): string =>
    `x3-nested:${containerKey}#${entryPath}`

  const selectedStep = (result: Extract<OpenSubjectResult, { readonly state: 'opened' }>) => {
    if (!('identity' in result.descriptor)) {
      throw new TypeError('an opened subject has no resolved descriptor identity')
    }
    return Object.freeze({
      formatId: result.descriptor.identity.formatId,
      extensionId: result.selected.extensionId,
      contributionId: result.selected.contributionId,
    })
  }

  /** Shared UI and acceptance route; acceptance may hand in bytes it verified before the open. */
  const openNestedEntry = async (
    descriptor: AnyDescriptor,
    entryId: string,
    entryPath: string,
    verifiedBytes?: Uint8Array,
  ): Promise<string | undefined> => {
    const key = descriptorKey(descriptor)
    const parent = assetSessions.get(key)
    if (parent === undefined) return t('web.archive.sessionGone')
    const nested = await openNestedSubject({
      parent,
      entryId,
      ...nestedSubjectServices(services),
      grant: { id: `pwa-nested-${openCount}`, classes: ['read-source'] },
      budget: {
        maxInputBytes: BigInt(
          activeFormatSmokeCase === undefined
            ? EXPLORER_MAXIMUM_BYTES
            : WEB_OFFLINE_RELEASE.maxArtifactBytes,
        ),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 10_000,
        deadlineMs: 30_000,
      },
    })
    if (nested.result.state !== 'opened') {
      return t('web.status.noNestedCodec', { name: entryPath, reason: nested.result.reason })
    }
    const operations = operationSessions.get(key)
    const extract = descriptor.operations.find(
      operation =>
        operation.state === 'available' &&
        !operation.mutatesSource &&
        operation.id === CONTAINER_EXTRACT_OPERATION_ID,
    )
    let bytes = verifiedBytes?.slice() ?? new Uint8Array()
    if (verifiedBytes === undefined && operations !== undefined && extract !== undefined) {
      const read = await operations.invoke(extract.handlerId, { entryId }, {})
      if (read.state === 'ok' && read.output.kind === 'bytes') bytes = read.output.value.slice()
    }
    const id = nestedEntryId(key, entryPath)
    const label = entryPath.slice(entryPath.lastIndexOf('/') + 1)
    const selectedRoute = Object.freeze([
      ...(selectedRoutes.get(key) ?? []),
      selectedStep(nested.result),
    ])
    pendingNested.set(id, { result: nested.result, bytes, label, selectedRoute })
    await editors.open({ id, name: label, directory: false })
    return undefined
  }

  const stages = createWebPreviewStages({
    localizer,
    renderer: services.renderer,
    operationsFor: descriptor => operationSessions.get(descriptorKey(descriptor)),
    textures: (descriptor, references, signal) => {
      const raster = rasterResources.get(descriptorKey(descriptor))
      return raster === undefined
        ? Promise.resolve(new Map())
        : resolveModelViewerTextures(raster, references, signal)
    },
    rasterResources: descriptor => rasterResources.get(descriptorKey(descriptor)),
    /*
     * The web half of `block9/archive-entry-as-subject` (block 13 slice B).
     *
     * Electron reached this route from its composition and VS Code reached it from its Explorer;
     * this page reached it from nowhere, and its archive stage settled for a hex pane. The route is
     * the host's, unchanged: the parent container stays open and leased for as long as the child
     * lives, so a model inside an archive finds its texture inside that same archive rather than
     * through a file this browser could not open anyway.
     */
    openNestedEntry,
  })

  const previewBase = {
    supported: services.supportedExtensions,
    stages,
    fallback: createWebPreviewFallback(localizer),
    async openSession(entry: ExplorerEntry, bytes: Uint8Array, signal?: AbortSignal) {
      openCount += 1
      /*
       * A file this session can write is opened under a grant that says so, and pinned to the
       * revision its handle reported. A file it cannot write keeps the old read-only grant and a
       * token that only has to be unique — no backend will ever be asked to honour it.
       */
      const writable = editability.get(entry.id)?.editable === true
      const token =
        pinnedRevisions.get(entry.id) ?? `provider-token:${bytes.byteLength}-${openCount}`
      const grant: PermissionGrant = {
        id: `pwa-${openCount}`,
        classes: writable ? ['read-source', 'write-source'] : ['read-source'],
      }
      const budget = {
        maxInputBytes: BigInt(
          activeFormatSmokeCase === undefined
            ? EXPLORER_MAXIMUM_BYTES
            : WEB_OFFLINE_RELEASE.maxArtifactBytes,
        ),
        maxDepth: 256,
        maxNodes: 1_000_000,
        maxScalarBytes: 64 * 1024 * 1024,
        maxDiagnostics: 10_000,
        deadlineMs: 30_000,
      }
      /*
       * A member of a container was already opened by the nested route, with its container held
       * behind it. Opening it again here would open it from bytes alone and quietly drop that.
       */
      const nested = pendingNested.get(entry.id)
      if (nested !== undefined) pendingNested.delete(entry.id)
      const ordinary =
        nested?.result ??
        (await services.open({
          source: bytesSource(entry.id, bytes, token),
          path: entry.name,
          intent: 'full',
          grant,
          budget,
          ...(signal === undefined ? {} : { signal }),
        }))
      if (activeFormatSmokeCase !== undefined) {
        lastFormatSmokeCandidates = summarizeFormatSmokeCandidates(ordinary)
      }
      if (ordinary.state === 'unresolved') {
        if (activeFormatSmokeCase !== undefined) {
          lastFormatSmokeHostFailure = `${ordinary.reason}; candidates=${lastFormatSmokeCandidates}`
        }
        say(t('web.status.noCodec', { name: entry.name, reason: ordinary.reason }))
        return undefined
      }
      let mapPreview = await prepareWebMapPreview({
        services,
        opened: ordinary,
        grant,
        budgets: budget,
        localizer,
        ...(signal === undefined ? {} : { signal }),
      })
      if (mapPreview.state === 'selection-required') {
        const choice = window.prompt(
          t('web.map.choose', {
            candidates: mapPreview.candidates
              .map(
                candidate =>
                  `${candidate.candidateId} — ${candidate.displayName}${
                    candidate.sourcePath === undefined ? '' : ` (${candidate.sourcePath})`
                  }`,
              )
              .join('\n'),
          }),
          '',
        )
        const selected = mapPreview.candidates.find(
          candidate => candidate.candidateId === choice?.trim(),
        )
        if (selected !== undefined) {
          mapPreview = await prepareWebMapPreview({
            services,
            opened: ordinary,
            grant,
            budgets: budget,
            selectionId: selected.candidateId,
            localizer,
            ...(signal === undefined ? {} : { signal }),
          })
        }
      }
      const result = mapPreview.opened
      if (mapPreview.state === 'permission-required') {
        say(t('web.map.permissionRequired', { name: entry.name }))
      } else if (mapPreview.state === 'selection-required') {
        say(
          t('web.map.selectionRequired', {
            name: entry.name,
            candidates: mapPreview.candidates.map(candidate => candidate.displayName).join(', '),
          }),
        )
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
        dataSource(
          contract: string,
          major: number,
        ): Promise<{ value: unknown; release(): Promise<void> }>
        operations(): OperationSession
        dispose(): Promise<void>
      }
      const key = descriptorKey(result.descriptor)
      const actualSelectedRoute = nested?.selectedRoute ?? Object.freeze([selectedStep(result)])
      selectedRoutes.set(key, actualSelectedRoute)
      if (activeFormatSmokeCase !== undefined) {
        lastFormatSmokeOpen = Object.freeze({
          caseId: activeFormatSmokeCase,
          descriptor: result.descriptor,
          selectedRoute: actualSelectedRoute,
        })
      }
      const presentation = await resolveCommonPresentationPlan(
        result.descriptor,
        {
          sessionId: `pwa:${key}`,
          providerId: result.selected.contributionId,
          variantId: result.selected.variantId,
        },
        { availableStageIds: stages.map(stageIdOf) },
      )
      /*
       * Format smoke must inspect a real namespace DOM even when the selected codec's product
       * presentation prefers a semantic card. Add that stage only to this opt-in acceptance
       * session; the shipped stage's default/app-local policy remains untouched.
       */
      const previewPresentation = (() => {
        const plan = presentation?.plan
        if (
          activeFormatSmokeStage !== 'tree' ||
          !result.descriptor.dataSources.some(
            source => source.contract === 'common.view/namespace-entry-source',
          ) ||
          plan === undefined ||
          plan.activeStage === undefined ||
          plan.slots.some(slot => slot.slotId === 'archive')
        ) {
          return plan
        }
        return Object.freeze({
          ...plan,
          slots: Object.freeze([
            ...plan.slots,
            Object.freeze({
              slotId: 'archive',
              kind: 'stage',
              contributionId: result.selected.contributionId,
              extensionId: result.selected.extensionId,
              priority: 0,
              bindings: Object.freeze([
                Object.freeze({
                  bindingId: 'content',
                  contract: 'common.view/namespace-entry-source',
                  major: 1,
                }),
              ]),
            }),
          ]),
          alternateStages: Object.freeze([...plan.alternateStages, 'archive']),
        }) as PresentationPlan
      })()
      const operations = session.operations()
      let commandAuthority: WebCommandSubjectLease | undefined
      /*
       * The protocol gets no raw browser path. Only a file that this explorer resolved through its
       * current WebFileAccess (and can still answer with an actual FileSystemHandle) is registered.
       * The authority holds that access object, so changing the global `access` on the next picker
       * does not retarget an already-open tab. Nested/archive members have a different parent lease
       * and are intentionally not smuggled through this file-handle route.
       */
      if (nested === undefined && access?.handleOf(entry.id) !== undefined) {
        try {
          commandAuthority = services.commands.authorize({
            access,
            entry,
            request: { intent: 'full', grant, budget },
          })
        } catch (error) {
          say(
            t('web.status.sharedCommandsUnavailable', { name: entry.name, reason: String(error) }),
          )
        }
      }
      operationSessions.set(key, operations)
      // Kept beside the operations arm so a container member can be opened as a subject of its own.
      assetSessions.set(key, result.session)
      if (result.rasterResources !== undefined) rasterResources.set(key, result.rasterResources)
      openedEntries.set(entry.id, entry)
      entryOfDescriptor.set(key, entry.id)
      /*
       * One editing surface per opened subject, composed here rather than per stage mount: the
       * tab's editors (Path B) and its Edit panel (Path A) then share a single grant snapshot and
       * a single commit coordinator. A subject this page will not write gets none, and with it no
       * editable stage and no Edit panel — the same fact, said once.
       */
      let releaseWriter: (() => Promise<void>) | undefined
      if (writable) {
        const writerResolution = await resolveFormatWriter({
          services: services.main,
          opened: result,
          grant,
          budgets: budget,
        })
        writerResolution.diagnostics.forEach(item => say(`${entry.name} — ${item.message}`))
        releaseWriter = writerResolution.release
        const editor = editing.editorFor({
          entryId: entry.id,
          name: entry.name,
          opened: result,
          grant,
          bytes,
          ...(writerResolution.writer === undefined ? {} : { writer: writerResolution.writer }),
        })
        if (editor !== undefined) subjectEditors.set(entry.id, editor)
        else {
          await releaseWriter?.()
          releaseWriter = undefined
        }
      }
      const decision = editability.get(entry.id)
      inspected.set(entry.id, {
        label: entry.name,
        descriptor: result.descriptor,
        operations,
        editable: subjectEditors.has(entry.id),
        ...(decision === undefined ? {} : { editNote: decision.sentence }),
      })
      inspecting = undefined
      inspect(entry.id)
      return {
        ...(previewPresentation === undefined ? {} : { presentation: previewPresentation }),
        descriptor: () => session.descriptor(),
        /*
         * What a view lists of a container leaves hidden members out unless it asks
         * (`includeHidden`) — the one filter, as the host applies to a page it serves over subject
         * RPC. The app's own readers (extract, nested opens) use the session and see everything.
         */
        dataSource: async (contract: string, major: number) => {
          const lease = await session.dataSource(contract, major)
          return contract === 'common.view/namespace-entry-source'
            ? {
                value: withoutHiddenEntries(lease.value as NamespaceEntrySource),
                release: () => lease.release(),
              }
            : lease
        },
        async dispose() {
          operationSessions.delete(key)
          assetSessions.delete(key)
          rasterResources.delete(key)
          selectedRoutes.delete(key)
          entryOfDescriptor.delete(key)
          inspected.delete(entry.id)
          openedEntries.delete(entry.id)
          subjectEditors.delete(entry.id)
          writableHandles.delete(sourceUriFor(entry.id))
          commandAuthority?.revoke()
          if (inspecting === entry.id) inspect(undefined)
          await releaseWriter?.()
          await session.dispose()
        },
      }
    },
  }

  /*
   * One resolver. `editorPorts` answers per entry and may answer `undefined`, which drops the
   * editable stages for that file alone — which is what a browser needs, because editability here
   * is a property of the file: this folder's PNG has a writable handle, the sample fetched from
   * the app origin does not.
   */
  const codecPreview = createCodecPreview({
    ...previewBase,
    /*
     * `openSession` above ran first and composed the subject's editing surface (or refused to);
     * this only hands out the half a stage needs. Asking the arm again here would compose a second
     * coordinator over the same file, and the tab's two edit paths would hold two grant snapshots.
     */
    editorPorts: entry => subjectEditors.get(entry.id)?.ports,
  })

  const preview: PreviewResolver = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const decision = await describeEditability(access, entry.id, entry.name, localizer)
      /*
       * A pinned revision is part of being editable: without the handle snapshot this tab read
       * before its bytes, the backend would compute a revision the plan never expected and every
       * save would look like a conflict. Refusing the editors is the honest form of that.
       */
      const source = sourceUriFor(entry.id)
      const handle = access?.handleOf(entry.id)
      const editable = decision.editable && pinnedRevisions.has(entry.id)
      if (editable && isWritableHandle(handle)) writableHandles.set(source, handle)
      else writableHandles.delete(source)
      editability.set(entry.id, editable ? decision : { ...decision, editable: false })
      noteEditing(decision.sentence)
      return codecPreview.open(container, entry, bytes, signal)
    },
  }

  // ---------------------------------------------------------------- editors + explorer
  const editors: EditorArea = createEditorArea(document, {
    localizer,
    preview,
    async confirmClose(entry) {
      /*
       * No "save" option: the Save button lives inside the editor stage and the shell has no way
       * to press it for a tab that is closing. Offering a button that would do nothing is worse
       * than offering two that do what they say.
       */
      return window.confirm(t('web.status.unsavedClose', { name: entry.name }))
        ? 'discard'
        : 'cancel'
    },
    async read(entry, signal) {
      // A container member has no file behind it; its bytes came out of the archive already.
      const nested = pendingNested.get(entry.id)
      if (nested !== undefined) return nested.bytes
      if (access === undefined) throw new Error('no folder or file is open')
      /*
       * The revision is pinned from the handle *before* the bytes are read, never after: if the
       * file changes in between, the tab holds the older bytes and the pin is the older revision,
       * so a later save is refused as a conflict. Pinning afterwards would silently bless the
       * change and overwrite it.
       */
      const snapshot = await access.snapshotOf(entry.id, signal)
      if (snapshot === undefined) pinnedRevisions.delete(entry.id)
      else pinnedRevisions.set(entry.id, sourceRevisionToken(snapshot))
      /*
       * Refuse rather than truncate. `read` caps at the limit, and a codec handed the first 64 MiB
       * of a larger file would detect and describe something that is not the file — the explorer's
       * own preview pane refuses for the same reason, and this path replaced that pane. The size
       * comes from the access: the tree rebuilds its `ExplorerEntry` without one.
       */
      const size = access.sizeOf(entry.id) ?? entry.size
      const maximumBytes =
        activeFormatSmokeCase === undefined
          ? EXPLORER_MAXIMUM_BYTES
          : WEB_OFFLINE_RELEASE.maxArtifactBytes
      if (size !== undefined && size > maximumBytes) {
        throw new Error(
          `${entry.name} is ${(size / (1024 * 1024)).toFixed(1)} MiB, over the ` +
            `${maximumBytes / (1024 * 1024)} MiB this host will read into memory`,
        )
      }
      return access.read(entry.id, maximumBytes, signal)
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(' · '))
      // The panel is about the focused tab, so switching tabs re-targets it rather than
      // leaving the last opened file's diagnostics on screen.
      inspect(status.path)
      focused = status.path
    },
  })
  markDirty = (entryId, dirty) => editors.markDirty(entryId, dirty)

  const recovery = createWebSessionRecovery({
    hasUnsaved: () => editors.hasUnsaved(),
    confirmDiscard: () => window.confirm(t('confirm.discardAndRestart')),
    restart: async () => {
      await services.dispose()
      window.location.reload()
    },
    onState: state => {
      restartSession.hidden = state !== 'worker-unavailable'
      if (state === 'worker-unavailable') say(t('status.workerUnavailable'))
    },
  })
  recoveryHost.current = recovery
  for (const diagnostic of bootSessionDiagnostics) recovery.report(diagnostic)
  restartSession.addEventListener('click', () => void recovery.restart())

  /*
   * The hex editor reports unsaved work through `edit.propose` on every changed byte, so the arm
   * marks its tab. The text editor proposes only when Save is pressed, and a textarea that has
   * been typed into but not saved would look clean until then — so typing is observed here. The
   * event bubbles out of the stage, and only the focused tab can receive one, which is why the
   * focused path is the right tab to mark.
   */
  editors.root.addEventListener('input', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.dataset['mkPart'] !== 'editor.text') return
    if (focused !== undefined) editors.markDirty(focused, true)
  })

  const explorer = createExplorer(document, {
    localizer,
    preview,
    // The tree browses; the editor area owns what is open, so opening is delegated to it.
    onOpen(entry) {
      void editors.open(entry)
    },
    async openFolder() {
      const handle = await pickDirectory()
      if (handle === undefined) {
        say(capabilityNotice)
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
   * "Open file…" and the drop target are the shell's, not the explorer's: in the `packages/ui` this
   * worktree was cut from, the explorer routes both into the preview pane that is no longer in the
   * document, and a browser drop carries `File` objects rather than paths, so each dropped file is
   * its own one-entry access.
   *
   * Upstream has since given `createExplorer` an `onOpen`-routed file picker and a nominable
   * `dropTarget`. Once this sits on top of that, both of these move back into the explorer's own
   * options — but the handle must travel with the file either way (see `pickFile`), because a file
   * that arrives without one can never be saved back.
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

  async function openFile(file: WebFileLike, handle?: WebFileHandleLike): Promise<void> {
    const picked = createSingleFileAccess(file, handle)
    access = picked.access
    await explorer.setAccess(picked.access)
    await editors.open(picked.entry)
  }

  toolbarAction(t('action.openFile'), t('action.openFileTitle'), () => {
    void (async () => {
      try {
        const picked = await pickFile()
        if (picked !== undefined) await openFile(picked.file, picked.handle)
      } catch (error) {
        say(t('error.openFile', { reason: describe(error) }))
      }
    })()
  })
  toolbarAction(t('action.splitEditor'), t('action.splitEditorTitle'), () => editors.split())
  /*
   * The gesture the browser insists on. `requestPermission` is only honoured while the page holds
   * transient user activation, so it is a click and never boot; the same request also happens on a
   * Save click, which is why this control is a convenience rather than a precondition.
   */
  toolbarAction(t('action.enableEditing'), t('action.enableEditingTitle'), () => {
    void (async () => {
      const asked = await requestWriteAccess(access, localizer)
      say(asked.sentence)
      noteEditing(asked.sentence)
    })()
  })

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
    void openFile(file).catch((error: unknown) => say(t('error.drop', { reason: describe(error) })))
  })

  // ---------------------------------------------------------------- settings
  const settingsUi = createSettingsUi(document, {
    localizer,
    store: settingsStore,
    themes: appThemes,
    onAppearance(appearance: SettingsDocument['appearance']) {
      applyAppearance(document.documentElement, appearance)
    },
    onChange(document) {
      settingsDocument = document
    },
    onClose() {
      showView('explorer')
    },
  })

  function bundledExtensionsSection(): HTMLElement {
    const section = document.createElement('section')
    section.className = 'web-extensions'
    element(section, 'h2', { text: t('settings.bundled') })
    element(section, 'p', {
      part: 'settings.description',
      text: t('settings.bundledDescription', {
        count: WEB_EXTENSION_CATALOG.extensions.length,
        reason: EXTENSIONS_READ_ONLY_REASON,
      }),
    })
    const list = element(section, 'div', { part: 'settings.list' })
    for (const entry of WEB_EXTENSION_CATALOG.extensions) {
      const item = element(list, 'div', { part: 'settings.extension' })
      const text = element(item, 'div', { part: 'settings.extension-text' })
      element(text, 'div', { part: 'settings.label', text: entry.name })
      element(text, 'div', { part: 'settings.description', text: entry.artifactRoot })
    }
    if (WEB_EXTENSION_CATALOG.excluded.length > 0) {
      element(section, 'h2', { text: t('settings.bundledExcluded') })
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
  settingsView.append(settingsUi.root, extensionsUi.root, bundledExtensionsSection())
  await settingsUi.reload()

  // ---------------------------------------------------------------- sidebar: the host itself
  const sidebar = document.createElement('div')
  sidebar.className = 'web-host-panel'
  element(sidebar, 'h2', { text: t('sidebar.host') })
  element(sidebar, 'p', {
    part: 'settings.description',
    text: t('sidebar.hostSummary', {
      extensions: services.main.inventory.extensions.length,
      types: services.supportedExtensions.length,
      profiles: services.executionProfiles.join('/'),
      realm: services.worker.profile.realmId,
      sharedMemory: t(probe.sharedMemory ? 'common.yes' : 'common.no'),
    }),
  })
  element(sidebar, 'p', { part: 'settings.description', text: capabilityNotice })
  element(sidebar, 'p', { part: 'settings.description', text: t('web.editing.notice') })
  /*
   * The live half of that notice: which of the two the file in front of you is, and what the last
   * save actually did. `noteEditing` writes here, so the claim on screen is about this session and
   * not a general statement about browsers.
   */
  sidebar.append(editingStatus)
  element(sidebar, 'h2', { text: t('sidebar.facilities') })
  const facilities = element(sidebar, 'ul', { part: 'settings.list' })
  for (const facility of services.main.profile.facilities) {
    element(facilities, 'li', { text: facility })
  }
  element(sidebar, 'h2', { text: t('sidebar.samples') })
  const sampleList = element(sidebar, 'div', { part: 'settings.list' })
  for (const sample of SAMPLES) {
    const button = element(sampleList, 'button', {
      part: 'explorer.action',
      text: t(sample.labelKey),
    }) as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', () => {
      void openServed(sample.path).catch((error: unknown) => say(describe(error)))
    })
  }
  element(sidebar, 'h2', { text: t('sidebar.language') })
  const localePicker = element(sidebar, 'select', {
    part: 'settings.select',
  }) as HTMLSelectElement
  for (const candidate of ['en', 'ru'] as const) {
    const option = document.createElement('option')
    option.value = candidate
    setViewerText(option, t(`locale.${candidate}`))
    localePicker.append(option)
  }
  localePicker.value = locale
  localePicker.setAttribute('aria-label', t('sidebar.language'))
  localePicker.addEventListener('change', () => {
    const target = new URL(window.location.href)
    target.searchParams.set('lang', localePicker.value)
    window.location.assign(target.href)
  })
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

  activity(t('activity.files'), t('activity.explorer'), () => showView('explorer'), 'explorer')
  activity(t('activity.host'), t('activity.hostTitle'), () => {
    workbench.sidebar.hidden = !workbench.sidebar.hidden
  })
  activity(t('activity.info'), t('activity.infoTitle'), () => {
    workbench.panel.hidden = !workbench.panel.hidden
  })
  activity(t('activity.settings'), t('activity.settings'), () => showView('settings'), 'settings')

  workbench.panel.hidden = true
  workbench.sidebar.hidden = false
  showView('explorer')
  // The empty state is drawn once here; `inspect` only redraws when the focused file changes.
  await inspector.show(undefined)
  say(
    t('status.ready', {
      extensions: services.main.inventory.extensions.length,
      notices: bootDiagnostics.length,
    }),
  )

  // ---------------------------------------------------------------- served resources
  async function openServed(path: string): Promise<void> {
    const file = await fetchServed(baseUrl, path)
    if (file === undefined) {
      say(t('error.fetch', { path }))
      return
    }
    if (activeView !== 'explorer') showView('explorer')
    await openFile(file)
  }

  // ----------------------------------------------------- installed format-family acceptance
  const digestBytes = async (bytes: Uint8Array): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  }

  const verifiedCorpus = async (
    testCase: FormatSmokeAuthorityCase,
    bytes: Uint8Array,
  ): Promise<{
    readonly bytes: number
    readonly sha256: string
    readonly verifiedBeforeOpen: true
  }> => {
    const expectedBytes = testCase.corpus.bytes
    const expectedSha256 = testCase.corpus.sha256
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes === undefined ||
      expectedBytes < 0 ||
      typeof expectedSha256 !== 'string'
    ) {
      throw new TypeError(`${testCase.id} has no generated corpus identity`)
    }
    const sha256 = await digestBytes(bytes)
    if (bytes.byteLength !== expectedBytes || sha256 !== expectedSha256) {
      throw new TypeError(`${testCase.id} corpus does not match the generated identity`)
    }
    return Object.freeze({ bytes: bytes.byteLength, sha256, verifiedBeforeOpen: true })
  }

  const namespaceEntry = async (
    descriptor: AnyDescriptor,
    entryPath: string,
  ): Promise<{ readonly id: string; readonly bytes: Uint8Array }> => {
    const key = descriptorKey(descriptor)
    const parent = assetSessions.get(key)
    const operations = operationSessions.get(key)
    if (parent === undefined || operations === undefined) {
      throw new TypeError('the opened container session is unavailable')
    }
    const extract = descriptor.operations.find(
      operation =>
        operation.state === 'available' &&
        !operation.mutatesSource &&
        operation.id === CONTAINER_EXTRACT_OPERATION_ID,
    )
    if (extract === undefined) throw new TypeError('the opened container has no extract operation')
    const lease = await parent.dataSource('common.view/namespace-entry-source', 1)
    const source = lease.value as NamespaceEntrySource
    const target = entryPath.replaceAll('\\', '/').replace(/^\/+|\/+$/gu, '')
    try {
      let found: { readonly id: string; readonly path: string } | undefined
      const basename = target.slice(target.lastIndexOf('/') + 1)
      if (source.search !== undefined) {
        let cursor: string | undefined
        for (let page = 0; page < 100 && found === undefined; page += 1) {
          const answer = await source.search(
            { kind: 'basename-any', basenames: [basename], caseSensitive: true },
            { limit: 200, ...(cursor === undefined ? {} : { cursor }) },
          )
          found = answer.items.find(item => item.path.replaceAll('\\', '/') === target)
          cursor = answer.nextCursor
          if (cursor === undefined) break
        }
      }
      if (found === undefined) {
        let cursor: string | undefined
        for (let page = 0; page < 1_000 && found === undefined; page += 1) {
          const answer = await source.list('', {
            limit: 200,
            ...(cursor === undefined ? {} : { cursor }),
          })
          found = answer.items.find(item => item.path.replaceAll('\\', '/') === target)
          cursor = answer.nextCursor
          if (cursor === undefined) break
        }
      }
      if (found === undefined) {
        let prefix = ''
        for (const segment of target.split('/')) {
          let cursor: string | undefined
          let next: { readonly id: string; readonly path: string } | undefined
          const wanted = prefix === '' ? segment : `${prefix}/${segment}`
          for (let page = 0; page < 100 && next === undefined; page += 1) {
            const answer = await source.list(prefix, {
              limit: 200,
              ...(cursor === undefined ? {} : { cursor }),
            })
            next = answer.items.find(item => item.path.replaceAll('\\', '/') === wanted)
            cursor = answer.nextCursor
            if (cursor === undefined) break
          }
          if (next === undefined) break
          prefix = wanted
          if (wanted === target) found = next
        }
      }
      if (found === undefined) throw new TypeError('the generated container member is absent')
      const read = await operations.invoke(extract.handlerId, { entryId: found.id }, {})
      if (read.state !== 'ok' || read.output.kind !== 'bytes') {
        throw new TypeError('the container refused to extract the generated member')
      }
      return Object.freeze({ id: found.id, bytes: read.output.value.slice() })
    } finally {
      await lease.release()
    }
  }

  const activeEditorGroup = (): HTMLElement => {
    const active = editors.root.querySelector(
      '[data-mk-part="explorer.group"][data-mk-state~="active"]',
    )
    return active instanceof HTMLElement ? active : editors.root
  }
  const visibleInGroup = (group: HTMLElement, selector: string): Element | undefined =>
    [...group.querySelectorAll(selector)].find(
      node => node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute('hidden') !== true,
    )
  const visibleCount = (group: HTMLElement, selector: string): number =>
    [...group.querySelectorAll(selector)].filter(
      node => node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute('hidden') !== true,
    ).length
  const waitForStage = async (test: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (test()) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (!test())
      throw new TypeError('the selected preview stage did not reach a terminal DOM state')
  }
  const selectFormatSmokeStage = async (id: string, ready: () => boolean): Promise<HTMLElement> => {
    const group = activeEditorGroup()
    const picker = group.querySelector('[data-mk-part="explorer.viewpicker"]')
    if (!(picker instanceof HTMLSelectElement))
      throw new TypeError('the active tab has no stage picker')
    if (![...picker.options].some(option => option.value === id)) {
      throw new TypeError(
        `the actual descriptor did not offer stage ${id}; available=${[...picker.options]
          .map(option => option.value)
          .join(',')}`,
      )
    }
    picker.value = id
    picker.dispatchEvent(new Event('change'))
    await waitForStage(() => picker.value === id && ready())
    return group
  }
  const hasFormatSmokeStage = (id: string): boolean => {
    const picker = activeEditorGroup().querySelector('[data-mk-part="explorer.viewpicker"]')
    return (
      picker instanceof HTMLSelectElement && [...picker.options].some(option => option.value === id)
    )
  }
  const metadataEntryCount = async (): Promise<number> => {
    const group = await selectFormatSmokeStage(
      'metadata',
      () => visibleInGroup(activeEditorGroup(), '[data-mk-part="metadata.row"]') !== undefined,
    )
    return visibleCount(group, '[data-mk-part="metadata.row"]')
  }
  const observeFormatSmokeStage = async (
    expected: FormatSmokeAuthorityCase['stage'],
  ): Promise<PwaFormatSmokeStageEvidence> => {
    if (expected === 'raster') {
      const group = await selectFormatSmokeStage('image', () => {
        const node = visibleInGroup(activeEditorGroup(), '[data-mk-part="image.canvas"]')
        return node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0
      })
      const canvas = visibleInGroup(group, '[data-mk-part="image.canvas"]') as HTMLCanvasElement
      const readout = visibleInGroup(group, '[data-mk-part="image.readout"]')
      const metadataEntries = (readout?.textContent ?? '').trim() === '' ? 0 : 1
      const sample = document.createElement('canvas')
      sample.width = Math.min(canvas.width, 64)
      sample.height = Math.min(canvas.height, 64)
      const context = sample.getContext('2d', { willReadFrequently: true })
      if (context === null) throw new TypeError('the browser has no readable raster canvas')
      context.drawImage(canvas, 0, 0, sample.width, sample.height)
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data
      let opaquePixels = 0
      for (let index = 3; index < pixels.length; index += 4) {
        if ((pixels[index] ?? 0) > 0) opaquePixels += 1
      }
      return Object.freeze({
        kind: 'raster',
        width: canvas.width,
        height: canvas.height,
        opaquePixels,
        // The image stage's actual codec-backed dimension/byte readout is raster metadata. Some
        // image descriptors intentionally publish no separate descriptor metadata groups.
        metadataEntries,
      })
    }
    if (expected === 'tree-text') {
      const treeGroup = await selectFormatSmokeStage(
        'tree',
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== undefined,
      )
      const treeNodes = visibleCount(treeGroup, '[data-mk-part="tree.item"]')
      // A resolved presentation plan may intentionally expose the XML tree slot but not a second
      // redundant text slot. The tree viewer's codec-backed labels are still real rendered text,
      // so prove both halves from that selected product stage rather than bypassing its plan.
      const textCharacters = (
        visibleInGroup(treeGroup, '[data-mk-part="tree.list"]')?.textContent ?? ''
      ).trim().length
      return Object.freeze({ kind: 'tree-text', treeNodes, textCharacters })
    }
    if (expected === 'tree') {
      if (!hasFormatSmokeStage('archive')) {
        const group = await selectFormatSmokeStage(
          'tree',
          () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== undefined,
        )
        return Object.freeze({
          kind: 'tree',
          treeNodes: visibleCount(group, '[data-mk-part="tree.item"]'),
        })
      }
      const group = await selectFormatSmokeStage(
        'archive',
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="namespace.item"]') !== undefined,
      )
      return Object.freeze({
        kind: 'tree',
        treeNodes: visibleCount(group, '[data-mk-part="namespace.item"]'),
      })
    }
    if (expected === 'metadata-tree') {
      const metadataEntries = await metadataEntryCount()
      const group = await selectFormatSmokeStage(
        'tree',
        () => visibleInGroup(activeEditorGroup(), '[data-mk-part="tree.item"]') !== undefined,
      )
      return Object.freeze({
        kind: 'metadata-tree',
        metadataEntries,
        treeNodes: visibleCount(group, '[data-mk-part="tree.item"]'),
      })
    }
    /*
     * The model stage draws through whichever backend this page resolved, so the probe selects the
     * canvas and *reads* the backend rather than requiring one. Requiring `wireframe` would have
     * turned a page that successfully resolved a GPU renderer into a smoke failure, and reporting
     * `wireframe` unconditionally — which the previous version did — would have said the fallback
     * had drawn on a machine where it had not.
     */
    const modelCanvas = (root: HTMLElement): HTMLCanvasElement | undefined => {
      const node = visibleInGroup(root, '[data-mk-part="model.canvas"][data-model-renderer]')
      return node instanceof HTMLCanvasElement && node.width > 0 && node.height > 0
        ? node
        : undefined
    }
    const group = await selectFormatSmokeStage(
      'model',
      () => modelCanvas(activeEditorGroup()) !== undefined,
    )
    const canvas = modelCanvas(group) as HTMLCanvasElement
    return Object.freeze({
      kind: 'model-or-wireframe',
      renderer: canvas.getAttribute('data-model-renderer') ?? 'wireframe',
      rendererStatus: canvas.getAttribute('data-model-renderer-status') ?? 'unavailable',
      ...(canvas.getAttribute('data-model-renderer-id') === null
        ? {}
        : { rendererId: canvas.getAttribute('data-model-renderer-id') as string }),
      width: canvas.width,
      height: canvas.height,
    })
  }

  const openFormatSmokeCase = async (
    testCase: FormatSmokeAuthorityCase,
    corpusUrl: string,
  ): Promise<PwaFormatSmokeOpenedResult> => {
    const url = new URL(corpusUrl, window.location.href)
    if (url.origin !== window.location.origin) {
      throw new TypeError('format smoke corpus must be served from this PWA origin')
    }
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new TypeError('format smoke corpus request failed')
    const bytes = new Uint8Array(await response.arrayBuffer())
    const name = decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/') + 1))
    if (name === '') throw new TypeError('format smoke corpus URL has no filename')
    const currentFormatSmokeOpen = () => lastFormatSmokeOpen
    activeFormatSmokeCase = testCase.id
    activeFormatSmokeStage = testCase.stage
    lastFormatSmokeOpen = undefined
    lastFormatSmokeHostFailure = undefined
    lastFormatSmokeCandidates = undefined
    try {
      if (testCase.corpus.kind === 'warzone-wz-entry') {
        await openFile(
          new File([bytes], name, { type: response.headers.get('content-type') ?? '' }),
        )
        const parent = currentFormatSmokeOpen()
        if (parent === undefined || parent.caseId !== testCase.id) {
          throw new TypeError('the generated container did not open')
        }
        if (JSON.stringify(parent.selectedRoute) !== JSON.stringify(testCase.route.slice(0, 1))) {
          console.warn(
            `[format-smoke] ${testCase.id} parent route candidates=${lastFormatSmokeCandidates ?? 'unavailable'}`,
          )
        }
        const entryPath = testCase.corpus.path
        if (typeof entryPath !== 'string') throw new TypeError('the generated entry path is absent')
        const entry = await namespaceEntry(parent.descriptor, entryPath)
        const corpus = await verifiedCorpus(testCase, entry.bytes)
        const problem = await openNestedEntry(parent.descriptor, entry.id, entryPath, entry.bytes)
        if (problem !== undefined) throw new TypeError('the nested subject did not open')
        const child = currentFormatSmokeOpen()
        if (child === undefined || child.caseId !== testCase.id) {
          throw new TypeError('the generated nested subject did not become active')
        }
        return Object.freeze({
          selectedRoute: child.selectedRoute,
          corpus,
          stage: await observeFormatSmokeStage(testCase.stage),
        })
      }
      const corpus = await verifiedCorpus(testCase, bytes)
      await openFile(new File([bytes], name, { type: response.headers.get('content-type') ?? '' }))
      const opened = currentFormatSmokeOpen()
      if (opened === undefined || opened.caseId !== testCase.id) {
        throw new TypeError(
          `the real browser host did not open the generated corpus: ${lastFormatSmokeHostFailure ?? 'no opened result'}`,
        )
      }
      if (JSON.stringify(opened.selectedRoute) !== JSON.stringify(testCase.route)) {
        console.warn(
          `[format-smoke] ${testCase.id} route candidates=${lastFormatSmokeCandidates ?? 'unavailable'}`,
        )
      }
      return Object.freeze({
        selectedRoute: opened.selectedRoute,
        corpus,
        stage: await observeFormatSmokeStage(testCase.stage),
      })
    } finally {
      activeFormatSmokeCase = undefined
      activeFormatSmokeStage = undefined
    }
  }

  const openFormatSmokeHostOnlySource = async (
    testCase: FormatSmokeAuthorityCase,
  ): Promise<never> => {
    const terminal = testCase.route.at(-1)
    if (
      testCase.runtime.pwa.kind !== 'host-facility-refusal' ||
      testCase.corpus.kind !== 'sc2-casc-entry' ||
      typeof testCase.corpus.path !== 'string' ||
      typeof testCase.corpus.sha256 !== 'string' ||
      typeof testCase.corpus.bytes !== 'number' ||
      testCase.route[0]?.formatId !== 'casc' ||
      terminal === undefined
    ) {
      throw new TypeError('the generated case is not an SC2/CASC source-open request')
    }
    return services.sourceOpen.openSc2CascEntry({
      requestId: testCase.id,
      source: {
        kind: testCase.corpus.kind,
        entryPath: testCase.corpus.path,
        contentSha256: testCase.corpus.sha256,
        bytes: testCase.corpus.bytes,
      },
      requestedFormatId: terminal.formatId,
    })
  }

  if (pageUrl.searchParams.has('format-smoke')) {
    const loaded = await loadPwaFormatSmokeAuthority(
      new URL('./format-smoke.v1.json', document.baseURI).href,
      __MODKIT_FORMAT_SMOKE_AUTHORITY_SHA256__,
    )
    const control = createPwaFormatSmokeAcceptance({
      authority: loaded.authority,
      authoritySha256: loaded.sha256,
      bridge: {
        async preparePackages(ids) {
          let changed = false
          let model = await managedExtensions.refreshCatalog()
          for (const id of ids) {
            const row = model.rows.find(candidate => candidate.id === id)
            if (row === undefined)
              throw new TypeError('the signed catalog lacks an expected package')
            if (!row.installed) {
              model = await managedExtensions.install(id)
              changed = true
            } else if (row.updateAvailable) {
              model = await managedExtensions.update(id)
              changed = true
            } else if (!row.enabled) {
              model = await managedExtensions.enable(id, true)
              changed = true
            }
          }
          return Object.freeze({ reloadRequired: changed })
        },
        async runtimeIdentity() {
          const packages = await managedStorage.list()
          const countedCoordinates = new Set([
            ...catalogCoordinates(WEB_EXTENSION_CATALOG),
            ...managedRoots.coordinates,
          ])
          return Object.freeze({
            offlineCatalogSha256: WEB_OFFLINE_RELEASE.catalogSha256,
            loadedManagedRoots: Object.freeze([...managedRoots.coordinates]),
            codecContributionCount: services.main.inventory.extensions.reduce(
              (count, extension) =>
                count +
                (countedCoordinates.has(`${extension.manifest.publisher}/${extension.manifest.id}`)
                  ? extension.contributions.filter(
                      contribution =>
                        contribution.manifest?.contract.id === 'modkit/codec-contribution',
                    ).length
                  : 0),
              0,
            ),
            packages: Object.freeze(
              packages.map(item =>
                Object.freeze({
                  id: item.id,
                  version: item.version,
                  digest: item.digest,
                  enabled: item.enabled,
                }),
              ),
            ),
          })
        },
        open: openFormatSmokeCase,
        openHostOnlySource: openFormatSmokeHostOnlySource,
        reportFailure: (caseId, error) => console.warn(`[format-smoke] ${caseId}`, error),
      },
    })
    Object.defineProperty(globalThis, '__MODKIT_FORMAT_SMOKE__', {
      configurable: true,
      enumerable: false,
      value: control,
    })
    Object.defineProperty(globalThis, '__MODKIT_ACCEPTANCE__', {
      configurable: true,
      enumerable: false,
      get: () => control.receipt(),
    })
  }

  // `?open=<same-origin path>` — launch the app on a served resource (also the manual smoke path).
  const requested = pageUrl.searchParams.get('open')
  if (requested !== null) await openServed(requested)

  // ---------------------------------------------------------------- the save path, in the page
  /**
   * Drive an entire save in the running browser, over a handle held in memory.
   *
   * The real `showDirectoryPicker` needs a user gesture an automated run cannot produce, so this
   * substitutes exactly the one thing that gesture would have produced — a handle with
   * `createWritable()` — and leaves everything else real: the same `WebFileAccess` shape, the same
   * codecs in the same module workers, the same stage list, the same editing backend, the same
   * commit coordinator, the same DOM events a person's clicks raise. What it proves is the write
   * path end to end; what it deliberately cannot prove is the browser's own permission dialog.
   */
  async function probeEditing(log: (line: string) => void): Promise<void> {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 60))
    const until = async (test: () => boolean): Promise<boolean> => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (test()) return true
        await settle()
      }
      return test()
    }

    /** One in-memory file behind a handle that behaves like the File System Access one. */
    const memoryFile = (name: string, text: string) => {
      let content = encoder.encode(text)
      let modified = 1_000
      const handle: WebWritableFileHandleLike = {
        kind: 'file',
        name,
        async getFile() {
          const held = content
          return {
            name,
            size: held.byteLength,
            lastModified: modified,
            slice: (start: number, end: number) => ({
              async arrayBuffer() {
                const part = held.slice(start, end)
                const copy = new ArrayBuffer(part.byteLength)
                new Uint8Array(copy).set(part)
                return copy
              },
            }),
          }
        },
        async createWritable() {
          const chunks: Uint8Array[] = []
          return {
            async write(data: Uint8Array) {
              chunks.push(data.slice())
            },
            async close() {
              const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
              const next = new Uint8Array(total)
              let at = 0
              for (const chunk of chunks) {
                next.set(chunk, at)
                at += chunk.byteLength
              }
              content = next
              // a real write moves the mtime, which is what the revision guard reads
              modified += 1
            },
          }
        },
        async queryPermission() {
          return 'granted' as const
        },
        async requestPermission() {
          return 'granted' as const
        },
      }
      return {
        handle,
        entry: { id: name, name, directory: false, size: content.byteLength },
        text: () => decoder.decode(content),
        size: () => content.byteLength,
        modified: () => modified,
      }
    }

    const first = memoryFile('selftest-text.csv', 'a,b\n1,2\n')
    const second = memoryFile('selftest-hex.csv', 'a,b\n3,4\n')
    const files = [first, second]
    const byId = new Map(files.map(file => [file.entry.id, file]))
    const memory: WebFileAccess = {
      label: 'in-memory grant',
      writeGrant: first.handle,
      async list(entryId) {
        return entryId === undefined ? files.map(file => file.entry) : []
      },
      sizeOf: entryId => byId.get(entryId)?.size(),
      handleOf: entryId => byId.get(entryId)?.handle,
      async snapshotOf(entryId) {
        const file = byId.get(entryId)
        return file === undefined ? undefined : { size: file.size(), lastModified: file.modified() }
      },
      async read(entryId) {
        const file = byId.get(entryId)
        if (file === undefined) throw new TypeError(`${entryId} is not in the memory grant`)
        return encoder.encode(file.text())
      },
    }

    /*
     * Every lookup is scoped to the *focused* group. The area splits earlier in this run, so a
     * document-wide `querySelector` would answer with the first group's picker and quietly test
     * the wrong file — which is exactly what it did before this scope existed.
     */
    const group = (): HTMLElement => {
      const active = editors.root.querySelector(
        '[data-mk-part="explorer.group"][data-mk-state~="active"]',
      )
      return active instanceof HTMLElement ? active : editors.root
    }
    const picker = (): HTMLSelectElement | undefined => {
      const node = group().querySelector('[data-mk-part="explorer.viewpicker"]')
      return node instanceof HTMLSelectElement ? node : undefined
    }
    const visible = (node: Element): boolean =>
      node.closest('[data-mk-part="explorer.tabcontent"]')?.hasAttribute('hidden') !== true
    const saveButton = (): HTMLButtonElement | undefined =>
      [...group().querySelectorAll('button')].find(
        button => button.textContent === 'Save' && visible(button),
      )
    const inStage = (part: string): Element | undefined =>
      [...group().querySelectorAll(`[data-mk-part="${part}"]`)].find(visible)
    const showView = async (id: string): Promise<boolean> => {
      const select = picker()
      if (select === undefined || ![...select.options].some(option => option.value === id)) {
        log(`selftest: ${id} was not offered for the focused tab`)
        return false
      }
      select.value = id
      select.dispatchEvent(new Event('change'))
      await settle()
      return true
    }

    access = memory
    await explorer.setAccess(memory)

    // ---- a writable handle offers the editors
    await editors.open(first.entry)
    await settle()
    const views = [...(picker()?.options ?? [])].map(option => option.value)
    log(`selftest: writable file offers [${views.join(', ')}]`)
    log(`selftest: editing line says "${editingStatus.textContent ?? ''}"`)

    // ---- the text editor writes the bytes the user typed
    if (await showView('text-editor')) {
      const area = inStage('editor.text')
      if (area instanceof HTMLTextAreaElement) {
        area.value = 'a,b\n9,9\n'
        area.dispatchEvent(new Event('input', { bubbles: true }))
        const tab = [...group().querySelectorAll('[data-mk-part="explorer.filetab"]')].find(
          node => node.getAttribute('title') === first.entry.id,
        )
        log(`selftest: tab state after typing = ${tab?.getAttribute('data-mk-state') ?? 'none'}`)
        saveButton()?.click()
        await until(() => first.text() === 'a,b\n9,9\n')
        log(`selftest: text save wrote ${JSON.stringify(first.text())}`)
        log(`selftest: after text save "${editingStatus.textContent ?? ''}"`)
      } else {
        log('selftest: the text editor mounted no textarea')
      }
    }

    // ---- the hex editor writes one byte, through the same backend
    await editors.open(second.entry)
    await settle()
    if (await showView('hex-editor')) {
      const cell = inStage('hex.cell')
      if (cell instanceof HTMLElement) {
        cell.textContent = '5a'
        cell.dispatchEvent(new Event('blur'))
        await settle()
        saveButton()?.click()
        await until(() => second.text().startsWith('Z'))
        log(`selftest: hex save wrote ${JSON.stringify(second.text())}`)
      } else {
        log('selftest: the hex editor mounted no cells')
      }
      // ---- and the revision guard refuses the next save from the same tab
      const again = [...group().querySelectorAll('[data-mk-part="hex.cell"]')].filter(visible)[1]
      if (again instanceof HTMLElement) {
        again.textContent = '59'
        again.dispatchEvent(new Event('blur'))
        await settle()
        saveButton()?.click()
        await until(() => (editingStatus.textContent ?? '').includes('changed on disk'))
        log(`selftest: second save from a stale tab -> "${editingStatus.textContent ?? ''}"`)
        log(`selftest: file is still ${JSON.stringify(second.text())}`)
      }
    }
  }

  if (pageUrl.searchParams.get('selftest') !== null) {
    await selfTest({ openServed, editors, settingsView, inspector, probeEditing })
  }
}

// ---------------------------------------------------------------------------------------------
// self test

interface SelfTestParts {
  openServed(path: string): Promise<void>
  readonly editors: EditorArea
  readonly settingsView: HTMLElement
  readonly inspector: Inspector
  /** Drives a real save over an in-memory handle; see `probeEditing` in `boot`. */
  probeEditing(log: (line: string) => void): Promise<void>
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

  /*
   * Served samples reach the page through a same-origin fetch, so they have no writable handle and
   * must offer no editor. This is the half of the editing rule that has to stay true.
   */
  const editable = [...(picker()?.options ?? [])].some(option => option.value.endsWith('-editor'))
  log(`selftest: editable stages for a fetched sample=${editable} (expected false: no handle)`)

  // The other half: a file that does have a handle is edited, saved and guarded, for real.
  try {
    await parts.probeEditing(log)
  } catch (error) {
    log(`selftest: editing probe FAILED ${describe(error)}`)
  }

  for (const theme of readAppThemeChoices(document)) {
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
    failure.textContent = createWebLocalizer(navigator.languages).text('web.status.bootFailed', {
      reason: describe(error),
    })
    node.append(failure)
  })
