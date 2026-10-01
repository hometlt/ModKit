/**
 * Webview bundle — the bridge realm's workbench.
 *
 * It has no host access and imports no composition root: the extension host serialises the realm
 * snapshot into the page, opens every subject on its own side and hands this page a consumer of
 * `x3.app/subject-services@1`. That asymmetry is the point — if this file could compose a host,
 * the webview would have become an extension host. What it holds is a client, a stage catalog and
 * a DOM; what it never holds is an inventory, a grant, an extension root or a file handle.
 *
 * The workbench itself is the shipped one, in the arrangement the PWA and Electron already use: a
 * tree on the left (`createExplorer`), the editor area with tabs and a per-tab view picker in place
 * of the explorer's single preview pane (`createEditorArea`), and one `createCodecPreview` deciding
 * which stages a subject can be shown as. Editing is real: the editable stages get ports that are
 * one RPC call each, and the bytes are written by the extension host inside the granted roots.
 */
import {
  createCodecPreview,
  createEditorArea,
  EXPLORER_MAXIMUM_BYTES,
  type EditorArea,
  type ExplorerEntry,
  type FileAccess,
  type PreviewResolver,
} from '@modkit/ui/explorer'
import { EDITOR_EDITED_EVENT, requestEditorHistory } from '@modkit/ui/editor'
import { createWorkbench } from '@modkit/ui/workbench'
import { setUiPreferenceStore } from '@modkit/ui/viewer'
import { resolveModelViewerTextures } from '@modkit/ui/model'
import { templateImagesFromRaster } from '@modkit/ui/template'
import type { UiCatalogDocument, UiLocale, UiLocalizer } from '@modkit/ui/localization'
import type {
  AnyDescriptor,
  JsonValue,
  NamespaceEntry,
  NamespaceEntrySource,
  Page,
  PageRequest,
  PresentationSlot,
  ViewerSources,
  ViewerStatusPort,
} from '@modkit/sdk'
import type { ImagePixelOperation } from '@modkit/ui/image'
import {
  createSubjectCard,
  loadSubjectCardSections,
  SubjectNavigationHistory,
  type CardRef,
  type SubjectCard,
} from '@modkit/ui/card'
import {
  connectSubjectRpc,
  type SubjectClientOpenResult,
  type SubjectPreviewSession,
} from '@modkit/host'
import {
  subjectFactsSourceFromWire,
  type ExtensionSubjectCardWireDocument,
} from '@modkit/extension-manager'

import { createArchiveViewer, type ArchiveGalleryThumbnail } from '@modkit/ui/archive'
import { revisionIdFromRef } from '@modkit/sdk'

import {
  createBridge,
  type ShellEntry,
  type ShellExplorerEntry,
  type ShellThumbnail,
  type WebviewChannel,
} from './bridge.js'
import {
  exposeModkitAcceptance,
  withSubjectAcceptance,
  type ModkitAcceptanceReceipt,
} from './acceptance.js'
import { probeWebviewFacilities } from './facilities.js'
import { createWebviewEditorPorts, type WebviewEditorPorts } from './editor-ports.js'
import { reopenCommittedEntry } from './edit-reopen.js'
import { continueVsCodeMapPreviewSelection } from './map-preview-selection.js'
import type { PageBootstrap } from './page.js'
import { createWebviewRendererPort } from './renderer-port.js'
import { createVsCodePreviewFallback, createVsCodePreviewStages } from './stages.js'
import { preferredStage } from './view-policy.js'
import { createVscodeLocalizer } from './localization.js'

/** What the extension host serialises into the page. Inert data a bridge realm may see. */
interface RealmSnapshot {
  readonly realmId: string
  readonly facilities: readonly string[]
}

interface Bootstrap {
  readonly locale: UiLocale
  readonly localizationCatalogs: readonly UiCatalogDocument[]
  readonly extensionHost: RealmSnapshot
  readonly webview: RealmSnapshot
  /**
   * The scene-renderer offer the extension host's resolver selected for this page's realm.
   *
   * Ids only, like everything else here. `./renderer-port.ts` turns it into a port by looking the
   * renderer up among the providers this bundle already carries; it loads nothing.
   */
  readonly renderer?: PageBootstrap['renderer']
  readonly topologyId: string
  /** Endpoint identity of the subject RPC; the serving side used the same pair. */
  readonly session: string
  readonly moduleUrl: string
  readonly contributionId: string
  readonly supportedExtensions: readonly string[]
  readonly extensions: {
    readonly bundled: readonly string[]
    readonly installed: readonly string[]
    readonly failures: readonly {
      readonly root: string
      readonly code: string
      readonly message: string
    }[]
    readonly problems: readonly string[]
  }
  readonly diagnostics: number
  readonly acceptance: ModkitAcceptanceReceipt
  /** Opened straight away when the panel was raised from a file (the custom editor). */
  readonly openPath?: string
  /** The single stage a stage-specific native editor raised this page for. */
  readonly forcedStage?: string
  readonly extensionCard?: import('./extension-cards.js').ExtensionCardBundle
  /** Lower-case extensions the explorer's gallery draws as pictures. */
  readonly galleryExtensions?: readonly string[]
  /** Raised as a Modkit Explorer over one folder; see `mountExplorerFolder`. */
  readonly explorer?: PageBootstrap['explorer']
  /** `modkit.showHiddenEntries` when the page was built. */
  readonly showHiddenEntries?: boolean
  /** The game-string locale cards open in (`modkit.locale`). */
  readonly gameLocale?: string
  /** Relations a graph walk follows from its root (`modkit.maxGraphHops`). */
  readonly graphDepth?: number
  /** The viewer preferences the extension keeps for its pages. */
  readonly preferences?: Readonly<Record<string, unknown>>
}

/** The live "show hidden files and folders" option: the bootstrap value, then `show-hidden` events. */
let showHiddenEntries = false

