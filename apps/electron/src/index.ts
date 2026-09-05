import { compareUtf8, ModkitError, uint64, type Diagnostic } from '@modkit/core'
export { ModkitError }
import { codeModule } from '@modkit/code/module'
import { sceneModule } from '@modkit/scene/module'
import { uvModule } from '@modkit/uv/module'
import {
  extensionSubjectRecordToWire,
  projectExtensionSubjects,
  type ExtensionSubjectCardWireDocument,
} from '@modkit/extension-manager'
import {
  createHostTopology,
  type AnyDescriptor,
  type HostTopology,
  type PresentationPlan,
} from '@modkit/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createHostComposition,
  createSubjectServices,
  EXTENSION_DISABLED_CODE,
  linkedExtensionInputs,
  nestedSubjectServices,
  openNestedSubject,
  openNestedSubjectRef,
  registerServiceDefinitionsOrThrow,
  resolveCommonPresentationPlan,
  serviceDefinitionSurfaces,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type ExtensionOrigin,
  type HostComposition,
  type Inventory,
  type SubjectOpenRequest,
  type SubjectServices,
} from '@modkit/host'
import { STAGE_ORDER } from './view-policy.js'
import {
  createNodeExecutionBackends,
  loadExtensionRoots,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
  type ExtensionRootFailure,
  type ExtensionRootRequest,
  type WorkerBackendPolicy,
} from '@modkit/host/node'

const ELECTRON_BUILTIN_MODULES = /* @__PURE__ */ linkedExtensionInputs([
  codeModule,
  sceneModule,
  uvModule,
])

export {
  connectElectronSubjectRpc,
  createElectronNestedSubjectNavigator,
  exposeElectronSubjectRpc,
  ELECTRON_SUBJECT_SERVICES,
  ELECTRON_SUBJECT_SERVICES_URL,
  type ElectronSubjectOpener,
  type ElectronNestedSubjectNavigatorOptions,
  type SubjectClientOpenResult,
  type SubjectOpenSnapshot,
  type SubjectOpenedSnapshot,
  type SubjectPreviewSession,
  type SubjectRpcClient,
  type SubjectRpcExposure,
  type SubjectUnresolvedSnapshot,
} from './subject-rpc.js'

export {
  prepareElectronMapPreview,
  type ElectronMapPreviewCandidate,
  type PreparedElectronMapPreview,
  type PrepareElectronMapPreviewRequest,
} from './map-preview.js'

export {
  createElectronLocalizer,
  createElectronLocalizerFromCatalogLoader,
  ELECTRON_UI_CATALOGS,
  type ElectronLocalizationCatalogLoader,
} from './localization.js'
export {
  loadElectronLocalization,
  type ElectronLocalizationSnapshot,
} from './localization-loader.js'

export {
  createElectronExtensionManagerBackend,
  readElectronManagedExtensionState,
  type ElectronExtensionManagerBackend,
  type ElectronExtensionManagerBackendOptions,
  type ElectronManagedExtensionState,
} from './extension-manager-main.js'

export {
  composeElectronExtensionRoots,
  ELECTRON_MANAGED_COORDINATE_CONFLICT,
  ELECTRON_MANUAL_MANAGED_COORDINATE_CONFLICT,
  type ElectronComposedExtensionRoot,
  type ElectronExtensionRootComposition,
  type ElectronExtensionRootCompositionOptions,
  type ElectronExtensionRootConflict,
  type ElectronManagedExtensionRoot,
  type ElectronManualExtensionRoot,
} from './extension-root-composition.js'

export {
  continueElectronMapPreviewSelection,
  electronMapPreviewSelectionRequest,
  parseElectronMapPreviewSelectionRequest,
  type ElectronMapPreviewSelectionRequest,
} from './map-preview-selection.js'

export const ELECTRON_MAIN_REALM = 'modkit.app.electron/main'
export const ELECTRON_RENDERER_REALM = 'modkit.app.electron/renderer'
/**
 * Where codecs run: the worker threads of the main process (W4 in IMPLEMENTATION_NOTES). Portable
 * variants are resolved and activated for this realm; the renderer keeps receiving leases through
 * the preload broker (renderer ↔ main ↔ worker) and never hosts codec code.
 */
