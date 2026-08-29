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
  readAppThemeChoices,
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
import { editOffer, editSelfTestLine } from './edit-operations.js'
import { createEditPanel } from './edit-panel.js'
import {
  createExtensionsSettingsGroups,
  type BrowseResult,
  type ExtensionManagerSnapshot,
  type ExtensionsReport,
} from './extensions-page.js'
import { createRendererEditorPorts, type RendererEditorPorts } from './editor-ports.js'
import { createInspectorDock, type InspectorSubject } from './inspector.js'
import { createElectronReadOnlyStages, createElectronStages } from './stages.js'
import { preferredStage, selfTestCodecLine, selfTestLine } from './view-policy.js'
import { continueElectronMapPreviewSelection } from './map-preview-selection.js'

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
    readonly selfTestPngOnly?: boolean
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
      | 'extensions'
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

/**
 * Managing extensions and codecs, which the settings bridge deliberately does not cover: those two
 * only move the JSON document, these three ask main to act on it — pick a folder, recompose the
 * running host, describe what is loaded now.
 */
interface ExtensionsBridge {
  report(): Promise<ExtensionsReport>
  reload(): Promise<ExtensionsReport>
  browse(): Promise<BrowseResult>
  managerSnapshot(): Promise<ExtensionManagerSnapshot>
  managerRefresh(): Promise<void>
  managerInstall(id: string, version?: string): Promise<void>
  managerUpdate(id: string): Promise<void>
  managerRemove(id: string): Promise<void>
  managerSetEnabled(id: string, enabled: boolean): Promise<void>
}

