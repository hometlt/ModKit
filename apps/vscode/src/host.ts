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

import { randomUUID } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { throwIfAborted, type Diagnostic } from '@modkit/core'
import { sceneModule } from '@modkit/scene/module'
import {
  createSubjectCandidateProvider,
  type AnyDescriptor,
  type ArtifactSource,
  type AssetSession,
  type InstallationFiles,
  type Lease,
  type ModelResourceRefsSource,
  type OperationSession,
  type PermissionGrant,
  type ResourceBudget,
  type SubjectCandidateProvider,
  type SubjectSelectorSource,
  type TreeDataSource,
  type Writer,
} from '@modkit/sdk'
import { advertisesSubjectCandidates, SUBJECT_SELECTOR_SOURCE } from './subject-candidates.js'
import { configuredContributionSettings } from './contribution-settings.js'
import { uvModule } from '@modkit/uv/module'
import type { MapPreviewResourcePlanResolver } from '@modkit/host/maps'
import type { ContentSources } from '@modkit/vfs/content-sources'
import { selectSceneRenderer, type SceneRendererSelection } from '@modkit/host/renderer'
import type { UiLocalizer } from '@modkit/ui/localization'
import {
  codecFidelityEvidenceRecords,
  subjectFidelityEvidenceRecords,
  createContentAssetOrigin,
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
  type SubjectCatalogOptions,
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
  type NodeSubjectServicesOptions,
  type PathSubjectOpenerOptions,
} from '@modkit/host/node'

import { anchorDocumentIndex, anchoredSubjectPath } from './anchor-documents.js'
import { STAGE_ORDER } from './view-policy.js'
import type { PhaseLog } from './timing.js'
import { contentSourceOpener, type ContentSourceReader } from './content-source-open.js'

const VSCODE_BUILTIN_MODULES = /* @__PURE__ */ linkedExtensionInputs([sceneModule, uvModule])

import {
  createBridge,
  type Bridge,
  type CloseAnswer,
  type ShellConfigureResult,
  type ShellEntry,
  type ShellExplorerEntry,
  type ShellRequest,
  type ShellSettingsView,
  type ShellThumbnail,
  type WebviewChannel,
} from './bridge.js'
import type { ExtensionCardResourceTarget } from './extension-cards.js'
import type { ArchiveAction, ArchiveTarget } from '@modkit/ui/archive'
import {
  containerOfSubject,
  containerUriText,
  isContainerUriText,
  parseContainerUriText,
  splitContainer,
} from './container-uri.js'
import {
  containerMemberEditingBackend,
  createContainerRegistry,
  type ContainerRegistry,
  type ContainerRegistryOptions,
} from './containers.js'
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
  /** Open one directory/file subject for a native tree view without creating a webview. */
  openTreeSubject(
    path: string,
    roots: readonly string[],
    signal?: AbortSignal,
  ): Promise<VsCodeTreeSubject | undefined>
  /** The same, for a source the caller already holds (a layer of a mod context), named `path`. */
  openTreeSource(
    source: ArtifactSource,
    path: string,
    signal?: AbortSignal,
  ): Promise<VsCodeTreeSubject | undefined>
  /**
   * The resources one subject names (`common.view/model-resource-refs-source`), as it spells them;
   * undefined when it publishes none. The subject is opened for the question and closed again.
   */
  resourceReferences(
    path: string,
    roots: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly string[] | undefined>
}

export interface VsCodeTreeSubject {
  readonly path: string
  openTreeDataSource(signal?: AbortSignal): Promise<Lease<TreeDataSource> | undefined>
  dispose(): Promise<void>
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
  /** Whether listings include entries the codec calls hidden; read per request. */
  readonly showHidden?: () => boolean
  /** What a map member's world is resolved with — the same inputs a served page's maps use. */
  readonly mapPreview?: Pick<
    VsCodeServeOptions,
    'mapPreviewResourcePlanResolver' | 'gameLocales' | 'contentSources' | 'localizer'
  >
}