export const ELECTRON_WORKER_REALM = 'modkit.app.electron/worker'

/** Worker policy of the Electron main process (within the host ceilings, refused above them). */
export const ELECTRON_WORKER_POLICY: WorkerBackendPolicy = workerBackendPolicy({
  resourceLimits: {
    maxOldGenerationSizeMb: 1024,
    maxYoungGenerationSizeMb: 128,
    codeRangeSizeMb: 128,
    stackSizeMb: 8,
  },
  loadDeadlineMs: 20_000,
  defaultCallDeadlineMs: 60_000,
  graceMs: 2_000,
  outputCapBytes: 256 * 1024,
  maxRestartsPerLease: 3,
})

/** Safe BrowserWindow defaults. The Electron adapter spreads these last and never weakens them. */
export const ELECTRON_SECURE_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
} as const)

/**
 * Broker channels the renderer may name.
 *
 * There is no whole-file write here on purpose. Saving goes through the subject RPC's editing arm
 * (S14), where main holds the grant, the commit coordinator, the file backend and every prepared
 * commit; a `filesystem.write-file` channel beside it would be a second write authority with none
 * of that — no revision check, no fidelity evidence, no receipt — and the renderer would choose
 * between them. `filesystem.atomic-replace` is the handle-based facility operation, not a path the
 * renderer can name.
 */
export const ELECTRON_BROKER_CHANNELS = Object.freeze([
  'filesystem.read-range',
  'filesystem.atomic-replace',
  'dialog.open-file',
  'dialog.open-directory',
  'dialog.accept-drop',
  'dialog.reopen-recent',
  'directory.list',
  'filesystem.read-file',
  'process.launch',
] as const)

export type ElectronBrokerChannel = (typeof ELECTRON_BROKER_CHANNELS)[number]

export type ElectronBrokerRequest =
  | {
      readonly channel: 'filesystem.read-range'
      readonly payload: {
        readonly handleId: string
        readonly offset: number
        readonly length: number
      }
    }
  | {
      readonly channel: 'filesystem.atomic-replace'
      readonly payload: { readonly handleId: string; readonly bytes: Uint8Array }
    }
  | { readonly channel: 'dialog.open-file'; readonly payload: { readonly requestId: string } }
  | { readonly channel: 'dialog.open-directory'; readonly payload: { readonly requestId: string } }
  | {
      readonly channel: 'dialog.accept-drop'
      readonly payload: { readonly paths: readonly string[] }
    }
  | { readonly channel: 'dialog.reopen-recent'; readonly payload: { readonly path: string } }
  | { readonly channel: 'directory.list'; readonly payload: { readonly path: string } }
  | {
      readonly channel: 'filesystem.read-file'
      readonly payload: { readonly path: string; readonly maxBytes: number }
    }
  | {
      readonly channel: 'process.launch'
      readonly payload: { readonly toolId: string; readonly args: readonly string[] }
    }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
}

export function isElectronBrokerRequest(value: unknown): value is ElectronBrokerRequest {
  if (!record(value) || !text(value['channel']) || !record(value['payload'])) return false
  const payload = value['payload']
  switch (value['channel']) {
    case 'filesystem.read-range':
      return (
        text(payload['handleId']) &&
        Number.isSafeInteger(payload['offset']) &&
        Number(payload['offset']) >= 0 &&
        Number.isSafeInteger(payload['length']) &&
        Number(payload['length']) >= 0
      )
    case 'filesystem.atomic-replace':
      return text(payload['handleId']) && payload['bytes'] instanceof Uint8Array
    case 'dialog.open-file':
    case 'dialog.open-directory':
      return text(payload['requestId'])
    case 'dialog.accept-drop':
      return (
        Array.isArray(payload['paths']) &&
        payload['paths'].length > 0 &&
        payload['paths'].length <= 64 &&
        payload['paths'].every(item => text(item))
      )
    case 'dialog.reopen-recent':
    case 'directory.list':
      return text(payload['path'])
    case 'filesystem.read-file':
      return (
        text(payload['path']) &&
        Number.isSafeInteger(payload['maxBytes']) &&
        Number(payload['maxBytes']) > 0
      )
    case 'process.launch':
      return (
        text(payload['toolId']) &&
        Array.isArray(payload['args']) &&
        payload['args'].length <= 128 &&
        payload['args'].every(item => typeof item === 'string' && item.length <= 4096)
      )
    default:
      return false
  }
}

