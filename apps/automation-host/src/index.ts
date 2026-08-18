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

export const AUTOMATION_REALM = 'org.modkitx.app.automation/main'
/** Worker threads of the automation process: where portable (`worker-brokered`) variants run. */
export const AUTOMATION_WORKER_REALM = 'org.modkitx.app.automation/worker'

/** Worker policy of an automation run (batch work: roomy heaps, long deadlines). */
export const AUTOMATION_WORKER_POLICY: WorkerBackendPolicy = workerBackendPolicy({
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
  maxRestartsPerLease: 3,
})

export function createAutomationTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/automation-host',
    realms: [
      {
        schemaVersion: 1,
        realmId: AUTOMATION_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'filesystem.read-random',
          'native-process.rpc',
          'network.range-fetch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 8,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'org.modkitx.policy/automation-default', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: AUTOMATION_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 16,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('8589934592'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 300_000,
        },
        policy: { id: 'org.modkitx.policy/automation-worker', revision: '1' },
      }),
    ],
    links: [...nodeWorkerLinks(AUTOMATION_REALM, AUTOMATION_WORKER_REALM)],
  })
}

export interface AutomationHostDescription {
  readonly topologyId: string
  readonly realmId: string
  readonly facilities: readonly string[]
  readonly contributions: readonly string[]
  readonly diagnostics: number
}

export interface AutomationHost {
  readonly composition: HostComposition
  /** The realm codecs run in (worker threads); automation steps that open subjects resolve for it. */
  readonly workers: HostComposition
  readonly executionBackends: ExecutionBackendRegistry
  describeHost(): AutomationHostDescription
}

export interface AutomationHostOptions {
  readonly executionBackends?: ExecutionBackendRegistry
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export async function createAutomationHost(
  extensions: readonly ExtensionInput[] = [],
  options: AutomationHostOptions = {},
): Promise<AutomationHost> {
  const topology = createAutomationTopology()
  const executionBackends =
    options.executionBackends ??
    createNodeExecutionBackends({
      policy: AUTOMATION_WORKER_POLICY,
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
    })
  const [composition, workers] = await Promise.all([
    createHostComposition({ topology, realmId: AUTOMATION_REALM, extensions, executionBackends }),
    createHostComposition({
      topology,
      realmId: AUTOMATION_WORKER_REALM,
      extensions,
      executionBackends,
    }),
  ])
  return Object.freeze({
    composition,
    workers,
    executionBackends,
    describeHost: () =>
      Object.freeze({
        topologyId: composition.topology.topologyId,
        realmId: composition.profile.realmId,
        facilities: composition.profile.facilities,
        contributions: Object.freeze(
          composition.inventory.extensions.flatMap(extension =>
            extension.contributions.flatMap(contribution =>
              contribution.manifest === undefined ? [] : [contribution.manifest.id],
            ),
          ),
        ),
        diagnostics: composition.inventory.diagnostics.length,
      }),
  })
}
