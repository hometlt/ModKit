/**
 * The VS Code extension host's half of the product (S7 + S9 + S14), with no `vscode` import.
 *
 * `./extension.ts` is the adapter that turns the editor's API into the arguments below; everything
 * that decides anything lives here, so it can be composed and exercised in plain Node:
 *
 *  - **compose** the three realms through `createNodeSubjectServices` — the extension host realm
 *    holds the inventory, the `node-worker` realm is the target codecs are resolved and activated
 *    for, and `serviceDefinitions` stays at its `'bundled'` default. That default is load-bearing:
 *    the writers and syntax providers of the delimited, INI, JSON, TOML, XML and YAML extensions
 *    are service contributions, and a root that registers none of them ships an editor that
 *    silently cannot open half the text formats it claims.
 *  - **open** through `createPathSubjectOpener`, whose roots are the workspace folders. It refuses
 *    a path outside them before any `stat`, which is the whole of this host's file confinement.
 *  - **edit** through `createSubjectEditing` + `createFileEditingBackend` + `createRawWriter` +
 *    `createEvidenceRegistry`, keyed by the snapshot's `sessionId` and handed to `exposeSubjectRpc`
 *    as its `editing` option. The webview receives ids, never authority: the grant snapshot, the
 *    prepared commit and the backend never leave this process.
 *  - **serve** all of it over the single VS Code webview channel (see `./bridge.ts`).
 *
 * Extension roots that fail to load are reported, never swallowed — a broken directory in the
 * `modkit.extensions` setting must not take the editor's Modkit surface down with it.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { throwIfAborted, type Diagnostic } from '@modkit/core'
import { sceneModule } from '@modkit/scene/module'
import {
  createSubjectCandidateProvider,
  type AnyDescriptor,
  type AssetSession,
  type Lease,
  type PermissionGrant,
  type ResourceBudget,
  type SubjectCandidateProvider,
  type SubjectSelectorSource,
  type Writer,
} from '@modkit/sdk'
import { advertisesSubjectCandidates, SUBJECT_SELECTOR_SOURCE } from './subject-candidates.js'
import { uvModule } from '@modkit/uv/module'
import type { MapPreviewResourcePlanResolver } from '@modkit/host/maps'
import { selectSceneRenderer, type SceneRendererSelection } from '@modkit/host/renderer'
import type { UiLocalizer } from '@modkit/ui/localization'
import {
  codecFidelityEvidenceRecords,
  createEvidenceRegistry,
  createHostComposition,
  createRawWriter,
  resolveCommonPresentationPlan,
  resolveFormatWriter,
  serviceProviderFidelityEvidenceRecord,
  createSubjectEditing,
  exposeSubjectRpc,
  linkedExtensionInputs,
  nestedSubjectServices,
  openNestedSubjectRef,
  subjectOpenSnapshot,
  type ExtensionInput,
  type HostComposition,
  type OpenedSubject,
  type SubjectEditing,
  type SubjectOpener,
  type SubjectRpcExposure,
  type SubjectServices,
} from '@modkit/host'
import {
  createFileEditingBackend,
  createNodeSubjectServices,
  createPathSubjectOpener,
  loadExtensionRoots,
  type ExtensionRootFailure,
  type FileArtifactReadTelemetry,
  type FileArtifactStreamTelemetry,
  type NodeSubjectServices,
} from '@modkit/host/node'

import { STAGE_ORDER } from './view-policy.js'
import { contentSourceOpener, type ContentSourceReader } from './content-source-open.js'

const VSCODE_BUILTIN_MODULES = /* @__PURE__ */ linkedExtensionInputs([sceneModule, uvModule])

import {
  createBridge,
  type Bridge,
  type CloseAnswer,
  type ShellConfigureResult,
  type ShellEntry,
  type ShellRequest,
  type ShellSettingsView,
  type WebviewChannel,
} from './bridge.js'
import type { ExtensionCardResourceTarget } from './extension-cards.js'
import { containerUriText, isContainerUriText, parseContainerUriText } from './container-uri.js'
import { createContainerRegistry, type ContainerRegistry } from './containers.js'
import { describeInventoryContributions, type ContributionRow } from './contributions.js'
import { prepareVsCodeMapPreview, type VsCodeMapPreviewCandidate } from './map-preview.js'
import { parseVsCodeMapPreviewSelectionRequest } from './map-preview-selection.js'
import {
  configuredDisabledContributions,
  configuredDisabledExtensions,
  configuredExtensionRoots,
  dedupeRoots,
  describeConfiguredExtensions,
  discoverCatalogRoots,
  discoverWorkspaceRoots,
  resolveBundledCatalog,
  withContributionDisabled,
  withContributionsDisabled,
  withExtensionDisabled,
  withExtensionEnabled,
  withExtensionRoot,
  withoutExtension,
  type BundledCatalogRoot,
  type DirectoryProbe,
  type ExtensionRootRequestLike,
  type ManagedExtensionRootRequest,
} from './extension-roots.js'

/** Said once, so every refusal to write configuration reads the same. */
const CANNOT_CONFIGURE =
  'This window cannot change Modkit configuration, so nothing was written. ' +
  'The same keys can be edited in the editor’s own Settings UI.'

/** Batch export of one texture's subresources; a cubemap mip chain is 6×N, never thousands. */
const EXPORT_FILE_LIMIT = 512
const EXPORT_FILE_MAXIMUM_BYTES = 64 * 1024 * 1024

/**
 * A leaf file name and nothing else: no separator, no drive, no dot-segment, no control character.
 * The page proposes the name; this is where "propose" is prevented from becoming "traverse".
 */
const isSafeExportName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
  !value.includes('..')
import {
  createVsCodeDesktopTopology,
  VSCODE_DESKTOP_EXTENSION_REALM,
  VSCODE_DESKTOP_WORKER_REALM,
  VSCODE_WEBVIEW_REALM,
  VSCODE_WORKER_POLICY,
} from './index.js'

/** Module identity of the services root served over the webview channel (nothing to import). */
export const VSCODE_SUBJECT_SERVICES_URL = 'x3-app://vscode/subject-services'
/** Identity the consuming side records for the loaded root; both ends must agree. */
export const VSCODE_SUBJECT_CONTRIBUTION_ID = 'modkit.app.vscode/subject-services'

/**
 * Largest file this host reads into memory for a preview.
 *
 * A file over the limit is refused, never truncated: a codec handed the first 64 MiB of a larger
 * file detects and describes something that is not the file.
 */
export const VSCODE_MAXIMUM_SUBJECT_BYTES = 64 * 1024 * 1024

/**
 * Largest range-backed subject the installed editor will address.
 *
 * This is deliberately separate from `VSCODE_MAXIMUM_SUBJECT_BYTES`: a WZ/ZIP/MPQ codec can
 * inspect a large archive through bounded random reads without materializing it. Commands and
 * container-member reads that return one `Uint8Array` remain capped at 64 MiB.
 */
export const VSCODE_MAXIMUM_RANGE_BACKED_SUBJECT_BYTES = 256 * 1024 * 1024

/** Entries a single directory listing will return before it stops. */
export const VSCODE_MAXIMUM_LISTING = 5_000

/** How many editing arms are kept alive at once; see `rememberEditing`. */
const MAXIMUM_LIVE_EDITING_ARMS = 256

const nativeMapScript = (): Uint8Array =>
  new TextEncoder().encode(
    `void NativePreservingProof() {\r\n${'    // fixed-slot zlib proof\r\n'.repeat(40)}}\r\n`,
  )

interface NativeMpqSnapshotOptions {
  readonly sourceBytes: Uint8Array
  readonly replacements: readonly { readonly path: string; readonly bytes: Uint8Array }[]
  readonly target: {
    readonly targetId: string
    readonly subjectUri: string
    readonly ownerSource: { readonly id: string; readonly uri: string }
    readonly semanticPath: readonly string[]
    readonly expectedRevision: {
      readonly namespaceRevision: string
      readonly compositionFingerprint: string
    }
  }
  readonly archiveName: string
}

interface NativeMpqSnapshotChange {
  readonly edits?: readonly {
    readonly operation?: unknown
    readonly payload?: { readonly kind?: unknown; readonly bytes?: unknown }
  }[]
  readonly semanticIntent?: { readonly nativeExportReceipt?: unknown }
}

interface NativeMpqSaveAsEntry {
  readonly snapshot: (options: NativeMpqSnapshotOptions) => Promise<NativeMpqSnapshotChange>
  readonly writer: Pick<Writer, 'validate' | 'plan'>
  readonly release?: () => Promise<void>
}

export interface VsCodeNativeSaveAsResult {
  readonly bytes: Uint8Array
  readonly nativeWriterReceipt: unknown
}

// ---------------------------------------------------------------------------------------------
// composition

/** Bundled-only failures retained for A7; unlike the public receipt these may still name a path. */
export interface VsCodeBundledLoadError {
  readonly code: string
  readonly message: string
  readonly root?: string
}