/** `acquireVsCodeApi`, declared structurally so nothing here depends on the editor's typings. */
interface VsCodeWebviewApi {
  postMessage(message: unknown): void
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const NAMESPACE_CONTRACT = 'common.view/namespace-entry-source'

/** Which entries the explorer's gallery shows: files whose extension an enabled image codec reads. */
function galleryAccepts(
  extensions: readonly string[] | undefined,
): ((entry: NamespaceEntry) => boolean) | undefined {
  if (extensions === undefined || extensions.length === 0) return undefined
  const names = new Set(extensions)
  return entry => {
    const dot = entry.name.lastIndexOf('.')
    return entry.kind === 'file' && dot > 0 && names.has(entry.name.slice(dot + 1).toLowerCase())
  }
}

/**
 * The host's thumbnails, remembered per entry revision and size.
 *
 * The gallery redraws on every selection, and each redraw asks for every visible picture again;
 * without this each click would decode them all a second time. A failed or cancelled draw is not
 * kept, so the next redraw asks again.
 */
function rememberedThumbnails(
  draw: (entry: NamespaceEntry, maxEdge: number) => Promise<ArchiveGalleryThumbnail | undefined>,
): (entry: NamespaceEntry, maxEdge: number) => Promise<ArchiveGalleryThumbnail | undefined> {
  const drawn = new Map<string, Promise<ArchiveGalleryThumbnail | undefined>>()
  return (entry, maxEdge) => {
    const key = `${maxEdge}:${entry.revision}:${entry.id}`
    const known = drawn.get(key)
    if (known !== undefined) return known
    const pending = draw(entry, maxEdge)
    pending.catch(() => drawn.delete(key))
    drawn.set(key, pending)
    return pending
  }
}

/** A `thumbnail` answer, checked: the host may have had nothing to draw. */
function thumbnailFrom(answer: unknown): ArchiveGalleryThumbnail | undefined {
  if (answer === null || typeof answer !== 'object') return undefined
  const { width, height, rgba } = answer as Partial<ShellThumbnail>
  return typeof width === 'number' &&
    typeof height === 'number' &&
    rgba instanceof Uint8Array &&
    rgba.byteLength === width * height * 4
    ? { width, height, rgba }
    : undefined
}

/**
 * The webview file explorer over one folder of any VS Code file system.
 *
 * The same archive explorer an archive's editor shows, bound to a namespace the extension host
 * lists one folder at a time (`explorer-children`), so a content source or a CASC-sized tree loads
 * only the folders that are opened. The page never sees the folder's address: entries carry ids
 * the host handed out, and opening or drawing one sends the id back.
 */
async function mountExplorerFolder(
  workbench: ReturnType<typeof createWorkbench>,
  bridge: ReturnType<typeof createBridge>,
  snapshot: Bootstrap,
  localizer: UiLocalizer,
): Promise<void> {
  const listings = new Map<string, Promise<readonly NamespaceEntry[]>>()
  const listing = (path: string): Promise<readonly NamespaceEntry[]> => {
    const known = listings.get(path)
    if (known !== undefined) return known
    const listed = bridge.request({ op: 'explorer-children', path }).then(answer =>
      (answer as readonly ShellExplorerEntry[]).map(
        (entry): NamespaceEntry => ({
          id: entry.id,
          path: entry.path,
          name: entry.name,
          kind: entry.kind,
          ...(entry.size === undefined ? {} : { size: BigInt(entry.size) }),
          ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt }),
          revision: revisionIdFromRef({
            kind: 'provider-token',
            value: `${Math.trunc(entry.modifiedAt ?? 0)}-${entry.size ?? 0}`,
          }),
        }),
      ),
    )
    // A failed listing is not remembered: opening the folder again asks again.
    listed.catch(() => listings.delete(path))
    listings.set(path, listed)
    return listed
  }
  const children = async (path: string, page: PageRequest): Promise<Page<NamespaceEntry>> => {
    const entries = await listing(path)
    const offset = page.cursor === undefined ? 0 : Number(page.cursor)
    const end = offset + page.limit
    return {
      items: entries.slice(offset, end),
      ...(end < entries.length ? { nextCursor: String(end) } : {}),
    }
  }
  const source: NamespaceEntrySource = {
    list: children,
    children,
    openEntry() {
      return Promise.reject(new Error('explorer entries are opened by the extension host'))
    },
  }
  const binding = { bindingId: 'modkit.explorer/folder', contract: NAMESPACE_CONTRACT, major: 1 }
  const slot = {
    slotId: 'modkit.explorer/folder',
    kind: 'stage',
    contributionId: 'modkit.app.vscode/explorer',
    extensionId: 'modkit/vscode',
    priority: 0,
    bindings: [binding],
  } as unknown as PresentationSlot
  const sources: ViewerSources = {
    get: (async (requested: { readonly contract?: string }) =>
      requested.contract === NAMESPACE_CONTRACT
        ? { value: source, release: async () => undefined }
        : undefined) as ViewerSources['get'],
    getUnknown: async () => undefined,
  }
  const accepts = galleryAccepts(snapshot.galleryExtensions)
  const viewer = createArchiveViewer({
    localizer,
    ...(snapshot.explorer === undefined ? {} : { rootLabel: snapshot.explorer.label }),
    openEntry: async entry => {
      await bridge.request({ op: 'explorer-open', id: entry.id })
    },
    ...(accepts === undefined
      ? {}
      : {
          gallery: {
            accepts,
            thumbnail: rememberedThumbnails(async (entry, maxEdge) =>
              thumbnailFrom(
                await bridge.request({ op: 'thumbnail', explorerId: entry.id, maxEdge }),
              ),
            ),
          },
        }),
  })
  let scope = new AbortController()
  window.addEventListener('unload', () => scope.abort(), { once: true })
  const draw = async (): Promise<void> => {
    const container = document.createElement('div')
    container.className = 'modkit-explorer'
    workbench.setMain(container)
    await viewer.mount({
      container,
      // A folder has no codec interpretation; the viewer reads only its revision.
      descriptor: {
        interpretation: 'none',
        candidates: [],
        revision: snapshot.explorer?.label ?? 'explorer',
      } as unknown as AnyDescriptor,
      slot,
      sources,
      signal: scope.signal,
    } as unknown as Parameters<typeof viewer.mount>[0])
  }
  // The host lists through the filesystem providers, which apply the option; a changed option only
  // has to ask for the folders again.
  bridge.onEvent(event => {
    if (event.op !== 'show-hidden') return
    showHiddenEntries = event.show
    listings.clear()
    scope.abort()
    scope = new AbortController()
    void draw().catch(() => undefined)
  })
  await draw()
}

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