export interface VsCodeSubjectHostOptions {
  /**
   * Directories to look for the first-party catalog in, most specific first. The first candidate
   * that contains any extension wins, so a packaged build never picks up a checkout above it.
   */
  readonly catalogCandidates: readonly string[]
  /** Where an opened subject's catalog questions are answered (its mod context). */
  readonly subjectCatalog?: SubjectCatalogOptions
  /** A game installation's own files, for codecs that read them (Diablo III's type registry). */
  readonly installationFiles?: InstallationFiles
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
  /** Raw value of `modkit.contributionSettings`, exactly as the editor returned it. */
  readonly configuredContributionSettings?: unknown
  /** The host storage this window may cache into; each contribution gets a subdirectory. */
  readonly contributionCacheDirectory?: string
  /** The one directory of index caches every contribution shares (sdk `index-caches`). */
  readonly indexCacheDirectory?: string
  /** Raw value of `modkit.indexCaches`: per game product, the name and content index switches. */
  readonly configuredIndexCaches?: unknown
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
  /** The editor's secret store and prompts; the services build the credential broker over them. */
  readonly credentials?: NodeSubjectServicesOptions['credentials']
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
  const contributionSettings = configuredContributionSettings({
    ...(options.configuredContributionSettings === undefined
      ? {}
      : { configured: options.configuredContributionSettings }),
    ...(options.contributionCacheDirectory === undefined
      ? {}
      : { cacheDirectory: options.contributionCacheDirectory }),
    ...(options.indexCacheDirectory === undefined
      ? {}
      : { indexCacheDirectory: options.indexCacheDirectory }),
    ...(options.configuredIndexCaches === undefined
      ? {}
      : { indexCaches: options.configuredIndexCaches }),
  })
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
    contributionSettings: contributionSettings.settingsFor,
    ...(options.subjectCatalog === undefined ? {} : { subjectCatalog: options.subjectCatalog }),
    ...(options.installationFiles === undefined
      ? {}
      : { installationFiles: options.installationFiles }),
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
    ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
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
  // statement about the very object the running product hands the page. The inventory is the
  // extension host's: the same inputs and switches, so building it a third time only repeated work.
  const webview = await createHostComposition({
    topology,
    realmId: VSCODE_WEBVIEW_REALM,
    inventory: services.host.inventory,
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
        ...(container.showHidden === undefined ? {} : { showHidden: container.showHidden }),
        ...(options.subjectCatalog === undefined
          ? {}
          : {
              assetOriginsFor: async (target: string) => {
                const { contentSources, baseMods } = await modResources(
                  options.subjectCatalog,
                  target,
                )
                return contentSources === undefined
                  ? []
                  : [
                      createContentAssetOrigin({
                        contentSources,
                        target: resolve(target),
                        ...(baseMods === undefined ? {} : { baseMods }),
                      }),
                    ]
              },
            }),
        ...(container.mapPreview === undefined
          ? {}
          : { prepareOpened: mapMemberPreview(services, container.mapPreview) }),
      }),
    serve: (served: VsCodeServeOptions) =>
      serveVsCode(services, served, {
        extensions,
        contributions,
        ...(options.subjectCatalog === undefined ? {} : { subjectCatalog: options.subjectCatalog }),
      }),
    async openTreeSubject(path: string, roots: readonly string[], signal?: AbortSignal) {
      const opener = createPathSubjectOpener({
        subjects: services,
        roots,
        grant: DEFAULT_OPEN_GRANT,
        budget: DEFAULT_OPEN_BUDGET,
        ...(await modResources(options.subjectCatalog, path)),
      })
      const answer = await opener(path, signal)
      if (answer.snapshot.state !== 'opened' || answer.session === undefined) return undefined
      return treeSubjectOf(answer.session, resolve(path))
    },
    async openTreeSource(source: ArtifactSource, path: string, signal?: AbortSignal) {
      const result = await services.open({
        source,
        path,
        intent: 'full',
        grant: DEFAULT_OPEN_GRANT,
        budget: DEFAULT_OPEN_BUDGET,
        ...(signal === undefined ? {} : { signal }),
      })
      return result.state === 'opened' ? treeSubjectOf(result.session, path) : undefined
    },
    async resourceReferences(path: string, roots: readonly string[], signal?: AbortSignal) {
      const opener = createPathSubjectOpener({
        subjects: services,
        roots,
        grant: DEFAULT_OPEN_GRANT,
        budget: DEFAULT_OPEN_BUDGET,
        ...(await modResources(options.subjectCatalog, path)),
      })
      const answer = await opener(path, signal)
      if (answer.snapshot.state !== 'opened' || answer.session === undefined) return undefined
      const session = answer.session
      try {
        const descriptor = await session.descriptor()
        if (
          !descriptor.dataSources.some(
            item => item.contract === 'common.view/model-resource-refs-source' && item.major === 1,
          )
        ) {
          return undefined
        }
        const lease = (await session.dataSource(
          'common.view/model-resource-refs-source',
          1,
        )) as Lease<ModelResourceRefsSource>
        try {
          const ids: string[] = []
          let cursor: string | undefined
          // ponytail: one place's worth; a publisher that names more is cut at this many.
          while (ids.length < 100_000) {
            const page = await lease.value.references(
              { limit: 1000, ...(cursor === undefined ? {} : { cursor }) },
              signal,
            )
            ids.push(...page.items.map(item => item.id))
            cursor = page.nextCursor
            if (cursor === undefined) break
          }
          return ids
        } finally {
          await lease.release()
        }
      } finally {
        await session.dispose()
      }
    },
  })
}