/** What loaded from where, and what did not. The output channel and the webview both show it. */
export interface VsCodeExtensionReport {
  /** Coordinates of the first-party catalog that shipped with this build. */
  readonly bundled: readonly string[]
  /** Coordinates of workspace-local and user-configured extensions that loaded. */
  readonly installed: readonly string[]
  /** Enabled package roots supplied directly by the Node extension manager. */
  readonly managed: readonly string[]
  /** Roots that did not load, with the reason. A broken one never stops the others. */
  readonly failures: readonly ExtensionRootFailure[]
  /** Settings entries that were not usable as a root at all (malformed, no path). */
  readonly problems: readonly string[]
  /** Contribution ids `modkit.disabledContributions` switched off, as the host received them. */
  readonly disabledContributions: readonly string[]
  /** Extension coordinates switched off without removing their inventory records. */
  readonly disabledExtensions: readonly string[]
}

export interface VsCodeSubjectHost {
  /** Extension-host realm composition (the inventory) plus the worker realm codecs run in. */
  readonly services: NodeSubjectServices
  /** The bridge realm's composition, for the snapshot the page is allowed to see. */
  readonly webview: HostComposition
  /**
   * Which `common.render/scene-3d` offer the standard resolver selects for the page's realm.
   *
   * A decision, taken here because only this side holds an inventory, and carried to the page as
   * ids. The page cannot resolve — it has no inventory, no grant and no extension root, and it
   * must not acquire one — but it does have the GPU, so it is the only place a WebGL provider can
   * draw. Activating the page's offer *here* would import a browser module into Node; forwarding
   * the frames back would put a megabyte on the bridge per camera move. So the authority stays on
   * this side and the execution stays on that one.
   *
   * `undefined` when nothing matched, which is a normal answer: the page then keeps the model
   * stage's own 2D fallback and reports why.
   */
  readonly webviewRenderer?: SceneRendererSelection
  readonly extensions: VsCodeExtensionReport
  /** Errors from the generated bundled catalog only, before receipt path redaction. */
  readonly bundledLoadErrors: readonly VsCodeBundledLoadError[]
  readonly supportedExtensions: readonly string[]
  /**
   * Every contribution the inventory holds, with the switch the running composition put it in.
   *
   * Fixed for the life of the extension host, because the composition is: the profile revision
   * keys resolution caches, so recomposing per command would silently invalidate them. A setting
   * changed after activation is therefore shown against these rows as pending until the window
   * reloads — which is the honest thing for this editor to say.
   */
  readonly contributions: readonly ContributionRow[]
  /**
   * Container browsing for this window, under the same grant and budget every other open runs
   * under.
   *
   * One per window rather than one per webview: the filesystem provider the Explorer talks to is
   * registered once at activation, and an archive opened for the Explorer is the same archive a
   * custom editor then opens a member of. Two registries would mean two open BIGs.
   */
  containers(options: VsCodeContainerOptions): ContainerRegistry
  /** Serve the subject RPC and the shell over one webview channel. */
  serve(options: VsCodeServeOptions): VsCodeServed
}

export interface VsCodeContainerOptions {
  /** Granted directories, read per request — the same confinement every open uses. */
  readonly roots: () => readonly string[]
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /** Optional test-only observation of completed read-only member extraction. */
  readonly onExtract?: (event: {
    readonly container: string
    readonly entry: string
    readonly bytes: number
  }) => void
}

export interface VsCodeSubjectHostOptions {
  /**
   * Directories to look for the first-party catalog in, most specific first. The first candidate
   * that contains any extension wins, so a packaged build never picks up a checkout above it.
   */
  readonly catalogCandidates: readonly string[]
  /** Workspace folders; scanned one level deep for workspace-local extensions. */
  readonly workspaceFolders?: readonly string[]
  /** Raw value of the `modkit.extensions` setting, exactly as the editor returned it. */
  readonly configuredExtensions?: unknown
  /** Enabled roots returned by the Node manager for this activation/reload. */
  readonly managedExtensions?: readonly ManagedExtensionRootRequest[]
  /**
   * Raw value of the `modkit.disabledContributions` setting, exactly as the editor returned it.
   *
   * Threaded into `createNodeSubjectServices` unchanged in meaning: a switched-off contribution
   * stays in the inventory and loses `activationEligible`, so the settings view can show it in its
   * off position and the user can put it back. Filtering it out here instead would make the codec
   * vanish and the switch with it.
   */
  readonly configuredDisabledContributions?: unknown
  /** Raw value of `modkit.disabledExtensions`; disabled roots remain inspectable. */
  readonly configuredDisabledExtensions?: unknown
  /**
   * The worker bootstrap this extension shipped beside its bundle. Required in a packaged build:
   * the backend default resolves it through `import.meta.url`, which a CommonJS extension entry
   * does not have.
   */
  readonly bootstrapUrl?: URL
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * The generated catalog of roots this build ships (`generated/bundled-catalog.json`).
   *
   * When present it is the authority on *what* the product carries and the candidates above are
   * only searched for *where*. Absent — which is the case in the unit tests, which inject a probe
   * describing a catalog of their own — the old directory discovery runs instead.
   */
  readonly bundledCatalog?: readonly BundledCatalogRoot[]
  /** Injectable for tests; defaults to `node:fs`. */
  readonly probe?: DirectoryProbe
}

