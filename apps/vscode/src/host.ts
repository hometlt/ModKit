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
import type { Diagnostic } from '@modkit/core'
import { sceneModule } from '@modkit/scene/module'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import { uvModule } from '@modkit/uv/module'
import type { MapPreviewResourcePlanResolver } from '@modkit/host/maps'
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
  type NodeSubjectServices,
} from '@modkit/host/node'

import { STAGE_ORDER } from './view-policy.js'

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

/** Entries a single directory listing will return before it stops. */
export const VSCODE_MAXIMUM_LISTING = 5_000

/** How many editing arms are kept alive at once; see `rememberEditing`. */
const MAXIMUM_LIVE_EDITING_ARMS = 256

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
      }),
    serve: (served: VsCodeServeOptions) =>
      serveVsCode(services, served, { extensions, contributions }),
  })
}

// ---------------------------------------------------------------------------------------------
// serving one webview

export interface VsCodeServeOptions {
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
  readonly services: NodeSubjectServices
  readonly roots: () => readonly string[]
  readonly containers?: ContainerRegistry
}): SubjectOpener {
  return async (requested, signal) => {
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
  maxInputBytes: BigInt(VSCODE_MAXIMUM_SUBJECT_BYTES),
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
    try {
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
                  await leasedSession.dispose()
                  if (!released) {
                    released = true
                    await writerResolution.release?.()
                  }
                },
              }),
            })
      rememberEditing(sessionId, editingForSession)
    } catch (error) {
      await writerResolution.release?.()
      // A subject shape editing does not support yet (a bundle, a namespace) still opens
      // read-only; the page sees `edit()` refuse and hides the editor stages.
      options.onDiagnostic?.({
        code: 'x3.app/vscode-subject-not-editable',
        message: `${basename(subjectRequested)} opened without an editing arm: ${describe(error)}`,
      })
    }
    return answer
  }

  const exposure = exposeSubjectRpc({
    framePort: bridge.framePort,
    session: options.session,
    open: openSubject,
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
        return isContainerUriText(request.path)
          ? readContainerEntry(options.containers, request.path, request.maxBytes)
          : readEntry(roots, request.path, request.maxBytes)
      case 'confirm':
        // No adapter means no way to ask, and discarding silently is the one answer that loses
        // work — so an unanswerable prompt keeps the tab open.
        return (await options.confirmClose?.(request.message, request.savable)) ?? 'cancel'
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
    async close(reason: string) {
      bridge.dispose()
      editingBySession.clear()
      await exposure.close(reason)
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
  return isContainerUriText(path) ? path : resolve(path)
}

/**
 * What this subject is called out loud.
 *
 * For a member, the container's own file name and the member's path inside it — never the
 * container's absolute path, which is what the owner's screenshot caught the old footer printing.
 * The URI keeps the absolute path (it has to address something), the label does not.
 */
export function subjectLabel(path: string): string {
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
   * A checkout's own tree stays before the packaged location for development fidelity. A production
   * VSIX instead carries the same generated roots under `dist-app/extensions` together with their
   * physical `node_modules` closure, so it can run with no checkout or workspace links. `existsSync`
   * keeps the ordering safe for a real package, where only the packaged candidate normally survives.
   */
  const candidates = [join(extensionRoot, 'extensions')]
  if (repositoryRoot !== undefined) candidates.push(join(repositoryRoot, 'extensions'))
  candidates.push(join(extensionRoot, 'dist-app', 'extensions'))
  return Object.freeze(candidates.filter(path => existsSync(path)))
}