export function assertElectronBrokerRequest(value: unknown): ElectronBrokerRequest {
  if (!isElectronBrokerRequest(value)) {
    throw new ModkitError({
      code: 'x3.app/invalid-electron-broker-request',
      message: 'renderer sent a malformed or non-allowlisted Electron broker request',
    })
  }
  return value
}

export function isAllowedElectronNavigation(target: string, applicationOrigin: string): boolean {
  try {
    const targetUrl = new URL(target)
    const originUrl = new URL(applicationOrigin)
    return targetUrl.origin === originUrl.origin && targetUrl.protocol === originUrl.protocol
  } catch {
    return false
  }
}

export function createElectronTopology(): HostTopology {
  const node = nodeRuntimeTargetBase()
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'modkit.app/electron',
    realms: [
      {
        schemaVersion: 1,
        realmId: ELECTRON_MAIN_REALM,
        revision: '1',
        target: node,
        facilities: [
          'credential.broker',
          'dialog.file-picker',
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native-process.rpc',
          'native.load',
          'process.launch',
          'window.custom-chrome',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 8,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('1073741824'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'modkit.policy/electron-main', revision: '1' },
      },
      {
        schemaVersion: 1,
        realmId: ELECTRON_RENDERER_REALM,
        revision: '1',
        target: {
          environment: 'browser-main',
          operatingSystem: node.operatingSystem,
          architecture: node.architecture,
        },
        facilities: ['gpu.webgl2', 'worker.module'],
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('2147483648'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'modkit.policy/electron-renderer', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: ELECTRON_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 8,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('4294967296'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'modkit.policy/electron-worker', revision: '1' },
      }),
    ],
    links: [
      {
        fromRealm: ELECTRON_RENDERER_REALM,
        toRealm: ELECTRON_MAIN_REALM,
        transports: ['rpc-handle', 'stream', 'structured-clone', 'transferable-buffer'],
      },
      {
        fromRealm: ELECTRON_MAIN_REALM,
        toRealm: ELECTRON_RENDERER_REALM,
        transports: ['rpc-handle', 'stream', 'structured-clone', 'transferable-buffer'],
      },
      ...nodeWorkerLinks(ELECTRON_MAIN_REALM, ELECTRON_WORKER_REALM),
    ],
  })
}

export interface ElectronApp {
  readonly topology: HostTopology
  readonly main: HostComposition
  readonly renderer: HostComposition
  /** The realm codecs run in (worker threads of main); `open` resolves for its target. */
  readonly workers: HostComposition
  /** One registry for main and workers: the activation target picks the backend. */
  readonly executionBackends: ExecutionBackendRegistry
}

export interface ElectronAppOptions {
  /** Defaults to the trusted in-process backend plus the Node worker backend under `ELECTRON_WORKER_POLICY`. */
  readonly executionBackends?: ExecutionBackendRegistry
  /** Backend diagnostics (worker shared-process notice, restarts, crashes, capped worker stdio). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * Contribution ids the user switched off. Applied to all three realms so the renderer's snapshot
   * and the worker realm agree with the inventory resolution runs against.
   */
  readonly disabledContributions?: readonly string[]
  /** Extension coordinates stay inventoried but none of their contributions may activate. */
  readonly disabledExtensions?: readonly string[]
}

/** What loaded from where, and what did not — the settings UI and the status bar report it. */
export interface ElectronExtensionReport {
  /** Coordinates of the bundled first-party catalog. */
  readonly bundled: readonly string[]
  /** Coordinates of the user's own extensions that loaded. */
  readonly installed: readonly string[]
  /** Roots that did not load, with the reason (a broken one never stops the others). */
  readonly failures: readonly ExtensionRootFailure[]
}

