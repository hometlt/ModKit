import { uint64 } from '@modkit/core'
import { createHostTopology, type HostTopology } from '@modkit/sdk'
import type { Diagnostic } from '@modkit/core'
import type { PermissionGrant, ResourceBudget } from '@modkit/sdk'
import {
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  describeSubjectCommandContracts,
  executeCommandRequest,
  exposeSubjectRpc,
  type CommandContractDocument,
  type CommandOutputSink,
  type CommandProgress,
  type CommandReceipt,
  type CommandRequest,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
  type SubjectRpcExposure,
  type SubjectServices,
} from '@modkit/host'
import type { MessagePortFrameOptions, MessagePortLike } from '@modkit/host/execution'
import {
  createNodeSubjectServices,
  createPathSubjectOpener,
  loadExtensionRoots,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
  type ExtensionRootFailure,
  type ExtensionRootRequest,
  type WorkerBackendPolicy,
} from '@modkit/host/node'

export const SERVER_REALM = 'modkit.app.server/main'
/** Worker threads of the server process: where portable (`worker-brokered`) variants run. */
export const SERVER_WORKER_REALM = 'modkit.app.server/worker'

/** Worker policy of a server deployment (larger heaps, longer deadlines, more restarts). */
export const SERVER_WORKER_POLICY: WorkerBackendPolicy = workerBackendPolicy({
  resourceLimits: {
    maxOldGenerationSizeMb: 2048,
    maxYoungGenerationSizeMb: 256,
    codeRangeSizeMb: 256,
    stackSizeMb: 16,
  },
  loadDeadlineMs: 30_000,
  defaultCallDeadlineMs: 300_000,
  graceMs: 5_000,
  outputCapBytes: 1024 * 1024,
  maxRestartsPerLease: 10,
})

export function createServerTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'modkit.app/server',
    realms: [
      {
        schemaVersion: 1,
        realmId: SERVER_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native-process.rpc',
          'native.load',
          'network.range-fetch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 32,
          maxWorkerCount: 16,
          maxResidentBytes: uint64('17179869184'),
          maxTransferBytes: uint64('1073741824'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'modkit.policy/server-deployment', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: SERVER_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('1073741824'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'modkit.policy/server-worker', revision: '1' },
      }),
    ],
    links: [...nodeWorkerLinks(SERVER_REALM, SERVER_WORKER_REALM)],
  })
}

export interface ServerHealthSnapshot {
  readonly status: 'ok' | 'degraded'
  readonly topologyId: string
  readonly realmId: string
  readonly profileRevision: string
  readonly extensionCount: number
  readonly diagnosticCount: number
  readonly extensionRootFailureCount: number
}

export interface ServerSubjectRpcOptions {
  /** The port the server hands to a client realm or process (anything `framePortFromMessagePort` adapts). */
  readonly port: MessagePortLike
  readonly listener?: MessagePortFrameOptions['listener']
  /** Endpoint identity the client must connect with. */
  readonly session: string
  readonly generation?: number
  /** Absolute directories clients may open files from; nothing outside them is ever stat'ed. */
  readonly roots: readonly string[]
  /** The grant opens run under (default: `read-source` only). */
  readonly grant?: PermissionGrant
  readonly budget?: ResourceBudget
  readonly onDiagnostic?: (diagnostic: { code: string; message: string }) => void
}

export interface ServerApp {
  readonly composition: HostComposition
  /** The realm codecs run in (worker threads); requests that open subjects resolve for its target. */
  readonly workers: HostComposition
  readonly executionBackends: ExecutionBackendRegistry
  /**
   * The product open path (S7): resolve against this realm's inventory, activate for the worker
   * realm's target — what a request handler calls to open a subject for a client.
   */
  readonly subjects: SubjectServices
  /** Configured directories that could not be loaded; other roots remain available. */
  readonly extensionRootFailures: readonly ExtensionRootFailure[]
  /** Stable JSON contract exposed to server clients; derived from the shared live runtime. */
  readonly commandContracts: CommandContractDocument
  /** Execute one structured request through the shared runtime and the server's subject realm. */
  runCommand(request: CommandRequest, options: ServerCommandOptions): Promise<CommandReceipt>
  /**
   * The product RPC path (S9): serve `x3.app/subject-services@1` (`open` → snapshot,
   * `attach` → the live session under `x3.abi/asset-session@1`) over a port, with file access
   * confined to `roots`. The same root Electron serves its renderer.
   */
  exposeSubjectRpc(options: ServerSubjectRpcOptions): SubjectRpcExposure
  health(): ServerHealthSnapshot
}