const nodeProbe: DirectoryProbe = {
  readDirectory(path) {
    try {
      return readdirSync(path)
    } catch {
      return undefined
    }
  },
  isFile(path) {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  readJson(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch {
      // missing, unreadable or malformed — all mean "this is not a declaration we can trust"
      return undefined
    }
  },
  join: (...parts) => join(...parts),
}

export async function createVsCodeSubjectHost(
  options: VsCodeSubjectHostOptions,
): Promise<VsCodeSubjectHost> {
  const probe = options.probe ?? nodeProbe
  /*
   * What this build ships, from the catalog when it has one.
   *
   * A root the catalog names and the disk does not hold is reported through the same channel a
   * broken `modkit.extensions` entry is: the user sees it, the output channel records it, and the
   * editor still starts with whatever did load. Silence here was the shape of block-9's sixth
   * defect — a packaged build with no codecs that looked perfectly healthy.
   */
  const resolved =
    options.bundledCatalog === undefined
      ? undefined
      : resolveBundledCatalog(options.bundledCatalog, options.catalogCandidates, probe)
  const catalogRoots = resolved?.roots ?? discoverCatalogRoots(options.catalogCandidates, probe)
  const catalogProblems =
    resolved === undefined || resolved.missing.length === 0
      ? []
      : [
          `the shipped catalog names ${resolved.missing.length} root(s) this build does not ` +
            `contain: ${resolved.missing.join(', ')}`,
        ]
  const configured = configuredExtensionRoots(options.configuredExtensions, path => resolve(path))
  const staticRequests: readonly ExtensionRootRequestLike[] = dedupeRoots([
    ...discoverWorkspaceRoots(options.workspaceFolders ?? [], probe),
    ...configured.roots,
  ])
  const managedRequests = options.managedExtensions ?? []
  const managedCoordinateCounts = new Map<string, number>()
  for (const request of managedRequests) {
    managedCoordinateCounts.set(
      request.expectedId,
      (managedCoordinateCounts.get(request.expectedId) ?? 0) + 1,
    )
  }
  const managedDuplicateFailures: ExtensionRootFailure[] = managedRequests.flatMap(request =>
    managedCoordinateCounts.get(request.expectedId) === 1
      ? []
      : [
          {
            root: request.root,
            code: 'x3.host/extension-coordinate-conflict',
            message:
              `managed coordinate «${request.expectedId}» is provided by more than one ` +
              'installed root; all copies were refused',
          },
        ],
  )
  const uniqueManagedRequests = managedRequests.filter(
    request => managedCoordinateCounts.get(request.expectedId) === 1,
  )

  /*
   * The first-party catalog is `bundled`, but deliberately without `allowTrustedInProcess`: the VS
   * Code extension host is a Node process shared with every other installed extension, and running
   * a codec on that thread would put a third party's parser beside everybody's language servers.
   * Portable variants resolve for the `node-worker` realm instead, which is what the topology's
   * third realm exists for.
   */
  const bundled = await loadExtensionRoots(catalogRoots, { origin: 'bundled' })
  const installed = await loadExtensionRoots(staticRequests, {
    origin: 'installed',
    claimed: [...VSCODE_BUILTIN_MODULES.coordinates, ...bundled.coordinates],
  })
  /*
   * Managed roots are a separate final group: a package may never shadow the build, workspace or
   * a hand-authored `modkit.extensions` root. `loadExtensionRoots` reports the exact conflicting
   * coordinate and rejects the managed root, so the ambiguity is visible and fail-closed.
   */
  const managed = await loadExtensionRoots(uniqueManagedRequests, {
    origin: 'installed',
    claimed: [
      ...VSCODE_BUILTIN_MODULES.coordinates,
      ...bundled.coordinates,
      ...installed.coordinates,
    ],
  })
  const extensionInputs: readonly ExtensionInput[] = [
    ...VSCODE_BUILTIN_MODULES.inputs,
    ...bundled.inputs,
    ...installed.inputs,
    ...managed.inputs,
  ]
  const switchedOff = configuredDisabledContributions(options.configuredDisabledContributions)
  const switchedOffExtensions = configuredDisabledExtensions(options.configuredDisabledExtensions)

  const topology = createVsCodeDesktopTopology()
  const services = await createNodeSubjectServices({
    topology,
    realms: { host: VSCODE_DESKTOP_EXTENSION_REALM, workers: VSCODE_DESKTOP_WORKER_REALM },
    extensions: extensionInputs,
    linkedModules: VSCODE_BUILTIN_MODULES.modules,
    policy: VSCODE_WORKER_POLICY,
    disabledExtensions: switchedOffExtensions.ids,
    disabledContributions: switchedOff.ids,
    /*
     * Where this host shipped the worker bootstrap.
     *
     * The backend's default resolves it beside its own module through `import.meta.url`, which is
     * empty in a CommonJS bundle — and VS Code requires a CommonJS extension entry, so the default
     * would be `undefined` and every codec spawn would die at `new Worker`. Naming the file the
     * build emits is the honest version of that, and it replaced a build-time rewrite of
     * `import.meta.url` that made one expression mean something else than it says.
     */
    ...(options.bootstrapUrl === undefined ? {} : { bootstrapUrl: options.bootstrapUrl }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  const bundledCoordinates = new Set(bundled.coordinates)
  const bundledLoadErrors: readonly VsCodeBundledLoadError[] = Object.freeze([
    ...bundled.failures,
    ...catalogProblems.map(message => ({
      code: 'x3.app/vscode-bundled-catalog-incomplete',
      message,
    })),
    ...services.host.inventory.extensions
      .filter(extension => {
        const coordinate = `${extension.manifest.publisher}/${extension.manifest.id}`
        return extension.origin === 'bundled' && bundledCoordinates.has(coordinate)
      })
      .flatMap(extension => {
        const coordinate = `${extension.manifest.publisher}/${extension.manifest.id}`
        return extension.contributions.flatMap(contribution =>
          contribution.diagnostics
            .filter(diagnostic => diagnostic.severity === 'error')
            .map(diagnostic => ({
              code: diagnostic.code,
              message: diagnostic.message,
              root: coordinate,
            })),
        )
      }),
  ])
  // The bridge realm, composed only so the page can be told what its own realm holds. It shares
  // the topology, so `apps:check`'s claim — the webview holds no extension-host facility — is a
  // statement about the very object the running product hands the page.
  const webview = await createHostComposition({
    topology,
    realmId: VSCODE_WEBVIEW_REALM,
    extensions: extensionInputs,
    disabledExtensions: switchedOffExtensions.ids,
    disabledContributions: switchedOff.ids,
  })
  /*
   * The renderer decision for that realm, taken once per composition.
   *
   * The page is the realm with the GPU and the realm without an inventory; this side is the
   * reverse. `selectSceneRenderer` runs the standard resolver's matcher against the page realm's
   * own target and facilities and stops before activation, so what crosses into the page is a
   * provider id and a variant — the same kind of inert snapshot the page already receives for its
   * realm's facilities — and never a lease, a grant or an inventory.
   *
   * A refusal is not an error here. It is what a machine whose driver has no WebGL2 answers, and
   * the model stage keeps its 2D fallback on that answer.
   */
  const webviewRenderer = await selectSceneRenderer({
    services: {
      inventory: webview.inventory,
      target: webview.target,
      executionBackends: webview.executionBackends,
      ...(services.serviceDefinitions === undefined
        ? {}
        : { serviceDefinitions: services.serviceDefinitions }),
    },
    outputKind: 'rgba8',
    grant: DEFAULT_OPEN_GRANT,
  })
  for (const item of webviewRenderer.diagnostics) options.onDiagnostic?.(item)

  const extensions: VsCodeExtensionReport = Object.freeze({
    bundled: bundled.coordinates,
    installed: Object.freeze([...installed.coordinates, ...managed.coordinates]),
    managed: managed.coordinates,
    failures: Object.freeze([
      ...bundled.failures,
      ...installed.failures,
      ...managedDuplicateFailures,
      ...managed.failures,
    ]),
    // a malformed `modkit.disabledContributions` is the user's setting too, so it is reported in
    // the same place a malformed `modkit.extensions` entry is, not swallowed on the way past
    problems: Object.freeze([
      ...catalogProblems,
      ...configured.problems,
      ...switchedOffExtensions.problems,
      ...switchedOff.problems,
    ]),
    disabledExtensions: switchedOffExtensions.ids,
    disabledContributions: switchedOff.ids,
  })

  const contributions = describeInventoryContributions(services.host.inventory)

  return Object.freeze({
    services,
    webview,
    ...(webviewRenderer.state === 'selected' ? { webviewRenderer: webviewRenderer.selection } : {}),
    extensions,
    bundledLoadErrors,
    contributions,
    supportedExtensions: services.supportedExtensions,
    containers: (container: VsCodeContainerOptions) =>
      createContainerRegistry({
        services,
        roots: container.roots,
        grant: DEFAULT_OPEN_GRANT,
        budget: DEFAULT_OPEN_BUDGET,
        ...(container.onDiagnostic === undefined ? {} : { onDiagnostic: container.onDiagnostic }),
        ...(container.onExtract === undefined ? {} : { onExtract: container.onExtract }),
      }),
    serve: (served: VsCodeServeOptions) =>
      serveVsCode(services, served, { extensions, contributions }),
  })
}

// ---------------------------------------------------------------------------------------------
// serving one webview

export interface VsCodeServeOptions {
  readonly readContentSource?: ContentSourceReader
  readonly channel: WebviewChannel
  /** Endpoint identity; the page must connect with the same pair. */
  readonly session: string
  /**
   * Directories the page may name. Read on every request, so opening another workspace folder
   * widens the grant without rebuilding anything.
   */
  readonly roots: () => readonly string[]
  /**
   * Host-discovered extension coordinates that an extension card may link into the user's
   * configuration. The webview receives coordinates only; absolute paths stay on this side of
   * the bridge and arbitrary page input can never become a configured filesystem root.
   */
  readonly linkableExtensionRoots?: ReadonlyMap<string, string>
  /**
   * Resources a currently-open extension card may request by opaque subject/resource ids.
   *
   * Paths and URLs are never sent back to the page as authority: the adapter receives them only
   * after this host has matched the card's subject id, resource id and role exactly.
   */
  readonly extensionCardResources?: ReadonlyMap<string, readonly ExtensionCardResourceTarget[]>
  /** Native adapter that opens a resource after the host-owned lookup above succeeds. */
  readonly openExtensionCardResource?: (resource: ExtensionCardResourceTarget) => Promise<void>
  /** Host-owned package ids accepted from extension cards, plus their manager mutation port. */
  readonly managedPackageIds?: ReadonlySet<string>
  readonly setManagedPackageEnabled?: (id: string, enabled: boolean) => Promise<void>
  readonly removeManagedPackage?: (id: string) => Promise<void>
  /** Exact repository subject/action tuple granted to this one card webview. */
  readonly repositorySubject?: {
    readonly kind: 'vendor' | 'game'
    readonly id: string
    readonly actions: readonly ('install' | 'remove')[]
  }
  readonly manageRepositorySubject?: (request: {
    readonly kind: 'vendor' | 'game'
    readonly id: string
    readonly action: 'install' | 'remove'
  }) => Promise<void>
  /** The grant every open runs under. Defaults to `read-source` only. */
  readonly grant?: PermissionGrant
  readonly budget?: ResourceBudget
  /** Trusted desktop resolver for opaque installation/dependency roots declared by map providers. */
  readonly mapPreviewResourcePlanResolver?: MapPreviewResourcePlanResolver
  /** Localizes host-owned diagnostics before they cross into VS Code's Problems UI. */
  readonly localizer?: UiLocalizer
  /** Confirm discarding unsaved work; a webview iframe cannot show a modal of its own. */
  readonly confirmClose?: (message: string, savable: boolean) => Promise<CloseAnswer>
  /**
   * Write viewer-produced export files somewhere this window owns, and say where they went.
   *
   * The adapter picks the destination; the page never names one. A host without this option makes
   * the page's export controls say so instead of failing at click time.
   */
  readonly exportFiles?: (
    files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
  ) => Promise<
    | { readonly state: 'written'; readonly names: readonly string[] }
    | { readonly state: 'refused'; readonly reason: string }
  >
  /** Native custom-document dirty state, emitted only for the provider's opened path. */
  readonly onDocumentDirty?: (path: string, dirty: boolean) => void
  /** Route an in-page Save button through VS Code's native save command. */
  readonly onDocumentSaveRequested?: (path: string) => void
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
  /**
   * One structured subject diagnostic, for whatever surface the editor gives them.
   *
   * Kept apart from `onDiagnostic`, which is the output-channel firehose and takes prose. This one
   * carries a code, a severity and the subject it is about, because that is the shape VS Code's
   * own Problems panel consumes — and a diagnostic that only ever reached a log was invisible to
   * the person who needed it.
   */
  /**
   * What was opened, and by which contribution.
   *
   * The facts a status bar wants live here and only here: the page is told the selection too, but
   * a webview drawing its own footer is the thing this host is getting rid of.
   */
  readonly onSubjectOpened?: (opened: {
    readonly path: string
    readonly contributionId: string
    readonly variantId: string
    readonly confidence: number
  }) => void
  /** What the page reported it can honour; compared with the composed realm by the adapter. */
  readonly onFacilities?: (observed: readonly string[]) => void
  readonly onSubjectDiagnostic?: (diagnostic: {
    readonly code: string
    readonly message: string
    readonly severity: 'error' | 'warning' | 'information' | 'hint'
    readonly path?: string
  }) => void
  /**
   * Reading and writing this window's Modkit configuration.
   *
   * Supplied by `./extension.ts`, because `vscode.workspace.getConfiguration` and
   * `vscode.window.showOpenDialog` live only where `vscode` may be imported. Absent means this
   * window cannot change configuration at all — the settings view then still *shows* everything
   * and draws no switch that would fail, which is the same rule the read-only settings surface
   * follows elsewhere in this lab.
   */
  readonly configuration?: VsCodeConfigurationPort
  /**
   * Where a `modkit-container:` subject path is opened.
   *
   * The page asks for a subject by naming a string, and one of the strings it can now be handed is
   * a container member. Routing that here — rather than teaching the page a second way to open
   * things — is what makes an archive entry a subject in this product: the page mounts the same
   * stages, the same viewers and the same editing arm, and never learns which of the two it got.
   */
  readonly containers?: ContainerRegistry
}

/** What the extension side lets the page do to configuration, and nothing more. */
export interface VsCodeConfigurationPort {
  /** `modkit.extensions` exactly as the editor returns it. */
  readExtensions(): unknown
  /** `modkit.disabledContributions` exactly as the editor returns it. */
  readDisabledContributions(): unknown
  /** `modkit.disabledExtensions` exactly as the editor returns it. */
  readDisabledExtensions?(): unknown
  /** Where a write lands; shown to the user, because it decides who else sees the change. */
  readonly scope: 'workspace' | 'user'
  write(
    key: 'extensions' | 'disabledExtensions' | 'disabledContributions',
    value: readonly unknown[],
  ): Promise<void>
  /** Native folder dialog; resolves with the chosen absolute path, or nothing when cancelled. */
  pickFolder(): Promise<string | undefined>
}

export interface VsCodeServed {
  readonly bridge: Bridge
  readonly exposure: SubjectRpcExposure
  /** Ask the page to open this path in a tab. */
  open(path: string): void
  /** Push the current granted folders; called again when the workspace changes. */
  publishRoots(): void
  /** Show one line in the page's status area (an extension that failed to load, say). */
  notice(text: string, severity?: 'info' | 'error'): void
  /** Ask the mounted editor buffer to commit; resolves only after the webview reports success. */
  saveDocument(path: string): Promise<void>
  /** Discard the mounted editor buffer and reopen the file from disk. */
  revertDocument(path: string): Promise<void>
  /**
   * Run the selected installed native writer for this subject's Save As route.  Undefined means
   * no opt-in writer was selected; the caller may then use its ordinary provider Save As path.
   */
  nativeSaveAs(
    path: string,
    destinationPath: string,
    sourceBytes: Uint8Array,
  ): Promise<VsCodeNativeSaveAsResult | undefined>
  /** Whether the currently served subject advertises the admitted selector source. */
  hasSubjectCandidates(): boolean
  /** Acquire the currently served subject's selector as one request-owned provider lease. */
  openSubjectCandidates(signal?: AbortSignal): Promise<Lease<SubjectCandidateProvider> | undefined>
  close(reason: string): Promise<void>
}

/**
 * The opener the shared command runtime is handed in this window.
 *
 * Two routes and no third: a `modkit-container:` ref is a member of an open container, anything
 * else is a path confined to the granted roots. It is the same pair `serveVsCode` uses for the
 * page — the page's version additionally attaches an editing arm and publishes subject diagnostics,
 * which are serving concerns a batch command has no use for.
 *
 * Exported because `./extension.ts` composes the runtime at activation, before any webview exists:
 * a command run from the palette must not require an open editor.
 */
export function createVsCodeCommandOpener(options: {
  readonly readContentSource?: ContentSourceReader
  readonly services: NodeSubjectServices
  readonly roots: () => readonly string[]
  readonly containers?: ContainerRegistry
  readonly onRead?: (event: FileArtifactReadTelemetry) => void
  readonly onStream?: (event: FileArtifactStreamTelemetry) => void
}): SubjectOpener {
  return async (requested, signal) => {
    if (requested.startsWith('modkit-source:')) {
      if (!options.readContentSource) throw new Error('Content source provider is unavailable')
      return contentSourceOpener(options.services, options.readContentSource)(requested, signal)
    }
    if (isContainerUriText(requested)) {
      if (options.containers === undefined) {
        throw new TypeError('this window did not compose container browsing')
      }
      return options.containers.open(requested, signal)
    }
    const opener = createPathSubjectOpener({
      subjects: options.services,
      roots: options.roots(),
      grant: DEFAULT_OPEN_GRANT,
      budget: DEFAULT_OPEN_BUDGET,
      ...(options.onRead === undefined ? {} : { onRead: options.onRead }),
      ...(options.onStream === undefined ? {} : { onStream: options.onStream }),
    })
    return opener(requested, signal)
  }
}

/** What every open in this window runs under; named so the container route cannot drift from it. */
const DEFAULT_OPEN_GRANT: PermissionGrant = Object.freeze({
  id: 'vscode',
  classes: Object.freeze(['read-source' as const]),
})

const DEFAULT_OPEN_BUDGET: ResourceBudget = Object.freeze({
  maxInputBytes: BigInt(VSCODE_MAXIMUM_RANGE_BACKED_SUBJECT_BYTES),
  maxDepth: 256,
  maxNodes: 1_000_000,
  maxScalarBytes: VSCODE_MAXIMUM_SUBJECT_BYTES,
  maxDiagnostics: 10_000,
  deadlineMs: 30_000,
})

/** The same confinement `createPathSubjectOpener` applies, for the listing and reading paths. */
export function withinRoots(roots: readonly string[], path: string): boolean {
  return roots.some(root => {
    const rel = relative(resolve(root), path)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  })
}

function requireInside(roots: readonly string[], requested: string): string {
  const path = resolve(requested)
  if (roots.length === 0 || !withinRoots(roots, path)) {
    throw new Error(`«${requested}» is outside the folders this window granted`)
  }
  return path
}

function serveVsCode(
  services: NodeSubjectServices,
  options: VsCodeServeOptions,
  composed: {
    readonly extensions: VsCodeExtensionReport
    readonly contributions: readonly ContributionRow[]
  },
): VsCodeServed {
  const bridge = createBridge({
    channel: options.channel,
    idPrefix: 'host',
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })

  /*
   * S14: this side owns the editing authority. The backend is confined to the same roots the
   * opener is, so a subject outside them could not be written even if a session id for it existed.
   */
  const editingBackend = createFileEditingBackend({
    roots: () => options.roots().map(root => resolve(root)),
  })
  const evidence = createEvidenceRegistry()
  /** The writer for editors that know nothing about the format (plain text, hex). */
  const rawWriter = createRawWriter()
  const editingBySession = new Map<string, SubjectEditing>()
  const nativeSaveAsByPath = new Map<string, NativeMpqSaveAsEntry>()
  let subjectGeneration = 0
  let navigationSequence = 0
  let candidateSession: Readonly<{ generation: number; session: AssetSession }> | undefined

  const beginsSubjectOpen = (): number => {
    subjectGeneration += 1
    candidateSession = undefined
    return subjectGeneration
  }
  const retainCandidateSession = (
    generation: number,
    descriptor: AnyDescriptor | undefined,
    session: AssetSession | undefined,
  ): void => {
    if (
      generation !== subjectGeneration ||
      descriptor === undefined ||
      session?.state() !== 'live'
    ) {
      return
    }
    if (advertisesSubjectCandidates(descriptor)) {
      candidateSession = Object.freeze({ generation, session })
    }
  }

  /**
   * Arms are kept until the window closes, because nothing on the wire says "this tab is gone":
   * the page releases the *session* lease, and the editing arm is a separate lease it may take
   * again. A bound keeps a very long session from growing without limit; the oldest arm is the one
   * whose tab was opened longest ago.
   */
  const rememberEditing = (sessionId: string, editing: SubjectEditing): void => {
    editingBySession.set(sessionId, editing)
    while (editingBySession.size > MAXIMUM_LIVE_EDITING_ARMS) {
      const oldest = editingBySession.keys().next()
      if (oldest.done === true) break
      const forgotten = editingBySession.get(oldest.value)
      editingBySession.delete(oldest.value)
      void Promise.resolve(forgotten?.session?.dispose()).catch(error =>
        options.onDiagnostic?.({
          code: 'x3.app/vscode-editing-release-failed',
          message: describe(error),
        }),
      )
    }
  }

  /** Findings about one subject, on whatever surface the adapter gave them. */
  const publishSubjectDiagnostics = (
    subject: string,
    items: readonly { code: string; message: string; severity?: string }[],
  ): void => {
    if (options.onSubjectDiagnostic === undefined) return
    for (const item of items) {
      options.onSubjectDiagnostic({
        code: item.code,
        message: item.message,
        severity: (item.severity as 'error' | 'warning' | 'information' | 'hint') ?? 'information',
        path: subject,
      })
    }
  }

  const openSubject: SubjectOpener = async (requested, signal) => {
    const generation = beginsSubjectOpen()
    if (requested.startsWith('modkit-source:')) {
      if (!options.readContentSource) throw new Error('Content source provider is unavailable')
      const answer = await contentSourceOpener(services, options.readContentSource)(
        requested,
        signal,
      )
      publishSubjectDiagnostics(requested, answer.snapshot.diagnostics)
      if (answer.snapshot.state === 'opened') {
        retainCandidateSession(generation, await answer.session?.descriptor(), answer.session)
        options.onSubjectOpened?.({ path: requested, ...answer.snapshot.selected })
      }
      return answer
    }
    const mapSelection = parseVsCodeMapPreviewSelectionRequest(requested)
    const subjectRequested = mapSelection?.path ?? requested
    /*
     * A container member, opened as a subject of its own.
     *
     * The RPC's contract is "a string names a subject", and this is the second kind of string it
     * accepts. Everything downstream — the snapshot, the diagnostics, the status bar — is the same
     * code as for a file, which is the whole reason the route was put behind the same opener rather
     * than beside it.
     */
    if (isContainerUriText(subjectRequested)) {
      const containers = options.containers
      if (containers === undefined) {
        throw new TypeError('this window did not compose container browsing')
      }
      const answer = await containers.open(subjectRequested, signal)
      publishSubjectDiagnostics(subjectRequested, answer.snapshot.diagnostics)
      if (answer.snapshot.state === 'opened') {
        retainCandidateSession(generation, await answer.session?.descriptor(), answer.session)
        const presentation = await resolveCommonPresentationPlan(
          answer.snapshot.descriptor as never,
          {
            sessionId: answer.snapshot.sessionId,
            providerId: answer.snapshot.selected.contributionId,
            variantId: answer.snapshot.selected.variantId,
          },
          { availableStageIds: STAGE_ORDER },
        )
        options.onSubjectOpened?.({
          path: subjectRequested,
          contributionId: answer.snapshot.selected.contributionId,
          variantId: answer.snapshot.selected.variantId,
          confidence: answer.snapshot.selected.confidence,
        })
        return presentation === undefined
          ? answer
          : {
              ...answer,
              snapshot: { ...answer.snapshot, presentation: presentation.plan },
            }
      }
      return answer
    }
    /*
     * `createPathSubjectOpener` hides the `OpenedSubject` behind its snapshot, and
     * `createSubjectEditing` needs it. Rather than re-implementing the opener to get at it, the
     * services object it is handed is wrapped for the duration of this one call: the open path,
     * the confinement and the snapshot stay the shared ones, and the result is captured on the way
     * past.
     */
    let opened: OpenedSubject | undefined
    let mapPreviewCandidates: readonly VsCodeMapPreviewCandidate[] = []
    const capturing: SubjectServices = {
      ...services,
      open: async request => {
        const result = await services.open(request)
        if (result.state === 'opened') {
          const preview = await prepareVsCodeMapPreview({
            services,
            opened: result,
            grant: request.grant,
            budgets: request.budget,
            ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
            ...(mapSelection === undefined ? {} : { selectionId: mapSelection.selectionId }),
            ...(options.mapPreviewResourcePlanResolver === undefined
              ? {}
              : { resourcePlanResolver: options.mapPreviewResourcePlanResolver }),
            ...(signal === undefined ? {} : { signal }),
          })
          opened = preview.opened
          mapPreviewCandidates = preview.candidates
          return preview.opened
        }
        return result
      },
    }
    const opener = createPathSubjectOpener({
      subjects: capturing,
      roots: options.roots(),
      grant: options.grant ?? DEFAULT_OPEN_GRANT,
      budget: options.budget ?? DEFAULT_OPEN_BUDGET,
    })
    const rawAnswer = await opener(subjectRequested, signal)
    const openedAnswer =
      rawAnswer.snapshot.state === 'opened' && mapPreviewCandidates.length > 0
        ? {
            ...rawAnswer,
            snapshot: {
              ...rawAnswer.snapshot,
              candidates: [...rawAnswer.snapshot.candidates, ...mapPreviewCandidates],
            },
          }
        : rawAnswer
    const presentation =
      openedAnswer.snapshot.state === 'opened'
        ? await resolveCommonPresentationPlan(
            openedAnswer.snapshot.descriptor as never,
            {
              sessionId: openedAnswer.snapshot.sessionId,
              providerId: openedAnswer.snapshot.selected.contributionId,
              variantId: openedAnswer.snapshot.selected.variantId,
            },
            { availableStageIds: STAGE_ORDER },
          )
        : undefined
    const answer =
      presentation === undefined || openedAnswer.snapshot.state !== 'opened'
        ? openedAnswer
        : {
            ...openedAnswer,
            snapshot: { ...openedAnswer.snapshot, presentation: presentation.plan },
          }
    if (answer.snapshot.state === 'opened') {
      retainCandidateSession(generation, opened?.descriptor, opened?.session)
    }

    /*
     * Every finding about this subject, on whatever surface the adapter gives them — reported for
     * the unresolved arm as well, because "no codec claimed it, and here is why" is exactly the
     * kind of thing a user needs to see and exactly the kind that used to vanish into a log.
     */
    /*
     * The opener's snapshot, not the inner open result. Companion findings are added around the
     * open — the resolver is the only thing that knows an optional sidecar was absent — so the
     * inner result carries everything except the one diagnostic this host most needs to show.
     */
    publishSubjectDiagnostics(resolve(subjectRequested), answer.snapshot.diagnostics)

    if (answer.snapshot.state === 'opened') {
      options.onSubjectOpened?.({
        path: resolve(subjectRequested),
        contributionId: answer.snapshot.selected.contributionId,
        variantId: answer.snapshot.selected.variantId,
        confidence: answer.snapshot.selected.confidence,
      })
    }

    if (answer.snapshot.state !== 'opened' || opened === undefined) return answer

    const sessionId = answer.snapshot.sessionId
    const editGrant: PermissionGrant = {
      id: `vscode:${sessionId}`,
      classes: ['read-source', 'write-source'],
    }
    const writerResolution = await resolveFormatWriter({
      services,
      opened,
      grant: editGrant,
      budgets: options.budget ?? DEFAULT_OPEN_BUDGET,
    })
    writerResolution.diagnostics.forEach(item => options.onDiagnostic?.(item))
    /*
     * SC2Map is an MPQ-backed semantic subject, so its normal editor writer facet is
     * `sc2-map`.  Save As needs the installed MPQ contribution's native-source export writer
     * instead.  This second resolution is deliberately narrow and only exposes the opt-in helper
     * when that worker contribution explicitly carries it beside the standard writer contract.
     */
    let retainedNativeSaveAs:
      { readonly key: string; readonly entry: NativeMpqSaveAsEntry } | undefined
    try {
      const openedFormatId =
        opened.descriptor.interpretation === 'codec'
          ? opened.descriptor.identity.formatId
          : undefined
      if (openedFormatId === 'sc2-map') {
        const nativeWriterResolution = await resolveFormatWriter({
          services,
          opened,
          grant: editGrant,
          budgets: options.budget ?? DEFAULT_OPEN_BUDGET,
          formatId: 'mpq',
          representationId: 'native-source',
          mutationMode: 'export-only',
          minimumRoundTrip: 'semantic',
        })
        let keepNativeWriterLease = false
        try {
          nativeWriterResolution.diagnostics.forEach(item => options.onDiagnostic?.(item))
          const candidate = nativeWriterResolution.writer as
            { readonly snapshotNativePreservingMpq?: NativeMpqSaveAsEntry['snapshot'] } | undefined
          const snapshot = candidate?.snapshotNativePreservingMpq
          if (
            nativeWriterResolution.writer?.identity.providerId === 'blizzard/mpq-fresh-writer' &&
            nativeWriterResolution.writer.offer.formatId === 'mpq' &&
            nativeWriterResolution.writer.offer.representationId === 'native-source' &&
            snapshot !== undefined
          ) {
            const selectedNativeSaveAs = Object.freeze({
              snapshot,
              writer: nativeWriterResolution.writer,
              ...(nativeWriterResolution.release === undefined
                ? {}
                : { release: nativeWriterResolution.release }),
            })
            const nativeSaveAsKey = resolve(subjectRequested)
            const previousNativeSaveAs = nativeSaveAsByPath.get(nativeSaveAsKey)
            await previousNativeSaveAs?.release?.()
            nativeSaveAsByPath.set(nativeSaveAsKey, selectedNativeSaveAs)
            retainedNativeSaveAs = { key: nativeSaveAsKey, entry: selectedNativeSaveAs }
            keepNativeWriterLease = true
          }
        } finally {
          if (!keepNativeWriterLease) await nativeWriterResolution.release?.()
        }
      }
      const selectedWriter = writerResolution.writer ?? rawWriter
      let sessionEvidence = evidence
      if (opened.descriptor.interpretation === 'codec') {
        sessionEvidence = codecFidelityEvidenceRecords(services.inventory, {
          codecId: opened.descriptor.identity.codecId,
          formatId: opened.descriptor.identity.formatId,
        }).reduce((registry, record) => registry.with(record), sessionEvidence)
      }
      if (writerResolution.writer !== undefined) {
        const writerRecord = serviceProviderFidelityEvidenceRecord(services.inventory, {
          writer: writerResolution.writer,
        })
        if (writerRecord !== undefined) sessionEvidence = sessionEvidence.with(writerRecord)
      }
      const editing = createSubjectEditing({
        opened,
        grant: editGrant,
        backendFor: () => editingBackend,
        evidenceFor: plan => sessionEvidence.evidenceFor(plan),
        writer: selectedWriter,
      })
      const leasedSession = editing.session
      let released = false
      const editingForSession =
        writerResolution.release === undefined || leasedSession === undefined
          ? editing
          : Object.freeze({
              ...editing,
              session: Object.freeze({
                ...leasedSession,
                async dispose() {
                  const shouldReleaseWriter = !released
                  if (shouldReleaseWriter) released = true
                  const releaseWriter = shouldReleaseWriter
                    ? Promise.resolve().then(() => writerResolution.release?.())
                    : undefined
                  const [sessionResult, writerResult] = await Promise.allSettled([
                    Promise.resolve().then(() => leasedSession.dispose()),
                    releaseWriter,
                  ])
                  if (sessionResult.status === 'rejected') throw sessionResult.reason
                  if (writerResult.status === 'rejected') throw writerResult.reason
                },
              }),
            })
      rememberEditing(sessionId, editingForSession)
    } catch (error) {
      const nativeRelease =
        retainedNativeSaveAs !== undefined &&
        nativeSaveAsByPath.get(retainedNativeSaveAs.key) === retainedNativeSaveAs.entry
          ? (() => {
              nativeSaveAsByPath.delete(retainedNativeSaveAs.key)
              return retainedNativeSaveAs.entry.release?.()
            })()
          : undefined
      await Promise.allSettled([nativeRelease, writerResolution.release?.()])
      // A subject shape editing does not support yet (a bundle, a namespace) still opens
      // read-only; the page sees `edit()` refuse and hides the editor stages.
      options.onDiagnostic?.({
        code: 'x3.app/vscode-subject-not-editable',
        message: `${basename(subjectRequested)} opened without an editing arm: ${describe(error)}`,
      })
    }
    return {
      ...answer,
      ...(opened?.rasterResources === undefined ? {} : { rasterResources: opened.rasterResources }),
    }
  }

  const exposure = exposeSubjectRpc({
    framePort: bridge.framePort,
    session: options.session,
    open: openSubject,
    navigate: async ({ parent, target }, signal) => {
      const diagnostics: Diagnostic[] = []
      const nested = await openNestedSubjectRef({
        parent,
        targetSubject: target,
        ...nestedSubjectServices(services),
        grant: options.grant ?? DEFAULT_OPEN_GRANT,
        budget: options.budget ?? DEFAULT_OPEN_BUDGET,
        onDiagnostic: item => {
          diagnostics.push(item)
          options.onDiagnostic?.(item)
        },
        ...(signal === undefined ? {} : { signal }),
      })
      if (nested === undefined) return undefined
      const carried = [...nested.result.diagnostics, ...diagnostics].map(item => ({
        code: item.code,
        message: item.message,
        severity: item.severity,
      }))
      if (nested.result.state === 'unresolved') {
        return {
          snapshot: subjectOpenSnapshot({
            result: nested.result,
            sessionId: () => '',
            diagnostics: carried,
          }),
        }
      }
      navigationSequence += 1
      const sessionId = `navigate:${options.session}:${navigationSequence}`
      const baseSnapshot = subjectOpenSnapshot({
        result: nested.result,
        sessionId: () => sessionId,
        diagnostics: carried,
      })
      const presentation = await resolveCommonPresentationPlan(
        nested.result.descriptor,
        {
          sessionId,
          providerId: nested.result.selected.contributionId,
          variantId: nested.result.selected.variantId,
        },
        { availableStageIds: STAGE_ORDER },
      )
      return {
        snapshot:
          presentation === undefined
            ? baseSnapshot
            : { ...baseSnapshot, presentation: presentation.plan },
        session: nested.result.session,
        ...(nested.result.rasterResources === undefined
          ? {}
          : { rasterResources: nested.result.rasterResources }),
      }
    },
    editing: sessionId => editingBySession.get(sessionId),
    moduleUrl: VSCODE_SUBJECT_SERVICES_URL,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })

  // ------------------------------------------------------------------ settings traffic
  /**
   * What the page shows: the setting as it stands now, and the composition as it is running.
   *
   * The two can disagree, and saying so is the point. A contribution the user just switched off is
   * in `disabledContributions` immediately and still `disabled: false` on its row until the window
   * reloads — the page draws that difference as "pending" instead of pretending the codec is
   * already gone.
   */
  const settingsView = (): ShellSettingsView => {
    const configuration = options.configuration
    const rawExtensions = configuration?.readExtensions()
    const configured = describeConfiguredExtensions(rawExtensions)
    const failures = composed.extensions.failures
    const installed = new Set(composed.extensions.installed)
    const resolvedFor = (path: string): string => resolve(path)
    return {
      bundled: composed.extensions.bundled,
      installed: composed.extensions.installed,
      failures: failures.map(item => ({
        root: item.root,
        code: item.code,
        message: item.message,
      })),
      problems: composed.extensions.problems,
      configuredExtensions: configured.map(entry => {
        const root = resolvedFor(entry.path)
        const failure = failures.find(item => item.root === root)
        /*
         * An entry with no `id` is the common case — a bare path is what the folder dialog
         * appends — so "loaded" cannot be conditioned on knowing the coordinate in advance. The
         * loader reports one failure per root it refused, including an identity mismatch, so a
         * root that is enabled and not among the failures is loaded. `absent` is left for the one
         * case that is genuinely odd: an entry that names a coordinate the inventory does not hold
         * and that the loader did not refuse.
         */
        const state = !entry.enabled
          ? 'disabled'
          : failure !== undefined
            ? 'failed'
            : entry.id !== undefined && !installed.has(entry.id)
              ? 'absent'
              : 'loaded'
        return {
          index: entry.index,
          path: entry.path,
          ...(entry.id === undefined ? {} : { id: entry.id }),
          enabled: entry.enabled,
          state,
          ...(failure === undefined ? {} : { code: failure.code, message: failure.message }),
        }
      }),
      contributions: composed.contributions.map(row => ({ ...row })),
      disabledExtensions:
        configuration === undefined
          ? composed.extensions.disabledExtensions
          : configuredDisabledExtensions(configuration.readDisabledExtensions?.()).ids,
      disabledContributions:
        configuration === undefined
          ? composed.extensions.disabledContributions
          : configuredDisabledContributions(configuration.readDisabledContributions()).ids,
      scope: configuration?.scope ?? 'user',
      writable: configuration !== undefined,
    }
  }

  const answer = (changed: boolean, message: string): ShellConfigureResult => ({
    changed,
    message,
    view: settingsView(),
  })

  /** Every write goes through here, so "changed" and "reload to apply" are said in one place. */
  const applies = 'Reload the window to apply it.'
  const cardResourceText = (
    key:
      | 'vscode.extensions.resourceNotGranted'
      | 'vscode.extensions.sourceOpened'
      | 'vscode.extensions.licenseOpened',
    fallback: string,
  ): string => {
    const translated = options.localizer?.text(key)
    return translated === undefined || translated === key ? fallback : translated
  }

  bridge.serve(async (request: ShellRequest): Promise<unknown> => {
    const roots = options.roots().map(root => resolve(root))
    const configuration = options.configuration
    switch (request.op) {
      /*
       * The page's own file access, for both kinds of subject.
       *
       * A container member is not a path, and routing it at `resolve()` was the defect the first
       * run of the reworked smoke found: the member opened in a tab, and the page then asked the
       * shell for its bytes and was told the URI «is outside the folders this window granted».
       * The bytes are readable — through the open container, by the same registry the editor's
       * filesystem provider answers from — so the shell reads them the same way rather than a
       * second way.
       */
      case 'list':
        return isContainerUriText(request.path ?? '')
          ? listContainer(options.containers, request.path ?? '')
          : listDirectory(roots, request.path)
      case 'read':
        if (request.path.startsWith('modkit-source:')) {
          if (!options.readContentSource) throw new Error('Content source provider is unavailable')
          return options.readContentSource(request.path, request.maxBytes)
        }
        return isContainerUriText(request.path)
          ? readContainerEntry(options.containers, request.path, request.maxBytes)
          : readEntry(roots, request.path, request.maxBytes)
      case 'confirm':
        // No adapter means no way to ask, and discarding silently is the one answer that loses
        // work — so an unanswerable prompt keeps the tab open.
        return (await options.confirmClose?.(request.message, request.savable)) ?? 'cancel'
      case 'export-files': {
        if (options.exportFiles === undefined) {
          return { state: 'refused', reason: 'this window cannot write exported files' }
        }
        const files = Array.isArray(request.files) ? request.files : []
        if (files.length === 0) return { state: 'refused', reason: 'nothing to export' }
        if (files.length > EXPORT_FILE_LIMIT) {
          return {
            state: 'refused',
            reason: `an export of ${files.length} files is over the limit of ${EXPORT_FILE_LIMIT}`,
          }
        }
        for (const file of files) {
          if (!isSafeExportName(file?.name)) {
            return { state: 'refused', reason: `«${String(file?.name)}» is not a plain file name` }
          }
          if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0) {
            return { state: 'refused', reason: `«${file.name}» carried no bytes` }
          }
          if (file.bytes.byteLength > EXPORT_FILE_MAXIMUM_BYTES) {
            return { state: 'refused', reason: `«${file.name}» is larger than the export ceiling` }
          }
        }
        return await options.exportFiles(
          files.map(file => ({ name: file.name, bytes: file.bytes })),
        )
      }
      case 'settings':
        return settingsView()
      case 'set-contribution': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const { next, changed } = withContributionDisabled(
          configuration.readDisabledContributions(),
          request.id,
          !request.enabled,
        )
        if (changed) await configuration.write('disabledContributions', next)
        return answer(
          changed,
          changed
            ? `${request.id} is now ${request.enabled ? 'enabled' : 'disabled'} in ` +
                `modkit.disabledContributions (${configuration.scope}). ${applies}`
            : `${request.id} was already ${request.enabled ? 'enabled' : 'disabled'}.`,
        )
      }
      case 'set-contributions': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        if (
          !Array.isArray(request.ids) ||
          request.ids.length === 0 ||
          request.ids.length > 4096 ||
          request.ids.some(id => typeof id !== 'string' || id.trim().length === 0)
        ) {
          return answer(false, 'The codec selection is empty or invalid, so nothing was written.')
        }
        const { next, changed } = withContributionsDisabled(
          configuration.readDisabledContributions(),
          request.ids,
          !request.enabled,
        )
        if (changed) await configuration.write('disabledContributions', next)
        return answer(
          changed,
          changed
            ? `${request.ids.length} contributions are now ` +
                `${request.enabled ? 'enabled' : 'disabled'} in modkit.disabledContributions ` +
                `(${configuration.scope}). ${applies}`
            : `The selected contributions were already ${request.enabled ? 'enabled' : 'disabled'}.`,
        )
      }
      case 'set-extension-coordinate': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const { next, changed } = withExtensionDisabled(
          configuration.readDisabledExtensions?.(),
          request.id,
          !request.enabled,
        )
        if (changed) await configuration.write('disabledExtensions', next)
        return answer(
          changed,
          changed
            ? `${request.id} is now ${request.enabled ? 'enabled' : 'disabled'} in ` +
                `modkit.disabledExtensions (${configuration.scope}). ${applies}`
            : `${request.id} was already ${request.enabled ? 'enabled' : 'disabled'}.`,
        )
      }
      case 'set-managed-package': {
        if (
          options.setManagedPackageEnabled === undefined ||
          options.managedPackageIds?.has(request.id) !== true
        ) {
          return answer(false, `${request.id} is not a managed extension package.`)
        }
        await options.setManagedPackageEnabled(request.id, request.enabled)
        return answer(
          true,
          `${request.id} is now ${request.enabled ? 'enabled' : 'disabled'} in the extension ` +
            `manager. ${applies}`,
        )
      }
      case 'remove-managed-package': {
        if (
          options.removeManagedPackage === undefined ||
          options.managedPackageIds?.has(request.id) !== true
        ) {
          return answer(false, `${request.id} is not a removable managed extension package.`)
        }
        await options.removeManagedPackage(request.id)
        return answer(true, `${request.id} was removed from the extension manager. ${applies}`)
      }
      case 'manage-repository-subject': {
        const granted = options.repositorySubject
        if (
          granted === undefined ||
          options.manageRepositorySubject === undefined ||
          request.kind !== granted.kind ||
          request.id !== granted.id ||
          !granted.actions.includes(request.action)
        ) {
          return answer(false, 'This repository subject card does not grant that package action.')
        }
        await options.manageRepositorySubject({
          kind: request.kind,
          id: request.id,
          action: request.action,
        })
        return answer(true, `${request.action} was requested for ${request.id}. ${applies}`)
      }
      case 'link-extension': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const root = options.linkableExtensionRoots?.get(request.id)
        if (root === undefined) {
          return answer(false, `${request.id} is not an available local extension.`)
        }
        const { next, added, reason } = withExtensionRoot(
          configuration.readExtensions(),
          resolve(root),
          { caseSensitive: process.platform !== 'win32' && process.platform !== 'darwin' },
        )
        if (added) await configuration.write('extensions', next)
        return answer(
          added,
          added
            ? `${request.id} was linked through modkit.extensions (${configuration.scope}). ${applies}`
            : (reason ?? `${request.id} is already linked.`),
        )
      }
      case 'open-extension-resource': {
        const resource = options.extensionCardResources
          ?.get(request.subjectId)
          ?.find(item => item.id === request.resourceId && item.role === request.role)
        if (resource === undefined || options.openExtensionCardResource === undefined) {
          return {
            opened: false,
            message: cardResourceText(
              'vscode.extensions.resourceNotGranted',
              'This extension card does not grant that source or license resource.',
            ),
          }
        }
        await options.openExtensionCardResource(resource)
        return {
          opened: true,
          message: cardResourceText(
            resource.role === 'source'
              ? 'vscode.extensions.sourceOpened'
              : 'vscode.extensions.licenseOpened',
            resource.role === 'source' ? 'Extension source opened.' : 'License file opened.',
          ),
        }
      }
      case 'set-extension': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const { next, changed } = withExtensionEnabled(
          configuration.readExtensions(),
          request.index,
          request.enabled,
        )
        if (changed) await configuration.write('extensions', next)
        return answer(
          changed,
          changed
            ? `modkit.extensions[${request.index}] is now ` +
                `${request.enabled ? 'enabled' : 'disabled'} (${configuration.scope}). ${applies}`
            : `modkit.extensions has no entry ${request.index}.`,
        )
      }
      case 'remove-extension': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const { next, changed } = withoutExtension(configuration.readExtensions(), request.index)
        if (changed) await configuration.write('extensions', next)
        return answer(
          changed,
          changed
            ? `Removed modkit.extensions[${request.index}] (${configuration.scope}). ${applies}`
            : `modkit.extensions has no entry ${request.index}.`,
        )
      }
      case 'add-extension-folder': {
        if (configuration === undefined) return answer(false, CANNOT_CONFIGURE)
        const picked = await configuration.pickFolder()
        if (picked === undefined) return answer(false, 'No folder was chosen.')
        const root = resolve(picked)
        const { next, added, reason } = withExtensionRoot(configuration.readExtensions(), root, {
          // Windows and macOS default volumes fold case; a Linux path does not.
          caseSensitive: process.platform !== 'win32' && process.platform !== 'darwin',
        })
        if (added) await configuration.write('extensions', next)
        return answer(
          added,
          added
            ? `Added ${root} to modkit.extensions (${configuration.scope}). ${applies}` +
                (reason === undefined ? '' : ` ${reason}`)
            : (reason ?? `${root} is already in modkit.extensions.`),
        )
      }
      default:
        throw new Error('unknown shell request')
    }
  })

  // The page's own status line, mirrored so the output channel records what the user saw.
  bridge.onEvent(event => {
    if (event.op === 'status') {
      options.onDiagnostic?.({ code: 'x3.app/vscode-webview-status', message: event.text })
    } else if (event.op === 'facilities') {
      options.onFacilities?.(event.observed)
    } else if (event.op === 'document-dirty') {
      options.onDocumentDirty?.(event.path, event.dirty)
    } else if (event.op === 'document-save-requested') {
      options.onDocumentSaveRequested?.(event.path)
    }
  })

  return {
    bridge,
    exposure,
    open(path: string) {
      bridge.emit({ op: 'open', path: subjectKey(path), name: subjectLabel(path) })
    },
    publishRoots() {
      bridge.emit({
        op: 'roots',
        roots: options.roots().map(root => {
          const absolute = resolve(root)
          return { id: absolute, label: basename(absolute) || absolute }
        }),
      })
    },
    notice(text: string, severity: 'info' | 'error' = 'info') {
      bridge.emit({ op: 'notice', text, severity })
    },
    async saveDocument(path: string) {
      if ((await bridge.request({ op: 'document-save', path: subjectKey(path) })) !== true) {
        throw new Error('the webview did not confirm that the custom document was saved')
      }
    },
    async revertDocument(path: string) {
      if ((await bridge.request({ op: 'document-revert', path: subjectKey(path) })) !== true) {
        throw new Error('the webview did not confirm that the custom document was reverted')
      }
    },
    async nativeSaveAs(path: string, destinationPath: string, sourceBytes: Uint8Array) {
      const entry = nativeSaveAsByPath.get(subjectKey(path))
      if (entry === undefined) return undefined
      const targetId = `vscode-save-as:${subjectKey(destinationPath)}`
      const change = await entry.snapshot({
        sourceBytes: ownedWireBytes(sourceBytes),
        replacements: Object.freeze([{ path: 'MapScript.galaxy', bytes: nativeMapScript() }]),
        target: Object.freeze({
          targetId,
          subjectUri: subjectKey(destinationPath),
          ownerSource: Object.freeze({ id: subjectKey(path), uri: subjectKey(path) }),
          semanticPath: Object.freeze([]),
          expectedRevision: Object.freeze({
            namespaceRevision: `content-hash:${subjectKey(path)}`,
            compositionFingerprint: 'vscode-native-save-as-v1',
          }),
        }),
        archiveName: basename(destinationPath),
      })
      const validation = await entry.writer.validate(change as never)
      if (!validation.valid) {
        throw new TypeError(
          `the installed MPQ writer refused Save As: ${validation.diagnostics
            .map(item => item.message)
            .join('; ')}`,
        )
      }
      const plan = await entry.writer.plan(change as never)
      const edit = plan.edits.length === 1 ? plan.edits[0] : undefined
      if (
        plan.semantics.mutationMode !== 'export-only' ||
        plan.semantics.minimumGuarantee !== 'atomic' ||
        edit?.operation !== 'create' ||
        edit.payload.kind !== 'inline' ||
        !(edit.payload.bytes instanceof Uint8Array) ||
        change.semanticIntent?.nativeExportReceipt === undefined
      ) {
        throw new TypeError(
          'the installed MPQ writer returned no native-preserving Save As payload',
        )
      }
      return Object.freeze({
        bytes: edit.payload.bytes,
        nativeWriterReceipt: change.semanticIntent.nativeExportReceipt,
      })
    },
    hasSubjectCandidates() {
      return (
        candidateSession?.generation === subjectGeneration &&
        candidateSession.session.state() === 'live'
      )
    },
    async openSubjectCandidates(signal?: AbortSignal) {
      throwIfAborted(signal)
      const selected = candidateSession
      if (
        selected === undefined ||
        selected.generation !== subjectGeneration ||
        selected.session.state() !== 'live'
      ) {
        return undefined
      }
      let lease: Lease<SubjectSelectorSource>
      try {
        lease = await selected.session.dataSource(
          SUBJECT_SELECTOR_SOURCE.contract,
          SUBJECT_SELECTOR_SOURCE.major,
        )
      } catch (error) {
        if (candidateSession !== selected || selected.session.state() !== 'live') return undefined
        throw error
      }
      try {
        throwIfAborted(signal)
      } catch (error) {
        await lease.release()
        throw error
      }
      if (
        candidateSession !== selected ||
        selected.generation !== subjectGeneration ||
        selected.session.state() !== 'live'
      ) {
        await lease.release()
        return undefined
      }
      return Object.freeze({
        value: createSubjectCandidateProvider(lease.value),
        release: () => lease.release(),
      })
    },
    async close(reason: string) {
      subjectGeneration += 1
      candidateSession = undefined
      let bridgeDisposeError: unknown
      try {
        bridge.dispose()
      } catch (error) {
        bridgeDisposeError = error
      }
      editingBySession.clear()
      const releases = [...new Set([...nativeSaveAsByPath.values()].map(entry => entry.release))]
      nativeSaveAsByPath.clear()
      const releaseResults = await Promise.allSettled(
        releases.map(release => Promise.resolve().then(() => release?.())),
      )
      const [exposureResult] = await Promise.allSettled([
        Promise.resolve().then(() => exposure.close(reason)),
      ])
      if (bridgeDisposeError !== undefined) throw bridgeDisposeError
      const rejectedRelease = releaseResults.find(result => result.status === 'rejected')
      if (rejectedRelease?.status === 'rejected') throw rejectedRelease.reason
      if (exposureResult.status === 'rejected') throw exposureResult.reason
    },
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The identity a subject is keyed by, for both kinds of subject path.
 *
 * A file is keyed by its resolved path — two spellings of one file are one subject. A container
 * member is keyed by its URI text, which is already canonical (the container path is resolved
 * before it is encoded), and which `resolve` would turn into nonsense by treating `modkit-container:`
 * as a relative directory name.
 */
export function subjectKey(path: string): string {
  return isContainerUriText(path) || path.startsWith('modkit-source:') ? path : resolve(path)
}

/**
 * An owned copy of bytes, as the plain kind the capability wire accepts.
 *
 * `workspace.fs.readFile` is typed `Uint8Array` but hands back the extension host's own buffer,
 * which under Node is a `Buffer`. That matters twice: the wire deliberately refuses a `Uint8Array`
 * subclass, because a subclass carries behaviour the far side would not reconstruct; and
 * `Buffer.prototype.slice` returns another view over the same memory rather than the owned copy a
 * defensive `.slice()` reads as. Constructing the base kind settles both at once.
 */
export function ownedWireBytes(view: Uint8Array): Uint8Array {
  return new Uint8Array(view)
}

/**
 * What this subject is called out loud.
 *
 * For a member, the container's own file name and the member's path inside it — never the
 * container's absolute path, which is what the owner's screenshot caught the old footer printing.
 * The URI keeps the absolute path (it has to address something), the label does not.
 */
export function subjectLabel(path: string): string {
  if (path.startsWith('modkit-source:'))
    return decodeURIComponent(new URL(path).pathname).split('/').at(-1) ?? 'Source file'
  const location = parseContainerUriText(path)
  if (location === undefined) return basename(path)
  return `${basename(location.container)} › ${location.entry}`
}

async function listDirectory(
  roots: readonly string[],
  requested: string | undefined,
): Promise<readonly ShellEntry[]> {
  if (requested === undefined) {
    // The root listing is the set of granted folders themselves.
    const out: ShellEntry[] = []
    for (const root of roots) {
      out.push({ id: root, name: basename(root) || root, directory: true })
    }
    return out
  }
  const path = requireInside(roots, requested)
  const entries = await readdir(path, { withFileTypes: true })
  const out: ShellEntry[] = []
  for (const entry of entries.slice(0, VSCODE_MAXIMUM_LISTING)) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      out.push({ id: child, name: entry.name, directory: true })
      continue
    }
    if (!entry.isFile()) continue
    let size: number | undefined
    try {
      size = Number((await stat(child)).size)
    } catch {
      size = undefined
    }
    out.push({
      id: child,
      name: entry.name,
      directory: false,
      ...(size === undefined ? {} : { size }),
    })
  }
  return out
}