/** The host's subject services (S7) plus the Electron application they were built from. */
export interface ElectronSubjectServices extends SubjectServices {
  readonly application: ElectronApp
  readonly extensions: ElectronExtensionReport
}

/** One open request as the main process issues it (re-exported for the RPC and the tests). */
export type ElectronSubjectOpenRequest = SubjectOpenRequest

/** Resolve the shared manifest-generated stage catalog against one already-opened session. */
export async function resolveElectronPresentationPlan(
  descriptor: AnyDescriptor,
  selection: {
    readonly sessionId: string
    readonly contributionId: string
    readonly variantId: string
  },
  options: { readonly sourceBytes?: bigint } = {},
): Promise<PresentationPlan> {
  const resolved = await resolveCommonPresentationPlan(
    descriptor,
    {
      sessionId: selection.sessionId,
      providerId: selection.contributionId,
      variantId: selection.variantId,
    },
    {
      availableStageIds: STAGE_ORDER,
      ...(options.sourceBytes === undefined ? {} : { sourceBytes: options.sourceBytes }),
    },
  )
  if (resolved === undefined) {
    throw new ModkitError({
      code: 'x3.host/presentation-fallback-missing',
      message: 'no registered Electron stage is eligible for the opened subject',
    })
  }
  return resolved.plan
}

export async function createElectronApp(
  extensions: readonly ExtensionInput[] = [],
  options: ElectronAppOptions = {},
): Promise<ElectronApp> {
  const topology = createElectronTopology()
  const composedExtensions = [...ELECTRON_BUILTIN_MODULES.inputs, ...extensions]
  const executionBackends =
    options.executionBackends ??
    createNodeExecutionBackends({
      policy: ELECTRON_WORKER_POLICY,
      linkedModules: ELECTRON_BUILTIN_MODULES.modules,
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    })
  const disabled = {
    ...(options.disabledContributions === undefined
      ? {}
      : { disabledContributions: options.disabledContributions }),
    ...(options.disabledExtensions === undefined
      ? {}
      : { disabledExtensions: options.disabledExtensions }),
  }
  const [main, renderer, workers] = await Promise.all([
    createHostComposition({
      topology,
      realmId: ELECTRON_MAIN_REALM,
      extensions: composedExtensions,
      executionBackends,
      ...disabled,
    }),
    createHostComposition({
      topology,
      realmId: ELECTRON_RENDERER_REALM,
      extensions: composedExtensions,
      ...disabled,
    }),
    createHostComposition({
      topology,
      realmId: ELECTRON_WORKER_REALM,
      extensions: composedExtensions,
      executionBackends,
      ...disabled,
    }),
  ])
  return Object.freeze({ topology, main, renderer, workers, executionBackends })
}

/**
 * Load the generated first-party catalog into the privileged realm and prepare the one subject-open
 * pipeline used by Electron. The caller supplies explicit roots from the generated catalog; this
 * helper never scans the repository or trusts installed extensions in-process; code, scene and UV
 * are explicit product imports composed separately from the generated extension catalog.
 */
export interface ElectronSubjectServicesOptions {
  /** Backend diagnostics of the worker realm (shared-process notice, restarts, crashes, worker stdio). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
  /**
   * Extensions the user connected (settings). They are `installed` artifacts: never admitted to
   * the in-process boundary, and a broken one is reported instead of stopping the application.
   */
  readonly userRoots?: readonly (string | ExtensionRootRequest)[]
  /**
   * Contribution ids the user switched off (settings). They stay in the inventory, lose
   * `activationEligible`, and carry `x3.host/contribution-disabled` — so the settings page can
   * show the switch in its off position and the inspector can say why nothing resolved.
   */
  readonly disabledContributions?: readonly string[]
  /** Extension coordinates switched off without removing their inventory or cards. */
  readonly disabledExtensions?: readonly string[]
}

/**
 * Contribution ids the user switched off in the settings document.
 *
 * Threaded straight into `createHostComposition`, which keeps the record in the inventory with
 * `activationEligible: false` and the `x3.host/contribution-disabled` diagnostic. That is the
 * whole point: a codec the user turned off must still be *listed*, or the settings page has no
 * switch to turn back on.
 */