const broker = (globalThis as { modkitBroker?: Broker }).modkitBroker
const host = (globalThis as { modkitHost?: HostBridge }).modkitHost
const files = (globalThis as { modkitFiles?: { pathFor(file: File): string } }).modkitFiles
const menu = (globalThis as { modkitMenu?: MenuBridge }).modkitMenu
const settingsBridge = (globalThis as { modkitSettings?: SettingsBridge }).modkitSettings
const extensionsBridge = (globalThis as { modkitExtensions?: ExtensionsBridge }).modkitExtensions
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
    extensionsBridge === undefined ||
    subjects === undefined
  ) {
    throw new Error(
      'preload bridge is missing: host, broker, menu, settings, extensions or subjects is undefined',
    )
  }
  // Bound locally: the narrowing above does not reach the nested helpers declared later.
  const bridge = broker
  const extensions = extensionsBridge
  const appThemes = readAppThemeChoices(document)
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
  const imageEditingStages = createElectronStages({
    operationsFor,
    imageEditing: true,
    onImageCommitted: async descriptor => {
      const record = subjectsByDescriptor.get(descriptorKey(descriptor))
      return record === undefined ? false : reopenSubject(record.path)
    },
  })
  const readOnlyStages = createElectronReadOnlyStages({ operationsFor })

  /**
   * Everything one opened subject needs before a stage list can even be chosen.
   *
   * The editing arm has to be leased *before* the previewer picks stages, because whether main
   * will write this subject is what decides whether the editable stages may be offered at all.
   * `session` absent means the codecs did not claim the file (the built-in text/hex fallback);
   * `ports` absent means main refused the arm.
   */
  interface PreparedOpen {
    readonly session?: PreviewSessionLike
    readonly ports?: RendererEditorPorts
    /** Main resolved the PNG/RGBA8 semantic writer for this subject. */
    readonly imageEditing?: boolean
    dispose(): Promise<void>
  }
  interface PreviewSessionLike {
    descriptor(): Promise<Record<string, unknown>>
    dataSource(contract: string, major: number): Promise<{ value: unknown }>
    dispose(): Promise<void>
  }

  /** Consumed by `openSession` during the one `createCodecPreview.open` call that follows. */
  const pendingOpens = new Map<string, PreparedOpen>()
  /** Live editor ports per open subject: a stage switch and the close prompt reach the same arm. */
  const portsByPath = new Map<string, RendererEditorPorts>()
  /** Why a tab has no editors, kept so the footer keeps saying it after the open report. */
  const readOnlyNotes = new Map<string, string>()
  /** Diagnostic codes of an open no codec claimed, so a verification run can read them back. */
  const unresolvedCodes = new Map<string, readonly string[]>()
  /** The entry each open path was opened from, so a committed edit can reopen the same tab. */
  const openedEntries = new Map<string, ExplorerEntry>()
  /**
   * What the last applied mutating operation did, per file.
   *
   * Applying one reopens the tab, which remounts the panel that reported it — so the panel would
   * come back with no memory of the change the user just made. The shell keeps the sentence and
   * hands it back on the next mount.
   */
  const editOutcomes = new Map<string, string>()
  const subjectUriOf = (descriptor: Record<string, unknown>): string =>
    String(descriptor['subjectUri'] ?? '')

  interface MapPreviewCandidate {
    readonly kind: 'map-preview-selection'
    readonly candidateId: string
    readonly displayName: string
    readonly sourcePath?: string
  }

  const mapPreviewCandidates = (items: readonly unknown[]): readonly MapPreviewCandidate[] =>
    items.flatMap(item => {
      if (
        typeof item !== 'object' ||
        item === null ||
        (item as { kind?: unknown }).kind !== 'map-preview-selection' ||
        typeof (item as { candidateId?: unknown }).candidateId !== 'string' ||
        typeof (item as { displayName?: unknown }).displayName !== 'string'
      ) {
        return []
      }
      return [item as MapPreviewCandidate]
    })

  /**
   * Open the subject, then ask main whether it will write it.
   *
   * `edit()` rejects when the serving side has no editing wiring for the subject — no writer, no
   * grant, an unwritable file. That rejection is the whole point of the S14 arm: a shell learns it
   * *before* mounting, so it drops the editors instead of drawing a Save that fails at the end.
   */
  async function prepareOpen(entry: ExplorerEntry): Promise<PreparedOpen> {
    openedEntries.set(entry.id, entry)
    let result = await subjectClient.open(entry.id)
    if (result.state === 'opened') {
      const candidates = mapPreviewCandidates(result.snapshot.candidates)
      if (candidates.length > 0) {
        const choice = window.prompt(
          `Choose a map for the World view by entering its id:\n\n${candidates
            .map(
              candidate =>
                `${candidate.candidateId} — ${candidate.displayName}${
                  candidate.sourcePath === undefined ? '' : ` (${candidate.sourcePath})`
                }`,
            )
            .join('\n')}`,
          '',
        )
        if (choice !== null && choice.trim().length > 0) {
          const selected = candidates.find(candidate => candidate.candidateId === choice.trim())
          if (selected === undefined) {
            setFooter(entry.id, 'Map preview selection was not one of the offered ids.', true)
          } else {
            const firstSession = result.session
            result = await continueElectronMapPreviewSelection({
              path: entry.id,
              selectionId: selected.candidateId,
              dispose: () => firstSession.dispose(),
              open: request => subjectClient.open(request),
            })
          }
        }
      }
    }
    if (result.state === 'unresolved') {
      const detail =
        result.snapshot.diagnostics[0]?.message ??
        `${result.snapshot.reason}; using the explicit text/hex fallback`
      setFooter(entry.id, detail, result.snapshot.reason !== 'no-candidate')
      subjectsByPath.delete(entry.id)
      /*
       * The reason rides along with every later status report for this tab.
       *
       * `onStatus` fires again on each stage switch, and without this the sentence explaining why
       * the file is showing raw bytes would be overwritten by the first view change — which is the
       * moment a user goes looking for it.
       */
      readOnlyNotes.set(entry.id, detail)
      unresolvedCodes.set(
        entry.id,
        result.snapshot.diagnostics.map(item => item.code),
      )
      return { dispose: async () => undefined }
    }
    const snapshot = result.snapshot
    unresolvedCodes.delete(entry.id)
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

    let ports: RendererEditorPorts | undefined
    try {
      const arm = await subjectClient.edit(snapshot.sessionId)
      ports = await createRendererEditorPorts({
        arm,
        onStatus: status => setFooter(entry.id, status.message, status.failed),
        onDirty: dirty => editors.markDirty(entry.id, dirty),
      })
      portsByPath.set(entry.id, ports)
      readOnlyNotes.delete(entry.id)
    } catch (error) {
      // main says why in a snapshot diagnostic; the wire error is the generic refusal.
      const stated = snapshot.diagnostics.find(item => item.code === 'x3.app/subject-not-editable')
      const because = stated?.message ?? (error instanceof Error ? error.message : String(error))
      readOnlyNotes.set(entry.id, `read-only: ${because}`)
      console.log(`[editing] ${entry.id} is read-only here: ${because}`)
    }

    const release = async (): Promise<void> => {
      subjectsByPath.delete(entry.id)
      subjectsByDescriptor.delete(descriptorKey(snapshot.descriptor))
      // The arm belongs to the tab, not to a stage: closing the tab is what releases it, and with
      // it every commit main has prepared for this subject.
      if (ports !== undefined && portsByPath.get(entry.id) === ports) portsByPath.delete(entry.id)
      await ports?.dispose().catch((error: unknown) => {
        console.warn(`[editing] releasing the arm failed: ${String(error)}`)
      })
      await result.session.dispose()
    }
    /*
     * The host's plan is kept as the *default* stage, not as the list of stages.
     * `resolvePresentationPlan` keeps one stage per `singletonGroup`, which is right for "what
     * opens first" and wrong for "what can this file be shown as" — a PNG would offer Image and
     * never Hex. Handing the previewer a session without the plan lets it evaluate every stage
     * in the app policy against the descriptor's own data sources and traits, and `planActive`
     * later restores the host's choice of which one starts.
     */
    return {
      session: {
        descriptor: async () => snapshot.descriptor,
        dataSource: (contract, major) => result.session.dataSource(contract, major),
        dispose: release,
      },
      ...(ports === undefined ? {} : { ports }),
      ...(ports !== undefined &&
      (snapshot.descriptor as { readonly identity?: { readonly formatId?: unknown } }).identity
        ?.formatId === 'png'
        ? { imageEditing: true }
        : {}),
      dispose: release,
    }
  }

  /**
   * Two previewers over one opener: with the editing ports, and without them.
   *
   * `createCodecPreview` decides once per instance whether editable stages may be offered, so the
   * per-subject answer has to be a choice between instances. Both share the session handed over in
   * `pendingOpens`, so a subject is still opened exactly once.
   */
  const previewFor = (
    availableStages: ReturnType<typeof createElectronStages>,
    editable: boolean,
  ): PreviewResolver =>
    createCodecPreview({
      supported: profile.supportedExtensions,
      stages: availableStages,
      fallback: PREVIEW_FALLBACK,
      async openSession(entry) {
        return pendingOpens.get(entry.id)?.session
      },
      ...(editable
        ? {
            // Every editable stage saves through main's editing backend under the granted roots.
            // There is no other write path in this renderer.
            editorPorts: (entry: ExplorerEntry) => {
              const ports = portsByPath.get(entry.id)
              if (ports === undefined) {
                throw new Error(`no editing arm is held for ${entry.id}`)
              }
              return ports
            },
          }
        : {}),
    })

  const editablePreview = previewFor(stages, true)
  const imageEditablePreview = previewFor(imageEditingStages, true)
  const readOnlyPreview = previewFor(readOnlyStages, false)

  /** Offer every applicable stage, then start on the one the host's plan selected. */
  const preview: PreviewResolver = {
    supported: editablePreview.supported,
    async open(container, entry, bytes, signal) {
      const prepared = await prepareOpen(entry)
      pendingOpens.set(entry.id, prepared)
      let handle
      try {
        const resolver =
          prepared.ports === undefined
            ? readOnlyPreview
            : prepared.imageEditing === true
              ? imageEditablePreview
              : editablePreview
        handle = await resolver.open(container, entry, bytes, signal)
      } catch (error) {
        await prepared.dispose()
        throw error
      } finally {
        pendingOpens.delete(entry.id)
      }
      // No usable stage: `createCodecPreview` disposed the session, so the arm goes with it.
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

  // ---------------------------------------------------------------- inspector
  /** The record a viewer holding only a descriptor belongs to, or nothing once its tab closed. */
  const recordFor = (descriptor: Record<string, unknown>): SubjectRecord | undefined =>
    subjectsByDescriptor.get(descriptorKey(descriptor))

  /**
   * Close and reopen the tab on `path`, so its stages read the bytes that are on disk now.
   *
   * A committed edit moves the subject's revision; the open session is pinned to the old one and
   * every stage in the tab is showing it. This host has no refresh-in-place, so it does the honest
   * thing and reopens — through the tab's own close control and `editors.open`, the two things a
   * user would do, which also releases the arm and leases a fresh one at the new revision.
   */
  const tabsOn = (path: string): readonly HTMLElement[] =>
    [...editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node.title === path,
    )

  /** Every path with a tab open right now, in tab order, duplicates included across groups. */
  const tabPaths = (): readonly string[] =>
    [...editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]')].flatMap(node =>
      node instanceof HTMLElement && node.title !== '' ? [node.title] : [],
    )

  /** Ask every tab on this path to close, through the control a user would click. */
  const closeTabsOn = (path: string): void => {
    for (const tab of tabsOn(path)) {
      const close = tab.querySelector('[data-mk-part="explorer.filetab-close"]')
      if (close instanceof HTMLElement) close.click()
    }
  }

  /**
   * Wait until none of these paths has a tab any more.
   *
   * Closing unmounts the stage and disposes the session and the editing arm asynchronously, and
   * the whole point of closing before a recomposition is that those sessions are gone before the
   * old composition is dropped. Recomposing while they are still in flight would leave the worker
   * leases of a host nothing points at any more.
   */
  const settleClosed = async (paths: readonly string[]): Promise<void> => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (!paths.some(path => tabsOn(path).length > 0)) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  }

  const reopenSubject = async (path: string): Promise<boolean> => {
    const entry = openedEntries.get(path)
    if (entry === undefined) return false
    closeTabsOn(path)
    // `closeTab` unmounts the stage and disposes the arm asynchronously; opening before it has
    // finished would find the old tab and only focus it.
    for (let attempt = 0; attempt < 60 && tabsOn(path).length > 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    if (tabsOn(path).length > 0) return false
    await editors.open(entry)
    return true
  }

  const editPanel = createEditPanel({
    portsFor: descriptor => {
      const record = recordFor(descriptor)
      return record === undefined ? undefined : portsByPath.get(record.path)
    },
    reopen: async descriptor => {
      const record = recordFor(descriptor)
      return record === undefined ? false : reopenSubject(record.path)
    },
    lastOutcome: descriptor => editOutcomes.get(subjectUriOf(descriptor)),
    recordOutcome: (descriptor, outcome) => {
      editOutcomes.set(subjectUriOf(descriptor), outcome)
    },
    // The panel is chrome beside the tab, so its result belongs on the same status line every
    // other editing surface reports to.
    onStatus: status => {
      setFooter(footerPath.textContent ?? '', status.message, status.failed)
    },
  })

  const inspector = createInspectorDock(document, { editPanel })
  const inspectorSubject = (path: string | undefined): InspectorSubject | undefined => {
    const record = path === undefined ? undefined : subjectsByPath.get(path)
    if (record === undefined) return undefined
    return {
      path: record.path,
      descriptor: record.descriptor,
      // Main's own answer: an arm exists exactly for a subject it is willing to write.
      editable: portsByPath.has(record.path),
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
      await portsByPath.get(entry.id)?.save()
    },
    onStatus(status) {
      // The read-only note rides along with every report for that tab: the open report lands after
      // the mount, and a sentence the user never sees is not an explanation.
      const note = status.path === undefined ? undefined : readOnlyNotes.get(status.path)
      setFooter(
        status.path ?? '',
        [status.view, status.detail, note].filter(Boolean).join(' · '),
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
  const extensionsSettings = createExtensionsSettingsGroups({
    store,
    report: () => extensions.report(),
    browse: () => extensions.browse(),
    apply: () => reloadExtensions(),
    manager: {
      snapshot: () => extensions.managerSnapshot(),
      refresh: () => extensions.managerRefresh(),
      install: (id, version) => extensions.managerInstall(id, version),
      update: id => extensions.managerUpdate(id),
      remove: id => extensions.managerRemove(id),
      setEnabled: (id, enabled) => extensions.managerSetEnabled(id, enabled),
    },
  })

  const settingsUi = createSettingsUi(document, {
    store,
    themes: appThemes,
    onAppearance(appearance: SettingsDocument['appearance']) {
      applyTheme(document.documentElement, appearance.theme as never)
      applyDensity(document.documentElement, appearance.density)
    },
    // Offer exactly the formats the loaded codecs can open — never advertise for what we cannot read.
    associableTypes: preview.supported,
    async registerFileTypes(extensions) {
      return (await host.registerFileTypes(extensions)).message
    },
    extraGroups: extensionsSettings.groups,
    onClose() {
      toggleSettings(false)
    },
  })
  await settingsUi.reload()

  // ---------------------------------------------------------------- extensions and codecs
  /**
   * Recompose the host from the settings file, then reopen whatever was open.
   *
   * Closing the tabs first is what disposes the sessions of the *old* composition — a worker lease
   * ends with the session that holds it — and reopening them is what makes a codec the user just
   * switched off actually stop serving the file on screen. Doing it in this order is the whole
   * difference between "applies immediately" and "applies whenever you happen to reopen the tab".
   */
  async function reloadExtensions(): Promise<ExtensionsReport> {
    const reopening = [...new Set(tabPaths())]
    for (const path of reopening) closeTabsOn(path)
    await settleClosed(reopening)
    const report = await extensions.reload()
    for (const path of reopening) {
      const entry = openedEntries.get(path)
      if (entry !== undefined) await editors.open(entry)
    }
    return report
  }

  type Surface = 'workspace' | 'settings'
  let surface: Surface = 'workspace'
  function showSurface(next: Surface, groupId?: string): void {
    surface = next
    body.replaceChildren(next === 'settings' ? settingsUi.root : workspace)
    setFooter(
      next === 'workspace' ? '' : 'Settings',
      next === 'workspace' ? 'Ready' : `${store.location} · realm ${profile.renderer.realmId}`,
    )
    if (next === 'settings') {
      if (groupId !== undefined) settingsUi.showGroup(groupId)
      void settingsUi.reload()
    }
  }
  /** Kept as its own name because the menu, the shortcut and four call sites all mean "settings". */
  function toggleSettings(open = surface !== 'settings'): void {
    showSurface(open ? 'settings' : 'workspace')
  }

  // ---------------------------------------------------------------- open helpers
  async function openFolder(): Promise<FileAccess | undefined> {
    const result = (await bridge.request('dialog.open-directory', {
      requestId: crypto.randomUUID(),
    })) as { canceled: boolean; root?: string }
    if (result.canceled || result.root === undefined) return undefined
    access = accessFor(result.root)
    if (surface !== 'workspace') showSurface('workspace')
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
    if (surface !== 'workspace') showSurface('workspace')
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
  on('extensions', () => {
    showSurface('settings', 'extensions')
  })
  on('split', () => {
    if (surface !== 'workspace') showSurface('workspace')
    editors.split()
  })
  on('inspector', () => {
    if (surface !== 'workspace') showSurface('workspace')
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
        if (surface !== 'workspace') showSurface('workspace')
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
    { label: 'Extensions & Codecs…', command: 'extensions', hint: 'Ctrl+Shift+X' },
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
      key === 'x' && event.shiftKey
        ? 'extensions'
        : key === 'k'
          ? 'open-folder'
          : key === 'o'
            ? 'open-file'
            : key === ','
              ? 'settings'
              : undefined
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
        portsFor: path => portsByPath.get(path),
        footerText: () => `${footerPath.textContent ?? ''} · ${footerDetail.textContent ?? ''}`,
        extensionsRoot: settingsUi.root,
        showExtensions: () => {
          showSurface('settings', 'extensions')
        },
        showWorkspace: () => {
          showSurface('workspace')
        },
        unresolvedCodes: path => unresolvedCodes.get(path) ?? [],
        pngOnly: initial.selfTestPngOnly === true,
      })
  }
}

/** Let the microtask queue and one animation frame settle after a mount. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 60))
}

/** The separator inside a PNG `tEXt` chunk, written as an escape so no source carries a NUL. */
const NUL = '\u0000'

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
  /** The editing arm a tab holds, or nothing when main refused one for that subject. */
  portsFor(path: string): RendererEditorPorts | undefined
  /** Whatever the status line currently says, so a refusal can be read back. */
  footerText(): string
  /** The Extensions & Codecs page, driven through its own switches like a user would. */
  readonly extensionsRoot: HTMLElement
  showExtensions(): void
  showWorkspace(): void
  /** Diagnostic codes of the last open on this path that no codec claimed. */
  unresolvedCodes(path: string): readonly string[]
  /** A focused live proof of the PNG writer lifecycle and on-disk round trip. */
  readonly pngOnly?: boolean
}): Promise<void> {
  const { access, preview, editors, settingsRoot, inspector } = options
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
  /**
   * One node inside the *visible tab of the focused group*.
   *
   * Every earlier tab keeps its DOM, hidden, so a bare `document.querySelector` for a hex cell or
   * a Save button finds the first file ever opened rather than the one under test.
   */
  const inFocusedTab = (selector: string): Element | null =>
    editors.root.querySelector(
      `${FOCUSED} [data-mk-part="explorer.tabcontent"]:not([hidden]) ${selector}`,
    )
  /** The visible tab's mounted viewer surface, or `null` when nothing mounted. */
  const mountedSurface = (): Element | null => inFocusedTab('[data-mk-part="viewer"]')

  /** Tabs the host has marked as holding uncommitted work, in the focused group. */
  const dirtyTabs = (): number =>
    editors.root.querySelectorAll(
      `${FOCUSED} [data-mk-part="explorer.filetab"][data-mk-state~="mutating"]`,
    ).length

  /** Drive the public view picker exactly as a user would; `false` when the stage is not offered. */
  const showStage = async (stage: string): Promise<boolean> => {
    const picker = focusedPicker()
    if (picker === undefined || ![...picker.options].some(option => option.value === stage)) {
      return false
    }
    picker.value = stage
    picker.dispatchEvent(new Event('change'))
    await settle()
    return true
  }

  if (options.pngOnly === true) {
    await imageEditingProbe({
      editors,
      entries,
      subjectFor: options.subjectFor,
      showStage,
      inFocusedTab,
    })
    console.log('selftest: done')
    return
  }

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
        console.log(selfTestCodecLine(entry.name, subject.descriptor))
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
  {
    /*
     * One file visible at a time. The component hides inactive tabs with the `hidden` attribute,
     * and an authored `display` on the same part silently defeats it — which is exactly how every
     * open file once rendered stacked one under another. The component test covers the mechanism;
     * this covers *this application*, whose own stylesheet could reintroduce the same defeat.
     */
    const contents = [...document.querySelectorAll('[data-mk-part="explorer.tabcontent"]')]
    const visible = contents.filter(
      node => getComputedStyle(node as HTMLElement).display !== 'none',
    ).length
    console.log(
      `selftest: tab visibility contents=${contents.length} visible=${visible} ` +
        `${contents.length > 0 && visible === 1 ? 'ok' : 'FAILED: expected exactly one'}`,
    )
  }
  editors.split()
  const groups = editors.root.querySelectorAll('[data-mk-part="explorer.group"]').length
  console.log(`selftest: after split groups=${editors.groupCount}, rendered=${groups}`)

  const settingsGroups = settingsRoot.querySelectorAll('[data-mk-part="settings.group"]').length
  console.log(`selftest: settings groups=${settingsGroups}`)

  try {
    await extensionProbes({ ...options, entries })
  } catch (error) {
    console.log(`selftest: extension probes FAILED ${String(error)}`)
  }

  /*
   * A probe that throws must not take the run with it. `boot()` catches, replaces the page with a
   * failure notice and logs nothing — so the run ends with no `selftest: done`, the process never
   * exits, and every harness reports a timeout instead of the one line that says what broke.
   */
  try {
    await editingProbes({
      ...options,
      entries,
      showStage,
      inFocusedTab,
      dirtyTabs,
      offeredViews: () => {
        const picker = focusedPicker()
        return picker === undefined ? [] : [...picker.options].map(item => item.value)
      },
    })
  } catch (error) {
    console.log(`selftest: edit probes FAILED ${String(error)}`)
  }

  try {
    await editOperationProbes({
      access,
      editors,
      entries,
      inspector,
      subjectFor: options.subjectFor,
      portsFor: options.portsFor,
      showStage,
      footerText: options.footerText,
    })
  } catch (error) {
    console.log(`selftest: edit-op probes FAILED ${String(error)}`)
  }

  const originalTheme = document.documentElement.getAttribute('data-mk-theme') ?? 'modkit-dark'
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
  console.log(`selftest: sheets=[${sheets.join(', ')}]`)

  // Every installed theme has to reach two places: the token cascade and the decor layer. Reading
  // the accent back proves the stylesheet is linked and its selector matches; reading the decor
  // animation name proves the theme found something to hang a background on in *this* host, which
  // is exactly what breaks silently when a host composes its own shell.
  for (const theme of readAppThemeChoices(document)) {
    document.documentElement.setAttribute('data-mk-theme', theme.id)
    const themed = getComputedStyle(document.documentElement)
      .getPropertyValue('--mk-color-accent')
      .trim()
    const anchor = document.querySelector('[data-mk-part="workbench"]') ?? document.body
    const decor = getComputedStyle(anchor, '::before').animationName
    console.log(`selftest: theme ${theme.id} accent ${themed} decor ${decor}`)
  }
  document.documentElement.setAttribute('data-mk-theme', originalTheme)

  const menus = [...document.querySelectorAll('[data-mk-part="titlebar.menu-item"]')].map(
    node => node.textContent,
  )
  const fileMenu = document.querySelector('[data-mk-part="titlebar.menu-item"]')
  ;(fileMenu as HTMLElement | null)?.click()
  const menuEntries = [...document.querySelectorAll('[data-mk-part="titlebar.menu-entry"]')].map(
    node => (node.textContent ?? '').split(' ')[0],
  )
  console.log(`selftest: menus=[${menus.join(', ')}] fileEntries=${menuEntries.length}`)

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

/**
 * What a `ViewerModule`-hosted editor sees of the four ports, narrowed to what a probe drives.
 * The ports themselves are `unknown` to the previewer on purpose; nothing in the app but this
 * probe ever names their methods.
 *
 * The edit session is called `edit`, which is the name `createCodecPreview` and `EditorModule.mount`
 * both use. Naming it `session` here read as `undefined` at run time and threw before the probe
 * could print anything — and because the throw escaped to `boot().catch`, the whole self-test
 * stopped at that line with no `selftest: done`, which is indistinguishable from a hang.
 */
interface ProbePorts {
  readonly edit: {
    readonly targets: readonly { readonly targetId: string; readonly ownerSource: unknown }[]
    propose(change: unknown): Promise<{
      readonly valid: boolean
      readonly diagnostics: readonly { readonly code: string }[]
    }>
    plan(change: unknown): Promise<unknown>
  }
  readonly commit: {
    prepare(plan: unknown): Promise<{ readonly state: string; readonly reason?: string }>
  }
}

/**
 * The Extensions & Codecs page, driven through its own switches.
 *
 * Every claim below is about what the *host* did afterwards, never about a checkbox having been
 * clicked: a settings page whose switches write a file and change nothing is precisely the failure
 * this exists to catch. So each toggle is followed by reopening the file and reading which stages
 * the shell offered — the same thing a user would look at.
 */
async function extensionProbes(options: {
  readonly editors: EditorArea
  readonly entries: readonly ExplorerEntry[]
  readonly extensionsRoot: HTMLElement
  showExtensions(): void
  showWorkspace(): void
  unresolvedCodes(path: string): readonly string[]
}): Promise<void> {
  const { editors, extensionsRoot } = options
  const PNG_CODEC = 'org.modkitx/image-png'

  /*
   * Start from an empty editor area.
   *
   * Applying a change reopens whatever was open, and the sweep above left every sample file in a
   * tab — so without this each of the four recompositions below would reopen eighteen subjects and
   * the probe would be measuring the sweep rather than the switch. No tab is dirty yet (the
   * editing probes run after this one), so nothing is being discarded.
   */
  const closeEverything = async (): Promise<number> => {
    const controls = [...editors.root.querySelectorAll('[data-mk-part="explorer.filetab-close"]')]
    for (const control of controls) {
      if (control instanceof HTMLElement) control.click()
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (editors.root.querySelectorAll('[data-mk-part="explorer.filetab"]').length === 0) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return controls.length
  }
  console.log(`selftest: extensions closed ${await closeEverything()} tab(s) before switching`)

  options.showExtensions()
  await settle()
  const groupButtons = [...extensionsRoot.querySelectorAll('[data-mk-part="settings.group"]')]
  console.log(
    `selftest: extensions page groups=[${groupButtons
      .map(node => node.textContent ?? '')
      .join(', ')}]`,
  )

  const status = (): string =>
    extensionsRoot.querySelector('[data-mk-part="settings.status"]')?.textContent ?? ''

  /** Move to a group of the page by clicking its tab, exactly as a user reaches it. */
  const showGroup = async (label: string): Promise<boolean> => {
    const button = groupButtons.find(node => node.textContent === label)
    if (!(button instanceof HTMLElement)) return false
    button.click()
    await settle()
    return true
  }

  /**
   * Wait for main to finish recomposing.
   *
   * The page says so itself: every switch reports "applied" (or "failed") on its status line once
   * the new composition is live and the tabs have been reopened. Polling that line is what a human
   * watching the page would do.
   */
  const settleApplied = async (): Promise<string> => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const text = status()
      if (text.includes('applied.') || text.includes('failed')) return text
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return `TIMEOUT ${status()}`
  }

  /** The stages the shell offers for this file, read from the focused group's own picker. */
  const openAndDescribe = async (entry: ExplorerEntry): Promise<string> => {
    options.showWorkspace()
    await editors.open(entry)
    await settle()
    const picker = editors.root.querySelector(
      '[data-mk-part="explorer.group"][data-mk-state~="active"] [data-mk-part="explorer.viewpicker"]',
    )
    const views =
      picker instanceof HTMLSelectElement ? [...picker.options].map(item => item.value) : []
    const codes = options.unresolvedCodes(entry.id)
    return (
      `views [${views.join(', ')}]` +
      (codes.length === 0 ? '' : ` unresolved codes [${codes.join(', ')}]`)
    )
  }

  const closeAllAndShowPage = async (): Promise<void> => {
    await closeEverything()
    options.showExtensions()
    await settle()
  }

  /** The switch for one contribution, found by the id it names — never by position. */
  const codecToggle = (id: string): HTMLInputElement | undefined => {
    const node = extensionsRoot.querySelector(
      `[data-mk-part="settings.toggle"][data-contribution="${id}"]`,
    )
    return node instanceof HTMLInputElement ? node : undefined
  }

  // ---------------------------------------------------------------- a codec, switched off and on
  const png = options.entries.find(entry => entry.name.toLowerCase().endsWith('.png'))
  if (png === undefined) {
    console.log('selftest: extensions no .png sample to switch a codec off for')
  } else {
    console.log(`selftest: extensions ${png.name} before ${await openAndDescribe(png)}`)
    await closeAllAndShowPage()
    if (!(await showGroup('Codecs'))) {
      console.log('selftest: extensions page has no Codecs group')
    } else {
      const off = codecToggle(PNG_CODEC)
      if (off === undefined) {
        console.log(`selftest: extensions no switch for ${PNG_CODEC}`)
      } else {
        off.checked = false
        off.dispatchEvent(new Event('change'))
        console.log(`selftest: extensions disable ${PNG_CODEC} -> ${await settleApplied()}`)
        console.log(`selftest: extensions ${png.name} disabled ${await openAndDescribe(png)}`)

        await closeAllAndShowPage()
        await showGroup('Codecs')
        const on = codecToggle(PNG_CODEC)
        if (on === undefined) {
          // The whole reason a disabled contribution stays in the inventory: without the record
          // there would be no switch left to turn it back on.
          console.log(`selftest: extensions ${PNG_CODEC} VANISHED while disabled`)
        } else {
          console.log(`selftest: extensions disabled switch still listed, checked=${on.checked}`)
          on.checked = true
          on.dispatchEvent(new Event('change'))
          console.log(`selftest: extensions enable ${PNG_CODEC} -> ${await settleApplied()}`)
          console.log(`selftest: extensions ${png.name} re-enabled ${await openAndDescribe(png)}`)
        }
      }
    }
  }

  // ---------------------------------------------------------------- connecting folders
  await closeAllAndShowPage()
  await showGroup('Extensions')
  const addButton = extensionsRoot.querySelector('[data-action="add-folder"]')
  if (!(addButton instanceof HTMLElement)) {
    console.log('selftest: extensions page has no Add extension folder control')
    return
  }

  /** Every id the Codecs group currently lists, read from the switches themselves. */
  const listedContributions = async (): Promise<readonly string[]> => {
    await showGroup('Codecs')
    const ids = [...extensionsRoot.querySelectorAll('[data-mk-part="settings.toggle"]')].flatMap(
      node => {
        const id = node instanceof HTMLInputElement ? node.dataset['contribution'] : undefined
        return id === undefined ? [] : [id]
      },
    )
    await showGroup('Extensions')
    return ids
  }

  const before = await listedContributions()
  addButton.click()
  console.log(`selftest: extensions add folder #1 -> ${await settleApplied()}`)
  const after = await listedContributions()
  const gained = after.filter(id => !before.includes(id))
  console.log(
    `selftest: extensions codecs ${before.length} -> ${after.length}, new [${gained.join(', ')}]`,
  )

  /*
   * Switching the whole extension off, which is a different seam from switching one codec off: a
   * disabled entry is never offered to the loader at all, so its contributions leave the inventory
   * rather than staying in it inert. Both halves are checked, because "the switch wrote the file"
   * and "the host stopped loading it" are two different claims.
   */
  const extensionToggle = (id: string): HTMLInputElement | undefined => {
    const node = extensionsRoot.querySelector(
      `[data-mk-part="settings.toggle"][data-extension="${id}"]`,
    )
    return node instanceof HTMLInputElement ? node : undefined
  }
  const connected = gained[0]
  if (connected === undefined) {
    console.log('selftest: extensions the connected folder contributed nothing to switch off')
  } else {
    const owner = extensionToggle('org.example/fixture-thirdparty')
    if (owner === undefined) {
      console.log('selftest: extensions no switch for the connected extension')
    } else {
      owner.checked = false
      owner.dispatchEvent(new Event('change'))
      console.log(`selftest: extensions disable the connected folder -> ${await settleApplied()}`)
      const off = await listedContributions()
      console.log(
        `selftest: extensions codecs ${after.length} -> ${off.length}, ` +
          `${connected} listed=${off.includes(connected)}`,
      )
      const again = extensionToggle('org.example/fixture-thirdparty')
      if (again !== undefined) {
        again.checked = true
        again.dispatchEvent(new Event('change'))
        console.log(`selftest: extensions enable the connected folder -> ${await settleApplied()}`)
        const back = await listedContributions()
        console.log(
          `selftest: extensions codecs ${off.length} -> ${back.length}, ` +
            `${connected} listed=${back.includes(connected)}`,
        )
      }
    }
  }

  // A folder that is not an extension: it must say so, verbatim, and not disappear.
  const addAgain = extensionsRoot.querySelector('[data-action="add-folder"]')
  if (addAgain instanceof HTMLElement) {
    addAgain.click()
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (status().includes('not added')) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    console.log(`selftest: extensions add folder #2 status ${JSON.stringify(status())}`)
    const refused = [
      ...extensionsRoot.querySelectorAll(
        '[data-mk-part="settings.extension"][data-mk-state~="error"]',
      ),
    ].map(node => node.textContent ?? '')
    console.log(`selftest: extensions refused rows ${JSON.stringify(refused)}`)
  }

  // Leave the settings file as it was found: a temp fixture path must not outlive the run.
  const remove = [...extensionsRoot.querySelectorAll('[data-mk-part="settings.remove"]')].find(
    node => node.textContent === 'Remove',
  )
  if (remove instanceof HTMLElement) {
    remove.click()
    console.log(`selftest: extensions remove connected folder -> ${await settleApplied()}`)
  }
  options.showWorkspace()
  await settle()
}

/**
 * The editing seam, driven on real files through the real controls.
 *
 * Every line below is a claim about bytes on disk or about what the shell offered, never about a
 * port having been called: a save path that reports success without changing the file is exactly
 * the failure this exists to catch.
 */
async function editingProbes(options: {
  readonly access: FileAccess
  readonly editors: EditorArea
  readonly entries: readonly ExplorerEntry[]
  subjectFor(path: string | undefined): InspectorSubject | undefined
  portsFor(path: string): RendererEditorPorts | undefined
  footerText(): string
  showStage(stage: string): Promise<boolean>
  inFocusedTab(selector: string): Element | null
  dirtyTabs(): number
  /** Stage ids the focused tab's view picker offers right now. */
  offeredViews(): readonly string[]
}): Promise<void> {
  const { access, editors, entries, portsFor, footerText, showStage, inFocusedTab, dirtyTabs } =
    options
  const decoder = new TextDecoder()
  const onDisk = async (entry: ExplorerEntry): Promise<string> =>
    decoder.decode(await access.read(entry.id, 4096))
  const statusText = (): string => inFocusedTab('[data-mk-part="viewer.status"]')?.textContent ?? ''
  const click = (selector: string): boolean => {
    const node = inFocusedTab(selector)
    if (!(node instanceof HTMLElement)) return false
    node.click()
    return true
  }
  const find = (name: string): ExplorerEntry | undefined => entries.find(item => item.name === name)
  /**
   * Close a tab the way a user does — its own close control — and report whether the arm went
   * with it. A closed tab that left an arm alive would keep main holding prepared commits for a
   * file nobody has open.
   */
  const closeTab = async (entry: ExplorerEntry): Promise<boolean> => {
    /*
     * Every tab on this file, not just the focused one. A split group can hold a second tab on the
     * same path, and each holds its own arm — so "closing released the arm" is only a claim worth
     * printing once no tab has the file open at all.
     */
    const controls = [
      ...editors.root.querySelectorAll(
        `[data-mk-part="explorer.filetab-close"][aria-label="Close ${entry.name}"]`,
      ),
    ]
    if (controls.length === 0) return false
    for (const control of controls) {
      if (control instanceof HTMLElement) control.click()
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    return portsFor(entry.id) === undefined
  }

  // ------------------------------------------------------------------ text: save, then conflict
  const text = find('savetest.json')
  if (text === undefined) console.log('selftest: edit no savetest.json fixture')
  else {
    try {
      await editors.open(text)
      await settle()
      const before = await onDisk(text)
      if (!(await showStage('text'))) {
        console.log('selftest: edit text stage was not offered for savetest.json')
      } else {
        const area = inFocusedTab('[data-mk-part="editor.text"]')
        if (!(area instanceof HTMLTextAreaElement)) {
          console.log('selftest: edit no textarea mounted for savetest.json')
        } else {
          area.value = '{"note":"SAVED BY SELFTEST"}'
          // The toolbar's first button is Save; clicking it is the whole user-visible save path.
          const clicked = click('[data-mk-part="editor.toolbar"] button')
          await new Promise(resolve => setTimeout(resolve, 400))
          const after = await onDisk(text)
          console.log(
            `selftest: edit text save clicked=${clicked} status=${JSON.stringify(statusText())} ` +
              `disk ${JSON.stringify(before)} -> ${JSON.stringify(after)} ` +
              `changed=${after !== before} dirtyTabs=${dirtyTabs()}`,
          )

          /*
           * Save again without reopening. The arm is pinned to the revision the subject was opened
           * at and the file has moved on, so the coordinator must refuse with a conflict — and the
           * status line must say that, not "failed".
           */
          area.value = '{"note":"SECOND WRITE"}'
          click('[data-mk-part="editor.toolbar"] button')
          await new Promise(resolve => setTimeout(resolve, 400))
          console.log(
            `selftest: edit stale save editor=${JSON.stringify(statusText())} ` +
              `footer=${JSON.stringify(footerText())} disk unchanged=${(await onDisk(text)) === after}`,
          )
        }
      }
    } catch (error) {
      console.log(`selftest: edit text FAILED ${String(error)}`)
    }
  }

  // ------------------------------------------------------------------ writer refusal, with reason
  if (text !== undefined) {
    const ports = portsFor(text.id)
    const target = (ports as unknown as ProbePorts | undefined)?.edit.targets[0]
    if (ports === undefined || target === undefined) {
      console.log('selftest: edit refusal probe has no arm for savetest.json')
    } else {
      try {
        const probe = ports as unknown as ProbePorts
        const refused = {
          targets: probe.edit.targets,
          edits: [{ operation: 'delete', targetId: target.targetId, source: target.ownerSource }],
          provenance: { actor: 'user' },
        }
        const validation = await probe.edit.propose(refused)
        const prepared = await probe.commit.prepare(await probe.edit.plan(refused))
        console.log(
          `selftest: edit writer refusal valid=${validation.valid} ` +
            `codes=[${validation.diagnostics.map(item => item.code).join(', ')}] ` +
            `prepare=${prepared.state}/${prepared.reason ?? '-'} footer=${JSON.stringify(footerText())}`,
        )
      } catch (error) {
        console.log(`selftest: edit writer refusal FAILED ${String(error)}`)
      }
    }
  }

  // ------------------------------------------------------------------ hex: one byte, to disk
  const binary = find('savehex.json')
  if (binary === undefined) console.log('selftest: edit no savehex.json fixture')
  else {
    try {
      await editors.open(binary)
      await settle()
      const before = await onDisk(binary)
      if (!(await showStage('hex'))) {
        console.log('selftest: edit hex stage was not offered for savehex.json')
      } else {
        const cell = inFocusedTab('[data-mk-part="hex.cell"]')
        const twin = inFocusedTab('[data-mk-part="hex.ascii"] > span')
        if (!(cell instanceof HTMLElement) || !(twin instanceof HTMLElement)) {
          console.log('selftest: edit no hex grid mounted for savehex.json')
        } else {
          const asciiBefore = twin.textContent
          cell.textContent = '5a'
          cell.dispatchEvent(new FocusEvent('blur'))
          await new Promise(resolve => setTimeout(resolve, 200))
          const markedWhileDirty = dirtyTabs()
          const clicked = click('[data-mk-part="hex.toolbar"] [data-mk-part="operations.button"]')
          await new Promise(resolve => setTimeout(resolve, 600))
          const after = await onDisk(binary)
          console.log(
            `selftest: edit hex ascii ${JSON.stringify(asciiBefore)} -> ` +
              `${JSON.stringify(twin.textContent)} dirtyTabs=${markedWhileDirty} ` +
              `save clicked=${clicked} status=${JSON.stringify(statusText())} ` +
              `disk ${JSON.stringify(before)} -> ${JSON.stringify(after)} changed=${after !== before} ` +
              `dirtyTabsAfter=${dirtyTabs()}`,
          )
        }
      }
      // Closing the tab must release the arm: main's prepared commits belong to the session.
      console.log(`selftest: edit hex tab closed, arm released=${await closeTab(binary)}`)
    } catch (error) {
      console.log(`selftest: edit hex FAILED ${String(error)}`)
    }
  }

  /*
   * The Monaco stage, which is an editor from an extension rather than from `@modkitx-x3/ui`.
   * It gets the same ports as the other two, so this line says whether an independently authored
   * editor can save through this seam. Kept in the run because "the code tab cannot save" is a
   * regression the app would otherwise never notice.
   */
  const code = find('savecode.json')
  if (code !== undefined) {
    try {
      await editors.open(code)
      await settle()
      const before = await onDisk(code)
      if (!(await showStage('code'))) {
        console.log('selftest: edit code stage was not offered for savecode.json')
      } else {
        /*
         * Monaco creates itself asynchronously and hangs its instance off the surface when it is
         * ready. Reading that handle too early leaves the buffer untouched, the Save control
         * disabled, and a probe that reports nothing rather than a result — so wait for it.
         */
        let editor: { setValue(value: string): void } | undefined
        for (let attempt = 0; attempt < 20 && editor === undefined; attempt += 1) {
          const surface = inFocusedTab('[data-mk-part="viewer"]')
          editor = (surface as { __mkEditor?: { setValue(value: string): void } } | null)
            ?.__mkEditor
          if (editor === undefined) await settle()
        }
        editor?.setValue('{"code":"SAVED BY SELFTEST"}')
        await settle()
        const control = inFocusedTab('[data-mk-part="operations.button"]')
        const enabled = control instanceof HTMLButtonElement && !control.disabled
        const clicked = click('[data-mk-part="operations.button"]')
        await new Promise(resolve => setTimeout(resolve, 400))
        const after = await onDisk(code)
        console.log(
          `selftest: edit code editor=${editor !== undefined} save clicked=${clicked} ` +
            `enabled=${enabled} status=${JSON.stringify(statusText())} ` +
            `disk ${JSON.stringify(before)} -> ${JSON.stringify(after)} changed=${after !== before}`,
        )
      }
    } catch (error) {
      console.log(`selftest: edit code FAILED ${String(error)}`)
    }
  }

  await imageEditingProbe(options)

  // ------------------------------------------------------------------ no arm, therefore no editor
  const locked = find('readonly.json')
  if (locked === undefined) console.log('selftest: edit no readonly.json fixture')
  else {
    try {
      await editors.open(locked)
      await settle()
      const views = options.offeredViews()
      console.log(
        `selftest: edit read-only views [${views.join(', ')}] arm=${portsFor(locked.id) !== undefined} ` +
          `footer=${JSON.stringify(footerText())} disk=${JSON.stringify(await onDisk(locked))}`,
      )
    } catch (error) {
      console.log(`selftest: edit read-only FAILED ${String(error)}`)
    }
  }
}

/** Drive one visible pixel through the real PNG editor, host writer, disk commit, and reopen. */
async function imageEditingProbe(options: {
  readonly editors: EditorArea
  readonly entries: readonly ExplorerEntry[]
  subjectFor(path: string | undefined): InspectorSubject | undefined
  showStage(stage: string): Promise<boolean>
  inFocusedTab(selector: string): Element | null
}): Promise<void> {
  const { editors, entries, subjectFor, showStage, inFocusedTab } = options
  const image = entries.find(item => item.name === 'sample.png')
  if (image === undefined) {
    console.log('selftest: edit no sample.png fixture for pixel editing')
    return
  }

  try {
    await editors.open(image)
    await settle()
    if (!(await showStage('image-edit'))) {
      console.log('selftest: edit image stage was not offered for sample.png')
      return
    }

    const canvas = inFocusedTab('[data-mk-part="image.canvas"]')
    const swatch = inFocusedTab('[data-mk-part="imageedit.swatch"]')
    const fill = inFocusedTab('[data-mk-part="imageedit.tool"][title="Flood fill"]')
    const apply = inFocusedTab(
      '[data-mk-part="imageedit.action"][title="Commit the edited pixels"]',
    )
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !(swatch instanceof HTMLInputElement) ||
      !(fill instanceof HTMLElement) ||
      !(apply instanceof HTMLButtonElement)
    ) {
      console.log('selftest: edit image controls did not mount for sample.png')
      return
    }

    const pixel = (target: HTMLCanvasElement): readonly number[] => {
      const context = target.getContext('2d', { willReadFrequently: true })
      return context === null ? [] : [...context.getImageData(0, 0, 1, 1).data]
    }
    const before = pixel(canvas)
    const width = canvas.width
    const height = canvas.height
    const colour = before[0] === 255 && before[1] === 0 ? '#00ff00' : '#ff0000'
    swatch.value = colour
    swatch.dispatchEvent(new Event('input', { bubbles: true }))
    fill.click()
    const box = canvas.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) {
      console.log('selftest: edit image canvas has no visible pointer area')
      return
    }
    const pointer = {
      bubbles: true,
      pointerId: 71,
      pointerType: 'mouse',
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }))
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }))
    await settle()

    const changedInMemory = pixel(canvas)
    const revision = String(subjectFor(image.id)?.descriptor['revision'] ?? '')
    const warning =
      inFocusedTab('[data-mk-part="imageedit.warning"]')?.textContent?.includes(
        'Metadata and unknown PNG chunks are removed',
      ) === true
    const enabled = !apply.disabled
    console.log(
      `selftest: edit image applying enabled=${enabled} warning=${warning} ` +
        `pixel=[${before.join(',')}]->memory=[${changedInMemory.join(',')}]`,
    )
    apply.click()

    let reopened = false
    let lastProgress = ''
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (attempt % 20 === 19) {
        const progress =
          inFocusedTab('[data-mk-part="image.readout"]')?.textContent?.trim() ?? 'stage unmounted'
        if (progress !== lastProgress) {
          console.log(`selftest: edit image progress ${JSON.stringify(progress)}`)
          lastProgress = progress
        }
      }
      const next = subjectFor(image.id)
      if (next !== undefined && String(next.descriptor['revision'] ?? '') !== revision) {
        reopened = true
        break
      }
    }
    if (reopened) {
      await settle()
      await showStage('image-edit')
    }
    const reopenedCanvas = inFocusedTab('[data-mk-part="image.canvas"]')
    const after =
      reopened && reopenedCanvas instanceof HTMLCanvasElement ? pixel(reopenedCanvas) : []
    console.log(
      `selftest: edit image writer=png/rgba8@semantic warning=${warning} ` +
        `size=${width}x${height}->${reopenedCanvas instanceof HTMLCanvasElement ? `${reopenedCanvas.width}x${reopenedCanvas.height}` : '-'} ` +
        `pixel=[${before.join(',')}]->memory=[${changedInMemory.join(',')}]->disk=[${after.join(',')}] ` +
        `applyEnabled=${enabled} reopened=${reopened} changed=${
          after.join(',') === changedInMemory.join(',') && after.join(',') !== before.join(',')
        }`,
    )
  } catch (error) {
    console.log(`selftest: edit image FAILED ${String(error)}`)
  }
}