/** Pixels cross the bridge as JSON; base64 keeps that from being one number per byte. */
function base64Of(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(text)
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/**
 * When this bundle began evaluating, so the page can say what it spent before showing anything.
 *
 * `performance.timeOrigin` is the navigation, so the difference is the cost of fetching, parsing
 * and evaluating the bundle — which is the part a 7 MiB page pays before any of this code runs.
 */
const pageEntered = performance.now()

const bootstrap = (globalThis as { __MODKIT_BOOTSTRAP__?: Bootstrap }).__MODKIT_BOOTSTRAP__
const acquire = (globalThis as { acquireVsCodeApi?: () => VsCodeWebviewApi }).acquireVsCodeApi
if (bootstrap !== undefined) exposeModkitAcceptance(globalThis, bootstrap.acceptance)
const pageLocalizer = createVscodeLocalizer(
  bootstrap?.locale ?? document.documentElement.lang,
  bootstrap?.localizationCatalogs,
)

const root = document.querySelector('#root')
if (root === null) throw new Error('missing #root')

if (bootstrap === undefined || acquire === undefined) {
  const message = document.createElement('p')
  message.textContent =
    bootstrap === undefined
      ? pageLocalizer.text('vscode.webview.noSnapshot')
      : pageLocalizer.text('vscode.webview.notInside')
  root.replaceChildren(message)
} else {
  void mount(root, bootstrap, acquire()).catch((error: unknown) => {
    const message = document.createElement('p')
    message.textContent = pageLocalizer.text('vscode.webview.workbenchFailed', {
      reason: describe(error),
    })
    root.replaceChildren(message)
  })
}

async function mount(
  mountPoint: Element,
  snapshot: Bootstrap,
  api: VsCodeWebviewApi,
): Promise<void> {
  const localizer = createVscodeLocalizer(snapshot.locale, snapshot.localizationCatalogs)
  showHiddenEntries = snapshot.showHiddenEntries === true
  // ---------------------------------------------------------------- transport
  const channel: WebviewChannel = {
    post: message => {
      api.postMessage(message)
    },
    onMessage: handler => {
      const listener = (event: MessageEvent): void => handler(event.data)
      window.addEventListener('message', listener)
      return () => window.removeEventListener('message', listener)
    },
  }
  const bridge = createBridge({ channel, idPrefix: 'view' })
  /*
   * Viewer preferences (the media shell's layout, recent colours) are kept by the extension host:
   * this page's storage is its own origin's and ends with the tab. Read from the bootstrap, each
   * change sent back for the pages after this one.
   */
  const preferences = new Map(Object.entries(snapshot.preferences ?? {}))
  setUiPreferenceStore({
    get: key => preferences.get(key),
    set(key, value) {
      preferences.set(key, value)
      void bridge
        .request({ op: 'preference', key, value: value as JsonValue })
        .catch(() => undefined)
    },
  })

  // ---------------------------------------------------------------- chrome
  /*
   * Built before the RPC client, not after. `onDiagnostic` fires from the moment the client is
   * connected, and it has to be able to reach the status line — when this block sat below the
   * connect, the handler could only `bridge.emit`, so a subject diagnostic went to the extension's
   * output channel and was never drawn anywhere a person looks.
   */
  const workbench = createWorkbench(document, {
    localizer,
    title: localizer.text('app.title'),
    host: { label: snapshot.webview.realmId, facilities: snapshot.webview.facilities },
    // VS Code owns this editor's chrome; the page mounts only its subject surface.
    embedded: true,
  })
  mountPoint.replaceChildren(workbench.root)
  // Reported to the output channel, beside the extension host's own phases (see `./timing.ts`).
  bridge.emit({ op: 'timing', name: 'bundle evaluated', milliseconds: pageEntered })
  bridge.emit({
    op: 'timing',
    name: 'workbench mounted',
    milliseconds: performance.now() - pageEntered,
  })

  /*
   * No status line of its own any more.
   *
   * The page used to draw a footer — realm id, facility count, the subject's absolute path, its
   * size — which is exactly the chrome the owner's screenshot objected to, and it leaked a local
   * path while doing it. The editor has a status bar; the extension writes the subject's facts
   * there, workspace-relative. What is left of  is the mirror into the output channel, so a
   * message still has somewhere to go.
   *
   * Diagnostics do not travel this way at all: they go to the Problems panel, with their code and
   * severity intact.
   */
  const say = (message: string): void => {
    bridge.emit({ op: 'status', text: message })
  }

  /*
   * What this page can actually honour, answered once and sent up (§1.5).
   *
   * The extension composed this realm with an intended facility set; only the page can say whether
   * the machine agrees. The smoke's own editor runs with `--disable-gpu`, which is exactly the case
   * where a composed `gpu.webgl2` would otherwise go on being asserted by a product that never
   * asked.
   */
  bridge.emit({ op: 'facilities', observed: probeWebviewFacilities(globalThis) })

  if (snapshot.extensionCard !== undefined) {
    await mountExtensionSubjectCard(workbench, bridge, snapshot.extensionCard, localizer)
    return
  }
  if (snapshot.explorer !== undefined) {
    await mountExplorerFolder(workbench, bridge, snapshot, localizer)
    return
  }

  type NavigationEvent = {
    readonly sourceSessionId: string
    readonly target: string
    readonly result: Extract<SubjectClientOpenResult, { readonly state: 'opened' }>
  }
  const preopenedSubjects = new Map<string, NavigationEvent['result']>()
  /** The view a navigated subject opens on, when the extension asked for one (its graph, say). */
  const pendingStages = new Map<string, string>()
  let openNavigatedSubject: ((event: NavigationEvent) => Promise<void>) | undefined
  /*
   * A cold codec realm can take longer to start than one RPC call may last (60 s; a Roblox place
   * took 89 s on a loaded machine). The extension host goes on warming it after the call gives up,
   * so the page asks again, at most twice, and says it is still waiting.
   */
  const openPatiently = async (path: string): Promise<SubjectClientOpenResult> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.open(path)
      } catch (error) {
        const code = (error as { readonly code?: unknown } | null)?.code
        if (code !== 'x3.host/rpc-deadline-exceeded' || attempt >= 3) throw error
        say(localizer.text('vscode.webview.stillOpening'))
      }
    }
  }
  const client = await connectSubjectRpc({
    framePort: bridge.framePort,
    // This port is emitter-shaped (`on`), and its payload is the frame itself.
    session: snapshot.session,
    moduleUrl: snapshot.moduleUrl,
    contributionId: snapshot.contributionId,
    async onNavigate(event) {
      if (openNavigatedSubject === undefined) {
        await event.result.session.dispose()
        throw new Error('subject navigation shell is unavailable')
      }
      await openNavigatedSubject(event)
    },
    /*
     * Said on the page, where it used to be silent. `say` also mirrors into the output channel,
     * so this one call covers both of the page's own channels.
     *
     * The editor's Problems panel is fed from the extension host instead, not from here: this
     * channel narrows a diagnostic to `{code, message}`, and a severity guessed from a code string
     * would be a worse answer than the one the host already has.
     */
    onDiagnostic: diagnostic => {
      say(`${diagnostic.code}: ${diagnostic.message}`)
    },
  })

  // ---------------------------------------------------------------- file access
  /**
   * Browsing is shell traffic, not RPC: the tree needs a listing and the tab needs bytes, and
   * neither is a capability. Both are confined on the serving side to the folders this window
   * granted — the very roots `createPathSubjectOpener` confines `open` to.
   */
  const access: FileAccess = {
    label: localizer.text('vscode.webview.workspace'),
    async list(entryId) {
      const answer = await bridge.request({
        op: 'list',
        ...(entryId === undefined ? {} : { path: entryId }),
      })
      return (answer as readonly ShellEntry[]).map(entry => ({
        id: entry.id,
        name: entry.name,
        directory: entry.directory,
        ...(entry.size === undefined ? {} : { size: entry.size }),
      }))
    },
    async read(entryId, maxBytes) {
      if (preopenedSubjects.has(entryId)) return new Uint8Array()
      const answer = await bridge.request({ op: 'read', path: entryId, maxBytes })
      if (!(answer instanceof Uint8Array)) {
        throw new Error(localizer.text('vscode.webview.noBytes'))
      }
      return answer
    },
  }

  // ---------------------------------------------------------------- subjects
  /** One record per open subject: what `editorPorts` and the status line need afterwards. */
  interface SubjectRecord {
    readonly entry: ExplorerEntry
    readonly sessionId: string
    readonly session: SubjectPreviewSession
    readonly descriptor: Record<string, unknown>
    readonly planActive: string | undefined
  }
  const subjects = new Map<string, SubjectRecord>()
  /** Live editor ports per open file, so "save before closing" commits the very ports in use. */
  const openPorts = new Map<string, WebviewEditorPorts>()
  /** Last successful Path A outcome per file, retained across the mandatory reopen. */
  const editOutcomes = new Map<string, string>()
  /** Entry id of the focused tab — the only tab that can receive a keystroke. */
  let focused: string | undefined
  /** The renderer this page was granted, if any; built once and shared by every model stage. */
  const rendererPort = createWebviewRendererPort(snapshot.renderer)

  const markDirty = (entryId: string, dirty: boolean): void => {
    editors.markDirty(entryId, dirty)
    if (entryId === snapshot.openPath) bridge.emit({ op: 'document-dirty', path: entryId, dirty })
  }

  const recordForDescriptor = (descriptor: Record<string, unknown>): SubjectRecord | undefined =>
    [...subjects.values()].find(record => record.descriptor === descriptor)

  /**
   * VS Code's editor picker is the mode switcher. A page raised as one of the stage-specific native
   * editors therefore offers exactly that stage: keeping the full list would put a second switcher
   * inside the editor the user already chose a mode for.
   */
  const onlyForcedStage = <T extends { readonly id?: string }>(
    stages: readonly T[],
  ): readonly T[] => {
    if (snapshot.forcedStage === undefined) return stages
    const wanted = stages.filter(stage => stage.id === snapshot.forcedStage)
    return wanted.length === 0 ? stages : wanted
  }

  /*
   * The custom editor's own chrome does the rest of what MK2's viewers had: the status bar entries
   * come from the viewer through this port, and the gallery lists the opened file's siblings.
   */
  let statusChoose: ((itemId: string, choiceId: string) => void) | undefined
  const viewerStatus: ViewerStatusPort | undefined =
    snapshot.openPath === undefined
      ? undefined
      : {
          set(items, onChoose) {
            statusChoose = onChoose
            /*
             * One tab, several files: the gallery can move the render area to a sibling, and VS
             * Code's tab keeps naming the file it was opened for. MK2 answered that with a path
             * entry in the status bar, and so does this — but only while the two differ.
             */
            const shownPath =
              focused !== undefined && focused !== snapshot.openPath ? focused : undefined
            void bridge
              .request({
                op: 'status-set',
                items:
                  shownPath === undefined
                    ? items
                    : [
                        {
                          id: 'path',
                          icon: 'file-media',
                          text: baseName(shownPath),
                          tooltip: shownPath,
                          align: 'start' as const,
                        },
                        ...items,
                      ],
              })
              .catch(() => undefined)
          },
          clear() {
            statusChoose = undefined
            void bridge.request({ op: 'status-set', items: [] }).catch(() => undefined)
          },
        }
  /*
   * The pixel view's own history and save, lent to the editor.
   *
   * The image stage keeps its edits in the page (a stroke is not a plan), so the editor's Undo,
   * Redo and Save arrive here as requests and are answered by whichever view is mounted. Nothing
   * is drawn for them in the page.
   */
  let pixelEditing: import('@modkit/ui/image').ImageEditingHandlers | undefined

  /*
   * No sibling gallery inside a viewer.
   *
   * The media shell's left pane is given no port of siblings: the one gallery is the webview file
   * explorer's, which shows the pictures among an archive's members (below, `archiveGallery`) or a
   * folder's files (a Modkit Explorer panel). Without a port the shell collapses that pane and hides
   * its toggle, leaving the render area the full width.
   */
  const archiveGalleryAccepts = galleryAccepts(snapshot.galleryExtensions)

  const codecPreview = createCodecPreview({
    localizer,
    supported: snapshot.supportedExtensions,
    ...(viewerStatus === undefined ? {} : { status: viewerStatus }),
    stages: onlyForcedStage(
      createVsCodePreviewStages({
        localizer,
        /*
         * Built here rather than resolved here: the extension host ran the standard resolver
         * against this realm and put the answer in the snapshot, and this turns that id into the
         * provider this bundle already carries. Absent when the host selected nothing, which the
         * model stage reports rather than hides.
         */
        ...(rendererPort === undefined ? {} : { renderer: rendererPort }),
        async textures(descriptor, references, signal) {
          const record = recordForDescriptor(descriptor as unknown as Record<string, unknown>)
          const readRaster = record?.session.readRasterResource
          if (readRaster === undefined) return new Map()
          return resolveModelViewerTextures(
            { read: (request, abort) => readRaster(request, abort) },
            references,
            signal,
          )
        },
        // The textures a model's effects name, through the same subject-bound port.
        rasterResources(descriptor) {
          const record = recordForDescriptor(descriptor as unknown as Record<string, unknown>)
          const readRaster = record?.session.readRasterResource
          return readRaster === undefined
            ? undefined
            : { read: (request, abort) => readRaster(request, abort) }
        },
        /*
         * The icons a template names, decoded through the same subject-bound raster port the model
         * stage uses. The page receives pixels, never a path or a codec choice, and encodes them
         * here because this is the side that has a canvas. An asset the host cannot resolve is left
         * out, and the stage keeps naming it.
         */
        async templateImages(descriptor, assets, signal) {
          const record = recordForDescriptor(descriptor as unknown as Record<string, unknown>)
          const readRaster = record?.session.readRasterResource
          if (readRaster === undefined) return new Map()
          return templateImagesFromRaster(
            document,
            { read: (request, abort) => readRaster(request, abort) },
            assets,
            signal,
          )
        },
        pixelOperations: {
          async list() {
            const answer = await bridge
              .request({ op: 'viewer-operations', surface: 'viewer.image' })
              .catch(() => [])
            return Array.isArray(answer) ? (answer as readonly ImagePixelOperation[]) : []
          },
          async run(operationId, input, image) {
            const answer = (await bridge.request({
              op: 'viewer-operation-run',
              operationId,
              input,
              image: { width: image.width, height: image.height, rgba: base64Of(image.rgba) },
            })) as
              | { state: 'ok'; image: { width: number; height: number; rgba: string } }
              | { state: 'refused'; reason: string }
            if (answer.state !== 'ok') return answer
            return {
              state: 'ok',
              image: {
                width: answer.image.width,
                height: answer.image.height,
                rgba: Uint8Array.from(atob(answer.image.rgba), character =>
                  character.charCodeAt(0),
                ),
              },
            }
          },
        },
        registerPixelEditing(handlers) {
          pixelEditing = handlers
        },
        // The recording's other view: its 2D player and its 3D world follow one transport.
        showStage: stageId => editors.showView(stageId),
        // The model a card's subject names: the extension host finds it in that subject's mod chain.
        openModel(model) {
          const subject = focused ?? snapshot.openPath
          if (subject === undefined) return
          void bridge
            .request({ op: 'open-model', subject, model })
            .catch((error: unknown) => say(describe(error)))
        },
        // A card's source: the extension host shows the declaring file at its line.
        openSource(location) {
          void bridge
            .request({ op: 'open-source', ...location })
            .catch((error: unknown) => say(describe(error)))
        },
        // An archive member opens as a tab of its own, addressed through the container VFS.
        async openArchiveEntry(entry) {
          const container = focused ?? snapshot.openPath
          if (container === undefined) return
          await bridge.request({ op: 'open-in-editor', path: container, entry })
        },
        // The explorer's gallery: members an enabled image codec reads, drawn by the extension host.
        ...(archiveGalleryAccepts === undefined
          ? {}
          : {
              archiveGallery: {
                accepts: archiveGalleryAccepts,
                thumbnail: rememberedThumbnails(async (entry, maxEdge) => {
                  const container = focused ?? snapshot.openPath
                  if (container === undefined) return undefined
                  return thumbnailFrom(
                    await bridge.request({
                      op: 'thumbnail',
                      path: container,
                      entry: entry.path,
                      maxEdge,
                    }),
                  )
                }),
              },
            }),
        async archiveAction(action, target) {
          const subject = focused ?? snapshot.openPath
          if (subject === undefined) return false
          const answer = await bridge.request({
            op: 'archive-action',
            subject,
            action,
            path: target.path,
            kind: target.kind,
          })
          return answer === true
        },
        onPixelEdit() {
          if (snapshot.openPath === undefined) return
          bridge.emit({ op: 'document-edited', path: snapshot.openPath })
        },
        portsFor(descriptor) {
          const record = recordForDescriptor(descriptor)
          return record === undefined ? undefined : openPorts.get(record.entry.id)
        },
        async reopen(descriptor) {
          const record = recordForDescriptor(descriptor)
          return record === undefined ? false : reopenCommittedEntry(editors, record.entry)
        },
        showHiddenEntries: () => showHiddenEntries,
        ...(snapshot.gameLocale === undefined ? {} : { gameLocale: snapshot.gameLocale }),
        ...(snapshot.graphDepth === undefined ? {} : { graphDepth: snapshot.graphDepth }),
        lastOutcome(descriptor) {
          const record = recordForDescriptor(descriptor)
          return record === undefined ? undefined : editOutcomes.get(record.entry.id)
        },
        recordOutcome(descriptor, outcome) {
          const record = recordForDescriptor(descriptor)
          if (record !== undefined) editOutcomes.set(record.entry.id, outcome)
        },
        onStatus(status) {
          say(status.message)
        },
        /*
         * Export travels the same shell channel as every other host capability the page cannot have
         * itself. The page sends bytes and a leaf name; the extension host picks the folder.
         */
        async exportFiles(files) {
          const beside = focused ?? snapshot.openPath
          const answer = await bridge.request({
            op: 'export-files',
            files: files.map(file => ({
              name: file.name,
              mediaType: file.mediaType,
              bytes: file.bytes,
            })),
            ...(beside === undefined ? {} : { beside }),
          })
          const outcome = answer as { readonly state?: unknown; readonly names?: unknown }
          if (outcome?.state === 'written' && Array.isArray(outcome.names)) {
            say(localizer.text('vscode.webview.exported', { count: outcome.names.length }))
            return { state: 'written', names: outcome.names.map(String) }
          }
          const reason =
            typeof (outcome as { readonly reason?: unknown })?.reason === 'string'
              ? (outcome as { readonly reason: string }).reason
              : 'the window returned no export outcome'
          return { state: 'refused', reason }
        },
        exportBaseName(descriptor) {
          const record = recordForDescriptor(descriptor as unknown as Record<string, unknown>)
          // the subject's name without its own extension: `icon.dds` exports as `icon.png`
          return record?.entry.name.replace(/\.[^.]+$/u, '') ?? 'image'
        },
      }),
    ),
    fallback: createVsCodePreviewFallback(localizer),

    /*
     * What the extension host holds around the open file. The page may not read a directory, so it
     * asks, and the extension host answers from the same bounded snapshot the language features
     * use. A window without the bridge op simply gets nothing back, which a stage reports.
     */
    workspaceDocuments: {
      async read(request) {
        const answer = (await bridge.request({
          op: 'workspace-documents',
          ...(request?.languageIds === undefined ? {} : { languageIds: [...request.languageIds] }),
          ...(request?.maxDocuments === undefined ? {} : { maxDocuments: request.maxDocuments }),
          ...(snapshot.openPath === undefined ? {} : { path: snapshot.openPath }),
        })) as { documents?: readonly unknown[]; isComplete?: boolean } | undefined
        return {
          documents: (answer?.documents ?? []) as never,
          isComplete: answer?.isComplete === true,
        }
      },
    },

    async openSession(entry) {
      const preopened = preopenedSubjects.get(entry.id)
      let result: SubjectClientOpenResult
      if (preopened === undefined) result = await openPatiently(entry.id)
      else {
        preopenedSubjects.delete(entry.id)
        result = preopened
      }
      if (result.state === 'opened') {
        const candidates = mapPreviewCandidates(result.snapshot.candidates)
        if (candidates.length > 0) {
          const choice = window.prompt(
            localizer.text('vscode.webview.chooseMap', {
              candidates: candidates
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
          if (choice !== null && choice.trim().length > 0) {
            const selected = candidates.find(candidate => candidate.candidateId === choice.trim())
            if (selected === undefined) {
              say(localizer.text('vscode.webview.invalidMapSelection', { name: entry.name }))
            } else {
              const firstSession = result.session
              result = await continueVsCodeMapPreviewSelection({
                path: entry.id,
                selectionId: selected.candidateId,
                dispose: () => firstSession.dispose(),
                open: request => client.open(request),
              })
            }
          }
        }
      }
      if (result.state === 'unresolved') {
        const failure =
          result.snapshot.diagnostics.find(item => item.severity === 'error') ??
          result.snapshot.diagnostics[0]
        const reason =
          failure === undefined
            ? result.snapshot.reason
            : `${result.snapshot.reason}; ${failure.code}: ${failure.message}`
        say(
          localizer.text('vscode.webview.noCodecClaimed', {
            name: entry.name,
            reason,
          }),
        )
        subjects.delete(entry.id)
        return undefined
      }
      const opened = result.snapshot
      say(
        `${entry.name} · ${opened.selected.contributionId}/${opened.selected.variantId} · ` +
          `${Math.round(opened.selected.confidence * 100)}%`,
      )
      // A map whose world could not be prepared opens on its other views: say why here, not only
      // in Problems, or it looks as if Modkit took the map for an archive.
      const worldFailure = opened.diagnostics.find(
        item => item.severity === 'error' && item.code.startsWith('x3.host/map-'),
      )
      if (worldFailure !== undefined)
        say(
          localizer.text('vscode.webview.mapWorldUnavailable', {
            name: entry.name,
            reason: `${worldFailure.code}: ${worldFailure.message}`,
          }),
        )
      subjects.set(entry.id, {
        entry,
        sessionId: opened.sessionId,
        session: result.session,
        descriptor: opened.descriptor,
        planActive: result.session.presentation?.activeStage,
      })
      exposeModkitAcceptance(
        globalThis,
        withSubjectAcceptance(snapshot.acceptance, {
          selected: opened.selected,
          ...(opened.selectedRoute === undefined ? {} : { selectedRoute: opened.selectedRoute }),
          descriptor: opened.descriptor,
        }),
      )
      return {
        ...(result.session.subjectNavigation === undefined
          ? {}
          : { subjectNavigation: result.session.subjectNavigation }),
        descriptor: async () => opened.descriptor,
        dataSource: (contract, major) => result.session.dataSource(contract, major),
        operations: () => result.session.operations(),
        async dispose() {
          subjects.delete(entry.id)
          const ports = openPorts.get(entry.id)
          openPorts.delete(entry.id)
          if (ports !== undefined) await ports.dispose().catch(() => undefined)
          await result.session.dispose()
        },
      }
    },

    /*
     * Asked once per opened subject, before any stage mounts. `undefined` drops the editable
     * stages for *that subject alone*, which is exactly how this host says "I cannot write this
     * one": the extension host refuses `edit(sessionId)` for a subject it has no writer or no
     * backend for, and a save button that fails at the end would be worse than none.
     */
    async editorPorts(entry) {
      const record = subjects.get(entry.id)
      if (record === undefined) return undefined
      try {
        const arm = await client.edit(record.sessionId)
        const ports = await createWebviewEditorPorts({
          arm,
          localizer,
          onStatus: message => say(`${entry.name} · ${message}`),
          onDirty: dirty => markDirty(entry.id, dirty),
        })
        openPorts.set(entry.id, ports)
        return ports
      } catch (error) {
        say(
          localizer.text('vscode.webview.readOnly', {
            name: entry.name,
            reason: describe(error),
          }),
        )
        return undefined
      }
    },
  })

  /** Offer every applicable stage, then start on the one the host's plan selected, if any. */
  const preview: PreviewResolver = {
    supported: codecPreview.supported,
    async open(container, entry, bytes, signal) {
      const handle = await codecPreview.open(container, entry, bytes, signal)
      if (handle === undefined) return undefined
      const views = handle.views.map(view => view.id)
      const requested = pendingStages.get(entry.id)
      pendingStages.delete(entry.id)
      const wanted =
        requested !== undefined && views.includes(requested)
          ? requested
          : preferredStage(views, subjects.get(entry.id)?.planActive)
      if (wanted !== undefined && wanted !== handle.activeView) await handle.show(wanted)
      return handle
    },
  }

  // ---------------------------------------------------------------- tabs
  /*
   * Declared after the previewer because the editor area consumes it, and referenced from
   * `editorPorts` above through the closure — which only runs when a file is opened, long after
   * this line.
   */
  const editors: EditorArea = createEditorArea(document, {
    localizer,
    preview,
    /*
     * In the custom editor the file already has a tab and a breadcrumb — VS Code drew them, above
     * this webview, for this very file. A second row of tabs showing the same one file, and a
     * second breadcrumb spelling out its absolute location, are this component not knowing where
     * it was mounted. Switched off, what is left is the working area: the view picker and the
     * stage. The standalone panel keeps both, because there it is the only thing that has them.
     */
    ...(snapshot.openPath === undefined
      ? {}
      : { chrome: { tabs: false, breadcrumb: false, viewPicker: false } as const }),
    read: (entry, signal) => access.read(entry.id, EXPLORER_MAXIMUM_BYTES, signal),
    async confirmClose(entry) {
      const answer = String(
        await bridge.request({
          op: 'confirm',
          message: localizer.text('vscode.webview.unsavedChanges', { name: entry.name }),
          savable: openPorts.has(entry.id),
        }),
      )
      return answer === 'save' || answer === 'discard' ? answer : 'cancel'
    },
    async save(entry) {
      const ports = openPorts.get(entry.id)
      if (ports === undefined || !(await ports.save())) {
        throw new Error(localizer.text('vscode.webview.saveFailed', { name: entry.name }))
      }
    },
    onStatus(status) {
      say([status.path, status.view, status.detail].filter(Boolean).join(' · '))
      focused = status.path
    },
  })
  openNavigatedSubject = async event => {
    const ownsSource = [...subjects.values()].some(
      record => record.sessionId === event.sourceSessionId,
    )
    if (!ownsSource || preopenedSubjects.has(event.target)) {
      await event.result.session.dispose()
      throw new Error('subject navigation source or target is unavailable in this webview')
    }
    if (subjects.has(event.target)) {
      pendingStages.delete(event.target)
      await event.result.session.dispose()
      await editors.open({ id: event.target, name: baseName(event.target), directory: false })
      return
    }
    preopenedSubjects.set(event.target, event.result)
    try {
      await editors.open({ id: event.target, name: baseName(event.target), directory: false })
    } catch (error) {
      if (preopenedSubjects.delete(event.target)) {
        await event.result.session.dispose().catch(() => undefined)
      }
      throw error
    }
  }
  /*
   * The hex editor reports unsaved work through `edit.propose` on every changed byte, so the arm
   * marks its tab. The text editor proposes only when Save is pressed, and a textarea that has
   * been typed into but not saved would look clean until then — so typing is observed here. The
   * event bubbles out of the stage and only the focused tab can receive one, which is why the
   * focused path is the right tab to mark.
   */
  editors.root.addEventListener('input', event => {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.dataset['mkPart'] !== 'editor.text') return
    if (focused !== undefined) markDirty(focused, true)
  })
  editors.root.addEventListener(
    'click',
    event => {
      if (snapshot.openPath === undefined || focused !== snapshot.openPath) return
      const target = event.target
      if (!(target instanceof Element)) return
      const save = target.closest<HTMLElement>('[data-modkit-action="save"]')
      if (save === null) return
      // The provider calls the editor command directly after VS Code dispatches Save. Stopping the
      // page button here avoids committing once in the page and then a second time through Ctrl+S.
      event.preventDefault()
      event.stopPropagation()
      bridge.emit({ op: 'document-save-requested', path: snapshot.openPath })
    },
    true,
  )

  /*
   * The native CustomEditorProvider asks the buffer that is already mounted here. Saving through
   * the editor-area command reaches text before it has produced an edit plan and hex after it has;
   * reverting drops the whole mounted revision and reopens disk bytes under a fresh session.
   */
  bridge.serve(async request => {
    if (
      request.op !== 'document-save' &&
      request.op !== 'document-encode' &&
      request.op !== 'document-revert' &&
      request.op !== 'document-undo' &&
      request.op !== 'document-redo'
    ) {
      throw new Error(localizer.text('vscode.webview.lifecycleOnly'))
    }
    if (snapshot.openPath === undefined || request.path !== snapshot.openPath) {
      throw new Error(localizer.text('vscode.webview.wrongDocument'))
    }
    if (request.op === 'document-encode') {
      // Painted pixels encode through their codec; other editors have no such route yet, and the
      // host then refuses rather than writing the source to get at the bytes.
      if (pixelEditing?.dirty !== true) return null
      return base64Of(await pixelEditing.encode())
    }
    // The mounted editor's own history first (the hex editor), then the painted pixels.
    if (request.op === 'document-undo')
      return requestEditorHistory(document, 'undo') ?? pixelEditing?.undo() ?? false
    if (request.op === 'document-redo')
      return requestEditorHistory(document, 'redo') ?? pixelEditing?.redo() ?? false
    if (request.op === 'document-save') {
      // Painted pixels are saved by the view that holds them, through its codec operation.
      if (pixelEditing?.dirty === true) {
        await pixelEditing.save()
        return true
      }
      const record = subjects.get(request.path)
      if (record === undefined) {
        throw new Error(localizer.text('vscode.webview.documentNotOpen'))
      }
      const entry = record.entry
      if (!(await editors.save(request.path))) {
        throw new Error(localizer.text('vscode.webview.editorSaveRefused'))
      }
      markDirty(request.path, false)
      if (!(await editors.close(request.path))) {
        throw new Error(localizer.text('vscode.webview.staleRevisionCloseFailed'))
      }
      await editors.open(entry)
      return true
    }
    const record = subjects.get(request.path)
    if (record === undefined) {
      throw new Error(localizer.text('vscode.webview.documentNotOpen'))
    }
    const entry = record.entry
    markDirty(request.path, false)
    if (!(await editors.close(request.path))) {
      throw new Error(localizer.text('vscode.webview.documentCloseFailed'))
    }
    await editors.open(entry)
    return true
  })

  // ---------------------------------------------------------------- the working area
  /*
   * The editor area, mounted on its own.
   *
   * What used to be here: an explorer with a file tree, an activity bar offering Files and
   * Extensions, a sidebar rail describing the realm, and a settings section listing every
   * contribution with switches beside it. Every one of those had a native equivalent one layer
   * up — VS Code's own Explorer, its view container, its Settings UI — so the page was drawing a
   * second, worse copy of the editor it was running inside. They are gone; see
   * docs/MK3/requests/REQUEST_VSCODE_NATIVE_SHELL_2026-08-25.md.
   *
   * What is left is the subject: a stage picker and the stage. That is the whole of this page.
   */
  workbench.setMain(editors.root)

  /** Open a path as this page's subject. One editor area, so there is nowhere else to put it. */
  const openPath = async (path: string, name: string): Promise<void> => {
    const entry: ExplorerEntry = { id: path, name, directory: false }
    await editors.open(entry)
  }

  const navigateSubject = async (target: string, stage?: string): Promise<void> => {
    const parent = subjects.get(snapshot.openPath ?? focused ?? '')
    const navigation = parent?.session.subjectNavigation
    if (navigation === undefined) throw new Error('the mounted subject does not support navigation')
    if (stage !== undefined) pendingStages.set(target, stage)
    const result = await navigation.open({ scope: navigation.scope, target })
    if (result.state === 'rejected') {
      pendingStages.delete(target)
      throw new Error(`subject navigation rejected ${target}: ${result.reason}`)
    }
  }

  // An editor's undoable change is a step on VS Code's undo stack, as a painted pixel is.
  document.addEventListener(EDITOR_EDITED_EVENT, () => {
    if (snapshot.openPath !== undefined)
      bridge.emit({ op: 'document-edited', path: snapshot.openPath })
  })

  /*
   * V flips a recording between its 2D player and its 3D world, as MK2's player did: both views
   * follow the same transport, so the moment on screen stays. Typing in a field keeps its V.
   */
  document.addEventListener('keydown', event => {
    if (event.key !== 'v' && event.key !== 'V') return
    if (event.ctrlKey || event.altKey || event.metaKey) return
    const target = event.target as Element | null
    if (target?.closest('input, select, textarea, [contenteditable="true"]') != null) return
    const views = editors.activeViews()
    if (views === undefined || !views.views.includes('playback') || !views.views.includes('world'))
      return
    event.preventDefault()
    void editors
      .showView(views.active === 'world' ? 'playback' : 'world')
      .catch((error: unknown) => say(describe(error)))
  })

  bridge.onEvent(event => {
    switch (event.op) {
      case 'open':
        void openPath(event.path, event.name).catch((error: unknown) => say(describe(error)))
        break
      case 'navigate-subject':
        void navigateSubject(event.subjectId, event.stage).catch((error: unknown) =>
          say(describe(error)),
        )
        break
      case 'notice':
        say(event.text)
        break
      case 'status-choose':
        statusChoose?.(event.itemId, event.choiceId)
        break
      case 'show-hidden': {
        showHiddenEntries = event.show
        // An archive view read the option when it drew its listing; its tab is opened again.
        const listed = [...subjects.values()].filter(record =>
          (record.descriptor['dataSources'] as readonly { readonly contract?: unknown }[] | undefined)
            ?.some(item => item.contract === NAMESPACE_CONTRACT),
        )
        for (const record of listed) {
          void reopenCommittedEntry(editors, record.entry).catch((error: unknown) =>
            say(describe(error)),
          )
        }
        break
      }
      default:
        break
    }
  })

  if (snapshot.openPath !== undefined) {
    // The number that matters: from this bundle's first line to pixels on the screen.
    const started = performance.now()
    await openPath(snapshot.openPath, baseName(snapshot.openPath))
    bridge.emit({
      op: 'timing',
      name: 'subject mounted (rpc open, decode, first paint)',
      milliseconds: performance.now() - started,
    })
  }
}

async function mountExtensionSubjectCard(
  workbench: ReturnType<typeof createWorkbench>,
  bridge: ReturnType<typeof createBridge>,
  bundle: import('./extension-cards.js').ExtensionCardBundle,
  localizer: UiLocalizer,
): Promise<void> {
  const documents = new Map(
    bundle.documents.map(document => [document.subject.subjectId, document]),
  )
  const root = document.createElement('div')
  root.className = 'modkit-extension-subject'
  root.dataset['mkPart'] = 'card'
  const toolbar = document.createElement('div')
  toolbar.className = 'modkit-extension-subject__toolbar'
  toolbar.dataset['mkPart'] = 'settings.adder'
  const status = document.createElement('span')
  status.dataset['mkPart'] = 'settings.status'
  const resources = document.createElement('div')
  resources.className = 'modkit-extension-subject__resources'
  resources.dataset['mkPart'] = 'card.facts'
  const icon =
    bundle.extension.iconUri === undefined
      ? undefined
      : (() => {
          const image = document.createElement('img')
          image.className = 'modkit-extension-subject__icon'
          image.src = bundle.extension.iconUri
          image.alt = ''
          image.setAttribute('aria-hidden', 'true')
          return image
        })()
  let card: SubjectCard | undefined
  const subjectHistory = new SubjectNavigationHistory()

  const configure = async (
    request:
      | { readonly op: 'set-contribution'; readonly id: string; readonly enabled: boolean }
      | {
          readonly op: 'set-contributions'
          readonly ids: readonly string[]
          readonly enabled: boolean
        }
      | { readonly op: 'set-extension-coordinate'; readonly id: string; readonly enabled: boolean }
      | { readonly op: 'set-managed-package'; readonly id: string; readonly enabled: boolean }
      | { readonly op: 'remove-managed-package'; readonly id: string }
      | { readonly op: 'link-extension'; readonly id: string }
      | {
          readonly op: 'manage-repository-subject'
          readonly kind: 'vendor' | 'game'
          readonly id: string
          readonly action: 'install' | 'remove'
        },
  ): Promise<void> => {
    await bridge.request(request)
    status.textContent = localizer.text('extensions.status.configurationUpdated')
  }

  const button = (label: string, run: () => void): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset['mkPart'] = 'settings.add'
    button.textContent = label
    button.addEventListener('click', run)
    return button
  }

  const openResource = async (
    resource: (typeof bundle.extension.resources)[number],
  ): Promise<void> => {
    const result = (await bridge.request({
      op: 'open-extension-resource',
      subjectId: bundle.extension.subjectId,
      resourceId: resource.id,
      role: resource.role,
    })) as { readonly opened?: unknown; readonly message?: unknown }
    status.textContent =
      typeof result.message === 'string'
        ? result.message
        : result.opened === true
          ? localizer.text('extensions.status.configurationUpdated')
          : localizer.text('vscode.webview.unknownExtensionSubject', { id: bundle.extension.id })
  }

  const resourceRows = (): readonly HTMLElement[] =>
    bundle.extension.resources.map(resource => {
      const row = document.createElement('div')
      row.className = 'modkit-extension-subject__resource'
      row.dataset['mkPart'] = 'card.fact'
      const label = document.createElement('span')
      label.className = 'modkit-extension-subject__resource-label'
      label.textContent =
        resource.role === 'source'
          ? localizer.text('extensions.label.source')
          : resource.label === 'License'
            ? localizer.text('extensions.label.license')
            : resource.label
      const display = document.createElement('code')
      display.className = 'modkit-extension-subject__resource-path'
      display.textContent = resource.display
      row.append(
        label,
        display,
        button(
          localizer.text(
            resource.role === 'source'
              ? 'extensions.action.openSource'
              : 'extensions.action.openLicense',
          ),
          () => {
            void openResource(resource).catch(error => {
              status.textContent = describe(error)
            })
          },
        ),
      )
      return row
    })

  const actionButtons = (
    active: ExtensionSubjectCardWireDocument,
  ): readonly HTMLButtonElement[] => {
    const subject = active.subject
    if (subject.kind === 'modkit/vendor' || subject.kind === 'modkit/game') {
      const control = bundle.repositorySubject
      if (
        control === undefined ||
        control.id !== subject.id ||
        control.kind !== (subject.kind === 'modkit/vendor' ? 'vendor' : 'game')
      ) {
        return []
      }
      return control.actions.map(action =>
        button(localizer.text(action === 'install' ? 'common.install' : 'common.remove'), () => {
          void configure({
            op: 'manage-repository-subject',
            kind: control.kind,
            id: control.id,
            action,
          })
        }),
      )
    }
    if (
      bundle.extension.managedPackageId !== undefined &&
      bundle.extension.managedPackageEnabled === false
    ) {
      const packageId = bundle.extension.managedPackageId
      return [
        button(localizer.text('extensions.action.enablePackage'), () => {
          void configure({ op: 'set-managed-package', id: packageId, enabled: true })
        }),
      ]
    }
    if (!bundle.extension.installed && bundle.extension.linkable) {
      return [
        button(localizer.text('common.install'), () => {
          void configure({ op: 'link-extension', id: bundle.extension.id })
        }),
      ]
    }
    if (subject.kind === 'modkit/contribution') {
      return [
        button(
          localizer.text(
            subject.enabled
              ? 'extensions.action.disableContribution'
              : 'extensions.action.enableContribution',
          ),
          () => {
            void configure({ op: 'set-contribution', id: subject.id, enabled: !subject.enabled })
          },
        ),
      ]
    }
    const actions = [
      button(
        localizer.text(
          bundle.extension.enabled
            ? 'extensions.action.disableExtension'
            : 'extensions.action.enableExtension',
        ),
        () => {
          void configure({
            op: 'set-extension-coordinate',
            id: bundle.extension.id,
            enabled: !bundle.extension.enabled,
          })
        },
      ),
    ]
    if (bundle.extension.managedPackageId !== undefined) {
      const packageId = bundle.extension.managedPackageId
      actions.push(
        button(localizer.text('common.remove'), () => {
          void configure({ op: 'remove-managed-package', id: packageId })
        }),
      )
    }
    if (bundle.extension.codecs.ids.length > 0) {
      actions.push(
        button(
          localizer.text(
            bundle.extension.codecs.enabled
              ? 'extensions.action.disableAllCodecs'
              : 'extensions.action.enableAllCodecs',
          ),
          () => {
            void configure({
              op: 'set-contributions',
              ids: bundle.extension.codecs.ids,
              enabled: !bundle.extension.codecs.enabled,
            })
          },
        ),
      )
    }
    return actions
  }

  const render = async (subjectId: string): Promise<void> => {
    const active = documents.get(subjectId)
    if (active === undefined) {
      throw new Error(localizer.text('vscode.webview.unknownExtensionSubject', { id: subjectId }))
    }
    const sections = await loadSubjectCardSections(subjectFactsSourceFromWire(active), {
      localizer,
    })
    card?.destroy()
    const historyBack = button('←', () => {
      const previous = subjectHistory.back()
      if (previous !== undefined && documents.has(previous)) void render(previous)
    })
    historyBack.disabled = !subjectHistory.canBack
    historyBack.setAttribute('aria-label', localizer.text('card.historyBack'))
    const historyForward = button('→', () => {
      const next = subjectHistory.forward()
      if (next !== undefined && documents.has(next)) void render(next)
    })
    historyForward.disabled = !subjectHistory.canForward
    historyForward.setAttribute('aria-label', localizer.text('card.historyForward'))
    toolbar.replaceChildren(
      ...(icon === undefined ? [] : [icon]),
      historyBack,
      historyForward,
      ...actionButtons(active),
      status,
    )
    const navigate = (ref: CardRef): void => {
      if (ref.href !== undefined && documents.has(ref.href)) {
        subjectHistory.open(ref.href)
        void render(ref.href)
      }
    }
    card = createSubjectCard(document, {
      localizer,
      label: active.subject.displayName,
      sections,
      onNavigate: navigate,
    })
    resources.replaceChildren(...resourceRows())
    root.replaceChildren(toolbar, resources, card.root)
  }

  workbench.setMain(root)
  subjectHistory.reset(bundle.activeSubjectId)
  await render(bundle.activeSubjectId)
}