export const CONTRIBUTION_DISABLED_CODE = 'x3.host/contribution-disabled'

/** One contribution as a settings page lists it: identity, kind, owner and switch position. */
export interface ElectronContributionRow {
  /** Qualified contribution id. Absent when the envelope did not parse — then there is no switch. */
  readonly id?: string
  readonly displayName: string
  /** The contract it implements (`modkit/codec-contribution`) and that contract's major. */
  readonly contract?: string
  readonly contractMajor?: number
  /** `publisher/id` of the extension that ships it. */
  readonly extension: string
  readonly origin: ExtensionOrigin
  readonly activationEligible: boolean
  /** True when the host refused activation because this contribution is switched off. */
  readonly disabled: boolean
  /** The direct contribution preference is retained even while its owner extension is off. */
  readonly extensionDisabled: boolean
  /** Manifest path inside the extension — the only identity an unparsed record has. */
  readonly path: string
}

/**
 * Flatten the inventory into the rows a settings page draws, sorted by owner then id.
 *
 * Every contribution is listed, including the ones the host refused: a page that showed only what
 * activated could never offer the switch that turns a disabled codec back on.
 */
export function describeInventoryContributions(
  inventory: Inventory,
): readonly ElectronContributionRow[] {
  const rows = inventory.extensions.flatMap(extension => {
    const owner = `${extension.manifest.publisher}/${extension.manifest.id}`
    return extension.contributions.map((contribution): ElectronContributionRow => {
      const manifest = contribution.manifest
      return {
        ...(manifest === undefined ? {} : { id: manifest.id }),
        displayName: manifest?.displayName ?? contribution.path,
        ...(manifest === undefined
          ? {}
          : { contract: manifest.contract.id, contractMajor: manifest.contract.major }),
        extension: owner,
        origin: extension.origin,
        activationEligible: contribution.activationEligible,
        disabled: contribution.diagnostics.some(item => item.code === CONTRIBUTION_DISABLED_CODE),
        extensionDisabled: contribution.diagnostics.some(
          item => item.code === EXTENSION_DISABLED_CODE,
        ),
        path: contribution.path,
      }
    })
  })
  return Object.freeze(
    rows.sort((left, right) => {
      const owner = compareUtf8(left.extension, right.extension)
      return owner === 0 ? compareUtf8(left.id ?? left.path, right.id ?? right.path) : owner
    }),
  )
}

/**
 * Function-free extension and contribution cards derived only from the host's validated inventory.
 *
 * Renderer code must not reopen extension manifests or learn artifact paths. The inventory already
 * owns the admitted JSON declarations, so main projects those declarations through the same neutral
 * subject ABI every other Modkit host uses and sends only inert card documents across IPC. Extension
 * enablement is an explicit coordinate set because an extension with zero valid contributions has
 * no child diagnostic from which state could be inferred.
 */
export async function describeInventoryExtensionSubjects(
  inventory: Inventory,
  disabledExtensions: readonly string[] = Object.freeze([]),
): Promise<readonly ExtensionSubjectCardWireDocument[]> {
  const documents: ExtensionSubjectCardWireDocument[] = []
  const disabled = new Set(disabledExtensions)
  for (const extension of inventory.extensions) {
    const extensionId = `${extension.manifest.publisher}/${extension.manifest.id}`
    const contributions = extension.contributions.flatMap(contribution =>
      contribution.manifest === undefined ? [] : [contribution.manifest],
    )
    const contributionEnablement = Object.fromEntries(
      extension.contributions.flatMap(contribution => {
        const id = contribution.manifest?.id
        return id === undefined
          ? []
          : [
              [
                id,
                !contribution.diagnostics.some(
                  diagnostic => diagnostic.code === CONTRIBUTION_DISABLED_CODE,
                ),
              ] as const,
            ]
      }),
    )
    const projection = projectExtensionSubjects({
      extension: extension.manifest,
      contributions,
      metadata: {
        displayName: `${extension.manifest.publisher}/${extension.manifest.id}`,
        source: extension.origin,
      },
      enabled: !disabled.has(extensionId),
      contributionEnablement,
    })
    documents.push(
      ...(await Promise.all(
        projection.records.map(record => extensionSubjectRecordToWire(record)),
      )),
    )
  }
  return Object.freeze(documents)
}