/**
 * The mutating operations (ADR-HOST-002 Path A), driven through the Edit panel's own controls.
 *
 * Every line below is a claim about bytes on disk *and* about what the app shows after the commit:
 * an operation that reported success and left the tab showing the old file would be exactly as
 * useless as one that wrote nothing.
 */
async function editOperationProbes(options: {
  readonly access: FileAccess
  readonly editors: EditorArea
  readonly entries: readonly ExplorerEntry[]
  readonly inspector: ReturnType<typeof createInspectorDock>
  subjectFor(path: string | undefined): InspectorSubject | undefined
  portsFor(path: string): RendererEditorPorts | undefined
  showStage(stage: string): Promise<boolean>
  footerText(): string
}): Promise<void> {
  const { access, editors, entries, inspector, showStage } = options
  const find = (name: string): ExplorerEntry | undefined => entries.find(item => item.name === name)

  /** Latin-1 view of a file's first bytes, so a binary can be searched without decoding it. */
  const rawOnDisk = async (entry: ExplorerEntry): Promise<string> => {
    const bytes = await access.read(entry.id, 256 * 1024)
    let text = ''
    for (let at = 0; at < bytes.length; at += 4096) {
      text += String.fromCharCode(...bytes.subarray(at, Math.min(at + 4096, bytes.length)))
    }
    return text
  }

  /** The tree/namespace labels the focused tab is showing right now. */
  const labels = (part: string): readonly string[] =>
    [
      ...editors.root.querySelectorAll(
        `[data-mk-part="explorer.group"][data-mk-state~="active"] ` +
          `[data-mk-part="explorer.tabcontent"]:not([hidden]) [data-mk-part="${part}"]`,
      ),
    ].map(node => (node.textContent ?? '').trim())

  interface MetadataGroup {
    readonly id?: unknown
    readonly entries?: readonly { readonly key?: unknown; readonly value?: unknown }[]
  }
  const metadataOf = (subject: InspectorSubject | undefined): readonly MetadataGroup[] => {
    const groups = subject?.descriptor['metadata']
    return Array.isArray(groups) ? (groups as readonly MetadataGroup[]) : []
  }
  /** Metadata group ids the subject's descriptor publishes, as the Metadata panel reads them. */
  const metadataGroups = (subject: InspectorSubject | undefined): readonly string[] =>
    metadataOf(subject).map(group => String(group.id ?? ''))
  /** One published metadata value, which is how the app itself reads a codec's facts back. */
  const metadataValue = (
    subject: InspectorSubject | undefined,
    groupId: string,
    key: string,
  ): string => {
    const group = metadataOf(subject).find(item => String(item.id ?? '') === groupId)
    const entry = group?.entries?.find(item => String(item.key ?? '') === key)
    return entry === undefined ? '-' : String(entry.value)
  }

  const panelStatus = (): string =>
    inspector.root.querySelector('[data-mk-part="operations.status"]')?.textContent ?? ''
  const panelNotes = (): string =>
    inspector.root.querySelector('[data-mk-part="form.status"]')?.textContent ?? ''
  const panelFailed = (): boolean =>
    inspector.root.querySelector('[data-mk-part="operations.status"][data-mk-state~="error"]') !==
    null

  /**
   * The subject record for a path once the reopen has registered it again.
   *
   * Between the tab closing and the file opening again there is no record at all, so reading the
   * descriptor straight after an apply reports "nothing" for a codec fact that is simply not back
   * yet — which would read as a missing value rather than a slow one.
   */
  const subjectAfterReopen = async (path: string): Promise<InspectorSubject | undefined> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const subject = options.subjectFor(path)
      if (subject !== undefined) return subject
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return undefined
  }

  /** Show the Edit panel for the focused tab; `false` when the app does not offer one. */
  const openEditPanel = async (path: string): Promise<boolean> => {
    const subject = options.subjectFor(path)
    if (subject === undefined) return false
    await inspector.show(subject)
    if (!inspector.panels.includes('edit')) return false
    await inspector.select('edit')
    await settle()
    return true
  }

  /** Drive the panel the way a user does: pick the form, fill the fields, click Apply. */
  const applyForm = async (
    path: string,
    formId: string,
    values: Readonly<Record<string, string>>,
  ): Promise<string> => {
    const picker = inspector.root.querySelector('[data-mk-part="form.select"]')
    if (!(picker instanceof HTMLSelectElement)) return 'no form picker mounted'
    if (![...picker.options].some(option => option.value === formId)) {
      return `form ${formId} is not offered (offers ${[...picker.options].map(item => item.value).join(', ')})`
    }
    picker.value = formId
    picker.dispatchEvent(new Event('change'))
    await settle()
    /*
     * What this apply's own note will say. The dock describes whatever tab is focused, and the
     * reopen focuses others on the way, so "a note appeared" is not the same claim as "this file's
     * change landed" — without the label a probe happily prints the previous file's outcome.
     */
    const expected = `Last change: ${picker.selectedOptions[0]?.textContent ?? ''}`
    for (const [name, value] of Object.entries(values)) {
      const input = inspector.root.querySelector(`[data-mk-part="form.input"][name="${name}"]`)
      if (!(input instanceof HTMLInputElement)) return `field ${name} is not on the form`
      input.value = value
    }
    const apply = inspector.root.querySelector('[data-mk-part="operations.button"]')
    if (!(apply instanceof HTMLElement)) return 'no Apply control mounted'
    // A repeat of the same form on the same file would leave the same note; only a *new* one
    // counts as this apply having landed.
    const noteBefore = panelNotes()
    apply.click()
    /*
     * The apply invokes the codec, commits through the arm and reopens the tab; the panel is
     * remounted by that reopen, and its "Last change" note is what says the round trip finished.
     * The budget is generous because the reopen re-mounts every stage of the file — an archive or
     * a model stage takes seconds on a loaded machine, and a probe that gave up first would report
     * a timeout for a save that worked.
     */
    for (let attempt = 0; attempt < 1200; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (panelFailed()) return panelStatus()
      /*
       * The panel that reported the outcome was remounted by the reopen, so its status line is
       * back to describing the subject; the note it kept is what says what the change did. It
       * counts only when it is this form's note, on a subject that is open again — otherwise the
       * probe would report whichever tab the dock happened to be describing mid-reopen.
       */
      const note = panelNotes()
      if (
        note !== noteBefore &&
        note.includes(expected) &&
        options.subjectFor(path) !== undefined
      ) {
        return note
      }
      /*
       * Closing the tab makes the dock describe whatever tab the close focused, which can move
       * the active panel off Edit before the file is opened again. Put it back the way a user
       * would — every two seconds, not on every tick: showing the dock leases the subject's
       * operation session over the RPC, and asking ten times a second starves the very reopen
       * this loop is waiting for.
       */
      if (attempt > 20 && attempt % 20 === 0) {
        if (inspector.root.querySelector('[data-mk-part="form.select"]') === null) {
          await openEditPanel(path)
        }
      }
    }
    return `timed out: ${panelStatus()}`
  }

  // ------------------------------------------------------------------ archive: add, then remove
  const archive = find('sample.zip')
  if (archive === undefined) console.log('selftest: edit-op no sample.zip fixture')
  else {
    await editors.open(archive)
    await settle()
    await showStage('archive')
    const before = labels('namespace.label')
    const offered = await openEditPanel(archive.id)
    if (!offered) {
      console.log(
        `selftest: edit-op sample.zip no Edit panel (panels ${inspector.panels.join(', ')})`,
      )
    } else {
      const status = await applyForm(archive.id, 'zip-add-entry', {
        path: 'added/hello.txt',
        content: 'added by the selftest\n',
      })
      await showStage('archive')
      const after = labels('namespace.label')
      console.log(
        editSelfTestLine(
          'sample.zip',
          'zip-add-entry',
          status,
          (await rawOnDisk(archive)).includes('added/hello.txt'),
        ),
      )
      console.log(
        `selftest: edit-op sample.zip entries [${before.join(' | ')}] -> [${after.join(' | ')}]`,
      )

      await openEditPanel(archive.id)
      const removal = await applyForm(archive.id, 'zip-remove-entry', { path: 'data/values.csv' })
      await showStage('archive')
      const removed = labels('namespace.label')
      console.log(
        editSelfTestLine(
          'sample.zip',
          'zip-remove-entry',
          removal,
          !(await rawOnDisk(archive)).includes('data/values.csv'),
        ),
      )
      console.log(`selftest: edit-op sample.zip entries after remove [${removed.join(' | ')}]`)

      // A refusal keeps its reason: the codec knows the entry is not there and says so.
      await openEditPanel(archive.id)
      const refused = await applyForm(archive.id, 'zip-remove-entry', { path: 'never/here.txt' })
      console.log(`selftest: edit-op sample.zip refusal status=${JSON.stringify(refused)}`)
    }
  }

  // ------------------------------------------------------------------ PNG: one tEXt field
  const png = find('sample.png')
  if (png === undefined) console.log('selftest: edit-op no sample.png fixture')
  else {
    await editors.open(png)
    await settle()
    const before = metadataValue(options.subjectFor(png.id), 'png-image', 'chunks')
    if (!(await openEditPanel(png.id))) {
      console.log(
        `selftest: edit-op sample.png no Edit panel (panels ${inspector.panels.join(', ')})`,
      )
    } else {
      const status = await applyForm(png.id, 'png-set-text', {
        keyword: 'Description',
        text: 'set by the selftest',
      })
      const bytes = await rawOnDisk(png)
      const after = metadataValue(await subjectAfterReopen(png.id), 'png-image', 'chunks')
      console.log(
        editSelfTestLine(
          'sample.png',
          'png-set-text',
          status,
          bytes.includes(`tEXtDescription${NUL}set by the selftest`),
        ),
      )
      console.log(`selftest: edit-op sample.png chunks ${before} -> ${after}`)
    }
  }

  // ------------------------------------------------------------------ MP3: one ID3v2 text frame
  const mp3 = find('sample.mp3')
  if (mp3 === undefined) console.log('selftest: edit-op no sample.mp3 fixture')
  else {
    await editors.open(mp3)
    await settle()
    const before = metadataGroups(options.subjectFor(mp3.id))
    if (!(await openEditPanel(mp3.id))) {
      console.log(
        `selftest: edit-op sample.mp3 no Edit panel (panels ${inspector.panels.join(', ')})`,
      )
    } else {
      const status = await applyForm(mp3.id, 'mp3-set-text-frame', {
        keyword: 'TIT2',
        text: 'Selftest title',
      })
      const bytes = await rawOnDisk(mp3)
      const after = metadataGroups(await subjectAfterReopen(mp3.id))
      console.log(
        editSelfTestLine(
          'sample.mp3',
          'mp3-set-text-frame',
          status,
          bytes.startsWith('ID3') && bytes.includes('TIT2') && bytes.includes('Selftest title'),
        ),
      )
      console.log(
        `selftest: edit-op sample.mp3 metadata [${before.join(', ')}] -> [${after.join(', ')}]`,
      )
    }
  }

  // ------------------------------------------------- a subject this host will not write offers none
  const locked = find('readonly.png')
  if (locked === undefined) console.log('selftest: edit-op no readonly.png fixture')
  else {
    await editors.open(locked)
    await settle()
    const subject = options.subjectFor(locked.id)
    if (subject !== undefined) await inspector.show(subject)
    const mutating = (
      (subject?.descriptor['operations'] as readonly { mutatesSource?: unknown }[] | undefined) ??
      []
    ).filter(item => item.mutatesSource === true).length
    console.log(
      `selftest: edit-op readonly.png arm=${options.portsFor(locked.id) !== undefined} ` +
        `declaredMutating=${mutating} panels [${inspector.panels.join(', ')}] ` +
        `editOffered=${inspector.panels.includes('edit')} ` +
        `forms=${editOffer(subject?.descriptor ?? {}, { editable: subject?.editable === true }).forms.length} ` +
        `footer=${JSON.stringify(options.footerText())}`,
    )
  }
}

boot().catch((error: unknown) => {
  const failure = document.createElement('p')
  failure.className = 'bad'
  failure.textContent = `Boot failed: ${error instanceof Error ? error.message : String(error)}`
  requireRoot().replaceChildren(failure)
})
