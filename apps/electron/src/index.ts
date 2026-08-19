import { canonicalJsonStringify, ModkitError, uint64, type Diagnostic } from '@modkitx-x3/core'
import {
  createHostTopology,
  type AnyDescriptor,
  type HostTopology,
  type PresentationPlan,
  type PresentationSlot,
} from '@modkitx-x3/sdk'
import {
  createBundledServiceDefinitionRegistry,
  createHostComposition,
  createSubjectServices,
  registerServiceDefinitionsOrThrow,
  resolvePresentationPlan,
  serviceDefinitionSurfaces,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
  type SubjectOpenRequest,
  type SubjectServices,
} from '@modkitx-x3/host'
import {
  createNodeExecutionBackends,
  loadExtensionDirectory,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
  type WorkerBackendPolicy,
} from '@modkitx-x3/host/node'

export {
  connectElectronSubjectRpc,
  exposeElectronSubjectRpc,
  ELECTRON_SUBJECT_SERVICES,
  ELECTRON_SUBJECT_SERVICES_URL,
  type ElectronSubjectOpener,
  type SubjectClientOpenResult,
  type SubjectOpenSnapshot,
  type SubjectOpenedSnapshot,
  type SubjectPreviewSession,
  type SubjectRpcClient,
  type SubjectRpcExposure,
  type SubjectUnresolvedSnapshot,
} from './subject-rpc.js'

export const ELECTRON_MAIN_REALM = 'org.modkitx.app.electron/main'
export const ELECTRON_RENDERER_REALM = 'org.modkitx.app.electron/renderer'
/**
 * Where codecs run: the worker threads of the main process (W4 in IMPLEMENTATION_NOTES). Portable
 * variants are resolved and activated for this realm; the renderer keeps receiving leases through
 * the preload broker (renderer ↔ main ↔ worker) and never hosts codec code.
 */
export const ELECTRON_WORKER_REALM = 'org.modkitx.app.electron/worker'

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