/**
 * The host's own "this codec is switched off" diagnostics for the codecs that declare this file's
 * extension.
 *
 * A disabled contribution never becomes a resolution candidate, so an unresolved open carries no
 * candidate diagnostics at all and the application would have nothing to show but "no codec
 * claimed it" — which is true and useless, because the user is the one who switched the codec off
 * thirty seconds earlier.
 *
 * The filter reads `spec.match.extensions`, the same declared hint `supportedExtensionHints` reads
 * for file pickers. It is a *hint* used to explain, never to decide: nothing here selects a codec
 * or changes an outcome, and the diagnostics returned are the host's own objects, with the host's
 * own code and wording, passed through unchanged.
 */
export function disabledContributionNotices(
  inventory: Inventory,
  path: string,
): readonly Diagnostic[] {
  const dot = path.lastIndexOf('.')
  const suffix = dot < 0 ? '' : path.slice(dot + 1).toLowerCase()
  if (suffix === '') return Object.freeze([])
  const notices = inventory.extensions.flatMap(extension =>
    extension.contributions.flatMap(contribution => {
      const manifest = contribution.manifest
      if (manifest?.contract.id !== 'modkit/codec-contribution') return []
      const spec = manifest.spec as { readonly match?: { readonly extensions?: unknown } }
      const hints = Array.isArray(spec.match?.extensions) ? spec.match.extensions : []
      if (!hints.some(hint => typeof hint === 'string' && hint.toLowerCase() === suffix)) return []
      return contribution.diagnostics.filter(item => item.code === CONTRIBUTION_DISABLED_CODE)
    }),
  )
  return Object.freeze(notices)
}

/** What probing one directory answered: the coordinate it declares, or why it is not usable. */
export type ElectronExtensionProbe =
  | { readonly state: 'extension'; readonly root: string; readonly id: string }
  | {
      readonly state: 'refused'
      readonly root: string
      readonly code: string
      readonly message: string
    }

/**
 * Ask what a directory the user picked actually is, before it is written into the settings file.
 *
 * The settings document keys an extension by identity, and only the directory knows its own
 * coordinate — so the answer has to come from the loader rather than from a guess at the folder
 * name. `claimed` is passed so a directory that duplicates something already loaded is refused
 * here, with the loader's own words, instead of being written and then silently ignored at the
 * next composition.
 */
export async function probeElectronExtensionRoot(
  root: string,
  claimed: readonly string[] = [],
): Promise<ElectronExtensionProbe> {
  const loaded = await loadExtensionRoots([{ root }], { origin: 'installed', claimed })
  const coordinate = loaded.coordinates[0]
  if (coordinate !== undefined) return { state: 'extension', root, id: coordinate }
  const failure = loaded.failures[0]
  return {
    state: 'refused',
    root,
    code: failure?.code ?? 'x3.host/extension-root-unreadable',
    message: failure?.message ?? 'the directory could not be read',
  }
}

