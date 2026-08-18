import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import type { Diagnostic } from '@modkitx-x3/core'
import {
  createHostComposition,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
} from '@modkitx-x3/host'
import {
  createNodeExecutionBackends,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
  type WorkerBackendPolicy,
} from '@modkitx-x3/host/node'

export const SERVER_REALM = 'org.modkitx.app.server/main'
/** Worker threads of the server process: where portable (`worker-brokered`) variants run. */
export const SERVER_WORKER_REALM = 'org.modkitx.app.server/worker'

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
    topologyId: 'org.modkitx.app/server',
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
        policy: { id: 'org.modkitx.policy/server-deployment', revision: '1' },
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
        policy: { id: 'org.modkitx.policy/server-worker', revision: '1' },
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
}

export interface ServerApp {
  readonly composition: HostComposition
  /** The realm codecs run in (worker threads); requests that open subjects resolve for its target. */
  readonly workers: HostComposition
  readonly executionBackends: ExecutionBackendRegistry
  health(): ServerHealthSnapshot
}

export interface ServerAppOptions {
  readonly executionBackends?: ExecutionBackendRegistry
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export async function createServerApp(
  extensions: readonly ExtensionInput[] = [],
  options: ServerAppOptions = {},
): Promise<ServerApp> {
  const topology = createServerTopology()
  const executionBackends =
    options.executionBackends ??
    createNodeExecutionBackends({
      policy: SERVER_WORKER_POLICY,
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    })
  const [composition, workers] = await Promise.all([
    createHostComposition({ topology, realmId: SERVER_REALM, extensions, executionBackends }),
    createHostComposition({
      topology,
      realmId: SERVER_WORKER_REALM,
      extensions,
      executionBackends,
    }),
  ])
  return Object.freeze({
    composition,
    workers,
    executionBackends,
    health: () =>
      Object.freeze({
        status: composition.inventory.diagnostics.some(item => item.severity === 'error')
          ? 'degraded'
          : 'ok',
        topologyId: composition.topology.topologyId,
        realmId: composition.profile.realmId,
        profileRevision: composition.profile.revision,
        extensionCount: composition.inventory.extensions.length,
        diagnosticCount: composition.inventory.diagnostics.length,
      }),
  })
}