/** A subject's standard tree, or nothing (the session closed) when it publishes none. */
async function treeSubjectOf(
  session: AssetSession,
  path: string,
): Promise<VsCodeTreeSubject | undefined> {
  const descriptor = await session.descriptor()
  if (
    !descriptor.dataSources.some(
      item => item.contract === 'common.view/tree-data-source' && item.major === 1,
    )
  ) {
    await session.dispose()
    return undefined
  }
  return Object.freeze({
    path,
    async openTreeDataSource(openSignal?: AbortSignal) {
      throwIfAborted(openSignal)
      if (session.state() !== 'live') return undefined
      const lease = await session.dataSource('common.view/tree-data-source', 1)
      try {
        throwIfAborted(openSignal)
      } catch (error) {
        await lease.release()
        throw error
      }
      if (session.state() !== 'live') {
        await lease.release()
        return undefined
      }
      return lease
    },
    dispose: () => session.dispose(),
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
  /** Game-string locales, preferred first (`modkit.locale`); read at each open. */
  readonly gameLocales?: () => readonly string[]
  /** The window's content sources, so a world's models reach its dependency layers; undefined when none. */
  readonly contentSources?: () => Promise<ContentSources | undefined>
  /** Localizes host-owned diagnostics before they cross into VS Code's Problems UI. */
  readonly localizer?: UiLocalizer
  /**
   * Ask before a lossy write (a block-compressed texture re-encoded, say); `notes` are the plan's
   * own words on what is lost. Absent, such a save is refused as `confirmation-required`.
   */
  readonly confirmLossyWrite?: (notes: readonly string[]) => Promise<boolean>
  /** Confirm discarding unsaved work; a webview iframe cannot show a modal of its own. */
  readonly confirmClose?: (message: string, savable: boolean) => Promise<CloseAnswer>
  /**
   * A file-manager action inside a container (`container` may be a member archive): the adapter
   * asks for names, confirms deletes, owns the clipboard. `true` when the container changed.
   */
  readonly archiveAction?: (request: {
    readonly container: string
    readonly action: ArchiveAction
    readonly path: string
    readonly kind: ArchiveTarget['kind']
  }) => Promise<boolean>
  /** Open a file in an editor of its own kind (a gallery pick). */
  readonly openInEditor?: (path: string) => Promise<void>
  /** Show a card's source file as text, at its declaration when the line is known. */
  readonly openSource?: (uri: string, line?: number, column?: number) => Promise<void>
  /**
   * A small picture of one archive member for the explorer's gallery. The ref reaching it is
   * already authorized: a member of a container inside the granted folders.
   */
  readonly thumbnail?: (ref: string, maxEdge: number) => Promise<ShellThumbnail | undefined>
  /**
   * The folder a Modkit Explorer panel shows. The adapter lists, opens and draws its entries, so
   * the page names only ids this adapter handed out and paths under the one root it was given.
   */
  readonly explorer?: {
    children(path: string): Promise<readonly ShellExplorerEntry[]>
    open(id: string): Promise<void>
    thumbnail(id: string, maxEdge: number): Promise<ShellThumbnail | undefined>
  }
  /** Draw the mounted viewer's status items; `choose` reports a picked choice back to the page. */
  readonly viewerStatus?: (
    items: Extract<ShellRequest, { op: 'status-set' }>['items'],
    choose: (itemId: string, choiceId: string) => void,
  ) => void
  /**
   * Operations extensions published for a viewer surface, and how to run one.
   *
   * The adapter owns discovery and invocation (they need a grant and a runtime realm); the page
   * receives inert descriptors and sends back an operation id, its input and the pixels.
   */
  readonly viewerOperations?: {
    list(surface: string): Promise<readonly ViewerSurfaceOperation[]>
    run(
      operationId: string,
      input: unknown,
      image: { readonly width: number; readonly height: number; readonly rgba: Uint8Array },
    ): Promise<ViewerSurfaceOperationResult>
  }
  /**
   * Write viewer-produced export files somewhere this window owns, and say where they went.
   *
   * The adapter picks the destination; the page never names one. A host without this option makes
   * the page's export controls say so instead of failing at click time.
   */
  readonly exportFiles?: (
    files: readonly { readonly name: string; readonly bytes: Uint8Array }[],
    /** The granted subject the files were made from: write beside it (inside it, for a member). */
    beside?: string,
  ) => Promise<
    | { readonly state: 'written'; readonly names: readonly string[] }
    | { readonly state: 'refused'; readonly reason: string }
  >
  /**
   * The documents around an opened subject, for an operation that resolves across files.
   *
   * The page may not read a directory, and an operation invoked on one open file answers "not
   * found" about templates and strings that are plainly in the next file. The extension host has
   * the snapshot already — it is what the language features run on — so it answers here too, under
   * its own bounds. Absent, the page's stages report what they could not resolve.
   */
  readonly readWorkspaceDocuments?: (request: {
    readonly path?: string
    readonly languageIds?: readonly string[]
    readonly maxDocuments?: number
  }) => Promise<{
    readonly documents: readonly {
      readonly uri: string
      readonly languageId: string
      readonly version: number
      readonly text: string
    }[]
    readonly isComplete: boolean
  }>
  /** Native custom-document dirty state, emitted only for the provider's opened path. */
  readonly onDocumentDirty?: (path: string, dirty: boolean) => void
  /** Route an in-page Save button through VS Code's native save command. */
  readonly onDocumentSaveRequested?: (path: string) => void
  /** One committed edit in a view with its own history; becomes one editor undo-stack entry. */
  readonly onDocumentEdited?: (path: string) => void
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
  /** Where the time goes: the subject open is timed, and the page's own marks land here too. */
  readonly timing?: PhaseLog
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

/** One operation an extension published for a viewer surface, as the page receives it. */
export interface ViewerSurfaceOperation {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly sectionId: string
  readonly sectionTitle: string
  readonly icon?: string
  readonly inputSchema?: unknown
}

export type ViewerSurfaceOperationResult =
  | {
      readonly state: 'ok'
      readonly image: { readonly width: number; readonly height: number; readonly rgba: string }
    }
  | { readonly state: 'refused'; readonly reason: string }

export interface VsCodeServed {
  readonly bridge: Bridge
  readonly exposure: SubjectRpcExposure
  /** Ask the page to open this path in a tab. */
  open(path: string): void
  /**
   * Ask the mounted parent session to open one of its opaque nested subject references, on `stage`
   * (the card, the relations graph) when the subject offers it.
   */
  navigate(subjectId: string, stage?: string): void
  /**
   * Bring the codec this path needs up while the page is still loading.
   *
   * Opening an editor is two waits in sequence: the webview fetches and evaluates its bundle, and
   * the extension host detects the format, activates the codec and inspects the bytes. Nothing
   * makes them sequential except that the page asks second — so this runs the second one early,
   * under the same grant, and drops the session it opened. The realm it activated stays warm (see
   * `execution/warm-backend.ts`), which is what the page's own open then reuses.
   *
   * Best effort by construction: a failure here is not reported, because the real open will report
   * it properly a moment later.
   */
  warm(path: string): void
  /** Push the current granted folders; called again when the workspace changes. */
  publishRoots(): void
  /** Show one line in the page's status area (an extension that failed to load, say). */
  notice(text: string, severity?: 'info' | 'error'): void
  /** Ask the mounted editor buffer to commit; resolves only after the webview reports success. */
  saveDocument(path: string): Promise<void>
  /** The bytes a save would write, encoded by the page and not written; undefined when it cannot. */
  encodeDocument(path: string): Promise<Uint8Array | undefined>
  /** The editor's own Undo and Redo, forwarded to the view holding the pending edit. */
  undoDocument(path: string): Promise<void>
  redoDocument(path: string): Promise<void>
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
  /** Acquire the currently served subject's generic resource tree. */
  openTreeDataSource(signal?: AbortSignal): Promise<Lease<TreeDataSource> | undefined>
  /** The current subject's dependency operation surface for one language snapshot. */
  languageSubject():
    | Readonly<{
        descriptor: AnyDescriptor
        operations: OperationSession
        revision: string
      }>
    | undefined
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
  /** The window's mod contexts; a file on disk reaches the resources of its mod through them. */
  readonly subjectCatalog?: SubjectCatalogOptions
  readonly onRead?: (event: FileArtifactReadTelemetry) => void
  readonly onStream?: (event: FileArtifactStreamTelemetry) => void
}): SubjectOpener {
  return async (requested, signal) => {
    if (requested.startsWith('modkit-source:')) {
      if (!options.readContentSource) throw new Error('Content source provider is unavailable')
      return contentSourceOpener(
        options.services,
        options.readContentSource,
        DEFAULT_OPEN_BUDGET,
        options.subjectCatalog?.contentSources,
      )(requested, signal)
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
      ...(await modResources(options.subjectCatalog, requested)),
    })
    return opener(requested, signal)
  }
}

/**
 * An ordinary open's way to the resources of the file's mod (host `createContentAssetOrigin`): a
 * map on disk reaches its tileset in the installation, a resource-pack model its textures in the
 * game. The mod context opens only when a codec asks in that scope; without sources, nothing.
 */
async function modResources(
  catalog: SubjectCatalogOptions | undefined,
  path: string,
): Promise<Pick<PathSubjectOpenerOptions, 'contentSources' | 'baseMods'>> {
  const contentSources = await catalog?.contentSources()
  if (contentSources === undefined) return {}
  const target = resolve(path)
  const mods = catalog?.baseMods?.(target)
  // The setting's packages for this very path, keyed by it; the host's `baseModsFor` finds them.
  return { contentSources, ...(mods === undefined ? {} : { baseMods: { [target]: mods } }) }
}

/**
 * What every open in this window runs under; named so the container route cannot drift from it.
 *
 * `network` and `credentials` are here for the operations that cannot work without them — machine
 * translation of a localization catalog is the one MK2 shipped. They are operation-scoped: the gate
 * narrows every contribution to what its own manifest requests, so a codec that never asked for
 * them never receives them, and an operation that needs them is reported disabled rather than
 * failing at the click when this window is not allowed to reach the network.
 */
const DEFAULT_OPEN_GRANT: PermissionGrant = Object.freeze({
  id: 'vscode',
  classes: Object.freeze(['read-source' as const, 'network' as const, 'credentials' as const]),
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

/** A map member of a container opened into its world, with the inputs a served page's maps use. */
function mapMemberPreview(
  services: SubjectServices,
  inputs: NonNullable<VsCodeContainerOptions['mapPreview']>,
): NonNullable<ContainerRegistryOptions['prepareOpened']> {
  return async ({ opened, grant, budget, signal }) => {
    const contentSources = await inputs.contentSources?.()
    const preview = await prepareVsCodeMapPreview({
      services,
      opened,
      grant,
      budgets: budget,
      ...(inputs.localizer === undefined ? {} : { localizer: inputs.localizer }),
      ...(inputs.gameLocales === undefined ? {} : { locales: inputs.gameLocales() }),
      ...(contentSources === undefined ? {} : { contentSources }),
      ...(inputs.mapPreviewResourcePlanResolver === undefined
        ? {}
        : { resourcePlanResolver: inputs.mapPreviewResourcePlanResolver }),
      ...(signal === undefined ? {} : { signal }),
    })
    return preview.opened
  }
}

function serveVsCode(
  services: NodeSubjectServices,
  options: VsCodeServeOptions,
  composed: {
    readonly extensions: VsCodeExtensionReport
    readonly contributions: readonly ContributionRow[]
    readonly subjectCatalog?: SubjectCatalogOptions
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
  let languageSession:
    Readonly<{ generation: number; descriptor: AnyDescriptor; session: AssetSession }> | undefined

  const beginsSubjectOpen = (): number => {
    subjectGeneration += 1
    candidateSession = undefined
    languageSession = undefined
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
    languageSession = Object.freeze({ generation, descriptor, session })
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
  /**
   * Tokens this host issued after the person confirmed a lossy write, by the plan they confirmed.
   * Kept, not consumed: a redo of that write presents the same token for the same plan.
   */
  const lossyConfirmations = new Map<string, string>()
  /**
   * Editing for a container member: the codec's own operations (Path A) and the raw writer for
   * the hex and text editors, committed back into the container by `containerMemberEditingBackend`.
   * ponytail: no format-writer resolution (Path B) for members yet; add it when a member needs a
   * service writer rather than its codec.
   */
  const memberEditing = async (
    sessionId: string,
    session: AssetSession,
    location: { readonly container: string; readonly entry: string },
  ): Promise<SubjectEditing> => {
    const containers = options.containers
    if (containers === undefined) throw new TypeError('this window composed no containers')
    const descriptor = await session.descriptor()
    const sessionEvidence =
      descriptor.interpretation === 'codec'
        ? codecFidelityEvidenceRecords(services.inventory, {
            codecId: descriptor.identity.codecId,
            formatId: descriptor.identity.formatId,
          }).reduce((registry, record) => registry.with(record), evidence)
        : evidence
    const backend = containerMemberEditingBackend(containers, location.container, location.entry)
    return createSubjectEditing({
      opened: { state: 'opened', session, descriptor } as never,
      grant: { id: `vscode:${sessionId}`, classes: ['read-source', 'write-source'] },
      backendFor: () => backend,
      evidenceFor: plan => sessionEvidence.evidenceFor(plan),
      confirmationMatches: (token, plan) => lossyConfirmations.get(token) === plan.planId,
      writer: rawWriter,
    })
  }
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

  /** Paths already warmed in this window; warming twice buys nothing. */
  const warmed = new Set<string>()

  /** Codec-declared entries that stand for their source; read once per window. */
  const anchors = anchorDocumentIndex(services.inventory)

  const openSubject: SubjectOpener = async (requested, signal) => {
    const generation = beginsSubjectOpen()
    if (requested.startsWith('modkit-source:')) {
      if (!options.readContentSource) throw new Error('Content source provider is unavailable')
      const answer = await contentSourceOpener(
        services,
        options.readContentSource,
        options.budget ?? DEFAULT_OPEN_BUDGET,
        composed.subjectCatalog?.contentSources,
      )(
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
    const subjectRequested = anchoredSubjectPath(mapSelection?.path ?? requested, anchors)
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
        const location = parseContainerUriText(subjectRequested)
        if (answer.session !== undefined && location !== undefined) {
          rememberEditing(
            answer.snapshot.sessionId,
            await memberEditing(answer.snapshot.sessionId, answer.session, location),
          )
        }
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
        const finished = options.timing?.phase(
          `open ${subjectLabel(request.path)} (detect, activate codec, inspect)`,
        )
        const result = await services.open(request)
        finished?.()
        if (result.state === 'opened') {
          const contentSources = await options.contentSources?.()
          const preview = await prepareVsCodeMapPreview({
            services,
            opened: result,
            grant: request.grant,
            budgets: request.budget,
            ...(options.localizer === undefined ? {} : { localizer: options.localizer }),
            ...(options.gameLocales === undefined ? {} : { locales: options.gameLocales() }),
            ...(contentSources === undefined ? {} : { contentSources }),
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
    /*
     * A file this window may write is opened with the authority to write it.
     *
     * The codec's own edit operations run under the grant the subject was opened with, so a
     * read-only grant made every in-place edit refuse at the click — `write-source` missing —
     * however writable the file was. It is added only for a real file inside the granted roots: a
     * container member has nowhere to be written back to, and the gate still narrows the class to
     * contributions whose manifest asked for it. A container member is written back into its
     * container (see `containerMemberEditingBackend`); a remote content source is not writable.
     */
    const writable = !subjectRequested.startsWith('modkit-source:')
    const baseGrant = options.grant ?? DEFAULT_OPEN_GRANT
    const openGrant: PermissionGrant = writable
      ? {
          ...baseGrant,
          classes: Object.freeze([
            ...baseGrant.classes.filter(item => item !== 'write-source'),
            'write-source' as const,
          ]),
        }
      : baseGrant
    const opener = createPathSubjectOpener({
      subjects: capturing,
      roots: options.roots(),
      grant: openGrant,
      budget: options.budget ?? DEFAULT_OPEN_BUDGET,
      ...(await modResources(composed.subjectCatalog, subjectRequested)),
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
        // The subject's codec, and for a map inside its MPQ the carrier that writes every plan of it.
        sessionEvidence = subjectFidelityEvidenceRecords(services.inventory, {
          selected: opened.selected,
          descriptor: opened.descriptor,
          ...(opened.carrier?.descriptor.interpretation === 'codec'
            ? { carrier: { selected: opened.carrier.selected, descriptor: opened.carrier.descriptor } }
            : {}),
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
        confirmationMatches: (token, plan) => lossyConfirmations.get(token) === plan.planId,
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
    confirm: async plan => {
      if (!(await options.confirmLossyWrite?.(plan.fidelity.notes ?? []))) return undefined
      const token = randomUUID()
      lossyConfirmations.set(token, plan.planId)
      return token
    },
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
      case 'open-in-editor': {
        const container = containerOfSubject(request.path)
        const roots = options.roots().map(root => resolve(root))
        if (!withinRoots(roots, splitContainer(container).file))
          throw new Error('that file is outside the granted folders')
        await options.openInEditor?.(
          request.entry === undefined ? request.path : containerUriText(container, request.entry),
        )
        return true
      }
      case 'open-source':
        await options.openSource?.(request.uri, request.line, request.column)
        return true
      case 'archive-action': {
        const container = containerOfSubject(request.subject)
        const roots = options.roots().map(root => resolve(root))
        if (!withinRoots(roots, splitContainer(container).file))
          throw new Error('that archive is outside the granted folders')
        return (
          (await options.archiveAction?.({
            container,
            action: request.action,
            path: request.path,
            kind: request.kind,
          })) ?? false
        )
      }
      case 'thumbnail': {
        const maxEdge = Math.min(256, Math.max(16, Math.floor(Number(request.maxEdge) || 96)))
        if (request.explorerId !== undefined) {
          return (await options.explorer?.thumbnail(request.explorerId, maxEdge)) ?? null
        }
        if (request.path === undefined || request.entry === undefined) return null
        const container = containerOfSubject(request.path)
        if (!withinRoots(roots, splitContainer(container).file))
          throw new Error('that archive is outside the granted folders')
        return (
          (await options.thumbnail?.(containerUriText(container, request.entry), maxEdge)) ?? null
        )
      }
      case 'explorer-children':
        if (options.explorer === undefined) throw new Error('this page is not a Modkit Explorer')
        return options.explorer.children(request.path)
      case 'explorer-open':
        if (options.explorer === undefined) throw new Error('this page is not a Modkit Explorer')
        await options.explorer.open(request.id)
        return true
      case 'viewer-operations':
        return (await options.viewerOperations?.list(request.surface)) ?? []
      case 'viewer-operation-run': {
        if (options.viewerOperations === undefined) {
          return { state: 'refused', reason: 'this window publishes no viewer operations' }
        }
        const rgba = Uint8Array.from(atob(request.image.rgba), character => character.charCodeAt(0))
        const outcome = await options.viewerOperations.run(request.operationId, request.input, {
          width: request.image.width,
          height: request.image.height,
          rgba,
        })
        return outcome
      }
      case 'status-set':
        options.viewerStatus?.(
          Array.isArray(request.items) ? request.items : [],
          (itemId, choiceId) => bridge.emit({ op: 'status-choose', itemId, choiceId }),
        )
        return true
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
        const beside =
          request.beside !== undefined &&
          withinRoots(
            options.roots().map(root => resolve(root)),
            splitContainer(containerOfSubject(request.beside)).file,
          )
            ? request.beside
            : undefined
        return await options.exportFiles(
          files.map(file => ({ name: file.name, bytes: file.bytes })),
          beside,
        )
      }
      case 'workspace-documents': {
        if (options.readWorkspaceDocuments === undefined)
          return { documents: [], isComplete: false }
        return await options.readWorkspaceDocuments({
          ...(request.path === undefined ? {} : { path: request.path }),
          ...(request.languageIds === undefined ? {} : { languageIds: request.languageIds }),
          ...(request.maxDocuments === undefined ? {} : { maxDocuments: request.maxDocuments }),
        })
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
    } else if (event.op === 'document-edited') {
      options.onDocumentEdited?.(event.path)
    } else if (event.op === 'timing') {
      options.timing?.mark(`page ${event.name}`, event.milliseconds)
    }
  })

  return {
    bridge,
    exposure,
    open(path: string) {
      bridge.emit({ op: 'open', path: subjectKey(path), name: subjectLabel(path) })
    },
    navigate(subjectId: string, stage?: string) {
      bridge.emit({ op: 'navigate-subject', subjectId, ...(stage === undefined ? {} : { stage }) })
    },
    warm(path: string) {
      if (warmed.has(subjectKey(path))) return
      warmed.add(subjectKey(path))
      const started = performance.now()
      void openSubject(path)
        .then(async answer => {
          await answer.session?.dispose()
          options.timing?.mark(
            `warm ${subjectLabel(path)} (codec realm ready)`,
            performance.now() - started,
          )
        })
        .catch(() => undefined)
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
    async encodeDocument(path: string) {
      const answer = await bridge.request({ op: 'document-encode', path: subjectKey(path) })
      return typeof answer === 'string' ? new Uint8Array(Buffer.from(answer, 'base64')) : undefined
    },
    async undoDocument(path: string) {
      await bridge.request({ op: 'document-undo', path: subjectKey(path) }).catch(() => undefined)
    },
    async redoDocument(path: string) {
      await bridge.request({ op: 'document-redo', path: subjectKey(path) }).catch(() => undefined)
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
    async openTreeDataSource(signal?: AbortSignal) {
      throwIfAborted(signal)
      const selected = languageSession
      if (
        selected === undefined ||
        selected.generation !== subjectGeneration ||
        selected.session.state() !== 'live' ||
        !selected.descriptor.dataSources.some(
          item => item.contract === 'common.view/tree-data-source' && item.major === 1,
        )
      ) {
        return undefined
      }
      let lease: Lease<TreeDataSource>
      try {
        lease = await selected.session.dataSource('common.view/tree-data-source', 1)
      } catch (error) {
        if (languageSession !== selected || selected.session.state() !== 'live') return undefined
        throw error
      }
      try {
        throwIfAborted(signal)
      } catch (error) {
        await lease.release()
        throw error
      }
      if (
        languageSession !== selected ||
        selected.generation !== subjectGeneration ||
        selected.session.state() !== 'live'
      ) {
        await lease.release()
        return undefined
      }
      return lease
    },
    languageSubject() {
      const selected = languageSession
      return selected === undefined ||
        selected.generation !== subjectGeneration ||
        selected.session.state() !== 'live'
        ? undefined
        : Object.freeze({
            descriptor: selected.descriptor,
            operations: selected.session.operations(),
            revision: String(selected.session.revision),
          })
    },
    async close(reason: string) {
      subjectGeneration += 1
      candidateSession = undefined
      languageSession = undefined
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