export async function createElectronSubjectServices(
  extensionRoots: readonly string[],
  options: ElectronSubjectServicesOptions = {},
): Promise<ElectronSubjectServices> {
  // the generated first-party catalog: this build vouches for these exact directories
  const bundledRoots = await loadExtensionRoots(extensionRoots, {
    origin: 'bundled',
    allowTrustedInProcess: true,
  })
  // whatever the user connected: installed artifacts, never trusted in-process, and a coordinate
  // the bundled catalog already owns is refused rather than shadowing it
  const userRoots = await loadExtensionRoots(options.userRoots ?? [], {
    origin: 'installed',
    claimed: bundledRoots.coordinates,
  })
  const bundled: readonly ExtensionInput[] = [...bundledRoots.inputs, ...userRoots.inputs]
  const extensions: ElectronExtensionReport = Object.freeze({
    bundled: bundledRoots.coordinates,
    installed: userRoots.coordinates,
    failures: Object.freeze([...bundledRoots.failures, ...userRoots.failures]),
  })
  // Only generated first-party inputs reach this registry (bundled: every inventoried owner is a
  // namespace owner). Installed/linked extensions are never promoted by this bootstrap and need
  // an explicit namespace-delegation policy later. The registry is filled after composition; the
  // worker backend reads the surfaces at every spawn, so binding it first is fine.
  const definitions = createBundledServiceDefinitionRegistry()
  const executionBackends = createNodeExecutionBackends({
    policy: ELECTRON_WORKER_POLICY,
    linkedModules: ELECTRON_BUILTIN_MODULES.modules,
    foreignSurfaces: () => serviceDefinitionSurfaces(definitions),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  const application = await createElectronApp(bundled, {
    executionBackends,
    ...(options.disabledContributions === undefined
      ? {}
      : { disabledContributions: options.disabledContributions }),
    ...(options.disabledExtensions === undefined
      ? {}
      : { disabledExtensions: options.disabledExtensions }),
  })
  await registerServiceDefinitionsOrThrow(application.main.inventory, definitions)
  // codecs are resolved against main's inventory and activated for the worker realm: portable
  // variants, worker-brokered; the gate refuses (never downgrades) a candidate without a boundary
  const services = createSubjectServices({
    inventory: application.main.inventory,
    target: application.workers.target,
    executionBackends: application.executionBackends,
    serviceDefinitions: definitions,
  })
  return Object.freeze({ ...services, application, extensions })
}

/*
 * R6: the renderer's subject traffic is capability-RPC (see ./subject-rpc.ts). The old
 * `ElectronSubjectRequest` validator and its bounded-clone walker are gone with the IPC they
 * guarded — frame validation now happens in the protocol core on both sides of the port.
 */

export { createGrantedRoots, type GrantedRoots, type PathTools } from './roots.js'
// S14: main owns the editing authority (backend, grant, writer, prepared commits) and hands
// the renderer ids; these are the pieces its bootstrap composes
export {
  codecFidelityEvidenceRecords,
  serviceProviderFidelityEvidenceRecord,
  createEvidenceRegistry,
  createRawWriter,
  createSubjectEditing,
  resolveFormatWriter,
} from '@modkit/host'
export { createFileEditingBackend } from '@modkit/host/node'
// Installed-game map resources are resolved in main, beside the ordinary subject services that
// open their archives. The renderer receives only the resulting world session over capability RPC.
export { createNodeMapPreviewResourcePlanResolver } from '@modkit/host/node'
export { nestedSubjectServices, openNestedSubject, openNestedSubjectRef }
// S14: the renderer's editor ports over the subject RPC (it holds no grant of its own)
export {
  createRendererEditorPorts,
  type RendererEditorPorts,
  type RendererEditorPortsOptions,
} from './editor-ports.js'
// S7/C1: main.cjs opens files or bounded loose directories through the shared host adapter.
export { openFileArtifactSource, openPathArtifactSource } from '@modkit/host/node'
/*
 * Block 9 step 6: main opens the byte source itself, so it cannot use `createPathSubjectOpener`
 * wholesale — but a codec that declares companions returns a composite plan, and a composite
 * plan without a resolver fails closed on `x3.host/input-resolver-required`. This is the same
 * factory the path opener composes, reached from the one place Electron actually opens files.
 */
export { createFilesystemInputResolver } from '@modkit/host/node'
/*
 * The archive route, reached from the composition rather than the UI. `archive-stage.ts` still
 * previews an entry by extracting its bytes; this is what a stage will call when block 13–14
 * gives it somewhere to put the opened subject.
 */
export { type NestedSubjectResult } from '@modkit/host'
/*
 * Block 13 works 4–6: the same command runtime the CLI and VS Code run. `main.cjs` supplies the
 * one thing it cannot have — `openSubjectForRpc`, which already confines a path to the granted
 * roots — and owns nothing else about what a command does.
 */
export {
  commandSubjectsFrom,
  commandRequest,
  createSubjectCommandEndpoint,
  createSubjectCommandRuntime,
  type CommandContractDocument,
  type CommandProtocolRunOptions,
  type CommandReceipt,
  type CommandRequest,
  type CommandResult,
  type CommandRuntime,
  type SubjectCommandEndpoint,
} from '@modkit/host'
