import { uint64 } from '@modkitx-x3/core'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import type { Diagnostic } from '@modkitx-x3/core'
import type {
  CommandContractDocument,
  CommandOutputSink,
  CommandProgress,
  CommandReceipt,
  CommandRequest,
  ExecutionBackendRegistry,
  ExtensionInput,
  HostComposition,
  SubjectServices,
} from '@modkitx-x3/host'
import {
  commandSubjectsFrom,
  createSubjectCommandRuntime,
  describeSubjectCommandContracts,
  executeCommandRequest,
} from '@modkitx-x3/host'
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
  readonly extensionRootFailures: number
}

export interface AutomationHost {
  readonly composition: HostComposition
  /** The realm codecs run in (worker threads); automation steps that open subjects resolve for it. */
  readonly workers: HostComposition
  readonly executionBackends: ExecutionBackendRegistry
  /**
   * The product open path (S7): resolve against this realm's inventory, activate for the worker
   * realm's target — what an automation step calls to open a subject.
   */
  readonly subjects: SubjectServices
  /** Configured directories that could not be loaded; other roots remain available. */
  readonly extensionRootFailures: readonly ExtensionRootFailure[]
  /** Stable JSON contract for batch planners; it is derived from the live shared runtime. */
  readonly commandContracts: CommandContractDocument
  /** Execute one structured request through that runtime and the automation host's subject realm. */
  runCommand(request: CommandRequest, options: AutomationCommandOptions): Promise<CommandReceipt>
  describeHost(): AutomationHostDescription
}

export interface AutomationCommandOptions {
  /** Absolute directories the request is allowed to name; no implicit discovery is performed. */
  readonly roots: readonly string[]
  /** Optional batch-owned sink for export/convert output. */
  readonly writeOutput?: CommandOutputSink
  readonly progress?: (progress: CommandProgress) => void
  readonly signal?: AbortSignal
}

export interface AutomationHostOptions {
  /** User-configured extension directories. They always execute through the worker boundary. */
  readonly extensionRoots?: readonly (string | ExtensionRootRequest)[]
  /** Contribution ids switched off by automation configuration. */
  readonly disabledContributions?: readonly string[]
  /** Backend diagnostics of the worker realm (shared-process notice, restarts, crashes, stdio). */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void
}

export async function createAutomationHost(
  extensions: readonly ExtensionInput[] = [],
  options: AutomationHostOptions = {},
): Promise<AutomationHost> {
  const loadedRoots = await loadExtensionRoots(options.extensionRoots ?? [], {
    origin: 'installed',
  })
  const subjects = await createNodeSubjectServices({
    topology: createAutomationTopology(),
    realms: { host: AUTOMATION_REALM, workers: AUTOMATION_WORKER_REALM },
    extensions: [...extensions, ...loadedRoots.inputs],
    policy: AUTOMATION_WORKER_POLICY,
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
    runCommand: (request: CommandRequest, commandOptions: AutomationCommandOptions) =>
      executeCommandRequest(commandRuntime, request, {
        openSubject: commandSubjectsFrom(
          createPathSubjectOpener({
            subjects,
            roots: commandOptions.roots,
            grant: { id: 'automation-command', classes: ['read-source'] },
          }),
        ),
        ...(commandOptions.writeOutput === undefined
          ? {}
          : { writeOutput: commandOptions.writeOutput }),
        ...(commandOptions.progress === undefined ? {} : { progress: commandOptions.progress }),
        ...(commandOptions.signal === undefined ? {} : { signal: commandOptions.signal }),
      }),
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
        extensionRootFailures: loadedRoots.failures.length,
      }),
  })
}