/** A container's own listing, in the shape the page's explorer consumes. */
async function listContainer(
  containers: ContainerRegistry | undefined,
  requested: string,
): Promise<readonly ShellEntry[]> {
  const location = parseContainerUriText(requested)
  if (containers === undefined || location === undefined) {
    throw new Error(`«${requested}» does not name a container this window composed`)
  }
  const children = await containers.list(location.container, location.entry)
  return children.map(child => ({
    // the child's own address, so the page can descend without knowing the encoding
    id: containerUriText(
      location.container,
      location.entry === '' ? child.name : `${location.entry}/${child.name}`,
    ),
    name: child.name,
    directory: child.kind === 'directory',
    ...(child.size === undefined ? {} : { size: child.size }),
  }))
}

/** One member's bytes, under the same ceiling a file on disk is read with. */
async function readContainerEntry(
  containers: ContainerRegistry | undefined,
  requested: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const location = parseContainerUriText(requested)
  if (containers === undefined || location === undefined) {
    throw new Error(`«${requested}» does not name a container this window composed`)
  }
  const limit = Math.min(
    Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : VSCODE_MAXIMUM_SUBJECT_BYTES,
    VSCODE_MAXIMUM_SUBJECT_BYTES,
  )
  const node = await containers.stat(location.container, location.entry)
  if (node.size !== undefined && node.size > limit) {
    throw new Error(
      `${node.name} is ${(node.size / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${(limit / (1024 * 1024)).toFixed(0)} MiB this host will read into memory`,
    )
  }
  return containers.read(location.container, location.entry)
}

