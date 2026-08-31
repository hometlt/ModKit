import { uint64 } from '@modkitx-x3/core'
import { sceneModule } from '@modkitx-x3/scene/module'
import { createHostTopology, type HostTopology } from '@modkitx-x3/sdk'
import { uvModule } from '@modkitx-x3/uv/module'
import {
  createHostComposition,
  linkedExtensionInputs,
  type ExecutionBackendRegistry,
  type ExtensionInput,
  type HostComposition,
} from '@modkitx-x3/host'
import type { Diagnostic } from '@modkitx-x3/core'
import {
  createNodeExecutionBackends,
  createNodeSubjectServices,
  nodeRuntimeTargetBase,
  nodeWorkerLinks,
  nodeWorkerRealmProfile,
  workerBackendPolicy,
  type NodeSubjectServices,
  type WorkerBackendPolicy,
} from '@modkitx-x3/host/node'

const CLI_BUILTIN_MODULES = /* @__PURE__ */ linkedExtensionInputs([sceneModule, uvModule])

export const MODKIT_CLI_REALM = 'org.modkitx.app.cli/main'
/** Worker threads of the CLI process: where portable (`worker-brokered`) variants run. */
export const MODKIT_CLI_WORKER_REALM = 'org.modkitx.app.cli/worker'

/** Worker policy of the CLI (a short-lived tool: small heaps, short deadlines). */
export const MODKIT_CLI_WORKER_POLICY: WorkerBackendPolicy = workerBackendPolicy({
  resourceLimits: {
    maxOldGenerationSizeMb: 512,
    maxYoungGenerationSizeMb: 64,
    codeRangeSizeMb: 64,
    stackSizeMb: 4,
  },
  loadDeadlineMs: 15_000,
  defaultCallDeadlineMs: 30_000,
  graceMs: 1_000,
  outputCapBytes: 64 * 1024,
  maxRestartsPerLease: 1,
})

export function createModkitCliTopology(): HostTopology {
  return createHostTopology({
    schemaVersion: 1,
    topologyId: 'org.modkitx.app/cli',
    realms: [
      {
        schemaVersion: 1,
        realmId: MODKIT_CLI_REALM,
        revision: '1',
        target: nodeRuntimeTargetBase(),
        facilities: [
          'directory.watch',
          'filesystem.atomic-replace',
          'filesystem.read-random',
          'native.load',
          'process.launch',
          'worker.module',
        ],
        budgets: {
          maxConcurrentTasks: 8,
          maxWorkerCount: 4,
          maxResidentBytes: uint64('4294967296'),
          maxTransferBytes: uint64('536870912'),
          defaultDeadlineMs: 120_000,
        },
        policy: { id: 'org.modkitx.policy/cli-default', revision: '1' },
      },
      nodeWorkerRealmProfile({
        realmId: MODKIT_CLI_WORKER_REALM,
        budgets: {
          maxConcurrentTasks: 4,
          maxWorkerCount: 0,
          maxResidentBytes: uint64('2147483648'),
          maxTransferBytes: uint64('268435456'),
          defaultDeadlineMs: 60_000,
        },
        policy: { id: 'org.modkitx.policy/cli-worker', revision: '1' },
      }),
    ],
    links: [...nodeWorkerLinks(MODKIT_CLI_REALM, MODKIT_CLI_WORKER_REALM)],
  })
}

export interface ModkitCliCompositionOptions {
  /** Which realm to compose: the host process (default) or its worker realm. */
  readonly realmId?: typeof MODKIT_CLI_REALM | typeof MODKIT_CLI_WORKER_REALM
  /** Defaults to the trusted in-process backend plus the Node worker backend under the CLI policy. */
  readonly executionBackends?: ExecutionBackendRegistry
}

/** The CLI's execution backends: trusted in-process (gated per artifact) + Node worker threads. */
export function createModkitCliExecutionBackends(): ExecutionBackendRegistry {
  return createNodeExecutionBackends({
    policy: MODKIT_CLI_WORKER_POLICY,
    linkedModules: CLI_BUILTIN_MODULES.modules,
  })
}

export function createModkitCliComposition(
  extensions: readonly ExtensionInput[] = [],
  options: ModkitCliCompositionOptions = {},
): Promise<HostComposition> {
  return createHostComposition({
    topology: createModkitCliTopology(),
    realmId: options.realmId ?? MODKIT_CLI_REALM,
    extensions: [...CLI_BUILTIN_MODULES.inputs, ...extensions],
    executionBackends: options.executionBackends ?? createModkitCliExecutionBackends(),
  })
}

/**
 * The CLI's product open path (S7, `modkit open`): resolve against the process realm's inventory,
 * activate for the worker realm — portable variants run worker-brokered in worker threads of the
 * CLI process; in-process execution needs the artifact's own `allowTrustedInProcess`.
 */
export function createModkitCliSubjectServices(
  extensions: readonly ExtensionInput[],
  options: { readonly onDiagnostic?: (diagnostic: Diagnostic) => void } = {},
): Promise<NodeSubjectServices> {
  return createNodeSubjectServices({
    topology: createModkitCliTopology(),
    realms: { host: MODKIT_CLI_REALM, workers: MODKIT_CLI_WORKER_REALM },
    extensions: [...CLI_BUILTIN_MODULES.inputs, ...extensions],
    linkedModules: CLI_BUILTIN_MODULES.modules,
    policy: MODKIT_CLI_WORKER_POLICY,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
  })
}