export interface ServerCommandOptions {
  /** Absolute directories the client request is allowed to name. */
  readonly roots: readonly string[]
  readonly grant?: PermissionGrant
  readonly writeOutput?: CommandOutputSink
  readonly progress?: (progress: CommandProgress) => void
  readonly signal?: AbortSignal
}

export interface ServerAppOptions {
  /** User-configured extension directories. They always execute through the worker boundary. */
  readonly extensionRoots?: readonly (string | ExtensionRootRequest)[]
  /** Contribution ids switched off by deployment configuration. */
  readonly disabledContributions?: readonly string[]
  /** Backend diagnostics of the worker realm (shared-process notice, restarts, crashes, stdio). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export async function createServerApp(
  extensions: readonly ExtensionInput[] = [],
  options: ServerAppOptions = {},
): Promise<ServerApp> {
  const loadedRoots = await loadExtensionRoots(options.extensionRoots ?? [], {
    origin: 'installed',
  })
  const subjects = await createNodeSubjectServices({
    topology: createServerTopology(),
    realms: { host: SERVER_REALM, workers: SERVER_WORKER_REALM },
    extensions: [...extensions, ...loadedRoots.inputs],
    policy: SERVER_WORKER_POLICY,
    ...(options.disabledContributions === undefined
      ? {}
      : { disabledContributions: options.disabledContributions }),
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
  const { host: composition, workers, executionBackends } = subjects
  const commandRuntime = createSubjectCommandRuntime()
  const commandContracts = describeSubjectCommandContracts()
  return Object.freeze({
    composition,
    workers,
    executionBackends,
    subjects,
    extensionRootFailures: loadedRoots.failures,
    commandContracts,
    runCommand: (request: CommandRequest, commandOptions: ServerCommandOptions) =>
      executeCommandRequest(commandRuntime, request, {
        openSubject: commandSubjectsFrom(
          createPathSubjectOpener({
            subjects,
            roots: commandOptions.roots,
            grant: commandOptions.grant ?? {
              id: 'server-command',
              classes: ['read-source'],
            },
          }),
        ),
        ...(commandOptions.writeOutput === undefined
          ? {}
          : { writeOutput: commandOptions.writeOutput }),
        ...(commandOptions.progress === undefined ? {} : { progress: commandOptions.progress }),
        ...(commandOptions.signal === undefined ? {} : { signal: commandOptions.signal }),
      }),
    exposeSubjectRpc: (rpc: ServerSubjectRpcOptions) =>
      exposeSubjectRpc({
        port: rpc.port,
        ...(rpc.listener === undefined ? {} : { listener: rpc.listener }),
        session: rpc.session,
        ...(rpc.generation === undefined ? {} : { generation: rpc.generation }),
        open: createPathSubjectOpener({
          subjects,
          roots: rpc.roots,
          ...(rpc.grant === undefined ? {} : { grant: rpc.grant }),
          ...(rpc.budget === undefined ? {} : { budget: rpc.budget }),
        }),
        ...(rpc.onDiagnostic === undefined ? {} : { onDiagnostic: rpc.onDiagnostic }),
      }),
    health: () =>
      Object.freeze({
        status:
          loadedRoots.failures.length > 0 ||
          composition.inventory.diagnostics.some(item => item.severity === 'error')
            ? 'degraded'
            : 'ok',
        topologyId: composition.topology.topologyId,
        realmId: composition.profile.realmId,
        profileRevision: composition.profile.revision,
        extensionCount: composition.inventory.extensions.length,
        diagnosticCount: composition.inventory.diagnostics.length,
        extensionRootFailureCount: loadedRoots.failures.length,
      }),
  })
}