async function readEntry(
  roots: readonly string[],
  requested: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const path = requireInside(roots, requested)
  const limit = Math.min(
    Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : VSCODE_MAXIMUM_SUBJECT_BYTES,
    VSCODE_MAXIMUM_SUBJECT_BYTES,
  )
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`«${basename(path)}» is not a file`)
  if (Number(info.size) > limit) {
    throw new Error(
      `${basename(path)} is ${(Number(info.size) / (1024 * 1024)).toFixed(1)} MiB, over the ` +
        `${(limit / (1024 * 1024)).toFixed(0)} MiB this host will read into memory`,
    )
  }
  const bytes = await readFile(path)
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice()
}

/** Candidate directories the first-party catalog may live in, most specific first. */
export function catalogCandidates(
  extensionRoot: string,
  repositoryRoot?: string,
): readonly string[] {
  /*
   * Bases, not catalogs: the generated catalog stores `images`, so each candidate is the
   * directory that `extensions/` prefix is joined onto.
   *
   * A production VSIX is always authoritative: it carries the generated roots under
   * `dist-app/extensions` together with their physical `node_modules` closure. The caller's
   * computed grandparent is not itself evidence of a checkout — for a normal installed extension it
   * is VS Code's shared extensions directory — so a repository candidate is admitted only for a
   * marked workspace checkout and is deliberately behind the packaged tree.
   */
  const candidates = [join(extensionRoot, 'dist-app', 'extensions')]
  if (
    repositoryRoot !== undefined &&
    resolve(extensionRoot) === resolve(repositoryRoot, 'apps', 'vscode') &&
    existsSync(join(repositoryRoot, '.git')) &&
    existsSync(join(repositoryRoot, 'pnpm-workspace.yaml')) &&
    existsSync(join(repositoryRoot, 'apps', 'vscode', 'package.json'))
  ) {
    candidates.push(join(repositoryRoot, 'extensions'))
  }
  return Object.freeze(candidates.filter(path => existsSync(path)))
}