export const ELECTRON_BROKER_CHANNELS = Object.freeze([
  'filesystem.read-range',
  'filesystem.atomic-replace',
  'dialog.open-file',
  'dialog.open-directory',
  'dialog.accept-drop',
  'dialog.reopen-recent',
  'directory.list',
  'filesystem.read-file',
  'filesystem.write-file',
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
      readonly channel: 'filesystem.write-file'
      readonly payload: { readonly path: string; readonly bytes: Uint8Array }
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
    case 'filesystem.write-file':
      return text(payload['path']) && payload['bytes'] instanceof Uint8Array
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
    topologyId: 'org.modkitx.app/electron',
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
        policy: { id: 'org.modkitx.policy/electron-main', revision: '1' },
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
        policy: { id: 'org.modkitx.policy/electron-renderer', revision: '1' },
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
        policy: { id: 'org.modkitx.policy/electron-worker', revision: '1' },
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
}

/** The host's subject services (S7) plus the Electron application they were built from. */
export interface ElectronSubjectServices extends SubjectServices {
  readonly application: ElectronApp
}

/** One open request as the main process issues it (re-exported for the RPC and the tests). */
export type ElectronSubjectOpenRequest = SubjectOpenRequest

interface ElectronPresentationTicket {
  readonly bindingId: string
  readonly sessionId: string
}

/** Resolve the renderer's inert stage catalog against one already-opened session descriptor. */
export async function resolveElectronPresentationPlan(
  descriptor: AnyDescriptor,
  catalog: readonly PresentationSlot[],
  selection: {
    readonly sessionId: string
    readonly contributionId: string
    readonly variantId: string
  },
): Promise<PresentationPlan> {
  const digest = (plan: PresentationPlan) => `canonical:${canonicalJsonStringify(plan)}`
  const resolved = await resolvePresentationPlan<ElectronPresentationTicket>({
    descriptor,
    candidates: catalog.map(slot => ({
      ...slot,
      eligible: slot.bindings.every(binding => {
        const contract = 'dataSource' in binding ? binding.dataSource : binding
        return descriptor.dataSources.some(
          source => source.contract === contract.contract && source.major === contract.major,
        )
      }),
    })),
    digest,
    ticketMatches: binding =>
      binding.ticket.bindingId === binding.bindingId &&
      binding.ticket.sessionId === selection.sessionId,
    async resolveBinding(binding) {
      return {
        ...binding,
        offerId: `session:${binding.bindingId}`,
        providerId: selection.contributionId,
        variantId: selection.variantId,
        ticket: { bindingId: binding.bindingId, sessionId: selection.sessionId },
      }
    },
  })
  return resolved.plan
}

export async function createElectronApp(
  extensions: readonly ExtensionInput[] = [],
  options: ElectronAppOptions = {},
): Promise<ElectronApp> {
  const topology = createElectronTopology()
  const executionBackends =
    options.executionBackends ??
    createNodeExecutionBackends({
      policy: ELECTRON_WORKER_POLICY,
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    })
  const [main, renderer, workers] = await Promise.all([
    createHostComposition({
      topology,
      realmId: ELECTRON_MAIN_REALM,
      extensions,
      executionBackends,
    }),
    createHostComposition({ topology, realmId: ELECTRON_RENDERER_REALM, extensions }),
    createHostComposition({
      topology,
      realmId: ELECTRON_WORKER_REALM,
      extensions,
      executionBackends,
    }),
  ])
  return Object.freeze({ topology, main, renderer, workers, executionBackends })
}

/**
 * Load the generated first-party catalog into the privileged realm and prepare the one subject-open
 * pipeline used by Electron. The caller supplies explicit roots from the generated catalog; this
 * helper never scans the repository or trusts installed/linked extensions in-process.
 */
export interface ElectronSubjectServicesOptions {
  /** Backend diagnostics of the worker realm (shared-process notice, restarts, crashes, worker stdio). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export async function createElectronSubjectServices(
  extensionRoots: readonly string[],
  options: ElectronSubjectServicesOptions = {},
): Promise<ElectronSubjectServices> {
  const loaded = await Promise.all(extensionRoots.map(root => loadExtensionDirectory(root)))
  const bundled: readonly ExtensionInput[] = loaded.map(input => ({
    ...input,
    execution: { origin: 'bundled', allowTrustedInProcess: true },
  }))
  // Only generated first-party inputs reach this registry (bundled: every inventoried owner is a
  // namespace owner). Installed/linked extensions are never promoted by this bootstrap and need
  // an explicit namespace-delegation policy later. The registry is filled after composition; the
  // worker backend reads the surfaces at every spawn, so binding it first is fine.
  const definitions = createBundledServiceDefinitionRegistry()
  const executionBackends = createNodeExecutionBackends({
    policy: ELECTRON_WORKER_POLICY,
    foreignSurfaces: () => serviceDefinitionSurfaces(definitions),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  const application = await createElectronApp(bundled, { executionBackends })
  await registerServiceDefinitionsOrThrow(application.main.inventory, definitions)
  // codecs are resolved against main's inventory and activated for the worker realm: portable
  // variants, worker-brokered; the gate refuses (never downgrades) a candidate without a boundary
  const services = createSubjectServices({
    inventory: application.main.inventory,
    target: application.workers.target,
    executionBackends: application.executionBackends,
    serviceDefinitions: definitions,
  })
  return Object.freeze({ ...services, application })
}

/*
 * R6: the renderer's subject traffic is capability-RPC (see ./subject-rpc.ts). The old
 * `ElectronSubjectRequest` validator and its bounded-clone walker are gone with the IPC they
 * guarded — frame validation now happens in the protocol core on both sides of the port.
 */

export { createGrantedRoots, type GrantedRoots, type PathTools } from './roots.js'
// S7: main.cjs opens files through the host's revision-checked adapter (no private copy here)
export { openFileArtifactSource } from '@modkitx-x3/host/node'
